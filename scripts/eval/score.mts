// Scores saved review runs against the strategists' notes with zero API calls, and writes the label
// and judgment working files the human steps need. The pure functions (moments, matching, floors,
// intervals) are exported so scripts/eval/check.mts can test them without a database or the package.
//
//   npm run eval:score                              every group of runs (prompt version, model, run index)
//   npm run eval:score -- --config <version|label> [--model id] [--run-index N] [--set dev|test]
//                        [--window 6] [--anchor 4] [--labels eval/labels] [--report]
//   npm run eval:score -- --scaffold                the strategist label working file (text, beside the package)
//   npm run eval:score -- --export-labels           the text-free label file, its SHA-256 and the correction rate
//   npm run eval:score -- --judgments --config <v> --model <m> [--run-index N] [--sample 15]
//                                                   the judgment working file for one group (text, beside the package)
//   npm run eval:score -- --export-judgments <work.md>
//   npm run eval:score -- --budget                  calls per model today from the ledger
//
// Definitions (docs/accuracy.md, "Pre-registration"): moments are strategist notes anchored within
// --anchor seconds of a moment's first note; a hit source is an AI note or a not_fixed verdict's new
// timecode; a candidate pair needs the source within --window seconds of any note of the moment and a
// family in common; pairs are assigned greedily by distance, one source per moment and one moment per
// source. Every number is printed beside its chance floor.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { budget } from "@/lib/ledger";
import type { NormalizedReview } from "@/lib/review-output";
import { mp4Duration } from "@/lib/mp4";
import { blocksFor } from "@/lib/time";
import { DATA_DIR } from "@/lib/uploads";
import {
  cutLabel,
  EVAL_SETS,
  findCut,
  loadPackage,
  setOf,
  type EvalSet,
  type PackageSeries,
  type StrategistNote,
} from "../examples-package";

// ---- vocabulary --------------------------------------------------------------------------------

export const FAMILIES = [
  "clarity",
  "story-logic",
  "pacing",
  "continuity",
  "delivery",
  "sound",
  "character",
  "emotion",
  "hook",
  "ending",
  "other",
] as const;
export type Family = (typeof FAMILIES)[number];

export const KINDS = ["observable", "direction", "needs-context", "unclear"] as const;
export type Kind = (typeof KINDS)[number];

/** AI category to the strategist families it may match; written once, used everywhere. */
export const FAMILY_OF_CATEGORY: Record<string, Family[]> = {
  clarity: ["clarity", "story-logic"],
  pacing: ["pacing"],
  continuity: ["continuity"],
  character: ["character", "emotion"],
  performance: ["delivery", "emotion", "sound"],
  sound: ["sound", "delivery"],
  hook: ["hook", "ending"],
  cliffhanger: ["hook", "ending"],
};

// ---- pure functions ------------------------------------------------------------------------------

/** A small seeded generator (mulberry32), so every floor is reproducible from its seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type LabelledNote = { time: number; family: Family | null; kind: Kind | null };

export type Moment = {
  index: number;
  times: number[];
  noteIdx: number[];
  families: Set<Family>;
  /** no labels on this cut: any family matches */
  unlabelled: boolean;
  observable: boolean;
  /** every note is direction or needs-context */
  ceiling: boolean;
};

/** Walk the notes in time order; a note joins the open moment if it is within anchorS of that moment's FIRST note. */
export function anchoredMoments(notes: LabelledNote[], anchorS: number): Moment[] {
  const order = notes.map((n, i) => i).sort((a, b) => notes[a].time - notes[b].time || a - b);
  const moments: Moment[] = [];
  let open: Moment | null = null;
  for (const i of order) {
    const n = notes[i];
    if (!open || n.time - open.times[0] > anchorS) {
      open = { index: moments.length, times: [], noteIdx: [], families: new Set(), unlabelled: false, observable: false, ceiling: true };
      moments.push(open);
    }
    open.times.push(n.time);
    open.noteIdx.push(i);
    if (n.family) open.families.add(n.family);
    else open.unlabelled = true;
    if (n.kind === "observable" || n.kind === "unclear") open.observable = true;
    if (n.kind !== "direction" && n.kind !== "needs-context") open.ceiling = false;
  }
  return moments;
}

export type HitSource = {
  index: number;
  t: number;
  families: Family[] | null;
  kind: "note" | "verdict";
  category: string;
  ref: string | null;
};

export type Pair = { source: number; moment: number; distance: number; offset: number };

function familiesMeet(source: HitSource, moment: Moment): boolean {
  if (source.families === null || moment.unlabelled) return true;
  return source.families.some((f) => moment.families.has(f));
}

/** Nearest note of the moment to the source: the signed offset (source minus note) and its distance. */
function nearest(source: HitSource, moment: Moment): { distance: number; offset: number } {
  let best = Infinity;
  let offset = 0;
  for (const t of moment.times) {
    const d = Math.abs(source.t - t);
    if (d < best) {
      best = d;
      offset = source.t - t;
    }
  }
  return { distance: best, offset };
}

/** Filter, then match: closest pairs first, ties to the earlier source; one source per moment, one moment per source. */
export function matchGreedy(sources: HitSource[], moments: Moment[], windowS: number, useFamilies = true): Pair[] {
  const candidates: Pair[] = [];
  for (const s of sources) {
    for (const m of moments) {
      if (useFamilies && !familiesMeet(s, m)) continue;
      const { distance, offset } = nearest(s, m);
      if (distance <= windowS) candidates.push({ source: s.index, moment: m.index, distance, offset });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || sources[a.source].t - sources[b.source].t || a.source - b.source);
  const usedS = new Set<number>();
  const usedM = new Set<number>();
  const out: Pair[] = [];
  for (const c of candidates) {
    if (usedS.has(c.source) || usedM.has(c.moment)) continue;
    usedS.add(c.source);
    usedM.add(c.moment);
    out.push(c);
  }
  return out;
}

/** F1: the run's own sources circularly shifted by a uniform offset, many draws; the mean matched share. */
export function floorShift(sources: HitSource[], moments: Moment[], windowS: number, durationS: number, draws = 1000, seed = 7): number {
  if (moments.length === 0 || sources.length === 0) return 0;
  const next = rng(seed);
  let total = 0;
  for (let d = 0; d < draws; d++) {
    const offset = next() * durationS;
    const shifted = sources.map((s) => ({ ...s, t: (s.t + offset) % durationS }));
    total += matchGreedy(shifted, moments, windowS).length / moments.length;
  }
  return total / draws;
}

/** F2: an evenly spaced grid at the run's source count, carrying the run's families in time order. */
export function floorGrid(sources: HitSource[], moments: Moment[], windowS: number, durationS: number): number {
  if (moments.length === 0 || sources.length === 0) return 0;
  const n = sources.length;
  const ordered = [...sources].sort((a, b) => a.t - b.t || a.index - b.index);
  const grid: HitSource[] = ordered.map((s, i) => ({ ...s, index: i, t: ((i + 0.5) * durationS) / n }));
  return matchGreedy(grid, moments, windowS).length / moments.length;
}

/** Wilson 95% interval for k of n, in percent. */
export function wilson(k: number, n: number): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 0 };
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { lo: Math.max(0, 100 * (centre - half)), hi: Math.min(100, 100 * (centre + half)) };
}

/** Bootstrap over cuts: resample cuts with replacement, pool, take the 2.5 and 97.5 percentiles (percent). */
export function bootstrapCuts(perCut: Array<{ k: number; n: number }>, resamples = 2000, seed = 11): { lo: number; hi: number } {
  if (perCut.length === 0) return { lo: 0, hi: 0 };
  const next = rng(seed);
  const rates: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let k = 0;
    let n = 0;
    for (let i = 0; i < perCut.length; i++) {
      const c = perCut[Math.floor(next() * perCut.length)];
      k += c.k;
      n += c.n;
    }
    rates.push(n > 0 ? (100 * k) / n : 0);
  }
  rates.sort((a, b) => a - b);
  const at = (q: number) => rates[Math.min(rates.length - 1, Math.max(0, Math.floor(q * rates.length)))];
  return { lo: at(0.025), hi: at(0.975) };
}

export const pct = (k: number, n: number): string => (n > 0 ? `${Math.round((100 * k) / n)}%` : "n/a");
const pctN = (x: number): string => `${Math.round(100 * x)}%`;

// ---- the keyword scaffold (proposes a family; never a kind) -------------------------------------

const KEYWORDS: Array<[Family, RegExp]> = [
  ["sound", /\b(sound|audio|music|sfx|volume|loud(er)?|quiet(er)?|mute|silen(t|ce)|score|ambien|not (clearly )?heard|can.?t hear|bang|v\.?o\.?\b|voice-?over)/i],
  ["delivery", /\b(voice|deliver|line read|robotic|monotone|accent|narrat|pronounc|intonation|too flat|speaks like|sounds like (a |an )?(robot|machine|ai)|no pauses|(reading|saying|says) .* instead)/i],
  ["character", /\b(bible|menac|character|doesn.?t look like|looks? (different|older|younger)|drift|hair|same person|different (person|face)|(regular|ordinary|normal) person|mysterious|manner of speaking|previous episodes?|earlier episodes?)/i],
  ["emotion", /\b(emotion|expression|annoyed|angry|scared|afraid|smil|smirk|react|reaction|should (look|feel|seem)|face (should|needs|is|a bit)|too casual|gaze|his look|her look)/i],
  ["continuity", /\b(continuity|wet|dry|wardrobe|costume|prop\b|disappear|appears? (from|out of)|float|mid-?air|artefact|artifact|morph|pasted|ai[- ]?(gen|generated|look)|looks? (very much )?ai|render|glitch|finger|shadow|teleport|too sharp|not realistic|doesn.?t look real|previous frames?|mood (is )?not maintained|dark bags|or change (the )?previous)/i],
  ["story-logic", /\b(how (does|did|would|is|can)|why (is|does|would|did|are|she|he|they|it)|doesn.?t make sense|logic|motivation|plot|know(s)? (that|this|her|him|about|who)|what told|shouldn.?t (she|he|they|the)|should (she|he|they) (be|have)|does not know|doesn.?t know|story is missing|something is missing)/i],
  ["pacing", /\b(hold(s|ing)?|too long|slow|drag|pace|pacing|faster|tighten|trim|shorten|cut (it|this|the shot|earlier|sooner)|transition|jump cut|choppy|abrupt|remove (this|the) (shot|frame|part)|lets remove|lose (this|the) shot|nothing happens|unn?ec+es+ary|uecessary|(does|do) not add|adds nothing|does nothing|too fast|too short|not flow|smoother|entrance|(sequence|order) is (off|wrong))/i],
  ["clarity", /\b(what is|what.?s (this|that|happening)|where (are|is)|whose|who is|who.?s|unclear|not clear|nothing is clear|confus|can.?t (see|read|tell)|cannot (see|read|tell)|do not see|don.?t see|didn.?t see|we did not see|readable|hard to (see|read|tell)|establish|insert|close-?up|wide|pov|point of view|purpose of|communicat|introduce|which (room|door|box|one)|what (box|letter|door|room)|not shown|not visible|on screen|on-screen|larger th[ae]n|text on screen)/i],
  ["hook", /\b(hook|opening|open on|first (shot|frame|second)|cold open)/i],
  ["ending", /\b(ending|end on|final (shot|frame)|cliffhanger|last shot|button)/i],
];

export function proposeFamily(text: string, time: number, durationS: number): Family {
  const t = text.toLowerCase();
  for (const [family, re] of KEYWORDS) {
    if ((family === "hook" && time > 12) || (family === "ending" && time < durationS - 20)) continue;
    if (re.test(t)) return family;
  }
  return "other";
}

// ---- files: runs, labels, judgments ---------------------------------------------------------------

type RunRecord = {
  file: string;
  savedAt: string;
  cut: string;
  set: EvalSet | null;
  model: string;
  promptVersion: string;
  runIndex: number;
  label: string | null;
  config: Record<string, unknown> | null;
  durationS: number;
  generateS: number | null;
  usage: { input: number; output: number; thoughts: number };
  finishReason: string | null;
  openNotes: Array<{ alias: string }>;
  normalized: NormalizedReview;
};

const EVAL_DIR = path.join(DATA_DIR, "eval");

export function loadRuns(dir = EVAL_DIR): RunRecord[] {
  if (!existsSync(dir)) return [];
  const runs: RunRecord[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const j = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Record<string, unknown>;
    if (!j.normalized || !j.cut) continue;
    const input = (j.input ?? {}) as { durationS?: number; openNotes?: Array<{ alias: string }> };
    const normalized = j.normalized as NormalizedReview;
    runs.push({
      file: f,
      savedAt: String(j.savedAt ?? ""),
      cut: String(j.cut),
      set: (j.set as EvalSet | null | undefined) ?? setOf(String(j.cut)),
      model: String(j.model),
      promptVersion: String(j.promptVersion ?? "unknown"),
      runIndex: typeof j.runIndex === "number" ? j.runIndex : 0,
      label: typeof j.label === "string" ? j.label : j.runIndex === undefined ? "round-1" : null,
      config: (j.config as Record<string, unknown> | null | undefined) ?? null,
      durationS: Number(j.durationS ?? input.durationS ?? 0),
      generateS: typeof j.generateS === "number" ? j.generateS : null,
      usage: (j.usage as RunRecord["usage"]) ?? { input: 0, output: 0, thoughts: 0 },
      finishReason: (j.finishReason as string | null | undefined) ?? null,
      openNotes: input.openNotes ?? [],
      normalized: { ...normalized, notes: normalized.notes.map((n) => ({ ...n, block: n.block ?? null })) },
    });
  }
  // Round-1 records carry no run index: number them by save time within (cut, version, model).
  const legacy = runs.filter((r) => r.runIndex === 0).sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  const counters = new Map<string, number>();
  for (const r of legacy) {
    const key = `${r.cut}|${r.promptVersion}|${r.model}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    r.runIndex = n;
  }
  return runs.sort((a, b) => a.savedAt.localeCompare(b.savedAt));
}

type LabelFile = {
  version: number;
  exportedAt: string;
  notes: Array<{ cut: string; time: number; family: Family; kind: Kind; proposed: Family; corrected: boolean }>;
};

const timeKey = (cut: string, time: number) => `${cut}|${time.toFixed(3)}`;

export function loadLabels(dir: string): Map<string, { family: Family; kind: Kind }> {
  const file = path.join(dir, "strategist-labels.json");
  const map = new Map<string, { family: Family; kind: Kind }>();
  if (!existsSync(file)) return map;
  const j = JSON.parse(readFileSync(file, "utf8")) as LabelFile;
  for (const n of j.notes) map.set(timeKey(n.cut, n.time), { family: n.family, kind: n.kind });
  return map;
}

type JudgmentFile = {
  mode: "full" | "guard";
  group: string;
  items: Array<{
    cut: string;
    kind: "note" | "verdict";
    time: number;
    category: string;
    valid: boolean | null;
    pair: { momentTime: number; label: "same" | "related" | "different" } | null;
    crossPair: { momentTime: number; label: "same" | "related" | "different" } | null;
  }>;
  verdicts: Array<{ cut: string; ref: string; assessment: string; judged: "right" | "wrong" | "cannot-tell" | null }>;
};

const groupKey = (promptVersion: string, model: string, runIndex: number) => `${promptVersion}--${model}--r${runIndex}`;

export function loadJudgments(dir: string, key: string): JudgmentFile | null {
  const file = path.join(dir, `${key}.judgments.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as JudgmentFile) : null;
}

// ---- scoring one run --------------------------------------------------------------------------

type CutScore = {
  cut: string;
  set: EvalSet | null;
  unlabelled: boolean;
  notes: number;
  echoes: number;
  sources: number;
  strategistNotes: number;
  moments: number;
  observableMoments: number;
  ceilingMoments: number;
  matched: number;
  matchedObservable: number;
  timeOnly: number;
  noteHits: number;
  floorShift: number;
  floorGrid: number;
  pairs: Pair[];
  unmatchedMoments: Moment[];
  grid: Record<string, number>;
  confirmed: number | null;
  confirmedObservable: number | null;
  confirmedFromCarried: number | null;
  crossRecovered: number | null;
  valid: number | null;
  judged: number | null;
  verdicts: { total: number; notFixed: number; withEvidence: number; right: number; wrong: number; cannotTell: number };
  boundaryShare: number | null;
  outOfBlock: number;
  generateS: number | null;
  tokens: { input: number; output: number; thoughts: number };
};

type CutInfo = { label: string; set: EvalSet | null; durationS: number; notes: StrategistNote[]; previous: { label: string; notes: StrategistNote[] } | null };

function cutInfos(pack: PackageSeries[]): Map<string, CutInfo> {
  const map = new Map<string, CutInfo>();
  for (const s of pack) {
    for (const e of s.episodes) {
      for (const c of e.cuts) {
        const label = cutLabel(s, e, c);
        const prev = e.cuts.find((x) => x.number === c.number - 1);
        map.set(label, {
          label,
          set: setOf(label),
          durationS: mp4Duration(readFileSync(c.path)) ?? 0,
          notes: e.notesByVersion.get(c.number) ?? [],
          previous: prev ? { label: cutLabel(s, e, prev), notes: e.notesByVersion.get(prev.number) ?? [] } : null,
        });
      }
    }
  }
  return map;
}

function labelled(cut: CutInfo, labels: Map<string, { family: Family; kind: Kind }>): LabelledNote[] {
  return cut.notes.map((n) => {
    const l = labels.get(timeKey(cut.label, n.time));
    return { time: n.time, family: l?.family ?? null, kind: l?.kind ?? null };
  });
}

/** Notes the model wrote within ECHO_S of the new timecode of its own not_fixed verdict: the carried note restated. */
export const ECHO_S = 2;

export function echoedNoteIndexes(run: RunRecord): Set<number> {
  const verdictTimes = run.normalized.assessments
    .filter((a) => a.assessment === "not_fixed" && a.suggestedTStart !== null)
    .map((a) => a.suggestedTStart as number);
  const out = new Set<number>();
  run.normalized.notes.forEach((n, i) => {
    if (verdictTimes.some((t) => Math.abs(t - n.tStart) <= ECHO_S)) out.add(i);
  });
  return out;
}

export let KEEP_ECHOES = false;

export function hitSourcesOf(run: RunRecord, cut: CutInfo, labels: Map<string, { family: Family; kind: Kind }>): HitSource[] {
  const out: HitSource[] = [];
  const echoes = KEEP_ECHOES ? new Set<number>() : echoedNoteIndexes(run);
  run.normalized.notes.forEach((n, i) => {
    if (echoes.has(i)) return;
    out.push({ index: out.length, t: n.tStart, families: FAMILY_OF_CATEGORY[n.category] ?? null, kind: "note", category: n.category, ref: null });
  });
  for (const a of run.normalized.assessments) {
    if (a.assessment !== "not_fixed" || a.suggestedTStart === null) continue;
    const prev = cut.previous?.notes[a.noteId - 1];
    const label = prev && cut.previous ? labels.get(timeKey(cut.previous.label, prev.time)) : undefined;
    out.push({
      index: out.length,
      t: a.suggestedTStart,
      families: label ? [label.family] : null,
      kind: "verdict",
      category: label?.family ?? "carried",
      ref: run.openNotes[a.noteId - 1]?.alias ?? `P${a.noteId}`,
    });
  }
  return out;
}

export function scoreRun(
  run: RunRecord,
  cut: CutInfo,
  labels: Map<string, { family: Family; kind: Kind }>,
  judgments: JudgmentFile | null,
  windowS: number,
  anchorS: number,
): CutScore {
  const durationS = run.durationS || cut.durationS;
  const notes = labelled(cut, labels);
  const unlabelledCut = notes.some((n) => n.family === null);
  const moments = anchoredMoments(notes, anchorS);
  const sources = hitSourcesOf(run, cut, labels);
  const pairs = matchGreedy(sources, moments, windowS);
  const matchedSet = new Set(pairs.map((p) => p.moment));
  const noteMoments = anchoredMoments(notes, 0);
  const grid: Record<string, number> = {};
  for (const w of [3, 6, 10]) {
    for (const a of [0, 4]) {
      const ms = anchoredMoments(notes, a);
      grid[`w${w}a${a}`] = ms.length > 0 ? matchGreedy(sources, ms, w).length / ms.length : 0;
    }
  }

  // Human judgments on this run, if the group has a judgment file.
  let confirmed: number | null = null;
  let confirmedObservable: number | null = null;
  let confirmedFromCarried: number | null = null;
  let crossRecovered: number | null = null;
  let valid: number | null = null;
  let judged: number | null = null;
  const verdicts = { total: run.normalized.assessments.length, notFixed: 0, withEvidence: 0, right: 0, wrong: 0, cannotTell: 0 };
  if (judgments) {
    const items = judgments.items.filter((i) => i.cut === cut.label);
    const confirmedMoments = new Set<number>();
    const carriedMoments = new Set<number>();
    let cross = 0;
    for (const item of items) {
      if (item.valid !== null) {
        judged = (judged ?? 0) + 1;
        if (item.valid) valid = (valid ?? 0) + 1;
      }
      const momentOf = (t: number) => moments.find((m) => m.times.some((x) => Math.abs(x - t) < 0.001));
      if (item.pair?.label === "same") {
        const m = momentOf(item.pair.momentTime);
        if (m) {
          confirmedMoments.add(m.index);
          if (item.kind === "verdict") carriedMoments.add(m.index);
        }
      }
      if (item.crossPair?.label === "same") {
        const m = momentOf(item.crossPair.momentTime);
        if (m && !confirmedMoments.has(m.index)) {
          confirmedMoments.add(m.index);
          cross += 1;
        }
      }
    }
    if (judgments.mode === "full") {
      confirmed = confirmedMoments.size;
      confirmedObservable = [...confirmedMoments].filter((i) => moments[i].observable).length;
      confirmedFromCarried = carriedMoments.size;
      crossRecovered = cross;
    }
    for (const v of judgments.verdicts.filter((v) => v.cut === cut.label)) {
      if (v.judged === "right") verdicts.right += 1;
      else if (v.judged === "wrong") verdicts.wrong += 1;
      else if (v.judged === "cannot-tell") verdicts.cannotTell += 1;
    }
  }
  for (const a of run.normalized.assessments) {
    if (a.assessment !== "not_fixed") continue;
    verdicts.notFixed += 1;
    if (a.suggestedTStart === null) continue;
    const prev = cut.previous?.notes[a.noteId - 1];
    const fam = prev && cut.previous ? labels.get(timeKey(cut.previous.label, prev.time))?.family : undefined;
    const near = notes.some((n) => Math.abs(n.time - a.suggestedTStart!) <= windowS && (!fam || !n.family || n.family === fam));
    if (near) verdicts.withEvidence += 1;
  }

  return {
    cut: cut.label,
    set: cut.set,
    unlabelled: unlabelledCut,
    notes: run.normalized.notes.length,
    echoes: echoedNoteIndexes(run).size,
    sources: sources.length,
    strategistNotes: notes.length,
    moments: moments.length,
    observableMoments: moments.filter((m) => m.observable).length,
    ceilingMoments: moments.filter((m) => m.ceiling && !m.unlabelled).length,
    matched: pairs.length,
    matchedObservable: pairs.filter((p) => moments[p.moment].observable).length,
    timeOnly: matchGreedy(sources, moments, windowS, false).length,
    noteHits: matchGreedy(sources, noteMoments, windowS).length,
    floorShift: floorShift(sources, moments, windowS, durationS),
    floorGrid: floorGrid(sources, moments, windowS, durationS),
    pairs,
    unmatchedMoments: moments.filter((m) => !matchedSet.has(m.index)),
    grid,
    confirmed,
    confirmedObservable,
    confirmedFromCarried,
    crossRecovered,
    valid,
    judged,
    verdicts,
    boundaryShare: run.normalized.diagnostics?.boundaryShare ?? null,
    outOfBlock: run.normalized.diagnostics?.outOfBlock ?? 0,
    generateS: run.generateS,
    tokens: run.usage,
  };
}

// ---- pooling and printing -----------------------------------------------------------------------

type Group = { key: string; promptVersion: string; model: string; runIndex: number; label: string | null; runs: RunRecord[] };

function groupRuns(runs: RunRecord[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of runs) {
    const key = groupKey(r.promptVersion, r.model, r.runIndex);
    const g = map.get(key) ?? { key, promptVersion: r.promptVersion, model: r.model, runIndex: r.runIndex, label: r.label, runs: [] };
    if (!g.label && r.label) g.label = r.label;
    g.runs.push(r);
    map.set(key, g);
  }
  return [...map.values()];
}

type Pooled = {
  cuts: number;
  moments: number;
  matched: number;
  micro: number;
  macro: number;
  wilson: { lo: number; hi: number };
  floor: number;
  floorShift: number;
  floorGrid: number;
  lift: number;
  timeOnly: number;
  noteHits: number;
  strategistNotes: number;
  observable: { matched: number; moments: number };
  confirmed: { k: number; n: number; observableK: number; observableN: number; carried: number; cross: number; wilson: { lo: number; hi: number }; bootstrap: { lo: number; hi: number } } | null;
  validity: { k: number; n: number; wilson: { lo: number; hi: number } } | null;
  grid: Record<string, { k: number; n: number }>;
};

function pool(scores: CutScore[]): Pooled {
  const moments = scores.reduce((n, s) => n + s.moments, 0);
  const matched = scores.reduce((n, s) => n + s.matched, 0);
  const rates = scores.filter((s) => s.moments > 0).map((s) => s.matched / s.moments);
  const expectedShift = scores.reduce((n, s) => n + s.floorShift * s.moments, 0);
  const expectedGrid = scores.reduce((n, s) => n + s.floorGrid * s.moments, 0);
  const fShift = moments > 0 ? expectedShift / moments : 0;
  const fGrid = moments > 0 ? expectedGrid / moments : 0;
  const floor = Math.max(fShift, fGrid);
  const micro = moments > 0 ? matched / moments : 0;
  const grid: Record<string, { k: number; n: number }> = {};
  for (const w of [3, 6, 10]) {
    for (const a of [0, 4]) {
      const key = `w${w}a${a}`;
      grid[key] = { k: 0, n: 0 };
      for (const s of scores) {
        grid[key].k += Math.round(s.grid[key] * s.moments);
        grid[key].n += s.moments;
      }
    }
  }
  const withConfirmed = scores.filter((s) => s.confirmed !== null);
  const confirmed =
    withConfirmed.length === scores.length && scores.length > 0
      ? (() => {
          const k = scores.reduce((n, s) => n + (s.confirmed ?? 0), 0);
          return {
            k,
            n: moments,
            observableK: scores.reduce((n, s) => n + (s.confirmedObservable ?? 0), 0),
            observableN: scores.reduce((n, s) => n + s.observableMoments, 0),
            carried: scores.reduce((n, s) => n + (s.confirmedFromCarried ?? 0), 0),
            cross: scores.reduce((n, s) => n + (s.crossRecovered ?? 0), 0),
            wilson: wilson(k, moments),
            bootstrap: bootstrapCuts(scores.map((s) => ({ k: s.confirmed ?? 0, n: s.moments }))),
          };
        })()
      : null;
  const judged = scores.reduce((n, s) => n + (s.judged ?? 0), 0);
  const valid = scores.reduce((n, s) => n + (s.valid ?? 0), 0);
  return {
    cuts: scores.length,
    moments,
    matched,
    micro,
    macro: rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0,
    wilson: wilson(matched, moments),
    floor,
    floorShift: fShift,
    floorGrid: fGrid,
    lift: micro - floor,
    timeOnly: scores.reduce((n, s) => n + s.timeOnly, 0),
    noteHits: scores.reduce((n, s) => n + s.noteHits, 0),
    strategistNotes: scores.reduce((n, s) => n + s.strategistNotes, 0),
    observable: { matched: scores.reduce((n, s) => n + s.matchedObservable, 0), moments: scores.reduce((n, s) => n + s.observableMoments, 0) },
    confirmed,
    validity: judged > 0 ? { k: valid, n: judged, wilson: wilson(valid, judged) } : null,
    grid,
  };
}

const r1 = (x: number) => `${Math.round(x * 10) / 10}`;

function printGroup(g: Group, scores: CutScore[], windowS: number, anchorS: number, labelsPresent: boolean): void {
  const p = pool(scores);
  const sets = [...new Set(scores.map((s) => s.set ?? "none"))].join("+");
  console.log(`\n=== ${g.model}  prompt ${g.promptVersion}${g.label ? ` (${g.label})` : ""}  run ${g.runIndex}  [${sets}]  window ${windowS} s, anchor ${anchorS} s${labelsPresent ? "" : "  (NO LABELS: time-only, families off)"}`);
  console.log(
    "  cut".padEnd(42) + "notes echo  src  strat  mom  matched  cov   floor(F1/F2)  lift  time-only  note-rec  valid  gen s  boundary",
  );
  for (const s of scores) {
    const floor = Math.max(s.floorShift, s.floorGrid);
    console.log(
      `  ${s.cut}${s.unlabelled ? " *" : ""}`.padEnd(42) +
        `${String(s.notes).padStart(5)} ${String(s.echoes).padStart(4)}  ${String(s.sources).padStart(3)}  ${String(s.strategistNotes).padStart(5)}  ${String(s.moments).padStart(3)}  ${String(s.matched).padStart(7)}  ` +
        `${pct(s.matched, s.moments).padStart(4)}  ${(pctN(s.floorShift) + "/" + pctN(s.floorGrid)).padStart(12)}  ${(s.moments > 0 ? `${Math.round(100 * (s.matched / s.moments - floor))}` : "n/a").padStart(4)}  ` +
        `${pct(s.timeOnly, s.moments).padStart(9)}  ${pct(s.noteHits, s.strategistNotes).padStart(8)}  ${(s.judged ? pct(s.valid ?? 0, s.judged) : "-").padStart(5)}  ` +
        `${(s.generateS === null ? "-" : r1(s.generateS)).padStart(5)}  ${(s.boundaryShare === null ? "-" : pctN(s.boundaryShare)).padStart(8)}`,
    );
  }
  console.log(
    `  pooled: ${p.matched} of ${p.moments} moments (micro ${pctN(p.micro)}, 95% ${Math.round(p.wilson.lo)} to ${Math.round(p.wilson.hi)}; macro ${pctN(p.macro)}); ` +
      `floor ${pctN(p.floor)} (shift ${pctN(p.floorShift)}, grid ${pctN(p.floorGrid)}); lift ${Math.round(100 * p.lift)} points; ` +
      `time-only ${pct(p.timeOnly, p.moments)}; note-level ${pct(p.noteHits, p.strategistNotes)}; observable ${pct(p.observable.matched, p.observable.moments)}`,
  );
  if (p.confirmed) {
    const c = p.confirmed;
    console.log(
      `  CONFIRMED by watching: ${c.k} of ${c.n} moments = ${pct(c.k, c.n)} (Wilson ${Math.round(c.wilson.lo)} to ${Math.round(c.wilson.hi)}, bootstrap over cuts ${Math.round(c.bootstrap.lo)} to ${Math.round(c.bootstrap.hi)}); ` +
        `observable slice ${pct(c.observableK, c.observableN)}; from carried-derived sources ${c.carried}; recovered cross-category ${c.cross}; excluding carried-derived ${pct(c.k - c.carried, c.n)}`,
    );
  }
  if (p.validity) {
    console.log(`  validity: ${p.validity.k} of ${p.validity.n} judged = ${pct(p.validity.k, p.validity.n)} (Wilson ${Math.round(p.validity.wilson.lo)} to ${Math.round(p.validity.wilson.hi)})`);
  }
  const gridLine = Object.entries(p.grid)
    .map(([k, v]) => `${k.replace("w", "w=").replace("a", " a=")}: ${pct(v.k, v.n)}`)
    .join("  ");
  console.log(`  sensitivity: ${gridLine}`);
  // misses by family and kind
  const byFamily = new Map<string, number>();
  const byKind = new Map<string, number>();
  for (const s of scores) {
    for (const m of s.unmatchedMoments) {
      const fam = m.unlabelled ? "unlabelled" : [...m.families].sort().join("+");
      byFamily.set(fam, (byFamily.get(fam) ?? 0) + 1);
      const kind = m.unlabelled ? "unlabelled" : m.observable ? "observable" : m.ceiling ? "direction/needs-context" : "mixed";
      byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    }
  }
  const fmtMap = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
  console.log(`  missed moments by family: ${fmtMap(byFamily) || "none"}; by kind: ${fmtMap(byKind) || "none"}`);
  // verdicts
  const v = scores.reduce(
    (acc, s) => ({ total: acc.total + s.verdicts.total, notFixed: acc.notFixed + s.verdicts.notFixed, withEvidence: acc.withEvidence + s.verdicts.withEvidence, right: acc.right + s.verdicts.right, wrong: acc.wrong + s.verdicts.wrong, cannotTell: acc.cannotTell + s.verdicts.cannotTell }),
    { total: 0, notFixed: 0, withEvidence: 0, right: 0, wrong: 0, cannotTell: 0 },
  );
  if (v.total > 0) {
    console.log(
      `  verdicts: ${v.total} assessed, ${v.notFixed} not_fixed, ${v.withEvidence} with a strategist note near the new timecode${v.right + v.wrong + v.cannotTell > 0 ? `; judged right ${v.right}, wrong ${v.wrong}, cannot tell ${v.cannotTell}` : ""}`,
    );
  }
  // signed offsets of matched pairs
  const buckets = new Map<number, number>();
  for (const s of scores) for (const pr of s.pairs) buckets.set(Math.round(pr.offset), (buckets.get(Math.round(pr.offset)) ?? 0) + 1);
  const hist = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k > 0 ? "+" : ""}${k}s:${n}`).join(" ");
  if (hist) console.log(`  matched-pair offsets (AI minus strategist): ${hist}`);
  const gen = scores.filter((s) => s.generateS !== null);
  const tok = scores.reduce((n, s) => n + s.tokens.input + s.tokens.output + s.tokens.thoughts, 0);
  const echoes = scores.reduce((n, s) => n + s.echoes, 0);
  if (echoes > 0) console.log(`  echoed carried notes (within ${ECHO_S} s of a not_fixed new timecode, ${KEEP_ECHOES ? "kept as" : "dropped from"} hit sources): ${echoes}`);
  console.log(`  cost: ${scores.length} call(s), ${tok} tokens${gen.length ? `, generate ${r1(gen.reduce((n, s) => n + (s.generateS ?? 0), 0))} s in total` : ""}`);
}

// ---- paired comparison of two groups (direction only, never a significance claim) ------------------

type RunStats = { notes: number; sources: number; blocks: number; notesPerBlock: number; emptyBlockShare: number | null; boundary: number | null; shotStart: number | null; outOfBlock: number; generateS: number | null; output: number; thoughts: number; finish: string | null };

function runStats(r: RunRecord): RunStats {
  const blocks = blocksFor(r.durationS);
  const perBlock = new Map<number, number>();
  for (const n of r.normalized.notes) {
    const b = n.block ?? blocks.find((x) => n.tStart >= x.startS && n.tStart < x.endS)?.n ?? blocks[blocks.length - 1]?.n ?? 1;
    perBlock.set(b, (perBlock.get(b) ?? 0) + 1);
  }
  const d = r.normalized.diagnostics;
  return {
    notes: r.normalized.notes.length,
    sources: r.normalized.notes.length + r.normalized.assessments.filter((a) => a.assessment === "not_fixed" && a.suggestedTStart !== null).length,
    blocks: blocks.length,
    notesPerBlock: blocks.length > 0 ? r.normalized.notes.length / blocks.length : 0,
    emptyBlockShare: blocks.length > 0 ? blocks.filter((b) => !perBlock.has(b.n)).length / blocks.length : null,
    boundary: d?.boundaryShare ?? null,
    shotStart: d?.shotStartShare ?? null,
    outOfBlock: d?.outOfBlock ?? 0,
    generateS: r.generateS,
    output: r.usage.output,
    thoughts: r.usage.thoughts,
    finish: r.finishReason,
  };
}

function matchedMoments(r: RunRecord, info: CutInfo, labels: Map<string, { family: Family; kind: Kind }>, windowS: number, anchorS: number): { moments: number; matched: Set<number>; floor: number } {
  const notes = labelled(info, labels);
  const moments = anchoredMoments(notes, anchorS);
  const sources = hitSourcesOf(r, info, labels);
  const pairs = matchGreedy(sources, moments, windowS);
  const d = r.durationS || info.durationS;
  const floor = Math.max(floorShift(sources, moments, windowS, d), floorGrid(sources, moments, windowS, d));
  return { moments: moments.length, matched: new Set(pairs.map((p) => p.moment)), floor };
}

function printCompare(a: Group, b: Group, infos: Map<string, CutInfo>, labels: Map<string, { family: Family; kind: Kind }>, windowS: number, anchorS: number): void {
  const name = (g: Group) => `${g.label ?? g.promptVersion} (${g.promptVersion}, ${g.model}, run ${g.runIndex})`;
  console.log(`\n=== paired: A = ${name(a)}  vs  B = ${name(b)}  (direction only)`);
  console.log("  cut".padEnd(42) + "mom  A   B   both  A-only  B-only  | notesA notesB  /blockA /blockB  emptyA emptyB  bndA  bndB  shotB  genA  genB  outA  outB");
  const tot = { moments: 0, a: 0, b: 0, both: 0, aOnly: 0, bOnly: 0, floorA: 0, floorB: 0, bWins: 0, cuts: 0 };
  const cuts = [...new Set([...a.runs, ...b.runs].map((r) => r.cut))].sort();
  const f = (x: number | null, pctMode = false) => (x === null ? "-" : pctMode ? `${Math.round(100 * x)}%` : r1(x));
  for (const cut of cuts) {
    const ra = a.runs.find((r) => r.cut === cut);
    const rb = b.runs.find((r) => r.cut === cut);
    const info = infos.get(cut);
    if (!ra || !rb || !info) {
      console.log(`  ${cut}`.padEnd(42) + "(only in one group)");
      continue;
    }
    const ma = matchedMoments(ra, info, labels, windowS, anchorS);
    const mb = matchedMoments(rb, info, labels, windowS, anchorS);
    const both = [...ma.matched].filter((m) => mb.matched.has(m)).length;
    const aOnly = ma.matched.size - both;
    const bOnly = mb.matched.size - both;
    tot.cuts += 1;
    tot.moments += ma.moments;
    tot.a += ma.matched.size;
    tot.b += mb.matched.size;
    tot.both += both;
    tot.aOnly += aOnly;
    tot.bOnly += bOnly;
    tot.floorA += ma.floor * ma.moments;
    tot.floorB += mb.floor * mb.moments;
    if (mb.matched.size > ma.matched.size) tot.bWins += 1;
    const sa = runStats(ra);
    const sb = runStats(rb);
    console.log(
      `  ${cut}`.padEnd(42) +
        `${String(ma.moments).padStart(3)}  ${String(ma.matched.size).padStart(2)}  ${String(mb.matched.size).padStart(2)}  ${String(both).padStart(4)}  ${String(aOnly).padStart(6)}  ${String(bOnly).padStart(6)}  | ` +
        `${String(sa.notes).padStart(6)} ${String(sb.notes).padStart(6)}  ${r1(sa.notesPerBlock).padStart(7)} ${r1(sb.notesPerBlock).padStart(7)}  ${f(sa.emptyBlockShare, true).padStart(6)} ${f(sb.emptyBlockShare, true).padStart(6)}  ${f(sa.boundary, true).padStart(4)}  ${f(sb.boundary, true).padStart(4)}  ${f(sb.shotStart, true).padStart(5)}  ${f(sa.generateS).padStart(4)}  ${f(sb.generateS).padStart(4)}  ${String(sa.output).padStart(4)}  ${String(sb.output).padStart(4)}`,
    );
  }
  const fa = tot.moments > 0 ? tot.floorA / tot.moments : 0;
  const fb = tot.moments > 0 ? tot.floorB / tot.moments : 0;
  const liftA = Math.round(100 * (tot.a / Math.max(1, tot.moments) - fa));
  const liftB = Math.round(100 * (tot.b / Math.max(1, tot.moments) - fb));
  console.log(
    `  pooled: ${tot.moments} moments; A ${tot.a} (${pct(tot.a, tot.moments)}, floor ${pctN(fa)}, lift ${liftA}); B ${tot.b} (${pct(tot.b, tot.moments)}, floor ${pctN(fb)}, lift ${liftB}); both ${tot.both}, A only ${tot.aOnly}, B only ${tot.bOnly}; cuts where B covers more than A: ${tot.bWins} of ${tot.cuts}`,
  );
  const fin = (g: Group) => g.runs.map((r) => r.finishReason ?? "?").join(",");
  console.log(`  finish reasons: A ${fin(a)}; B ${fin(b)}`);
}

// ---- the report tables for docs/accuracy.md -------------------------------------------------------

function reportMarkdown(groups: Array<{ g: Group; scores: CutScore[] }>, windowS: number, anchorS: number): string {
  const lines: string[] = [];
  lines.push(`Generated by \`npm run eval:score -- --report\` (window ${windowS} s, anchor ${anchorS} s). Counts and percentages only.`, "");
  for (const { g, scores } of groups) {
    const p = pool(scores);
    const sets = [...new Set(scores.map((s) => s.set ?? "none"))].join(" + ");
    lines.push(`### ${g.model}, prompt ${g.promptVersion}${g.label ? ` (${g.label})` : ""}, run ${g.runIndex}, ${sets}`, "");
    lines.push("| Cut | AI notes | Echoed | Hit sources | Strategist notes | Moments | Matched | Coverage | Floor (shift / grid) | Lift | Time-only | Note-level | Validity | Generate s |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const s of scores) {
      const floor = Math.max(s.floorShift, s.floorGrid);
      lines.push(
        `| ${s.cut}${s.unlabelled ? " (unlabelled)" : ""} | ${s.notes} | ${s.echoes} | ${s.sources} | ${s.strategistNotes} | ${s.moments} | ${s.matched} | ${pct(s.matched, s.moments)} | ${pctN(s.floorShift)} / ${pctN(s.floorGrid)} | ${s.moments > 0 ? Math.round(100 * (s.matched / s.moments - floor)) : "n/a"} | ${pct(s.timeOnly, s.moments)} | ${pct(s.noteHits, s.strategistNotes)} | ${s.judged ? pct(s.valid ?? 0, s.judged) : "n/a"} | ${s.generateS === null ? "n/a" : r1(s.generateS)} |`,
      );
    }
    lines.push(
      `| Pooled (micro) | ${scores.reduce((n, s) => n + s.notes, 0)} | ${scores.reduce((n, s) => n + s.echoes, 0)} | ${scores.reduce((n, s) => n + s.sources, 0)} | ${p.strategistNotes} | ${p.moments} | ${p.matched} | ${pctN(p.micro)} (95% ${Math.round(p.wilson.lo)} to ${Math.round(p.wilson.hi)}) | ${pctN(p.floorShift)} / ${pctN(p.floorGrid)} | ${Math.round(100 * p.lift)} | ${pct(p.timeOnly, p.moments)} | ${pct(p.noteHits, p.strategistNotes)} | ${p.validity ? pct(p.validity.k, p.validity.n) : "n/a"} | |`,
    );
    lines.push("", `Macro (mean of per-cut coverage): ${pctN(p.macro)}. Observable moments: ${pct(p.observable.matched, p.observable.moments)}.`);
    if (p.confirmed) {
      const c = p.confirmed;
      lines.push(
        "",
        `Confirmed by watching: ${c.k} of ${c.n} moments, ${pct(c.k, c.n)} (Wilson ${Math.round(c.wilson.lo)} to ${Math.round(c.wilson.hi)}; bootstrap over cuts ${Math.round(c.bootstrap.lo)} to ${Math.round(c.bootstrap.hi)}). Observable slice ${pct(c.observableK, c.observableN)}. Hits from carried-derived sources: ${c.carried}; excluding them ${pct(c.k - c.carried, c.n)}. Cross-category pairs recovered by the human check: ${c.cross}.`,
      );
    }
    if (p.validity) lines.push("", `Validity: ${p.validity.k} of ${p.validity.n} hit sources judged worth keeping, ${pct(p.validity.k, p.validity.n)} (Wilson ${Math.round(p.validity.wilson.lo)} to ${Math.round(p.validity.wilson.hi)}).`);
    lines.push("", "Sensitivity (automatic coverage): " + Object.entries(p.grid).map(([k, v]) => `window ${k.slice(1, k.indexOf("a"))} s, anchor ${k.slice(k.indexOf("a") + 1)} s: ${pct(v.k, v.n)}`).join("; ") + ".", "");
  }
  return lines.join("\n");
}

// ---- the label working file ---------------------------------------------------------------------

const WORK_HEADER = `# Strategist labels (working file)

This file holds note text from the review package. It stays beside the package and never enters git; the exported file (eval/labels/strategist-labels.json) carries no text.

One row per strategist note. Fill the two label columns:

- family: one of ${FAMILIES.join(", ")}. The scaffold proposes one from keywords and marks it with "?"; delete the "?" to confirm it or replace the word. A note about an AI-rendering artefact (pasted-in, morphing, generated-looking) is continuity; a choppy or abrupt transition is pacing; "where are we", "whose camera", "what is this" are clarity; "how does she know" is story-logic; a line reading or a voice is delivery; levels, effects and music are sound; a look or an expression is emotion; "not the person in the bible" or a drifting face is character. Use other only when nothing fits.
- kind: one of ${KINDS.join(", ")}. observable: a first-time viewer given this cut, the bible and the cast could point at a frame or sound and agree it is a problem. direction: a taste or story preference with no defect on screen. needs-context: requires earlier episodes or production intent. unclear: cannot decide. No proposal is made for kind.

Every row must end with a confirmed family (no "?") and a kind before export.
`;

function scaffold(pack: PackageSeries[], dir: string, runs: RunRecord[]): void {
  const infos = cutInfos(pack);
  const durations = new Map<string, number>();
  for (const [label, info] of infos) if (info.durationS > 0) durations.set(label, info.durationS);
  for (const r of runs) if (r.durationS > 0) durations.set(r.cut, r.durationS);
  const cuts: string[] = [...EVAL_SETS.dev, ...EVAL_SETS.test];
  for (const label of [...cuts]) {
    const info = infos.get(label);
    if (info?.previous && info.previous.notes.length > 0 && !cuts.includes(info.previous.label)) cuts.push(info.previous.label);
  }
  const lines: string[] = [WORK_HEADER];
  let total = 0;
  for (const label of cuts) {
    const info = infos.get(label);
    if (!info) throw new Error(`No such cut in the package: ${label}`);
    const d = durations.get(label) ?? 0;
    lines.push(`## ${label} (${info.set ?? "carried source"}${d ? `, ${d.toFixed(1)} s` : ""})`, "", "| # | time | note | family | kind |", "|---|---|---|---|---|");
    const sorted = [...info.notes].sort((a, b) => a.time - b.time);
    sorted.forEach((n, i) => {
      const text = n.text.replace(/\s+/g, " ").replace(/\|/g, "/").trim();
      lines.push(`| ${i + 1} | ${n.time.toFixed(3)} | ${text} | ${proposeFamily(n.text, n.time, d || 999)}? | |`);
      total += 1;
    });
    lines.push("");
  }
  const outDir = path.join(dir, "labels");
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "strategist-labels.work.md");
  if (existsSync(out)) throw new Error(`${out} exists; move it away before writing a new scaffold`);
  writeFileSync(out, lines.join("\n"));
  console.log(`wrote ${out}: ${cuts.length} cuts, ${total} notes to label`);
}

function exportLabels(dir: string, labelsDir: string): void {
  const work = path.join(dir, "labels", "strategist-labels.work.md");
  const text = readFileSync(work, "utf8");
  let cut: string | null = null;
  const notes: LabelFile["notes"] = [];
  const problems: string[] = [];
  for (const raw of text.split("\n")) {
    const h = /^## (.+?) \(/.exec(raw);
    if (h) {
      cut = h[1];
      continue;
    }
    const m = /^\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|(.*)\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*$/.exec(raw);
    if (!m || !cut) continue;
    const proposedRaw = m[4].trim();
    const kindRaw = m[5].trim().toLowerCase();
    const confirmed = !proposedRaw.endsWith("?");
    const family = proposedRaw.replace(/\?$/, "").trim().toLowerCase() as Family;
    if (!confirmed) problems.push(`${cut} #${m[1]}: family not confirmed (${proposedRaw})`);
    if (!(FAMILIES as readonly string[]).includes(family)) problems.push(`${cut} #${m[1]}: unknown family "${family}"`);
    if (!(KINDS as readonly string[]).includes(kindRaw)) problems.push(`${cut} #${m[1]}: kind missing or unknown "${kindRaw}"`);
    notes.push({ cut, time: Number(m[2]), family, kind: kindRaw as Kind, proposed: "other", corrected: false });
  }
  // The proposal is recomputed from the scaffold rule so the correction rate needs no second file.
  const pack = loadPackage(dir);
  const infos = cutInfos(pack);
  const durations = new Map<string, number>();
  for (const [label, info] of infos) if (info.durationS > 0) durations.set(label, info.durationS);
  for (const n of notes) {
    const info = infos.get(n.cut);
    const src = info?.notes.find((x) => Math.abs(x.time - n.time) < 0.0005);
    if (!src) {
      problems.push(`${n.cut} ${n.time}: no strategist note at this time`);
      continue;
    }
    n.proposed = proposeFamily(src.text, src.time, durations.get(n.cut) ?? 999);
    n.corrected = n.proposed !== n.family;
  }
  if (problems.length > 0) {
    console.error(`Not exported, ${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  const file: LabelFile = { version: 1, exportedAt: new Date().toISOString(), notes };
  mkdirSync(labelsDir, { recursive: true });
  const out = path.join(labelsDir, "strategist-labels.json");
  const body = JSON.stringify(file, null, 2);
  writeFileSync(out, body);
  const hash = createHash("sha256").update(body).digest("hex");
  const corrected = notes.filter((n) => n.corrected).length;
  console.log(`wrote ${out}: ${notes.length} labels; SHA-256 ${hash}`);
  console.log(`scaffold correction rate: ${corrected} of ${notes.length} families changed (${pct(corrected, notes.length)})`);
  for (const set of ["dev", "test"] as const) {
    const inSet = notes.filter((n) => EVAL_SETS[set].includes(n.cut));
    const fam = new Map<string, number>();
    const kind = new Map<string, number>();
    for (const n of inSet) {
      fam.set(n.family, (fam.get(n.family) ?? 0) + 1);
      kind.set(n.kind, (kind.get(n.kind) ?? 0) + 1);
    }
    const show = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
    console.log(`  ${set}: ${inSet.length} notes; families ${show(fam)}; kinds ${show(kind)}`);
  }
}

// ---- the judgment working file -------------------------------------------------------------------

function writeJudgments(g: Group, infos: Map<string, CutInfo>, labels: Map<string, { family: Family; kind: Kind }>, dir: string, windowS: number, anchorS: number, sample: number | null): void {
  const lines: string[] = [];
  const mode = sample ? "guard" : "full";
  lines.push(
    `# Judgments: ${g.model}, prompt ${g.promptVersion}${g.label ? ` (${g.label})` : ""}, run ${g.runIndex} (${mode})`,
    "",
    "This file holds AI note text about the review package and strategist note text. It stays beside the package and never enters git; the exported file carries no text.",
    "",
    "Fill the judgment columns. valid: yes or no, one question: the moment exists, the claim can be checked on screen or audio, and a strategist would act on it. pair: same (same shot, same problem), related (same shot, different problem, or the same problem seen differently) or different. Items are shuffled across cuts; seek the cut in the app to watch each moment.",
    "",
  );
  type Row = { cut: string; kind: "note" | "verdict"; time: number; category: string; title: string; body: string; pair: { momentTime: number; text: string } | null };
  const rows: Row[] = [];
  const crossRows: Array<{ cut: string; momentTime: number; text: string; candidates: Array<{ time: number; category: string; title: string }> }> = [];
  const verdictRows: Array<{ cut: string; ref: string; carried: string; assessment: string; newTime: number | null; rationale: string }> = [];
  for (const r of g.runs) {
    const info = infos.get(r.cut);
    if (!info) continue;
    const notes = labelled(info, labels);
    const moments = anchoredMoments(notes, anchorS);
    const sources = hitSourcesOf(r, info, labels);
    const pairs = matchGreedy(sources, moments, windowS);
    const pairBySource = new Map(pairs.map((p) => [p.source, p]));
    const matchedMoments = new Set(pairs.map((p) => p.moment));
    const textOf = (m: Moment) => m.noteIdx.map((i) => info.notes[i].text.replace(/\s+/g, " ").replace(/\|/g, "/").trim()).join(" // ");
    for (const s of sources) {
      const p = pairBySource.get(s.index);
      const m = p ? moments[p.moment] : null;
      let title = "";
      let body = "";
      if (s.kind === "note") {
        const n = r.normalized.notes[s.index];
        title = n.title;
        body = n.body;
      } else {
        const a = r.normalized.assessments.find((x) => `P${x.noteId}` === s.ref || r.openNotes[x.noteId - 1]?.alias === s.ref);
        title = `verdict ${s.ref} not_fixed`;
        body = a?.rationale ?? "";
      }
      rows.push({ cut: r.cut, kind: s.kind, time: s.t, category: s.category, title, body, pair: m ? { momentTime: m.times[0], text: textOf(m) } : null });
    }
    if (!sample) {
      const unmatchedSources = sources.filter((s) => !pairBySource.has(s.index));
      for (const m of moments) {
        if (matchedMoments.has(m.index)) continue;
        const candidates = unmatchedSources
          .filter((s) => nearest(s, m).distance <= windowS)
          .map((s) => ({ time: s.t, category: s.category, title: s.kind === "note" ? r.normalized.notes[s.index].title : `verdict ${s.ref}` }));
        if (candidates.length > 0) crossRows.push({ cut: r.cut, momentTime: m.times[0], text: textOf(m), candidates });
      }
      for (const a of r.normalized.assessments) {
        const prev = info.previous?.notes[a.noteId - 1];
        verdictRows.push({
          cut: r.cut,
          ref: r.openNotes[a.noteId - 1]?.alias ?? `P${a.noteId}`,
          carried: prev ? prev.text.replace(/\s+/g, " ").replace(/\|/g, "/").trim() : "",
          assessment: a.assessment,
          newTime: a.suggestedTStart,
          rationale: a.rationale,
        });
      }
    }
  }
  // shuffle across cuts with a fixed seed; the guard samples unmatched notes only
  const next = rng(g.runIndex * 1000 + g.promptVersion.length);
  let items = rows;
  if (sample) items = rows.filter((r) => r.kind === "note" && !r.pair);
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  if (sample) items = items.slice(0, sample);
  const clean = (s: string) => s.replace(/\s+/g, " ").replace(/\|/g, "/").trim();
  lines.push("## Hit sources", "", "| # | cut | kind | time | category | AI title | AI body | strategist moment (time: text) | valid | pair |", "|---|---|---|---|---|---|---|---|---|---|");
  items.forEach((r, i) => {
    const moment = r.pair ? `${r.pair.momentTime.toFixed(3)}: ${clean(r.pair.text)}` : "";
    lines.push(`| ${i + 1} | ${r.cut} | ${r.kind} | ${r.time.toFixed(3)} | ${r.category} | ${clean(r.title)} | ${clean(r.body)} | ${moment} | | ${r.pair ? "" : "n/a"} |`);
  });
  if (!sample) {
    lines.push("", "## Unmatched moments with an unmatched AI note within the window (any category)", "", "Mark same only when the AI note is about the same shot and the same problem; it then counts as a recovered cross-category hit.", "", "| # | cut | moment time | strategist text | candidate AI notes (time, category, title) | same? |", "|---|---|---|---|---|---|");
    crossRows.forEach((c, i) => {
      lines.push(`| ${i + 1} | ${c.cut} | ${c.momentTime.toFixed(3)} | ${clean(c.text)} | ${c.candidates.map((x) => `${x.time.toFixed(1)} ${x.category} ${clean(x.title)}`).join("; ")} | |`);
    });
    lines.push("", "## Verdicts on carried notes", "", "judged: right, wrong or cannot-tell, by watching the new cut at the carried moment.", "", "| # | cut | ref | carried note | verdict | new time | rationale | judged |", "|---|---|---|---|---|---|---|---|");
    verdictRows.forEach((v, i) => {
      lines.push(`| ${i + 1} | ${v.cut} | ${v.ref} | ${clean(v.carried)} | ${v.assessment} | ${v.newTime === null ? "" : v.newTime.toFixed(3)} | ${clean(v.rationale)} | |`);
    });
  }
  const outDir = path.join(dir, "judgments");
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${g.key}${sample ? `.guard${sample}` : ""}.work.md`);
  if (existsSync(out)) throw new Error(`${out} exists; move it away first`);
  writeFileSync(out, lines.join("\n"));
  console.log(`wrote ${out}: ${items.length} hit sources${sample ? " (guard sample)" : `, ${crossRows.length} cross-category candidates, ${verdictRows.length} verdicts`}`);
}

function exportJudgments(workPath: string, judgmentsDir: string): void {
  const text = readFileSync(workPath, "utf8");
  const head = /^# Judgments: (\S+), prompt (\S+?)(?: \(.*\))?, run (\d+) \((full|guard)\)/.exec(text);
  if (!head) throw new Error("Not a judgment working file");
  const [, model, promptVersion, runIndex, mode] = head;
  const key = groupKey(promptVersion, model, Number(runIndex));
  const file: JudgmentFile = { mode: mode as "full" | "guard", group: key, items: [], verdicts: [] };
  let section = "";
  const problems: string[] = [];
  const momentOfLine = new Map<string, number>();
  for (const raw of text.split("\n")) {
    if (raw.startsWith("## ")) {
      section = raw.slice(3).trim();
      continue;
    }
    if (!raw.startsWith("|") || /^\|\s*#|^\|---/.test(raw)) continue;
    const cells = raw.split("|").slice(1, -1).map((c) => c.trim());
    if (section.startsWith("Hit sources")) {
      const [n, cut, kind, time, category, , , moment, valid, pair] = cells;
      const v = valid.toLowerCase();
      const validity = v === "yes" || v === "valid" ? true : v === "no" || v === "invalid" ? false : null;
      if (validity === null) problems.push(`hit source #${n}: valid must be yes or no`);
      let pairObj: JudgmentFile["items"][number]["pair"] = null;
      if (moment) {
        const momentTime = Number(moment.split(":")[0]);
        const label = pair.toLowerCase() as "same" | "related" | "different";
        if (!["same", "related", "different"].includes(label)) problems.push(`hit source #${n}: pair must be same, related or different`);
        pairObj = { momentTime, label };
        momentOfLine.set(`${cut}|${momentTime}`, momentTime);
      }
      file.items.push({ cut, kind: kind as "note" | "verdict", time: Number(time), category, valid: validity, pair: pairObj, crossPair: null });
    } else if (section.startsWith("Unmatched moments")) {
      const [n, cut, momentTime, , candidates, same] = cells;
      const s = same.toLowerCase();
      if (s === "same" || s === "yes") {
        const first = /^([\d.]+) (\S+)/.exec(candidates);
        file.items.push({
          cut,
          kind: "note",
          time: first ? Number(first[1]) : NaN,
          category: first ? first[2] : "unknown",
          valid: null,
          pair: null,
          crossPair: { momentTime: Number(momentTime), label: "same" },
        });
      } else if (s && s !== "no" && s !== "different" && s !== "related") {
        problems.push(`cross-category #${n}: same? must be same, related, different or empty`);
      }
    } else if (section.startsWith("Verdicts")) {
      const [n, cut, ref, , assessment, , , judged] = cells;
      const j = judged.toLowerCase().replace(/\s+/g, "-") as "right" | "wrong" | "cannot-tell";
      if (!["right", "wrong", "cannot-tell"].includes(j)) problems.push(`verdict #${n}: judged must be right, wrong or cannot-tell`);
      file.verdicts.push({ cut, ref, assessment, judged: j });
    }
  }
  if (problems.length > 0) {
    console.error(`Not exported, ${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  mkdirSync(judgmentsDir, { recursive: true });
  const out = path.join(judgmentsDir, `${key}.judgments.json`);
  const body = JSON.stringify(file, null, 2);
  writeFileSync(out, body);
  console.log(`wrote ${out}: ${file.items.length} items, ${file.verdicts.length} verdicts; SHA-256 ${createHash("sha256").update(body).digest("hex")}`);
}

// ---- main -----------------------------------------------------------------------------------------

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      dir: { type: "string", default: "microdrama-review-examples" },
      labels: { type: "string", default: "eval/labels" },
      judgments: { type: "boolean", default: false },
      "judgments-dir": { type: "string", default: "eval/judgments" },
      config: { type: "string" },
      model: { type: "string" },
      "run-index": { type: "string" },
      set: { type: "string" },
      window: { type: "string", default: "6" },
      anchor: { type: "string", default: "4" },
      report: { type: "boolean", default: false },
      scaffold: { type: "boolean", default: false },
      "export-labels": { type: "boolean", default: false },
      "export-judgments": { type: "string" },
      sample: { type: "string" },
      budget: { type: "boolean", default: false },
      compare: { type: "string", multiple: true },
      "keep-echoes": { type: "boolean", default: false },
    },
  });
  if (values.budget) {
    const b = budget();
    if (b.length === 0) console.log("No calls logged today (Pacific).");
    for (const x of b) console.log(`${x.model}: ${x.used} used, ${x.left} left under the reserve`);
    return;
  }
  const dir = path.resolve(values.dir ?? "microdrama-review-examples");
  const labelsDir = path.resolve(values.labels ?? "eval/labels");
  const judgmentsDir = path.resolve(values["judgments-dir"] ?? "eval/judgments");
  const windowS = Number(values.window ?? "6");
  KEEP_ECHOES = values["keep-echoes"] === true;
  const anchorS = Number(values.anchor ?? "4");
  const runs = loadRuns();
  if (values.scaffold) return scaffold(loadPackage(dir), dir, runs);
  if (values["export-labels"]) return exportLabels(dir, labelsDir);
  if (values["export-judgments"]) return exportJudgments(path.resolve(values["export-judgments"]), judgmentsDir);

  const pack = loadPackage(dir);
  const infos = cutInfos(pack);
  const labels = loadLabels(labelsDir);
  const labelsPresent = labels.size > 0;
  const setFilter = values.set as EvalSet | undefined;
  if (setFilter && !(setFilter in EVAL_SETS)) throw new Error("--set takes dev or test");
  if (!labelsPresent) console.log(`No labels at ${labelsDir}: families are off, every number below is time-only (not the pre-registered metric).`);

  let groups = groupRuns(runs.filter((r) => findCut(pack, r.cut)));
  // --compare a --compare b, or --compare a b (the second lands in the positionals)
  const compareSel = values.compare ? [...values.compare, ...positionals].slice(0, 2) : [];
  if (compareSel.length === 2) {
    // selector: <version or label>[@model][#runIndex]; the --model and --run-index flags are the defaults
    const pick = (sel: string): Group => {
      const m = /^([^@#]+)(?:@([^#]+))?(?:#(\d+))?$/.exec(sel);
      if (!m) throw new Error(`bad selector ${sel}`);
      const model = m[2] ?? values.model;
      const run = m[3] ? Number(m[3]) : values["run-index"] ? Number(values["run-index"]) : 1;
      const found = groups.filter((g) => (g.promptVersion === m[1] || g.label === m[1]) && (!model || g.model === model) && g.runIndex === run);
      if (found.length !== 1) throw new Error(`selector ${sel} matches ${found.length} groups (${found.map((g) => g.key).join(", ") || "none"}); add @model`);
      const g = found[0];
      return { ...g, runs: g.runs.filter((r) => (setFilter ? setOf(r.cut) === setFilter : setOf(r.cut) === "dev" || setOf(r.cut) === "test")) };
    };
    printCompare(pick(compareSel[0]), pick(compareSel[1]), infos, labels, windowS, anchorS);
    return;
  }
  if (values.config) groups = groups.filter((g) => g.promptVersion === values.config || g.label === values.config);
  if (values.model) groups = groups.filter((g) => g.model === values.model);
  if (values["run-index"]) groups = groups.filter((g) => g.runIndex === Number(values["run-index"]));
  const scored: Array<{ g: Group; scores: CutScore[] }> = [];
  for (const g of groups) {
    const runsInGroup = g.runs.filter((r) => (setFilter ? setOf(r.cut) === setFilter : setOf(r.cut) === "dev" || setOf(r.cut) === "test"));
    if (runsInGroup.length === 0) continue;
    if (values.judgments) {
      writeJudgments({ ...g, runs: runsInGroup }, infos, labels, dir, windowS, anchorS, values.sample ? Number(values.sample) : null);
      continue;
    }
    const judgments = loadJudgments(judgmentsDir, g.key);
    const scores = runsInGroup
      .sort((a, b) => a.cut.localeCompare(b.cut))
      .map((r) => scoreRun(r, infos.get(r.cut)!, labels, judgments, windowS, anchorS));
    scored.push({ g, scores });
    printGroup(g, scores, windowS, anchorS, labelsPresent);
  }
  if (values.judgments) return;
  if (scored.length === 0) console.log("No scorable runs matched.");
  if (values.report) {
    const doc = path.resolve("docs/accuracy.md");
    const start = "<!-- eval:score tables start -->";
    const end = "<!-- eval:score tables end -->";
    const body = `${start}\n\n${reportMarkdown(scored, windowS, anchorS)}\n${end}`;
    let text = existsSync(doc) ? readFileSync(doc, "utf8") : "# Accuracy\n\n";
    if (text.includes(start) && text.includes(end)) {
      text = text.slice(0, text.indexOf(start)) + body + text.slice(text.indexOf(end) + end.length);
    } else {
      text = `${text.trimEnd()}\n\n## Tables\n\n${body}\n`;
    }
    writeFileSync(doc, text);
    console.log(`\nwrote the tables into ${doc}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
