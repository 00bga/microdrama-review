// Unit checks for the scorer's pure functions, with no database, no package and no API call.
//
//   npm run eval:check
import assert from "node:assert/strict";
import { blocksFor } from "@/lib/time";
import { computeDiagnostics, normalizeReview } from "@/lib/review-output";
import {
  anchoredMoments,
  bootstrapCuts,
  echoedNoteIndexes,
  floorGrid,
  floorShift,
  matchGreedy,
  proposeFamily,
  wilson,
  type HitSource,
  type LabelledNote,
} from "./score.mjs";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`ok  ${name}`);
};

const note = (time: number, family: LabelledNote["family"] = "clarity", kind: LabelledNote["kind"] = "observable"): LabelledNote => ({ time, family, kind });
const source = (index: number, t: number, category = "clarity"): HitSource => ({
  index,
  t,
  families: category === "clarity" ? ["clarity", "story-logic"] : category === "pacing" ? ["pacing"] : ["continuity"],
  kind: "note",
  category,
  ref: null,
});

check("anchored moments: a note joins only within 4 s of the FIRST note (no chaining)", () => {
  // 0, 3, 6, 9: chaining would make one moment; anchoring makes 0-3 | 6-9
  const m = anchoredMoments([note(0), note(3), note(6), note(9)], 4);
  assert.equal(m.length, 2);
  assert.deepEqual(m[0].times, [0, 3]);
  assert.deepEqual(m[1].times, [6, 9]);
});

check("anchored moments: anchor 0 gives one moment per distinct time", () => {
  assert.equal(anchoredMoments([note(0), note(0.5), note(10)], 0).length, 3);
});

check("moment families are the union of its notes; observable if any note is observable or unclear", () => {
  const m = anchoredMoments([note(0, "clarity", "direction"), note(2, "pacing", "unclear")], 4);
  assert.deepEqual([...m[0].families].sort(), ["clarity", "pacing"]);
  assert.equal(m[0].observable, true);
  assert.equal(m[0].ceiling, false);
  const c = anchoredMoments([note(0, "clarity", "direction"), note(2, "pacing", "needs-context")], 4);
  assert.equal(c[0].ceiling, true);
  assert.equal(c[0].observable, false);
});

check("matching: filter by family, then greedy by distance, one to one", () => {
  const moments = anchoredMoments([note(10, "clarity"), note(30, "pacing")], 4);
  const sources = [source(0, 12, "clarity"), source(1, 31, "clarity"), source(2, 33, "pacing")];
  const pairs = matchGreedy(sources, moments, 6);
  // source 1 (clarity) may not match the pacing moment; source 2 does
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs.map((p) => [p.source, p.moment]).sort(), [[0, 0], [2, 1]]);
});

check("matching: window applies to the nearest note of the moment, offsets are signed", () => {
  const moments = anchoredMoments([note(10), note(13)], 4);
  const pairs = matchGreedy([source(0, 18)], moments, 6);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].distance, 5);
  assert.equal(pairs[0].offset, 5);
  assert.equal(matchGreedy([source(0, 20)], moments, 6).length, 0);
});

check("matching: ties go to the earlier hit source", () => {
  const moments = anchoredMoments([note(10)], 4);
  const pairs = matchGreedy([source(0, 12), source(1, 8)], moments, 6);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].source, 1);
});

check("matching: time-only mode ignores families", () => {
  const moments = anchoredMoments([note(10, "pacing")], 4);
  assert.equal(matchGreedy([source(0, 11, "clarity")], moments, 6).length, 0);
  assert.equal(matchGreedy([source(0, 11, "clarity")], moments, 6, false).length, 1);
});

check("matching: an unlabelled moment or a label-less source matches on time", () => {
  const moments = anchoredMoments([{ time: 10, family: null, kind: null }], 4);
  assert.equal(matchGreedy([source(0, 11, "pacing")], moments, 6).length, 1);
  const labelled = anchoredMoments([note(10, "pacing")], 4);
  const carried: HitSource = { index: 0, t: 11, families: null, kind: "verdict", category: "carried", ref: "P1" };
  assert.equal(matchGreedy([carried], labelled, 6).length, 1);
});

check("floor F2: a grid at the source count, one to one against the moments", () => {
  const dense = anchoredMoments(Array.from({ length: 20 }, (_, i) => note(i * 5)), 4);
  const sparse = anchoredMoments([note(50)], 4);
  const sources = Array.from({ length: 10 }, (_, i) => source(i, i * 10));
  // one-to-one: 10 grid points can cover at most 10 of the 20 moments
  assert.equal(floorGrid(sources, dense, 6, 100), 0.5);
  // grid points at 45 and 55 sit within 6 s of the one moment at 50
  assert.equal(floorGrid(sources, sparse, 6, 100), 1);
  assert.equal(floorGrid([], dense, 6, 100), 0);
});

check("floor F1: seeded, repeatable, between 0 and 1", () => {
  const moments = anchoredMoments([note(10), note(40), note(70)], 4);
  const sources = [source(0, 12), source(1, 50), source(2, 90)];
  const a = floorShift(sources, moments, 6, 100, 200, 3);
  const b = floorShift(sources, moments, 6, 100, 200, 3);
  assert.equal(a, b);
  assert.ok(a >= 0 && a <= 1);
});

check("wilson: 7 of 10 gives about 40 to 89; 0 of 0 gives 0 to 0", () => {
  const w = wilson(7, 10);
  assert.ok(Math.abs(w.lo - 39.7) < 1 && Math.abs(w.hi - 89.2) < 1, `${w.lo} ${w.hi}`);
  assert.deepEqual(wilson(0, 0), { lo: 0, hi: 0 });
});

check("bootstrap over cuts: identical cuts give a tight interval around the rate", () => {
  const b = bootstrapCuts(Array.from({ length: 4 }, () => ({ k: 7, n: 10 })), 500, 1);
  assert.ok(b.lo === 70 && b.hi === 70, `${b.lo} ${b.hi}`);
});

check("blocks: 10 s blocks, a last block under 5 s merges into the one before", () => {
  assert.deepEqual(blocksFor(87.3).map((b) => [b.startS, b.endS]).slice(-2), [[70, 80], [80, 87.3]]);
  const b = blocksFor(184.6);
  assert.equal(b.length, 18);
  assert.deepEqual([b[17].startS, b[17].endS], [170, 184.6]);
  assert.equal(blocksFor(0).length, 0);
});

check("diagnostics: boundary share, shot-start share, out-of-block count", () => {
  const notes = [
    { tStart: 10.2, tEnd: null, category: "pacing", severity: "low", title: "a", body: "b", evidence: null, castMemberId: null, block: 2 },
    { tStart: 15, tEnd: null, category: "pacing", severity: "low", title: "a", body: "b", evidence: null, castMemberId: null, block: 1 },
    { tStart: 23, tEnd: null, category: "pacing", severity: "low", title: "a", body: "b", evidence: null, castMemberId: null, block: 3 },
  ] as const;
  const d = computeDiagnostics([...notes], [{ block: 2, shots: ["00:15 kitchen, her phone, she reads"] }], 60);
  assert.ok(Math.abs(d.boundaryShare! - 1 / 3) < 1e-9);
  assert.ok(Math.abs(d.shotStartShare! - 1 / 3) < 1e-9);
  assert.equal(d.outOfBlock, 1);
  assert.equal(d.shotsListed, 1);
});

check("normalizeReview: keeps up to 60 notes, counts the rest as dropped, accepts block and shotList", () => {
  const raw = {
    shotList: [{ block: 1, shots: ["00:00 a", "00:04 b"] }],
    notes: Array.from({ length: 65 }, (_, i) => ({ timecode: `00:${String(i % 60).padStart(2, "0")}`, category: "pacing", severity: "low", title: `n${i}`, body: "x", evidence: "y", block: 1 })),
    hookCheck: { verdict: "strong", reason: "r" },
    cliffhangerCheck: { verdict: "weak", reason: "r" },
    summary: "s",
  };
  const r = normalizeReview(raw, { durationS: 70, castByName: new Map(), openByAlias: new Map() });
  assert.equal(r.notes.length, 60);
  assert.equal(r.droppedNotes, 5);
  assert.equal(r.shotList.length, 1);
  assert.equal(r.notes[0].block, 1);
});

check("proposeFamily: keywords route to a family, hook and ending need the right position", () => {
  assert.equal(proposeFamily("the music is way too loud here", 30, 100), "sound");
  assert.equal(proposeFamily("whose camera is this", 30, 100), "clarity");
  assert.equal(proposeFamily("great opening shot, keep it", 2, 100), "hook");
  assert.equal(proposeFamily("great opening shot, keep it", 50, 100), "other");
});

check("echoed notes: a note within 2 s of a not_fixed verdict new timecode is an echo", () => {
  const note = (tStart: number) => ({ tStart, tEnd: null, category: "pacing" as const, severity: "low" as const, title: "t", body: "b", evidence: null, castMemberId: null, block: null });
  const run = {
    file: "", savedAt: "", cut: "", set: null, model: "", promptVersion: "", runIndex: 1, label: null, config: null, durationS: 100, generateS: null,
    usage: { input: 0, output: 0, thoughts: 0 }, finishReason: null, openNotes: [],
    normalized: {
      shotList: [], notes: [note(10), note(31), note(50)], castChecks: [], hook: null, cliffhanger: null, summary: "", droppedNotes: 0, droppedAssessments: 0, droppedEchoes: 0,
      diagnostics: { boundaryShare: null, shotStartShare: null, outOfBlock: 0, blocksListed: 0, shotsListed: 0 },
      assessments: [
        { noteId: 1, assessment: "not_fixed" as const, rationale: "", suggestedTStart: 30, suggestedTEnd: null },
        { noteId: 2, assessment: "fixed" as const, rationale: "", suggestedTStart: 50, suggestedTEnd: null },
      ],
    },
  };
  assert.deepEqual([...echoedNoteIndexes(run)], [1]);
});

check("normalizeReview: a note within 2 s of a not_fixed verdict new timecode is dropped and counted", () => {
  const raw = {
    notes: [
      { timecode: "00:10", category: "pacing", severity: "low", title: "a", body: "b", evidence: "e" },
      { timecode: "00:31", category: "pacing", severity: "low", title: "echo", body: "b", evidence: "e" },
      { timecode: "00:50", category: "pacing", severity: "low", title: "c", body: "b", evidence: "e" },
    ],
    previousNoteAssessments: [
      { ref: "P1", assessment: "not_fixed", rationale: "r", newTimecode: "00:30" },
      { ref: "P2", assessment: "fixed", rationale: "r", newTimecode: "00:50" },
    ],
    hookCheck: { verdict: "strong", reason: "r" },
    cliffhangerCheck: { verdict: "strong", reason: "r" },
    summary: "s",
  };
  const r = normalizeReview(raw, { durationS: 100, castByName: new Map(), openByAlias: new Map([["P1", 1], ["P2", 2]]) });
  assert.equal(r.droppedEchoes, 1);
  assert.deepEqual(r.notes.map((n) => n.tStart), [10, 50]);
});

console.log(`\n${passed} checks passed`);
