// POST starts the AI review of a cut (202), GET reports its progress for polling.
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { after, type NextRequest } from "next/server";
import { getDb, schema } from "@/db";
import { parseId } from "@/lib/ids";
import { runReview } from "@/lib/review-job";

const { versions } = schema;
const STALE_MS = 10 * 60_000;

function statusOf(versionId: number) {
  const v = getDb()
    .select({
      aiStatus: versions.aiStatus,
      aiStage: versions.aiStage,
      aiStartedAt: versions.aiStartedAt,
      aiFinishedAt: versions.aiFinishedAt,
      aiError: versions.aiError,
    })
    .from(versions)
    .where(eq(versions.id, versionId))
    .get();
  return v ?? null;
}

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/versions/[id]/review">) {
  const versionId = parseId((await ctx.params).id);
  const status = versionId ? statusOf(versionId) : null;
  if (!status) return Response.json({ error: "Version not found" }, { status: 404 });
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(_req: NextRequest, ctx: RouteContext<"/api/versions/[id]/review">) {
  const versionId = parseId((await ctx.params).id);
  if (!versionId) return Response.json({ error: "Version not found" }, { status: 404 });
  const db = getDb();
  const version = db.select().from(versions).where(eq(versions.id, versionId)).get();
  if (!version) return Response.json({ error: "Version not found" }, { status: 404 });
  const latest = db
    .select({ number: versions.number })
    .from(versions)
    .where(eq(versions.episodeId, version.episodeId))
    .orderBy(desc(versions.number))
    .limit(1)
    .get();
  if (latest && latest.number !== version.number) {
    return Response.json({ error: "Only the latest cut can be reviewed" }, { status: 409 });
  }

  const runId = crypto.randomUUID();
  const now = Date.now();
  // One conditional update is the lock: a running job that is not stale keeps the row.
  const claimed = db
    .update(versions)
    .set({ aiStatus: "running", aiStage: "uploading", aiRunId: runId, aiStartedAt: now, aiFinishedAt: null, aiError: null })
    .where(
      and(
        eq(versions.id, versionId),
        or(
          inArray(versions.aiStatus, ["idle", "error", "done"]),
          and(eq(versions.aiStatus, "running"), lt(versions.aiStartedAt, now - STALE_MS)),
        ),
      ),
    )
    .run();
  if (claimed.changes === 0) {
    return Response.json({ error: "An AI review is already running for this cut" }, { status: 409 });
  }

  after(() =>
    runReview(versionId, runId).catch((err) => {
      console.error("[review] unexpected failure", err instanceof Error ? err.message : err);
    }),
  );
  return Response.json({ started: true, runId }, { status: 202 });
}
