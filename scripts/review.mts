// Runs one AI review outside the app, with the exact request shape the app sends.
//
//   npm run review:cli -- --video E:/samples/v1.mp4 [--duration 87.4] [--cast "Mira=E:/samples/mira.png"]
//                         [--bible bible.txt] [--noted noted.json] [--open open.json] [--series Demo]
//                         [--episode "Ep 1"] [--version 1] [--model gemini-3.5-flash-lite] [--save run.json]
//
// --open takes a JSON array of {timecode, category, severity, title, body, fromVersion}; the items
// become P1..Pn. Uploads are cached in <video>.gemini.json next to the sample, outside the repo.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  createClient,
  describeGeminiError,
  ensureVideoFile,
  generateReview,
  getModelIds,
  parseModelList,
} from "@/lib/gemini";
import { mp4Duration } from "@/lib/mp4";
import { estimateCost, fmtUsd } from "@/lib/pricing";
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
import { VIDEO_TYPES } from "@/lib/uploads";

const { values } = parseArgs({
  options: {
    video: { type: "string" },
    duration: { type: "string" },
    cast: { type: "string", multiple: true, default: [] },
    bible: { type: "string" },
    noted: { type: "string" },
    open: { type: "string" },
    series: { type: "string", default: "Demo" },
    episode: { type: "string", default: "Episode 1" },
    number: { type: "string", default: "1" },
    version: { type: "string", default: "1" },
    model: { type: "string" },
    save: { type: "string" },
  },
});

if (!values.video) {
  console.error("Usage: npm run review:cli -- --video <file.mp4> [--duration s] [--cast Name=image.png] [--open open.json] [--save out.json]");
  process.exit(1);
}

const videoPath = path.resolve(values.video);
const videoBytes = readFileSync(videoPath);
const ext = path.extname(videoPath).toLowerCase();
const mimeType = Object.entries(VIDEO_TYPES).find(([, e]) => e === ext)?.[0] ?? "video/mp4";
const durationS = values.duration ? Number(values.duration) : mp4Duration(videoBytes);
if (!durationS || !Number.isFinite(durationS) || durationS <= 0) {
  console.error("Could not read the duration from the file; pass --duration <seconds>.");
  process.exit(1);
}

const IMAGE_MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const cast: CastInput[] = (values.cast ?? []).map((spec) => {
  const eq = spec.indexOf("=");
  if (eq < 1) throw new Error(`--cast expects Name=path, got "${spec}"`);
  const name = spec.slice(0, eq).trim();
  const [imagePath, description = ""] = spec.slice(eq + 1).split("|");
  const abs = path.resolve(imagePath.trim());
  const mime = IMAGE_MIME[path.extname(abs).toLowerCase()];
  if (!mime) throw new Error(`Unsupported cast image type: ${abs}`);
  return { name, description, mimeType: mime, base64: readFileSync(abs).toString("base64") };
});
const castByName = new Map(cast.map((c, i) => [c.name, i + 1]));

const seriesBible = values.bible ? readFileSync(values.bible, "utf8") : "";
const alreadyNoted: NotedInput[] = values.noted ? JSON.parse(readFileSync(values.noted, "utf8")) : [];
const openRaw: Omit<OpenNoteInput, "alias">[] = values.open ? JSON.parse(readFileSync(values.open, "utf8")) : [];
const openNotes: OpenNoteInput[] = openRaw.map((n, i) => ({ ...n, alias: `P${i + 1}` }));
const openByAlias = new Map(openNotes.map((n, i) => [n.alias, i + 1]));

const models = values.model?.trim() ? parseModelList(values.model) : getModelIds();
let model = models[0];
const ai = createClient();
const started = Date.now();
const stamp = (msg: string) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${msg}`);

// Upload cache next to the sample: the same bytes are not uploaded twice while the file is alive.
const cachePath = `${videoPath}.gemini.json`;
const sha256 = createHash("sha256").update(videoBytes).digest("hex");
type Cache = { sha256: string; name: string; uri: string; expiresAt: number | null };
let cached: Cache | null = existsSync(cachePath) ? (JSON.parse(readFileSync(cachePath, "utf8")) as Cache) : null;
if (cached && cached.sha256 !== sha256) cached = null;

try {
  const file = await ensureVideoFile(ai, cached, videoPath, mimeType, path.basename(videoPath), (s) => stamp(s));
  writeFileSync(cachePath, JSON.stringify({ sha256, ...file }, null, 2));
  stamp(`video ready: ${file.name} (${durationS.toFixed(1)} s)`);

  const input: ReviewInput = {
    seriesName: values.series ?? "Demo",
    episodeTitle: values.episode ?? "Episode 1",
    episodeNumber: Number(values.number ?? "1"),
    versionNumber: Number(values.version ?? "1"),
    durationS,
    seriesBible,
    cast,
    alreadyNoted,
    openNotes,
    video: { uri: file.uri, mimeType: file.mimeType },
  };
  const schema = buildResponseSchema([...castByName.keys()], [...openByAlias.keys()]);
  stamp(`calling ${models.join(", ")} (prompt ${PROMPT_VERSION}, ${cast.length} cast, ${alreadyNoted.length} noted, ${openNotes.length} open)`);
  const result = await generateReview(ai, models, buildContents(input), schema, SYSTEM_INSTRUCTION);
  model = result.model;
  const elapsedMs = Date.now() - started;
  const raw = JSON.parse(result.text);
  const review = normalizeReview(raw, { durationS, castByName, openByAlias });

  console.log("");
  for (const n of review.notes) {
    const who = n.castMemberId ? ` {${cast[n.castMemberId - 1]?.name}}` : "";
    const span = n.tEnd !== null ? `${fmtTime(n.tStart)}-${fmtTime(n.tEnd)}` : fmtTime(n.tStart);
    console.log(`${span.padEnd(11)} ${n.category.padEnd(11)} ${n.severity.padEnd(6)} ${n.title}${who}`);
    console.log(`            ${n.body}`);
    if (n.evidence) console.log(`            evidence: ${n.evidence}`);
  }
  for (const a of review.assessments) {
    const where = a.suggestedTStart !== null ? ` now at ${fmtTime(a.suggestedTStart)}` : "";
    console.log(`P${a.noteId} ${a.assessment}${where}: ${a.rationale}`);
  }
  console.log("");
  console.log(composeSummary(review));
  const u = result.usage;
  console.log(
    `\n${review.notes.length} notes (${review.droppedNotes} dropped), ${review.assessments.length} assessments (${review.droppedAssessments} dropped), ` +
      `${(elapsedMs / 1000).toFixed(1)} s, tokens in ${u.input} out ${u.output} thoughts ${u.thoughts}, list price ${fmtUsd(estimateCost(model, u))}`,
  );

  if (values.save) {
    const record = {
      savedAt: new Date().toISOString(),
      model,
      promptVersion: PROMPT_VERSION,
      elapsedMs,
      usage: u,
      input: { ...input, cast: cast.map((c) => ({ name: c.name, description: c.description, mimeType: c.mimeType })) },
      raw,
      normalized: review,
    };
    writeFileSync(values.save, JSON.stringify(record, null, 2));
    stamp(`saved ${values.save}`);
  }
} catch (err) {
  console.error(`\nFailed: ${describeGeminiError(err)}`);
  process.exit(1);
}
