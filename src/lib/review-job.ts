// The AI review job: load context, make sure Gemini has the video, call the model once,
// validate the answer and store it in one transaction. Fenced by the run id so a stale job
// can never overwrite a newer one.
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { getDb, schema } from "@/db";
import { pickExemplars } from "@/lib/exemplars";
import {
  createClient,
  describeGeminiError,
  ensureVideoFile,
  generateReview,
  getModelIds,
  type Stage,
} from "@/lib/gemini";
import { appendLedger } from "@/lib/ledger";
import { estimateCost, type TokenUsage } from "@/lib/pricing";
import {
  buildContents,
  buildResponseSchema,
  buildSystemInstruction,
  promptVersion,
  type CastInput,
  type NotedInput,
  type OpenNoteInput,
  type ReviewInput,
} from "@/lib/prompt";
import { reviewConfigFromEnv } from "@/lib/review-config";
import { composeSummary, normalizeReview } from "@/lib/review-output";
import { fmtTime, pacificDate } from "@/lib/time";
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
  cutLabel: string;
  absVideoPath: string;
  mimeType: string;
  cached: { name: string; uri: string; expiresAt: number | null } | null;
};

function loadContext(versionId: number, exemplarCount: number): Context {
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
    cutLabel: `${row.series.name}/${row.episode.title}/v${v.number}`,
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
      seriesBible: row.series.bible,
      cast: castInput,
      alreadyNoted,
      openNotes,
      exemplars: pickExemplars(row.episode.id, row.series.id, exemplarCount),
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
  const models = getModelIds();
  let model = models[0];
  const config = reviewConfigFromEnv();
  const version = promptVersion(config.prompt);

  try {
    const ctx = loadContext(versionId, config.prompt.exemplars);
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
      models,
      buildContents(ctx.input, config.prompt.arm, config.prompt.video),
      buildResponseSchema(castNames, aliases, config.prompt.arm),
      buildSystemInstruction(config.prompt.arm),
      {
        thinking: config.prompt.thinking,
        seed: config.seed,
        retryWaitMs: 30_000,
        onAttempt: (a) => {
          const now = Date.now();
          appendLedger({
            at: new Date(now).toISOString(),
            pacificDate: pacificDate(now),
            model: a.model,
            source: "app",
            cut: ctx.cutLabel,
            status: a.status,
            httpStatus: a.httpStatus,
            generateS: Math.round(a.generateS * 10) / 10,
            promptVersion: version,
            runIndex: null,
          });
        },
      },
    );
    usage = result.usage;
    model = result.model;

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
          promptVersion: version,
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
    if (err instanceof Error && err.message !== message) {
      // The raw message helps debugging; the key never appears in it, but redact just in case.
      const raw = err.message.replace(/AIza[0-9A-Za-z_-]{35}/g, "[key]").slice(0, 400);
      console.error(`[review] raw ${err.name}${"status" in err ? ` ${String(err.status)}` : ""}: ${raw}`);
    }
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
