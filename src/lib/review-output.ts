// Turns the model's JSON into rows the app can store. Lenient: a bad note is dropped and counted,
// never fatal. Pure, so the CLI and tests can use it without a database.
import { z } from "zod";
import {
  AI_NOTE_CATEGORIES,
  FIX_ASSESSMENTS,
  SEVERITIES,
  type FixAssessment,
  type NoteCategory,
  type Severity,
} from "@/lib/enums";
import { blocksFor, parseTimecode } from "@/lib/time";

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const SPACED_EM = new RegExp("\\s*" + EM_DASH + "\\s*", "g");
const SPACED_EN = new RegExp("\\s+" + EN_DASH + "\\s+", "g");
const ANY_EN = new RegExp(EN_DASH, "g");

/** Replaces dashes the repo rule forbids: em dash becomes a comma, en dash a hyphen. */
export function stripDashes(text: string): string {
  return text.replace(SPACED_EM, ", ").replace(SPACED_EN, ", ").replace(ANY_EN, "-").trim();
}

/**
 * A sanity cap, not a target: round 1 silently kept the first 12 notes, which would have hidden any
 * coverage gain. A rough three-minute cut can carry 40 strategist notes, so the cap sits well above.
 */
export const MAX_NOTES = 60;

const checkSchema = z.object({
  verdict: z.enum(["strong", "weak"]),
  reason: z.string().default(""),
});

const noteSchema = z.object({
  timecode: z.union([z.string(), z.number()]),
  endTimecode: z.union([z.string(), z.number()]).optional(),
  category: z.enum(AI_NOTE_CATEGORIES),
  severity: z.enum(SEVERITIES),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
  evidence: z.string().trim().max(2000).optional(),
  castMember: z.string().optional(),
  block: z.number().int().optional(),
});

const assessmentSchema = z.object({
  ref: z.string(),
  assessment: z.enum(FIX_ASSESSMENTS),
  rationale: z.string().trim().max(2000).default(""),
  newTimecode: z.union([z.string(), z.number()]).optional(),
  newEndTimecode: z.union([z.string(), z.number()]).optional(),
});

const castCheckSchema = z.object({
  castMember: z.string(),
  seen: z.boolean(),
  matchesReference: z.boolean(),
  evidence: z.string().trim().max(1000).default(""),
});

const shotBlockSchema = z.object({
  block: z.number().int(),
  shots: z.array(z.string()).default([]),
});

const outputSchema = z.object({
  shotList: z.array(z.unknown()).optional(),
  notes: z.array(z.unknown()).default([]),
  castChecks: z.array(z.unknown()).optional(),
  hookCheck: checkSchema.optional(),
  cliffhangerCheck: checkSchema.optional(),
  previousNoteAssessments: z.array(z.unknown()).optional(),
  summary: z.string().default(""),
});

export type NormalizedNote = {
  tStart: number;
  tEnd: number | null;
  category: NoteCategory;
  severity: Severity;
  title: string;
  body: string;
  evidence: string | null;
  castMemberId: number | null;
  /** the block the model filed the note under (arm AB), null in arm A */
  block: number | null;
};

export type NormalizedAssessment = {
  noteId: number;
  assessment: FixAssessment;
  rationale: string;
  suggestedTStart: number | null;
  suggestedTEnd: number | null;
};

export type CastCheck = { castMemberId: number | null; name: string; seen: boolean; matchesReference: boolean; evidence: string };

export type ShotBlock = { block: number; shots: string[] };

/** Where the timecodes landed, for the arm AB check that the shot walk did not turn into block filler. */
export type Diagnostics = {
  /** share of note timecodes within 0.5 s of a 10 s boundary; uniform expectation about 10%, failure at 25% */
  boundaryShare: number | null;
  /** share of note timecodes within 0.5 s of a listed shot start */
  shotStartShare: number | null;
  /** notes whose timecode falls outside the block they were filed under (kept, counted) */
  outOfBlock: number;
  blocksListed: number;
  shotsListed: number;
};

export type NormalizedReview = {
  shotList: ShotBlock[];
  notes: NormalizedNote[];
  assessments: NormalizedAssessment[];
  castChecks: CastCheck[];
  hook: { verdict: "strong" | "weak"; reason: string } | null;
  cliffhanger: { verdict: "strong" | "weak"; reason: string } | null;
  summary: string;
  droppedNotes: number;
  droppedAssessments: number;
  diagnostics: Diagnostics;
};

export type NormalizeContext = {
  durationS: number;
  /** cast name (as sent in the schema enum) to cast member id */
  castByName: Map<string, number>;
  /** open-note alias (P1..Pn) to the carried note id on this version */
  openByAlias: Map<string, number>;
};

/** A start more than one second past the end is a hallucinated moment; inside that slack it is clamped. */
function anchor(value: unknown, durationS: number): number | null {
  const s = parseTimecode(value);
  if (s === null) return null;
  if (s > durationS + 1) return null;
  return Math.min(s, durationS);
}

function range(start: unknown, end: unknown, durationS: number): { tStart: number; tEnd: number | null } | null {
  const tStart = anchor(start, durationS);
  if (tStart === null) return null;
  const tEnd = end === undefined ? null : anchor(end, durationS);
  return { tStart, tEnd: tEnd !== null && tEnd >= tStart ? tEnd : null };
}

/** The MM:SS at the head of a shot line, if the model wrote one. */
export function shotStart(line: string): number | null {
  const m = /^\s*(\d{1,2}:\d{2}(?:\.\d+)?)/.exec(line);
  return m ? parseTimecode(m[1]) : null;
}

export function computeDiagnostics(notes: NormalizedNote[], shotList: ShotBlock[], durationS: number): Diagnostics {
  const blocks = blocksFor(durationS);
  const starts = shotList.flatMap((b) => b.shots.map(shotStart)).filter((t): t is number => t !== null);
  let boundary = 0;
  let atShot = 0;
  let outOfBlock = 0;
  for (const n of notes) {
    const rem = n.tStart % 10;
    if (rem <= 0.5 || rem >= 9.5) boundary += 1;
    if (starts.some((s) => Math.abs(s - n.tStart) <= 0.5)) atShot += 1;
    if (n.block !== null) {
      const b = blocks.find((x) => x.n === n.block);
      if (!b || n.tStart < b.startS - 0.5 || n.tStart > b.endS + 0.5) outOfBlock += 1;
    }
  }
  const total = notes.length;
  return {
    boundaryShare: total > 0 ? boundary / total : null,
    shotStartShare: total > 0 && starts.length > 0 ? atShot / total : null,
    outOfBlock,
    blocksListed: shotList.length,
    shotsListed: shotList.reduce((n, b) => n + b.shots.length, 0),
  };
}

export function normalizeReview(raw: unknown, ctx: NormalizeContext): NormalizedReview {
  const top = outputSchema.parse(raw);
  const result: NormalizedReview = {
    shotList: [],
    notes: [],
    assessments: [],
    castChecks: [],
    hook: top.hookCheck ? { verdict: top.hookCheck.verdict, reason: stripDashes(top.hookCheck.reason) } : null,
    cliffhanger: top.cliffhangerCheck
      ? { verdict: top.cliffhangerCheck.verdict, reason: stripDashes(top.cliffhangerCheck.reason) }
      : null,
    summary: stripDashes(top.summary),
    droppedNotes: 0,
    droppedAssessments: 0,
    diagnostics: { boundaryShare: null, shotStartShare: null, outOfBlock: 0, blocksListed: 0, shotsListed: 0 },
  };

  for (const item of top.shotList ?? []) {
    const parsed = shotBlockSchema.safeParse(item);
    if (!parsed.success) continue;
    result.shotList.push({ block: parsed.data.block, shots: parsed.data.shots.map((s) => stripDashes(s)) });
  }

  for (const item of top.notes.slice(0, MAX_NOTES)) {
    const parsed = noteSchema.safeParse(item);
    const span = parsed.success ? range(parsed.data.timecode, parsed.data.endTimecode, ctx.durationS) : null;
    if (!parsed.success || !span) {
      result.droppedNotes += 1;
      continue;
    }
    const n = parsed.data;
    result.notes.push({
      tStart: span.tStart,
      tEnd: span.tEnd,
      category: n.category,
      severity: n.severity,
      title: stripDashes(n.title),
      body: stripDashes(n.body),
      evidence: n.evidence ? stripDashes(n.evidence) : null,
      castMemberId: n.castMember ? (ctx.castByName.get(n.castMember) ?? null) : null,
      block: n.block ?? null,
    });
  }
  result.droppedNotes += Math.max(0, top.notes.length - MAX_NOTES);

  for (const item of top.previousNoteAssessments ?? []) {
    const parsed = assessmentSchema.safeParse(item);
    const noteId = parsed.success ? ctx.openByAlias.get(parsed.data.ref) : undefined;
    if (!parsed.success || noteId === undefined) {
      result.droppedAssessments += 1;
      continue;
    }
    const a = parsed.data;
    const span = a.newTimecode === undefined ? null : range(a.newTimecode, a.newEndTimecode, ctx.durationS);
    result.assessments.push({
      noteId,
      assessment: a.assessment,
      rationale: stripDashes(a.rationale),
      suggestedTStart: span ? span.tStart : null,
      suggestedTEnd: span ? span.tEnd : null,
    });
  }

  for (const item of top.castChecks ?? []) {
    const parsed = castCheckSchema.safeParse(item);
    if (!parsed.success) continue;
    const c = parsed.data;
    result.castChecks.push({
      castMemberId: ctx.castByName.get(c.castMember) ?? null,
      name: c.castMember,
      seen: c.seen,
      matchesReference: c.matchesReference,
      evidence: stripDashes(c.evidence),
    });
  }

  result.diagnostics = computeDiagnostics(result.notes, result.shotList, ctx.durationS);
  return result;
}

/** One paragraph for the version card: hook and cliffhanger verdicts, cast checks, then the summary. */
export function composeSummary(r: NormalizedReview): string {
  const lines: string[] = [];
  if (r.hook) lines.push(`Hook ${r.hook.verdict}: ${r.hook.reason}`);
  if (r.cliffhanger) lines.push(`Cliffhanger ${r.cliffhanger.verdict}: ${r.cliffhanger.reason}`);
  for (const c of r.castChecks) {
    const status = !c.seen ? "not seen" : c.matchesReference ? "matches the reference" : "does not match the reference";
    lines.push(`${c.name}: ${status}${c.evidence ? ` (${c.evidence})` : ""}`);
  }
  if (r.summary) lines.push(r.summary);
  return lines.join("\n");
}
