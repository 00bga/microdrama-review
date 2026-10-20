CREATE TABLE `cast_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`series_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`image_path` text NOT NULL,
	`image_mime` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cast_members_series` ON `cast_members` (`series_id`);--> statement-breakpoint
CREATE TABLE `episodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`series_id` integer NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_series_number` ON `episodes` (`series_id`,`number`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version_id` integer NOT NULL,
	`t_start` real NOT NULL,
	`t_end` real,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`evidence` text,
	`cast_member_id` integer,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`carried_from_note_id` integer,
	`ai_fix_assessment` text,
	`ai_fix_rationale` text,
	`suggested_t_start` real,
	`suggested_t_end` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cast_member_id`) REFERENCES `cast_members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`carried_from_note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `notes_version` ON `notes` (`version_id`);--> statement-breakpoint
CREATE TABLE `series` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`episode_id` integer NOT NULL,
	`number` integer NOT NULL,
	`video_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`duration_s` real NOT NULL,
	`ai_status` text DEFAULT 'idle' NOT NULL,
	`ai_stage` text,
	`ai_run_id` text,
	`ai_started_at` integer,
	`ai_finished_at` integer,
	`ai_error` text,
	`ai_model` text,
	`prompt_version` text,
	`ai_summary` text,
	`ai_input_tokens` integer,
	`ai_output_tokens` integer,
	`ai_thought_tokens` integer,
	`ai_cost_usd` real,
	`gemini_file_name` text,
	`gemini_file_uri` text,
	`gemini_file_expires_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `versions_episode_number` ON `versions` (`episode_id`,`number`);