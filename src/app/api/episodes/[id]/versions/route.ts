// POST multipart: a new cut of an existing episode, with open notes carried forward.
import { desc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb, schema } from "@/db";
import { parseId } from "@/lib/ids";
import { readVideoField, removeStored, streamToDisk } from "@/lib/uploads";
import { ConflictError, createVersionWithCarryForward } from "@/lib/versions";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/episodes/[id]/versions">) {
  const episodeId = parseId((await ctx.params).id);
  if (!episodeId) return Response.json({ error: "Episode not found" }, { status: 404 });
  const db = getDb();
  const latest = db
    .select({ aiStatus: schema.versions.aiStatus })
    .from(schema.versions)
    .where(eq(schema.versions.episodeId, episodeId))
    .orderBy(desc(schema.versions.number))
    .limit(1)
    .get();
  if (!latest) return Response.json({ error: "Episode not found" }, { status: 404 });
  if (latest.aiStatus === "running") {
    return Response.json(
      { error: "Wait for the AI review of the current cut to finish before uploading a new one" },
      { status: 409 },
    );
  }

  const form = await req.formData();
  const video = readVideoField(form.get("video"), form.get("durationS"));
  if ("error" in video) return Response.json({ error: video.error }, { status: 400 });

  await streamToDisk(video.file, video.storedPath);
  try {
    const created = createVersionWithCarryForward(episodeId, {
      videoPath: video.storedPath,
      mimeType: video.file.type,
      durationS: video.durationS,
    });
    return Response.json(created, { status: 201 });
  } catch (err) {
    await removeStored(video.storedPath);
    if (err instanceof ConflictError) return Response.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
