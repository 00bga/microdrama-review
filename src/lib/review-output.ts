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
import { parseTimecode } from "@/lib/time";

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const SPACED_EM = new RegExp("\\s*" + EM_DASH + "\\s*", "g");
const SPACED_EN = new RegExp("\\s+" + EN_DASH + "\\s+", "g");
const ANY_EN = new RegExp(EN_DASH, "g");

/** Replaces dashes the repo rule forbids: em dash becomes a comma, en dash a hyphen. */
export function stripDashes(text: string): string {
  return text.replace(SPACED_EM, ", ").replace(SPACED_EN, ", ").replace(ANY_EN, "-").trim();
}

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

const outputSchema = z.object({
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
};

export type NormalizedAssessment = {
  noteId: number;
  assessment: FixAssessment;
  rationale: string;
  suggestedTStart: number | null;
  suggestedTEnd: number | null;
};

export type CastCheck = { castMemberId: number | null; name: string; seen: boolean; matchesReference: boolean; evidence: string };

export type NormalizedReview = {
  notes: NormalizedNote[];
  assessments: NormalizedAssessment[];
  castChecks: CastCheck[];
  hook: { verdict: "strong" | "weak"; reason: string } | null;
  cliffhanger: { verdict: "strong" | "weak"; reason: string } | null;
  summary: string;
  droppedNotes: number;
  droppedAssessments: number;
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

export function normalizeReview(raw: unknown, ctx: NormalizeContext): NormalizedReview {
  const top = outputSchema.parse(raw);
  const result: NormalizedReview = {
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
  };

  for (const item of top.notes.slice(0, 12)) {
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
    });
  }

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
