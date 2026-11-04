// Single source for every enum used by the schema, the validators and the UI.

export const EPISODE_STATUSES = ["pending", "in_review", "approved"] as const;
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number];

export const AI_STATUSES = ["idle", "running", "done", "error"] as const;
export type AiStatus = (typeof AI_STATUSES)[number];

export const AI_STAGES = ["uploading", "processing", "analysing"] as const;
export type AiStage = (typeof AI_STAGES)[number];

// "sound" was added in round 2 (voice delivery, VO level, effects). The column is plain text, so
// no migration; a database written by this code should not be opened with the round-1 build.
export const NOTE_CATEGORIES = [
  "hook",
  "continuity",
  "character",
  "pacing",
  "performance",
  "sound",
  "clarity",
  "cliffhanger",
  "other",
] as const;
export type NoteCategory = (typeof NOTE_CATEGORIES)[number];

// The model never files a note as "other"; that bucket is for humans.
export const AI_NOTE_CATEGORIES = [
  "hook",
  "continuity",
  "character",
  "pacing",
  "performance",
  "sound",
  "clarity",
  "cliffhanger",
] as const;

export const SEVERITIES = ["low", "medium", "high"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const NOTE_SOURCES = ["ai", "human"] as const;
export type NoteSource = (typeof NOTE_SOURCES)[number];

export const NOTE_STATUSES = ["draft", "open", "resolved"] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

export const FIX_ASSESSMENTS = ["fixed", "not_fixed", "unclear"] as const;
export type FixAssessment = (typeof FIX_ASSESSMENTS)[number];

export const CATEGORY_LABELS: Record<NoteCategory, string> = {
  hook: "Hook",
  continuity: "Continuity",
  character: "Character",
  pacing: "Pacing",
  performance: "Performance",
  sound: "Sound",
  clarity: "Clarity",
  cliffhanger: "Cliffhanger",
  other: "Other",
};

export const STATUS_LABELS: Record<EpisodeStatus, string> = {
  pending: "Pending",
  in_review: "In review",
  approved: "Approved",
};
