import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import {
  AI_STATUSES,
  AI_STAGES,
  EPISODE_STATUSES,
  FIX_ASSESSMENTS,
  NOTE_CATEGORIES,
  NOTE_SOURCES,
  NOTE_STATUSES,
  SEVERITIES,
} from "@/lib/enums";

// All timestamps are integer milliseconds since the epoch (Date.now()).

export const series = sqliteTable("series", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  /** the show's rules (logline, tone, visual rules, characters); sent with every AI review */
  bible: text("bible").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});

export const castMembers = sqliteTable(
  "cast_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seriesId: integer("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    imagePath: text("image_path").notNull(),
    imageMime: text("image_mime").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("cast_members_series").on(t.seriesId)],
);

export const episodes = sqliteTable(
  "episodes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seriesId: integer("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    status: text("status", { enum: EPISODE_STATUSES }).notNull().default("pending"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("episodes_series_number").on(t.seriesId, t.number)],
);

export const versions = sqliteTable(
  "versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    episodeId: integer("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    videoPath: text("video_path").notNull(),
    mimeType: text("mime_type").notNull(),
    durationS: real("duration_s").notNull(),
    aiStatus: text("ai_status", { enum: AI_STATUSES }).notNull().default("idle"),
    aiStage: text("ai_stage", { enum: AI_STAGES }),
    aiRunId: text("ai_run_id"),
    aiStartedAt: integer("ai_started_at"),
    aiFinishedAt: integer("ai_finished_at"),
    aiError: text("ai_error"),
    aiModel: text("ai_model"),
    promptVersion: text("prompt_version"),
    aiSummary: text("ai_summary"),
    aiInputTokens: integer("ai_input_tokens"),
    aiOutputTokens: integer("ai_output_tokens"),
    aiThoughtTokens: integer("ai_thought_tokens"),
    aiCostUsd: real("ai_cost_usd"),
    geminiFileName: text("gemini_file_name"),
    geminiFileUri: text("gemini_file_uri"),
    geminiFileExpiresAt: integer("gemini_file_expires_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("versions_episode_number").on(t.episodeId, t.number)],
);

export const notes = sqliteTable(
  "notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    versionId: integer("version_id")
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    tStart: real("t_start").notNull(),
    tEnd: real("t_end"),
    category: text("category", { enum: NOTE_CATEGORIES }).notNull(),
    severity: text("severity", { enum: SEVERITIES }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    evidence: text("evidence"),
    castMemberId: integer("cast_member_id").references(() => castMembers.id, {
      onDelete: "set null",
    }),
    source: text("source", { enum: NOTE_SOURCES }).notNull(),
    status: text("status", { enum: NOTE_STATUSES }).notNull(),
    carriedFromNoteId: integer("carried_from_note_id").references(
      (): AnySQLiteColumn => notes.id,
      { onDelete: "set null" },
    ),
    aiFixAssessment: text("ai_fix_assessment", { enum: FIX_ASSESSMENTS }),
    aiFixRationale: text("ai_fix_rationale"),
    suggestedTStart: real("suggested_t_start"),
    suggestedTEnd: real("suggested_t_end"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("notes_version").on(t.versionId)],
);

export type Series = typeof series.$inferSelect;
export type CastMember = typeof castMembers.$inferSelect;
export type Episode = typeof episodes.$inferSelect;
export type Version = typeof versions.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
