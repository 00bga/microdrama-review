// The AI review job: load context, make sure Gemini has the video, call the model once,
// validate the answer and store it in one transaction. Fenced by the run id so a stale job
// can never overwrite a newer one.
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { getDb, schema } from "@/db";
import {
  createClient,
  describeGeminiError,
  ensureVideoFile,
  generateReview,
  getModelId,
  type Stage,
} from "@/lib/gemini";
import { estimateCost, type TokenUsage } from "@/lib/pricing";
import {
  buildContents,
  buildResponseSchema,
  PROMPT_VERSION,
  SYSTEM_INSTRUCTION,
  type CastInput,
  type NotedInput,
  type OpenNoteInput,
  type ReviewInput,
} from "@/lib/prompt";
import { composeSummary, normalizeReview } from "@/lib/review-output";
import { fmtTime } from "@/lib/time";
import { resolveDataPath } from "@/lib/uploads";

const { castMembers, episodes, notes, series, versions } = schema;

/** Cast names must be unique in the schema enum; a duplicate gets a numeric suffix. */
export function uniqueCastNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw) => {
    const name = raw.trim() || "Unnamed";
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name} (${count + 1})`;
  });
}

type Context = {
  input: ReviewInput;
  castByName: Map<string, number>;
  openByAlias: Map<string, number>;
  episodeId: number;
  absVideoPath: string;
  mimeType: string;
  cached: { name: string; uri: string; expiresAt: number | null } | null;
};

function loadContext(versionId: number): Context {
  const db = getDb();
  const row = db
    .select({ version: versions, episode: episodes, series: series })
    .from(versions)
    .innerJoin(episodes, eq(episodes.id, versions.episodeId))
    .innerJoin(series, eq(series.id, episodes.seriesId))
    .where(eq(versions.id, versionId))
    .get();
  if (!row) throw new Error("Version not found");

  const cast = db
    .select()
    .from(castMembers)
    .where(eq(castMembers.seriesId, row.series.id))
    .orderBy(asc(castMembers.id))
    .all();
  const names = uniqueCastNames(cast.map((c) => c.name));
  const castByName = new Map<string, number>();
  const castInput: CastInput[] = cast.map((c, i) => {
    castByName.set(names[i], c.id);
    return {
      name: names[i],
      description: c.description,
      mimeType: c.imageMime,
      base64: readFileSync(resolveDataPath(c.imagePath)).toString("base64"),
    };
  });

  const versionNotes = db
    .select()
    .from(notes)
    .where(eq(notes.versionId, versionId))
    .orderBy(asc(notes.tStart), asc(notes.id))
    .all();
  const previousNumber = row.version.number - 1;
  const alreadyNoted: NotedInput[] = [];
  const openNotes: OpenNoteInput[] = [];
  const openByAlias = new Map<string, number>();
  for (const n of versionNotes) {
    if (n.status === "draft") continue;
    const noted: NotedInput = {
      timecode: fmtTime(n.tStart),
      category: n.category,
      severity: n.severity,
      title: n.title,
      body: n.body,
    };
    if (n.status === "open" && n.carriedFromNoteId !== null) {
      const alias = `P${openNotes.length + 1}`;
      openByAlias.set(alias, n.id);
      openNotes.push({ ...noted, alias, fromVersion: Math.max(1, previousNumber) });
    } else {
      alreadyNoted.push(noted);
    }
  }

  const v = row.version;
  return {
    episodeId: row.episode.id,
    absVideoPath: resolveDataPath(v.videoPath),
    mimeType: v.mimeType,
    cached:
      v.geminiFileName && v.geminiFileUri
        ? { name: v.geminiFileName, uri: v.geminiFileUri, expiresAt: v.geminiFileExpiresAt }
        : null,
    castByName,
    openByAlias,
    input: {
      seriesName: row.series.name,
      episodeTitle: row.episode.title,
      episodeNumber: row.episode.number,
      versionNumber: v.number,
      durationS: v.durationS,
      cast: castInput,
      alreadyNoted,
      openNotes,
      video: { uri: "", mimeType: "" },
    },
  };
}

export async function runReview(versionId: number, runId: string): Promise<void> {
  const db = getDb();
  const fenced = and(eq(versions.id, versionId), eq(versions.aiRunId, runId));
  const setStage = (stage: Stage) => {
    db.update(versions).set({ aiStage: stage }).where(fenced).run();
  };
  let usage: TokenUsage | null = null;
  const model = getModelId();

  try {
    const ctx = loadContext(versionId);
    const ai = createClient();

    const file = await ensureVideoFile(
      ai,
      ctx.cached,
      ctx.absVideoPath,
      ctx.mimeType,
      `v${ctx.input.versionNumber} of episode ${ctx.input.episodeNumber}`,
      setStage,
    );
    db.update(versions)
      .set({ geminiFileName: file.name, geminiFileUri: file.uri, geminiFileExpiresAt: file.expiresAt })
      .where(eq(versions.id, versionId))
      .run();

    setStage("analysing");
    ctx.input.video = { uri: file.uri, mimeType: file.mimeType };
    const castNames = [...ctx.castByName.keys()];
    const aliases = [...ctx.openByAlias.keys()];
    const result = await generateReview(
      ai,
      model,
      buildContents(ctx.input),
      buildResponseSchema(castNames, aliases),
      SYSTEM_INSTRUCTION,
    );
    usage = result.usage;

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      throw new Error("Gemini answered with invalid JSON. Run it again");
    }
    const review = normalizeReview(parsed, {
      durationS: ctx.input.durationS,
      castByName: ctx.castByName,
      openByAlias: ctx.openByAlias,
    });
    const summaryParts = [composeSummary(review)];
    if (review.droppedNotes > 0) summaryParts.push(`${review.droppedNotes} note(s) dropped: invalid format`);
    const now = Date.now();

    db.transaction((tx) => {
      const current = tx.select({ runId: versions.aiRunId }).from(versions).where(eq(versions.id, versionId)).get();
      if (!current || current.runId !== runId) return; // a newer run took over

      tx.delete(notes)
        .where(and(eq(notes.versionId, versionId), eq(notes.source, "ai"), eq(notes.status, "draft")))
        .run();
      tx.update(notes)
        .set({ aiFixAssessment: null, aiFixRationale: null, suggestedTStart: null, suggestedTEnd: null })
        .where(and(eq(notes.versionId, versionId), isNotNull(notes.carriedFromNoteId)))
        .run();
      for (const a of review.assessments) {
        tx.update(notes)
          .set({
            aiFixAssessment: a.assessment,
            aiFixRationale: a.rationale,
            suggestedTStart: a.suggestedTStart,
            suggestedTEnd: a.suggestedTEnd,
            updatedAt: now,
          })
          .where(and(eq(notes.id, a.noteId), eq(notes.versionId, versionId)))
          .run();
      }
      if (review.notes.length > 0) {
        tx.insert(notes)
          .values(
            review.notes.map((n) => ({
              versionId,
              tStart: n.tStart,
              tEnd: n.tEnd,
              category: n.category,
              severity: n.severity,
              title: n.title,
              body: n.body,
              evidence: n.evidence,
              castMemberId: n.castMemberId,
              source: "ai" as const,
              status: "draft" as const,
              createdAt: now,
              updatedAt: now,
            })),
          )
          .run();
      }
      tx.update(versions)
        .set({
          aiStatus: "done",
          aiStage: null,
          aiFinishedAt: now,
          aiError: null,
          aiModel: model,
          promptVersion: PROMPT_VERSION,
          aiSummary: summaryParts.join("\n"),
          aiInputTokens: result.usage.input,
          aiOutputTokens: result.usage.output,
          aiThoughtTokens: result.usage.thoughts,
          aiCostUsd: estimateCost(model, result.usage),
        })
        .where(eq(versions.id, versionId))
        .run();
      tx.update(episodes)
        .set({ status: "in_review", updatedAt: now })
        .where(and(eq(episodes.id, ctx.episodeId), eq(episodes.status, "pending")))
        .run();
    });
  } catch (err) {
    const message = describeGeminiError(err);
    console.error(`[review] version ${versionId}: ${message}`);
    db.update(versions)
      .set({
        aiStatus: "error",
        aiStage: null,
        aiFinishedAt: Date.now(),
        aiError: message,
        aiModel: model,
        aiInputTokens: usage?.input ?? null,
        aiOutputTokens: usage?.output ?? null,
        aiThoughtTokens: usage?.thoughts ?? null,
      })
      .where(fenced)
      .run();
  }
}
