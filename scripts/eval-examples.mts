// Runs the AI review on cuts of the example package, blind to the strategists' notes on each cut,
// and saves one JSON per run under data/eval/ for scripts/eval/score.mts to score with zero calls.
// For v2 and later the previous cut's notes go in as OPEN NOTES, so the fixed / not fixed verdicts
// can be checked against what the strategists wrote on this cut.
//
//   npm run eval:run -- --list
//   npm run eval:run -- --set dev|test|shakedown | --cut "<series>/<episode>/vN"
//       [--model gemini-3.8-flash --pin] [--run-index 1] [--resume] [--force] [--label text]
//       [--arm P|A|AB|AC] [--exemplars 0..15] [--exemplar-source other-series|same-series]
//       [--fps 2] [--resolution low|medium|high] [--thinking minimal|low|medium|high]
//       [--clip 40:85] [--static] [--seed N] [--worst-case] [--no-carry] [--dir microdrama-review-examples]
//       [--windows [--window-size 40] [--window-overlap 5]]
//
// --windows sends one whole-cut call and then one call per window of the cut (the video part clipped
// with videoMetadata, timecodes absolute); window notes are added to the whole-cut notes unless a
// note of the same category sits within 3 s. Verdicts, cast checks and the summary come from the
// whole-cut call. The run gets its own prompt version and costs 1 + ceil((D - 5) / 35) calls per cut.
//
// A run is keyed on (cut, prompt version, model, run index). A cut that already has a completed run
// for that key is refused unless --resume (skip it) or --force (run it again, logged) is passed. Every
// attempt goes into data/eval/ledger.jsonl; a sweep that would pass the reserve of 15 calls per model
// per Pacific day (100 for Flash-Lite, whose quota is 500) does not start, and the sweep stops at the first failure and prints the resume command.
// Uploads are cached in <video>.gemini.json next to the cut.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  createClient,
  describeGeminiError,
  ensureVideoFile,
  generateReview,
  getModelIds,
  parseModelList,
  RESOLUTIONS,
  THINKING_LEVELS,
  type Resolution,
  type ThinkingLevel,
  type VideoOptions,
} from "@/lib/gemini";
import { appendLedger, budget, callsOn, reserveFor } from "@/lib/ledger";
import { mp4Duration } from "@/lib/mp4";
import { estimateCost, fmtUsd } from "@/lib/pricing";
import {
  ARMS,
  buildContents,
  buildResponseSchema,
  buildSystemInstruction,
  promptVersion,
  type Arm,
  type CastInput,
  type OpenNoteInput,
  type PromptConfig,
  type ReviewInput,
} from "@/lib/prompt";
import { MAX_EXEMPLARS } from "@/lib/review-config";
import { uniqueCastNames } from "@/lib/review-job";
import { computeDiagnostics, ECHO_WINDOW_S, normalizeReview } from "@/lib/review-output";
import { fmtTime, pacificDate, windowSpans } from "@/lib/time";
import { DATA_DIR } from "@/lib/uploads";
import {
  cutLabel,
  EVAL_SETS,
  findCut,
  loadPackage,
  noteTitle,
  setOf,
  slugOf,
  strategistBody,
  type CutRef,
  type EvalSet,
  type StrategistNote,
} from "./examples-package";

const { values } = parseArgs({
  options: {
    dir: { type: "string", default: "microdrama-review-examples" },
    list: { type: "boolean", default: false },
    set: { type: "string" },
    cut: { type: "string" },
    model: { type: "string" },
    pin: { type: "boolean", default: false },
    "run-index": { type: "string", default: "1" },
    resume: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    label: { type: "string" },
    arm: { type: "string", default: "P" },
    windows: { type: "boolean", default: false },
    "window-size": { type: "string" },
    "window-overlap": { type: "string" },
    exemplars: { type: "string", default: "0" },
    "exemplar-source": { type: "string", default: "other-series" },
    fps: { type: "string" },
    resolution: { type: "string" },
    thinking: { type: "string" },
    clip: { type: "string" },
    static: { type: "boolean", default: false },
    seed: { type: "string" },
    "worst-case": { type: "boolean", default: false },
    "no-carry": { type: "boolean", default: false },
  },
});

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const root = path.resolve(values.dir ?? "microdrama-review-examples");
const pack = loadPackage(root);
if (pack.length === 0) fail(`No series folders with a series.json under ${root}`);

if (values.list || (!values.cut && !values.set)) {
  for (const s of pack) {
    for (const e of s.episodes) {
      const cuts = e.cuts
        .map((c) => {
          const label = cutLabel(s, e, c);
          const set = setOf(label);
          return `v${c.number} (${e.notesByVersion.get(c.number)?.length ?? 0} notes${set ? `, ${set}` : ""})`;
        })
        .join(", ");
      console.log(`${s.name}/${e.title}: ${cuts}`);
    }
  }
  if (!values.cut && !values.set) console.log('\nRun one with: npm run eval:run -- --cut "<series>/<episode>/v1", or a set with --set dev');
  process.exit(0);
}

// ---- which cuts ----------------------------------------------------------------------------------

let targets: CutRef[] = [];
if (values.set) {
  const set = values.set as EvalSet;
  if (!(set in EVAL_SETS)) fail(`--set takes dev, test or shakedown`);
  for (const label of EVAL_SETS[set]) {
    const ref = findCut(pack, label);
    if (!ref) fail(`The ${set} set names "${label}" but the package has no such cut`);
    targets.push(ref);
  }
} else {
  const ref = findCut(pack, values.cut!);
  if (!ref) fail(`No cut matches "${values.cut}". Use --list to see them.`);
  targets = [ref];
}

// ---- the configuration --------------------------------------------------------------------------

const armRaw = (values.arm ?? "P").toUpperCase();
if (!(ARMS as readonly string[]).includes(armRaw)) fail(`--arm takes ${ARMS.join(", ")}`);
const arm = armRaw as Arm;
const exemplars = Math.max(0, Math.min(MAX_EXEMPLARS, Math.round(Number(values.exemplars ?? "0"))));
const exemplarSource = values["exemplar-source"] === "same-series" ? "same-series" : "other-series";
const video: VideoOptions = {};
if (values.fps) {
  const fps = Number(values.fps);
  if (!(fps > 0 && fps <= 24)) fail("--fps takes a number between 0 and 24");
  video.fps = fps;
}
if (values.resolution) {
  if (!(RESOLUTIONS as readonly string[]).includes(values.resolution)) fail(`--resolution takes ${RESOLUTIONS.join(", ")}`);
  video.resolution = values.resolution as Resolution;
}
if (values.clip) {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(values.clip);
  if (!m) fail("--clip takes start:end in seconds, for example 40:85");
  video.clip = { startS: Number(m[1]), endS: Number(m[2]) };
}
if (values.static) video.staticProcessing = true;
let thinking: ThinkingLevel | undefined;
if (values.thinking) {
  if (!(THINKING_LEVELS as readonly string[]).includes(values.thinking)) fail(`--thinking takes ${THINKING_LEVELS.join(", ")}`);
  thinking = values.thinking as ThinkingLevel;
}
const windows = values.windows
  ? { sizeS: Number(values["window-size"] ?? "40"), overlapS: Number(values["window-overlap"] ?? "5") }
  : undefined;
if (windows && !(windows.sizeS > windows.overlapS && windows.overlapS >= 0)) fail("--window-size must be larger than --window-overlap");
/** a window note this close to a note of the same category repeats it */
const WINDOW_DEDUPE_S = 3;
const config: PromptConfig = { arm, exemplars, video, thinking, ...(windows ? { windows } : {}) };
const version = promptVersion(config);
const runIndex = Math.max(1, Math.round(Number(values["run-index"] ?? "1")));
/** The same request for the same run index; a second run of the configuration is a different draw. */
const seed = values.seed ? Math.round(Number(values.seed)) : 1000 + runIndex;
const models = values.model?.trim() ? parseModelList(values.model) : getModelIds();
if (values.pin && models.length !== 1) fail("--pin takes exactly one --model");
const requestedModel = models[0];
const carry = !values["no-carry"];
const worstCase = values["worst-case"];
const outDir = path.join(DATA_DIR, "eval");
mkdirSync(outDir, { recursive: true });

const outPathFor = (label: string, model: string) =>
  path.join(outDir, `${slugOf(label)}--${model}--${version}--r${runIndex}.json`);

// ---- the resume key and the budget ---------------------------------------------------------------

const pending: CutRef[] = [];
for (const t of targets) {
  const done = existsSync(outPathFor(t.label, requestedModel));
  if (done && values.resume) {
    console.log(`skip ${t.label}: completed run exists for ${requestedModel} ${version} r${runIndex}`);
    continue;
  }
  if (done && !values.force) {
    fail(
      `${t.label} already has a completed run for ${requestedModel} ${version} r${runIndex}: pass --resume to skip it, --force to run it again (logged), or another --run-index`,
    );
  }
  pending.push(t);
}
if (pending.length === 0) {
  console.log("Nothing to run.");
  process.exit(0);
}
const callsFor = (t: CutRef) => (windows ? 1 + windowSpans(mp4Duration(readFileSync(t.cut.path)) ?? 0, windows.sizeS, windows.overlapS).length : 1);
const callsNeeded = pending.reduce((n, t) => n + callsFor(t), 0);
const usedToday = callsOn(requestedModel);
if (usedToday + callsNeeded > reserveFor(requestedModel)) {
  console.error(
    `Refusing to start: ${requestedModel} has ${usedToday} call(s) logged on ${pacificDate()} (Pacific) and this sweep needs ${callsNeeded}; the reserve is ${reserveFor(requestedModel)} for this model per day.`,
  );
  for (const b of budget()) console.error(`  ${b.model}: ${b.used} used, ${b.left} left`);
  process.exit(1);
}

// ---- exemplars: strategist notes from dev cuts, round-robin across cuts in time order ------------

function exemplarPool(target: CutRef): string[] {
  const cuts: StrategistNote[][] = [];
  for (const label of EVAL_SETS.dev) {
    const ref = findCut(pack, label);
    if (!ref || ref.label === target.label) continue;
    const sameSeries = ref.series.name === target.series.name;
    if ((exemplarSource === "same-series") !== sameSeries) continue;
    const notes = [...(ref.episode.notesByVersion.get(ref.cut.number) ?? [])].sort((a, b) => a.time - b.time);
    if (notes.length > 0) cuts.push(notes);
  }
  const out: string[] = [];
  for (let i = 0; out.length < exemplars; i++) {
    let any = false;
    for (const list of cuts) {
      if (i < list.length) {
        any = true;
        if (out.length < exemplars) out.push(list[i].text);
      }
    }
    if (!any) break;
  }
  return out;
}

// ---- the sweep -----------------------------------------------------------------------------------

const ai = createClient();
const sweepStarted = Date.now();
const stamp = (msg: string) => console.log(`[${((Date.now() - sweepStarted) / 1000).toFixed(1)}s] ${msg}`);
const resumeCommand = () => {
  const args = process.argv.slice(2).filter((a) => a !== "--resume" && a !== "--force");
  return `npm run eval:run -- ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")} --resume`;
};

stamp(
  `${pending.length} cut(s), arm ${arm}, exemplars ${exemplars} (${exemplarSource}), prompt ${version}, run ${runIndex}, seed ${seed}, model ${models.join(", ")}${values.pin ? " (pinned)" : ""}${windows ? `, windows ${windows.sizeS} s with ${windows.overlapS} s overlap (${callsNeeded} calls)` : ""}`,
);

for (const target of pending) {
  const { series: s, episode: e, cut } = target;
  const videoBytes = readFileSync(cut.path);
  const durationS = mp4Duration(videoBytes);
  if (!durationS) fail(`Could not read the duration of ${cut.path}`);

  const names = uniqueCastNames(s.cast.map((c) => c.name));
  const cast: CastInput[] = s.cast.map((c, i) => ({
    name: names[i],
    description: c.description,
    mimeType: c.mimeType,
    base64: readFileSync(c.imagePath).toString("base64"),
  }));
  const castByName = new Map(names.map((n, i) => [n, i + 1]));
  const schemaCastNames = [...names];
  if (worstCase) for (let i = schemaCastNames.length; i < 13; i++) schemaCastNames.push(`Extra ${i + 1}`);

  const previous: StrategistNote[] = carry && cut.number > 1 ? (e.notesByVersion.get(cut.number - 1) ?? []) : [];
  const openNotes: OpenNoteInput[] = previous.map((n, i) => ({
    alias: `P${i + 1}`,
    fromVersion: cut.number - 1,
    timecode: fmtTime(n.time),
    category: "other",
    severity: "medium",
    title: noteTitle(n.text),
    body: strategistBody(n),
  }));
  if (worstCase) {
    for (let i = openNotes.length; i < 24; i++) {
      openNotes.push({
        alias: `P${i + 1}`,
        fromVersion: Math.max(1, cut.number - 1),
        timecode: fmtTime(5 * (i + 1)),
        category: "other",
        severity: "medium",
        title: `Synthetic open note ${i + 1}`,
        body: "A placeholder for the schema shape test; assess it as unclear.",
      });
    }
  }
  const openByAlias = new Map(openNotes.map((n, i) => [n.alias, i + 1]));
  const truth = e.notesByVersion.get(cut.number) ?? [];
  const exemplarTexts = exemplarPool(target);

  const cachePath = `${cut.path}.gemini.json`;
  const sha256 = createHash("sha256").update(videoBytes).digest("hex");
  type Cache = { sha256: string; name: string; uri: string; expiresAt: number | null };
  let cached: Cache | null = existsSync(cachePath) ? (JSON.parse(readFileSync(cachePath, "utf8")) as Cache) : null;
  if (cached && cached.sha256 !== sha256) cached = null;

  const started = Date.now();
  try {
    const file = await ensureVideoFile(ai, cached, cut.path, "video/mp4", `${e.title} v${cut.number}`, (st) => stamp(`${target.label}: ${st}`));
    writeFileSync(cachePath, JSON.stringify({ sha256, ...file }, null, 2));
    stamp(
      `${target.label}: video ready (${durationS.toFixed(1)} s), ${cast.length} cast${worstCase ? ` (${schemaCastNames.length} in the schema)` : ""}, bible ${s.bibleText.length} chars, ${openNotes.length} open notes, ${exemplarTexts.length} exemplars`,
    );

    // One call: the whole cut, or one window of it (clipped video part, no open notes).
    const callModel = async (clip: { startS: number; endS: number } | undefined, open: OpenNoteInput[], aliases: Map<string, number>) => {
      const input: ReviewInput = {
        seriesName: s.name,
        episodeTitle: e.title,
        episodeNumber: e.number,
        versionNumber: cut.number,
        durationS,
        seriesBible: s.bibleText,
        cast,
        alreadyNoted: [],
        openNotes: open,
        exemplars: exemplarTexts,
        video: { uri: file.uri, mimeType: file.mimeType },
      };
      const callVideo: VideoOptions = clip ? { ...video, clip } : video;
      const result = await generateReview(
        ai,
        models,
        buildContents(input, arm, callVideo),
        buildResponseSchema(schemaCastNames, [...aliases.keys()], arm),
        buildSystemInstruction(arm),
        {
          thinking,
          seed,
          pin: values.pin,
          retryWaitMs: 30_000,
          onAttempt: (a) => {
            const now = Date.now();
            appendLedger({
              at: new Date(now).toISOString(),
              pacificDate: pacificDate(now),
              model: a.model,
              source: "eval",
              cut: clip ? `${target.label} [${fmtTime(clip.startS)} to ${fmtTime(clip.endS)}]` : target.label,
              status: a.status,
              httpStatus: a.httpStatus,
              generateS: Math.round(a.generateS * 10) / 10,
              promptVersion: version,
              runIndex,
              ...(values.force ? { forced: true } : {}),
            });
            stamp(
              `${target.label}${clip ? ` [${fmtTime(clip.startS)} to ${fmtTime(clip.endS)}]` : ""}: ${a.model} ${a.status}${a.httpStatus ? ` ${a.httpStatus}` : ""} in ${a.generateS.toFixed(1)} s${a.droppedOption ? ` (dropped ${a.droppedOption})` : ""}`,
            );
          },
        },
      );
      const raw = JSON.parse(result.text);
      const review = normalizeReview(raw, { durationS, castByName, openByAlias: aliases });
      return { input, result, raw, review };
    };

    const whole = await callModel(undefined, openNotes, openByAlias);
    const { input, review } = whole;
    const results = [whole.result];
    const raws: { whole: unknown; windows: Array<{ span: { startS: number; endS: number }; raw: unknown }> } = { whole: whole.raw, windows: [] };
    let windowNotes = 0;
    let windowRepeats = 0;
    if (windows) {
      for (const span of windowSpans(durationS, windows.sizeS, windows.overlapS)) {
        const w = await callModel(span, [], new Map());
        results.push(w.result);
        raws.windows.push({ span, raw: w.raw });
        review.shotList.push(...w.review.shotList);
        for (const n of w.review.notes) {
          if (n.tStart < span.startS - 0.5 || n.tStart > span.endS + 0.5) continue;
          if (review.notes.some((m) => m.category === n.category && Math.abs(m.tStart - n.tStart) <= WINDOW_DEDUPE_S)) {
            windowRepeats += 1;
            continue;
          }
          review.notes.push(n);
          windowNotes += 1;
        }
      }
      const verdictTimes = review.assessments.filter((a) => a.assessment === "not_fixed" && a.suggestedTStart !== null).map((a) => a.suggestedTStart as number);
      const kept = review.notes.filter((n) => !verdictTimes.some((t) => Math.abs(t - n.tStart) <= ECHO_WINDOW_S));
      review.droppedEchoes += review.notes.length - kept.length;
      review.notes = kept.sort((a, b) => a.tStart - b.tStart);
      review.diagnostics = computeDiagnostics(review.notes, review.shotList, durationS);
    }
    const model = whole.result.model;
    const elapsedMs = Date.now() - started;
    const attempts = results.flatMap((r) => r.attempts);
    const usage = results.reduce(
      (u, r) => ({ input: u.input + r.usage.input, output: u.output + r.usage.output, thoughts: u.thoughts + r.usage.thoughts, cached: u.cached + r.usage.cached }),
      { input: 0, output: 0, thoughts: 0, cached: 0 },
    );
    const finishReason = whole.result.finishReason;
    const generateS = attempts.filter((a) => a.status === "ok").reduce((n, a) => n + a.generateS, 0);

    // A quick signal on the console only: the scorer owns the real numbers.
    const hit6 = truth.filter((tn) => review.notes.some((an) => Math.abs(an.tStart - tn.time) <= 6)).length;
    const d = review.diagnostics;
    console.log(
      `  ${review.notes.length} notes (${review.droppedNotes} dropped, ${review.droppedEchoes} echoed carried notes dropped, ${review.shotNotes} lifted from ${review.slotsFilled} filled shot slots), ${review.assessments.length} verdicts, ` +
        `${truth.length} strategist notes, ${hit6} within 6 s by time only; ` +
        `blocks ${d.blocksListed}, shots ${d.shotsListed}, boundary share ${d.boundaryShare === null ? "n/a" : Math.round(d.boundaryShare * 100) + "%"}, out of block ${d.outOfBlock}; ` +
        `${generateS.toFixed(1)} s generate, tokens in ${usage.input} out ${usage.output} thoughts ${usage.thoughts}, finish ${finishReason}, list price ${fmtUsd(estimateCost(model, usage))}` +
        (windows ? `; windows: ${results.length - 1} calls, ${windowNotes} window notes added, ${windowRepeats} repeats skipped` : ""),
    );

    const record = {
      savedAt: new Date().toISOString(),
      cut: target.label,
      set: setOf(target.label),
      model,
      requestedModels: models,
      pin: values.pin,
      promptVersion: version,
      runIndex,
      label: values.label ?? null,
      config: { ...config, seed, exemplarSource, worstCase, carry },
      durationS,
      elapsedMs,
      generateS,
      finishReason,
      usage,
      attempts,
      windowed: windows ? { ...windows, calls: results.length, windowNotes, windowRepeats } : null,
      input: { ...input, cast: cast.map((c) => ({ name: c.name, description: c.description })) },
      truth,
      raw: windows ? raws : whole.raw,
      normalized: review,
    };
    const outPath = outPathFor(target.label, model);
    writeFileSync(outPath, JSON.stringify(record, null, 2));
    stamp(`saved ${path.relative(process.cwd(), outPath)}`);
  } catch (err) {
    console.error(`\n${target.label} failed after ${((Date.now() - started) / 1000).toFixed(1)} s: ${describeGeminiError(err)}`);
    if (err instanceof Error) {
      const status = "status" in err ? ` ${String(err.status)}` : "";
      console.error(`raw ${err.name}${status}: ${err.message.replace(/AIza[0-9A-Za-z_-]{35}/g, "[key]").slice(0, 600)}`);
    }
    console.error(`\nThe sweep stopped here. Resume the rest with:\n  ${resumeCommand()}`);
    process.exit(1);
  }
}
stamp("done");
