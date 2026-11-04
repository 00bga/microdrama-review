// Strategist notes from other episodes, shown to the model as a sample of how this team writes
// (density and bluntness), never the episode under review. Same series first, then any series,
// in note-id order so the pick is deterministic. The eval runner applies a stricter rule (other
// series only) so a held-out cut never sees notes from its own series; see docs/accuracy.md.
import { and, asc, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";

const { episodes, notes, versions } = schema;

/** The note text as the strategist wrote it: the body up to its first reply, at most 240 characters. */
export function exemplarText(body: string, max = 240): string {
  const first = body.split(/\n\s*\n\s*Reply:/)[0].replace(/\s+/g, " ").trim();
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > 60 ? cut.slice(0, space) : cut}...`;
}

export function pickExemplars(episodeId: number, seriesId: number, limit: number): string[] {
  if (limit <= 0) return [];
  const db = getDb();
  const query = (sameSeries: boolean, take: number) =>
    db
      .select({ body: notes.body })
      .from(notes)
      .innerJoin(versions, eq(versions.id, notes.versionId))
      .innerJoin(episodes, eq(episodes.id, versions.episodeId))
      .where(
        and(
          eq(notes.source, "human"),
          ne(episodes.id, episodeId),
          sameSeries ? eq(episodes.seriesId, seriesId) : ne(episodes.seriesId, seriesId),
        ),
      )
      .orderBy(asc(notes.id))
      .limit(take)
      .all()
      .map((r) => exemplarText(r.body))
      .filter((t) => t.length > 0);
  const same = query(true, limit);
  if (same.length >= limit) return same;
  return [...same, ...query(false, limit - same.length)];
}
