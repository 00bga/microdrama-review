// Runs the AI review on one cut of the example package, blind to the strategists' notes on that cut,
// and scores the answer against them: a strategist note is a hit when an AI note sits within the
// window around it. For v2 and later the previous cut's notes go in as OPEN NOTES, so the fixed /
// not fixed verdicts can be checked against what the strategists wrote on this cut.
//
//   npm run eval:examples -- --list
//   npm run eval:examples -- --cut "Bound to the Demon King/Episode 04/v1" [--model gemini-3.5-flash-lite]
//                            [--window 6] [--no-carry] [--dir microdrama-review-examples]
//
// Every run is saved under data/eval/. Uploads are cached in <video>.gemini.json next to the cut.
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
} from "@/lib/gemini";
import { estimateCost, fmtUsd } from "@/lib/pricing";
import {
  buildContents,
  buildResponseSchema,
  PROMPT_VERSION,
  SYSTEM_INSTRUCTION,
  type CastInput,
  type OpenNoteInput,
  type ReviewInput,
} from "@/lib/prompt";
import { uniqueCastNames } from "@/lib/review-job";
import { composeSummary, normalizeReview } from "@/lib/review-output";
import { fmtTime } from "@/lib/time";
import { DATA_DIR } from "@/lib/uploads";
import { mp4Duration } from "@/lib/mp4";
import { loadPackage, noteTitle, strategistBody, type StrategistNote } from "./examples-package";

const { values } = parseArgs({
  options: {
    dir: { type: "string", default: "microdrama-review-examples" },
    cut: { type: "string" },
    model: { type: "string" },
    window: { type: "string", default: "6" },
    "no-carry": { type: "boolean", default: false },
    list: { type: "boolean", default: false },
  },
});

const root = path.resolve(values.dir ?? "microdrama-review-examples");
const pack = loadPackage(root);
if (pack.length === 0) {
  console.error(`No series folders with a series.json under ${root}`);
  process.exit(1);
}

if (values.list || !values.cut) {
  for (const s of pack) {
    for (const e of s.episodes) {
      const cuts = e.cuts.map((c) => `v${c.number} (${e.notesByVersion.get(c.number)?.length ?? 0} notes)`).join(", ");
      console.log(`${s.name}/${e.title}: ${cuts}`);
    }
  }
  if (!values.cut) console.log('\nRun one with: npm run eval:examples -- --cut "<series>/<episode>/v1"');
  process.exit(0);
}

const [seriesTerm, episodeTerm, cutTerm] = values.cut.split("/").map((p) => p.trim());
const cutNumber = Number(/^v?(\d+)$/i.exec(cutTerm ?? "")?.[1]);
const s = pack.find((x) => x.name.toLowerCase().includes((seriesTerm ?? "").toLowerCase()));
const e = s?.episodes.find((x) => x.title.toLowerCase().includes((episodeTerm ?? "").toLowerCase()));
const cut = e?.cuts.find((c) => c.number === cutNumber);
if (!s || !e || !cut) {
  console.error(`No cut matches "${values.cut}". Use --list to see them.`);
  process.exit(1);
}

// Strategists pause a few seconds after the moment and the AI anchors on the shot start, hence 6 s.
const window = Number(values.window ?? "6");
const carry = !values["no-carry"] && cut.number > 1;
const models = values.model?.trim() ? parseModelList(values.model) : getModelIds();
let model = models[0];

const videoBytes = readFileSync(cut.path);
const durationS = mp4Duration(videoBytes);
if (!durationS) {
  console.error(`Could not read the duration of ${cut.path}`);
  process.exit(1);
}

const names = uniqueCastNames(s.cast.map((c) => c.name));
const cast: CastInput[] = s.cast.map((c, i) => ({
  name: names[i],
  description: c.description,
  mimeType: c.mimeType,
  base64: readFileSync(c.imagePath).toString("base64"),
}));
const castByName = new Map(names.map((n, i) => [n, i + 1]));

const previous: StrategistNote[] = carry ? (e.notesByVersion.get(cut.number - 1) ?? []) : [];
const openNotes: OpenNoteInput[] = previous.map((n, i) => ({
  alias: `P${i + 1}`,
  fromVersion: cut.number - 1,
  timecode: fmtTime(n.time),
  category: "other",
  severity: "medium",
  title: noteTitle(n.text),
  body: strategistBody(n),
}));
const openByAlias = new Map(openNotes.map((n, i) => [n.alias, i + 1]));
const truth = e.notesByVersion.get(cut.number) ?? [];

const started = Date.now();
const stamp = (msg: string) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${msg}`);

const cachePath = `${cut.path}.gemini.json`;
const sha256 = createHash("sha256").update(videoBytes).digest("hex");
type Cache = { sha256: string; name: string; uri: string; expiresAt: number | null };
let cached: Cache | null = existsSync(cachePath) ? (JSON.parse(readFileSync(cachePath, "utf8")) as Cache) : null;
if (cached && cached.sha256 !== sha256) cached = null;

const ai = createClient();
try {
  const file = await ensureVideoFile(ai, cached, cut.path, "video/mp4", `${e.title} v${cut.number}`, (st) => stamp(st));
  writeFileSync(cachePath, JSON.stringify({ sha256, ...file }, null, 2));
  stamp(`video ready (${durationS.toFixed(1)} s), ${cast.length} cast, bible ${s.bibleText.length} chars, ${openNotes.length} open notes`);

  const input: ReviewInput = {
    seriesName: s.name,
    episodeTitle: e.title,
    episodeNumber: e.number,
    versionNumber: cut.number,
    durationS,
    seriesBible: s.bibleText,
    cast,
    alreadyNoted: [],
    openNotes,
    video: { uri: file.uri, mimeType: file.mimeType },
  };
  stamp(`calling ${models.join(", ")} (prompt ${PROMPT_VERSION})`);
  const result = await generateReview(
    ai,
    models,
    buildContents(input),
    buildResponseSchema([...castByName.keys()], [...openByAlias.keys()]),
    SYSTEM_INSTRUCTION,
  );
  model = result.model;
  const elapsedMs = Date.now() - started;
  const raw = JSON.parse(result.text);
  const review = normalizeReview(raw, { durationS, castByName, openByAlias });

  console.log(`\nAI notes (${review.notes.length}):`);
  for (const n of review.notes) {
    const who = n.castMemberId ? ` {${names[n.castMemberId - 1]}}` : "";
    const span = n.tEnd !== null ? `${fmtTime(n.tStart)}-${fmtTime(n.tEnd)}` : fmtTime(n.tStart);
    console.log(`  ${span.padEnd(11)} ${n.category.padEnd(11)} ${n.severity.padEnd(6)} ${n.title}${who}`);
    console.log(`              ${n.body}`);
  }

  // Match strategist notes to AI notes, closest pairs first, each note used once.
  const match = (w: number) => {
    const pairs: Array<{ t: number; a: number; d: number }> = [];
    truth.forEach((tn, ti) => {
      review.notes.forEach((an, ai2) => {
        const d = Math.abs(an.tStart - tn.time);
        if (d <= w) pairs.push({ t: ti, a: ai2, d });
      });
    });
    pairs.sort((x, y) => x.d - y.d);
    const hitMap = new Map<number, number>();
    const used = new Set<number>();
    for (const p of pairs) {
      if (hitMap.has(p.t) || used.has(p.a)) continue;
      hitMap.set(p.t, p.a);
      used.add(p.a);
    }
    return { hitMap, used };
  };
  const { hitMap: truthHit, used: aiUsed } = match(window);
  const wide = match(window * 2);

  console.log(`\nStrategist notes on this cut (${truth.length}), window ${window} s:`);
  truth.forEach((tn, ti) => {
    const hit = truthHit.get(ti);
    const text = noteTitle(tn.text, 60);
    if (hit !== undefined) {
      const an = review.notes[hit];
      console.log(`  HIT   ${fmtTime(tn.time)}  ${text}\n        <- ${fmtTime(an.tStart)} [${an.category}] ${an.title}`);
    } else {
      console.log(`  MISS  ${fmtTime(tn.time)}  ${text}`);
    }
  });
  review.notes.forEach((an, i) => {
    if (!aiUsed.has(i)) console.log(`  EXTRA ${fmtTime(an.tStart)}  [${an.category}] ${an.title}`);
  });
  const hits = truthHit.size;
  const recall = truth.length > 0 ? Math.round((100 * hits) / truth.length) : 0;
  const precision = review.notes.length > 0 ? Math.round((100 * hits) / review.notes.length) : 0;
  console.log(`\n  strategist ${truth.length}, hit ${hits} (recall ${recall}%), AI ${review.notes.length}, matched ${hits} (precision ${precision}%), dropped ${review.droppedNotes}`);
  console.log(`  with a ${window * 2} s window: hit ${wide.hitMap.size} of ${truth.length}`);

  if (openNotes.length > 0) {
    console.log(`\nCarried notes from v${cut.number - 1} (${review.assessments.length} assessed of ${openNotes.length}):`);
    for (const a of review.assessments) {
      const prev = previous[a.noteId - 1];
      const at = a.suggestedTStart !== null ? ` now ${fmtTime(a.suggestedTStart)}` : "";
      const again = truth.find((tn) => Math.abs(tn.time - (a.suggestedTStart ?? prev?.time ?? -999)) <= window);
      const signal = again ? `strategists noted again at ${fmtTime(again.time)}` : "strategists did not note it again";
      console.log(`  P${a.noteId} ${a.assessment.padEnd(9)}${at}  ${prev ? noteTitle(prev.text, 50) : ""}`);
      console.log(`      AI: ${a.rationale}\n      ${signal}`);
    }
  }

  console.log(`\n${composeSummary(review)}`);
  const u = result.usage;
  console.log(
    `\n${(elapsedMs / 1000).toFixed(1)} s, tokens in ${u.input} out ${u.output} thoughts ${u.thoughts}, list price ${fmtUsd(estimateCost(model, u))}`,
  );

  const slug = `${s.name}-${e.title}-v${cut.number}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const outDir = path.join(DATA_DIR, "eval");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${slug}-${model}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        cut: values.cut,
        model,
        promptVersion: PROMPT_VERSION,
        window,
        elapsedMs,
        usage: u,
        score: { strategist: truth.length, hits, recall, aiNotes: review.notes.length, precision },
        input: { ...input, cast: cast.map((c) => ({ name: c.name, description: c.description })) },
        truth,
        raw,
        normalized: review,
      },
      null,
      2,
    ),
  );
  stamp(`saved ${path.relative(process.cwd(), outPath)}`);
} catch (err) {
  console.error(`\nFailed after ${((Date.now() - started) / 1000).toFixed(1)} s: ${describeGeminiError(err)}`);
  if (err instanceof Error) {
    const status = "status" in err ? ` ${String(err.status)}` : "";
    console.error(`raw ${err.name}${status}: ${err.message.replace(/AIza[0-9A-Za-z_-]{35}/g, "[key]").slice(0, 600)}`);
  }
  process.exit(1);
}
