// Scores a saved review run against the planted issues of a test cut.
//
//   npx tsx scripts/score.mts --run v1-flash.json --expected expected.json [--window 2]
//
// expected.json:
//   { "issues": [ { "id": "cup-jump", "category": "continuity", "timecode": "00:12", "castMember": "Mira" } ],
//     "fixed": ["cup-jump"] }            (optional: ids that the v2 recut fixed, to grade assessments)
//
// A planted issue is a hit when a note of the same category sits within the window (seconds) of its
// timecode. Every other note is unexpected. Carried-note assessments are printed for a manual check.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fmtTime, parseTimecode } from "@/lib/time";

type Expected = {
  issues: Array<{ id: string; category: string; timecode: string; castMember?: string | null }>;
  fixed?: string[];
};
type Run = {
  model: string;
  promptVersion: string;
  elapsedMs: number;
  usage: { input: number; output: number; thoughts: number };
  input: { cast: Array<{ name: string }>; openNotes: Array<{ alias: string; title: string }> };
  normalized: {
    notes: Array<{ tStart: number; category: string; severity: string; title: string; castMemberId: number | null }>;
    assessments: Array<{ noteId: number; assessment: string; rationale: string; suggestedTStart: number | null }>;
    droppedNotes: number;
  };
};

const { values } = parseArgs({
  options: { run: { type: "string" }, expected: { type: "string" }, window: { type: "string", default: "2" } },
});
if (!values.run || !values.expected) {
  console.error("Usage: npx tsx scripts/score.mts --run run.json --expected expected.json [--window 2]");
  process.exit(1);
}
const run = JSON.parse(readFileSync(values.run, "utf8")) as Run;
const expected = JSON.parse(readFileSync(values.expected, "utf8")) as Expected;
const window = Number(values.window ?? "2");

const notes = run.normalized.notes;
const used = new Set<number>();
let hits = 0;
console.log(`${run.model} (prompt ${run.promptVersion}), ${notes.length} notes, ${(run.elapsedMs / 1000).toFixed(1)} s\n`);
for (const issue of expected.issues) {
  const t = parseTimecode(issue.timecode) ?? 0;
  let best = -1;
  let bestDistance = Infinity;
  notes.forEach((n, i) => {
    if (used.has(i) || n.category !== issue.category) return;
    const d = Math.abs(n.tStart - t);
    if (d <= window && d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  if (best >= 0) {
    used.add(best);
    hits += 1;
    const n = notes[best];
    const cast = issue.castMember ? (n.castMemberId ? "" : " (cast member not named)") : "";
    console.log(`HIT   ${issue.id.padEnd(16)} ${issue.timecode} ${issue.category.padEnd(11)} <- ${fmtTime(n.tStart)} ${n.severity} ${n.title}${cast}`);
  } else {
    console.log(`MISS  ${issue.id.padEnd(16)} ${issue.timecode} ${issue.category}`);
  }
}
const unexpected = notes.filter((_, i) => !used.has(i));
for (const n of unexpected) {
  console.log(`EXTRA ${"".padEnd(16)} ${fmtTime(n.tStart)} ${n.category.padEnd(11)} ${n.severity} ${n.title}`);
}

console.log(`\nplanted ${expected.issues.length}, hits ${hits}, missed ${expected.issues.length - hits}, unexpected ${unexpected.length}, dropped ${run.normalized.droppedNotes}`);

if (run.normalized.assessments.length > 0) {
  console.log("\nCarried-note assessments:");
  const aliases = run.input.openNotes;
  for (const a of run.normalized.assessments) {
    const alias = aliases[a.noteId - 1];
    const at = a.suggestedTStart !== null ? ` now ${fmtTime(a.suggestedTStart)}` : "";
    console.log(`  ${alias?.alias ?? a.noteId} ${a.assessment.padEnd(9)}${at}  ${alias?.title ?? ""}: ${a.rationale}`);
  }
  if (expected.fixed) console.log(`  expected fixed: ${expected.fixed.join(", ")}`);
}
