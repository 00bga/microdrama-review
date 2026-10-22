// Creating episodes and versions. Both run as one synchronous SQLite transaction.
import { and, asc, desc, eq, max } from "drizzle-orm";
import { getDb, schema } from "@/db";

const { episodes, notes, versions } = schema;

export type NewCut = { videoPath: string; mimeType: string; durationS: number };

export class ConflictError extends Error {}

export function createEpisodeWithFirstCut(
  seriesId: number,
  title: string,
  cut: NewCut,
  /** the episode number; the next free number when omitted */
  requestedNumber?: number,
): { episodeId: number; versionId: number; number: number } {
  const db = getDb();
  return db.transaction((tx) => {
    const now = Date.now();
    const top = tx
      .select({ n: max(episodes.number) })
      .from(episodes)
      .where(eq(episodes.seriesId, seriesId))
      .get();
    const number = requestedNumber ?? (top?.n ?? 0) + 1;
    const episode = tx
      .insert(episodes)
      .values({ seriesId, number, title, status: "pending", createdAt: now, updatedAt: now })
      .returning({ id: episodes.id })
      .get();
    const version = tx
      .insert(versions)
      .values({ episodeId: episode.id, number: 1, ...cut, createdAt: now })
      .returning({ id: versions.id })
      .get();
    return { episodeId: episode.id, versionId: version.id, number: 1 };
  });
}

/**
 * New version N+1: copies every open note of N (carriedFromNoteId set, verdicts cleared) and
 * sends an approved episode back to review. N's own notes are never touched.
 */
export function createVersionWithCarryForward(
  episodeId: number,
  cut: NewCut,
): { versionId: number; number: number } {
  const db = getDb();
  return db.transaction((tx) => {
    const now = Date.now();
    const previous = tx
      .select()
      .from(versions)
      .where(eq(versions.episodeId, episodeId))
      .orderBy(desc(versions.number))
      .limit(1)
      .get();
    if (!previous) throw new Error("Episode has no versions");
    if (previous.aiStatus === "running") {
      throw new ConflictError("Wait for the AI review of the current cut to finish before uploading a new one");
    }
    const number = previous.number + 1;
    const created = tx
      .insert(versions)
      .values({ episodeId, number, ...cut, createdAt: now })
      .returning({ id: versions.id })
      .get();

    const open = tx
      .select()
      .from(notes)
      .where(and(eq(notes.versionId, previous.id), eq(notes.status, "open")))
      .orderBy(asc(notes.tStart), asc(notes.id))
      .all();
    if (open.length > 0) {
      tx.insert(notes)
        .values(
          open.map((n) => ({
            versionId: created.id,
            tStart: n.tStart,
            tEnd: n.tEnd,
            category: n.category,
            severity: n.severity,
            title: n.title,
            body: n.body,
            evidence: n.evidence,
            castMemberId: n.castMemberId,
            source: n.source,
            status: "open" as const,
            carriedFromNoteId: n.id,
            aiFixAssessment: null,
            aiFixRationale: null,
            suggestedTStart: null,
            suggestedTEnd: null,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .run();
    }

    tx.update(episodes)
      .set({ status: "in_review", updatedAt: now })
      .where(and(eq(episodes.id, episodeId), eq(episodes.status, "approved")))
      .run();
    tx.update(episodes).set({ updatedAt: now }).where(eq(episodes.id, episodeId)).run();
    return { versionId: created.id, number };
  });
}
