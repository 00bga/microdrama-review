// The review configuration the app runs with, read from the environment with code defaults, so a
// reviewer can reproduce a measured configuration by setting a few variables. The eval runner builds
// the same shape from its flags instead.
import { RESOLUTIONS, THINKING_LEVELS, type Resolution, type ThinkingLevel, type VideoOptions } from "@/lib/gemini";
import { ARMS, DEFAULT_PROMPT_CONFIG, type Arm, type PromptConfig } from "@/lib/prompt";

export const MAX_EXEMPLARS = 15;

function pick<T extends string>(raw: string | undefined, allowed: readonly T[]): T | undefined {
  const v = raw?.trim().toLowerCase();
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

function num(raw: string | undefined): number | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export type AppReviewConfig = { prompt: PromptConfig; seed: number | undefined };

/**
 * GEMINI_ARM (P, A, AB or AC), GEMINI_EXEMPLARS (0 to 15), GEMINI_FPS (frames per second, API default 1),
 * GEMINI_RESOLUTION (low, medium, high), GEMINI_THINKING (minimal, low, medium, high), GEMINI_SEED.
 * Anything unset or invalid keeps the code default.
 */
export function reviewConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AppReviewConfig {
  const armRaw = env.GEMINI_ARM?.trim().toUpperCase();
  const arm: Arm = (ARMS as readonly string[]).includes(armRaw ?? "") ? (armRaw as Arm) : DEFAULT_PROMPT_CONFIG.arm;
  const exemplarsRaw = num(env.GEMINI_EXEMPLARS);
  const exemplars =
    exemplarsRaw === undefined ? DEFAULT_PROMPT_CONFIG.exemplars : Math.max(0, Math.min(MAX_EXEMPLARS, Math.round(exemplarsRaw)));
  const video: VideoOptions = {};
  const fps = num(env.GEMINI_FPS);
  if (fps !== undefined && fps > 0 && fps <= 24) video.fps = fps;
  const resolution = pick<Resolution>(env.GEMINI_RESOLUTION, RESOLUTIONS);
  if (resolution) video.resolution = resolution;
  const thinking = pick<ThinkingLevel>(env.GEMINI_THINKING, THINKING_LEVELS);
  const seedRaw = num(env.GEMINI_SEED);
  return {
    prompt: { arm, exemplars, video, thinking },
    seed: seedRaw === undefined ? undefined : Math.round(seedRaw),
  };
}
