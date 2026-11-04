// Gemini client, Files API handling and the single generateContent call. No database here.
import {
  ApiError,
  FileState,
  GoogleGenAI,
  ThinkingLevel as SdkThinkingLevel,
  type Content,
  type File as GeminiFile,
  type GenerateContentConfig,
  type Part,
} from "@google/genai";
import { setTimeout as sleep } from "node:timers/promises";
import type { AttemptStatus } from "@/lib/ledger";
import type { TokenUsage } from "@/lib/pricing";

/** 3.8 Flash for the best notes, 3.6 Flash for the hours when 3.8 is overloaded, Flash-Lite as the last resort. */
export const DEFAULT_MODEL = "gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite";

export const TIMEOUTS = {
  /** client-wide cap, which is what the upload request gets (a per-upload option breaks the SDK's upload URL) */
  requestMs: 4 * 60_000,
  processingMs: 5 * 60_000,
  generateMs: 3 * 60_000,
  pollMs: 3_000,
};

/**
 * GEMINI_MODEL holds one model id, or several separated by commas: the next one is tried when the
 * one before is overloaded (503 or 504). An empty GEMINI_MODEL= line loads as "", hence || not ??.
 */
export function getModelIds(): string[] {
  const raw = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return ids.length > 0 ? ids : [DEFAULT_MODEL];
}

/** The preferred model: the first entry of GEMINI_MODEL. */
export function getModelId(): string {
  return getModelIds()[0];
}

/** "a, b" or ["a", "b"] to a clean list. */
export function parseModelList(raw: string | string[]): string[] {
  const list = Array.isArray(raw) ? raw : raw.split(",");
  return list.map((s) => s.trim()).filter((s) => s.length > 0);
}

export function getApiKey(): string | null {
  return process.env.GOOGLE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || null;
}

/** One client per job. The SDK retries 429 by default, which would burn the free quota, so retries are off. */
export function createClient(): GoogleGenAI {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("No API key: set GOOGLE_API_KEY in .env and restart the server");
  return new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: TIMEOUTS.requestMs, retryOptions: { attempts: 1 } },
  });
}

/** The Files API lists video/mov rather than the browser's video/quicktime. */
export function geminiMimeType(mimeType: string): string {
  return mimeType === "video/quicktime" ? "video/mov" : mimeType;
}

export type UploadedVideo = {
  name: string;
  uri: string;
  mimeType: string;
  expiresAt: number | null;
};

export type CachedVideo = { name: string; uri: string; expiresAt: number | null } | null;

export type Stage = "uploading" | "processing" | "analysing";

function toUploaded(file: GeminiFile, fallbackMime: string): UploadedVideo {
  if (!file.name || !file.uri) throw new Error("Gemini returned a file without a name or URI");
  const expires = file.expirationTime ? Date.parse(file.expirationTime) : NaN;
  return {
    name: file.name,
    uri: file.uri,
    mimeType: file.mimeType ?? fallbackMime,
    expiresAt: Number.isFinite(expires) ? expires : null,
  };
}

/** Returns the file when Gemini still has it in ACTIVE state, otherwise null (403 and 404 included). */
export async function getActiveFile(ai: GoogleGenAI, name: string): Promise<GeminiFile | null> {
  try {
    const file = await ai.files.get({ name });
    return file.state === FileState.ACTIVE ? file : null;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return null;
    throw err;
  }
}

export async function uploadVideo(
  ai: GoogleGenAI,
  absPath: string,
  mimeType: string,
  displayName: string,
  onStage: (stage: Stage) => void,
): Promise<UploadedVideo> {
  onStage("uploading");
  const geminiMime = geminiMimeType(mimeType);
  // No per-call httpOptions here: the SDK (2.30) builds the upload URL from them and 404s.
  let file = await ai.files.upload({ file: absPath, config: { mimeType: geminiMime, displayName } });
  const name = file.name;
  if (!name) throw new Error("Gemini accepted the upload but returned no file name");

  onStage("processing");
  const deadline = Date.now() + TIMEOUTS.processingMs;
  while (file.state === FileState.PROCESSING || file.state === FileState.STATE_UNSPECIFIED) {
    if (Date.now() > deadline) {
      throw new Error("Gemini is still processing the video after 5 minutes; try a smaller or shorter file");
    }
    await sleep(TIMEOUTS.pollMs);
    file = await ai.files.get({ name });
  }
  if (file.state === FileState.FAILED) {
    const detail = file.error?.message ? ` (${file.error.message.replace(/\.+$/, "")})` : "";
    throw new Error(`Gemini could not process this video${detail}. H.264 MP4 works best`);
  }
  return toUploaded(file, geminiMime);
}

/** Reuses a cached, still-active upload with at least five minutes of life left; otherwise uploads once. */
export async function ensureVideoFile(
  ai: GoogleGenAI,
  cached: CachedVideo,
  absPath: string,
  mimeType: string,
  displayName: string,
  onStage: (stage: Stage) => void,
): Promise<UploadedVideo> {
  if (cached && (cached.expiresAt === null || cached.expiresAt > Date.now() + 5 * 60_000)) {
    const file = await getActiveFile(ai, cached.name);
    if (file) return toUploaded(file, geminiMimeType(mimeType));
  }
  return uploadVideo(ai, absPath, mimeType, displayName, onStage);
}

// ---- generation options -------------------------------------------------------------------------

export const RESOLUTIONS = ["low", "medium", "high"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export const THINKING_LEVELS = ["minimal", "low", "medium", "high"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const SDK_THINKING: Record<ThinkingLevel, SdkThinkingLevel> = {
  minimal: SdkThinkingLevel.MINIMAL,
  low: SdkThinkingLevel.LOW,
  medium: SdkThinkingLevel.MEDIUM,
  high: SdkThinkingLevel.HIGH,
};

/** Options on the video part: how the model samples the cut. Applied once, in buildContents. */
export type VideoOptions = {
  /** frames per second sent to the model; the API default is 1 */
  fps?: number;
  /** review only this span of the cut (seconds); the one place clipping is tried */
  clip?: { startS: number; endS: number };
  /** per-part media resolution for the video; cast images keep the default */
  resolution?: Resolution;
  /** fixed-rate frame extraction, set explicitly so the request shape is stated in the run record */
  staticProcessing?: boolean;
};

/** Options on the request: how the model thinks and answers. */
export type GenerateOptions = {
  /** sent only to models that report thought tokens (Flash-Lite does not) */
  thinking?: ThinkingLevel;
  /** fixed so a rerun of the same configuration is as repeatable as the API allows */
  seed?: number;
  /** one model, no same-model retry on 503, no fallthrough: a scorecard run never mixes models */
  pin?: boolean;
  /** pause before the one same-model retry on 500, 503 or 504 (the app waits 30 s) */
  retryWaitMs?: number;
  /** called after every attempt, so the caller can append it to the ledger */
  onAttempt?: (attempt: Attempt) => void;
};

export type Attempt = {
  model: string;
  status: AttemptStatus;
  httpStatus: number | null;
  /** seconds around generateContent only, never the upload */
  generateS: number;
  finishReason: string | null;
  /** an option the API rejected by name (400), removed before the next attempt */
  droppedOption: string | null;
};

/** The models known to report thought tokens on the free tier (from the saved runs); Flash-Lite reports 0. */
export function supportsThinking(model: string): boolean {
  return !/lite/i.test(model);
}

const OPTION_NAMES: Array<{ key: string; re: RegExp }> = [
  { key: "thinking", re: /thinking/i },
  { key: "resolution", re: /media_?resolution/i },
  { key: "fps", re: /video_?metadata|\bfps\b|start_?offset|end_?offset/i },
  { key: "staticProcessing", re: /media_?processing/i },
  { key: "seed", re: /\bseed\b/i },
];

/** The option a 400 names, if any: the request is retried without it. */
export function rejectedOption(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 400) return null;
  for (const o of OPTION_NAMES) if (o.re.test(err.message)) return o.key;
  return null;
}

/** A copy of the contents with one part-level option removed from every part. */
function withoutPartOption(contents: Content[], option: string): Content[] {
  return contents.map((c) => ({
    ...c,
    parts: (c.parts ?? []).map((p) => {
      const q: Part = { ...p };
      if (option === "fps") delete q.videoMetadata;
      if (option === "resolution") delete q.mediaResolution;
      if (option === "staticProcessing") delete q.mediaProcessing;
      return q;
    }),
  }));
}

export type GenerateResult = {
  text: string;
  usage: TokenUsage;
  finishReason: string | null;
  /** the model that answered (the first in the list that was not overloaded) */
  model: string;
  /** every attempt made, in order */
  attempts: Attempt[];
};

export function isRetryable(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 500 || err.status === 503 || err.status === 504);
}

/** The SDK's own timeout (AbortError) or a socket timeout: the model hung, so it is not worth a retry. */
export function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || /timeout|timed out/i.test(err.message));
}

/** A rate limit or a spent daily quota: never retry this model, but another model has its own quota. */
export function isQuota(err: unknown): boolean {
  return err instanceof ApiError && err.status === 429;
}

function statusOf(err: unknown): AttemptStatus {
  if (isTimeout(err)) return "timeout";
  if (isQuota(err)) return "quota";
  if (isRetryable(err)) return "overloaded";
  if (err instanceof ApiError && err.status === 400) return "rejected";
  return "error";
}

/**
 * One structured-output call. Without pin: on 500, 503 or 504 the same model is retried once after
 * a pause; after that, or when the model hangs until the timeout, or on a 429, the next model in
 * the list gets its turn. With pin there is one model and one attempt, so a failure surfaces at
 * once and the sweep can stop. A 400 that names an option (thinking, resolution, fps, media
 * processing, seed) drops that option and tries again, on the next model when there is one,
 * otherwise on the same model. Every attempt is reported through onAttempt for the ledger.
 */
export async function generateReview(
  ai: GoogleGenAI,
  models: string | string[],
  contents: Content[],
  responseJsonSchema: unknown,
  systemInstruction: string,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const list = parseModelList(models);
  if (list.length === 0) throw new Error("No model id: set GEMINI_MODEL");
  if (options.pin && list.length > 1) throw new Error("pin takes exactly one model id");
  const attempts: Attempt[] = [];
  const dropped = new Set<string>();
  let body = contents;

  const call = async (model: string) => {
    const config: GenerateContentConfig = {
      systemInstruction,
      responseMimeType: "application/json",
      responseJsonSchema,
      httpOptions: { timeout: TIMEOUTS.generateMs, retryOptions: { attempts: 1 } },
    };
    if (options.thinking && supportsThinking(model) && !dropped.has("thinking")) {
      config.thinkingConfig = { thinkingLevel: SDK_THINKING[options.thinking] };
    }
    if (options.seed !== undefined && !dropped.has("seed")) config.seed = options.seed;
    const t0 = Date.now();
    try {
      const response = await ai.models.generateContent({ model, contents: body, config });
      const finishReason = response.candidates?.[0]?.finishReason ?? null;
      const attempt: Attempt = { model, status: "ok", httpStatus: 200, generateS: (Date.now() - t0) / 1000, finishReason, droppedOption: null };
      attempts.push(attempt);
      options.onAttempt?.(attempt);
      return response;
    } catch (err) {
      const attempt: Attempt = {
        model,
        status: statusOf(err),
        httpStatus: err instanceof ApiError ? err.status : null,
        generateS: (Date.now() - t0) / 1000,
        finishReason: null,
        droppedOption: rejectedOption(err),
      };
      attempts.push(attempt);
      options.onAttempt?.(attempt);
      throw err;
    }
  };

  let response: Awaited<ReturnType<typeof call>> | null = null;
  let model = list[0];
  for (let i = 0; i < list.length && response === null; i++) {
    model = list[i];
    const last = i === list.length - 1;
    const next = last ? null : list[i + 1];
    try {
      response = await call(model);
    } catch (err) {
      const option = rejectedOption(err);
      if (option && !dropped.has(option)) {
        dropped.add(option);
        body = withoutPartOption(body, option);
        const again = options.pin || last;
        console.warn(`[gemini] ${model} rejected the ${option} option; trying ${again ? "again" : next} without it`);
        if (again) i -= 1; // the same model, once per option
        continue;
      }
      if (options.pin) throw err;
      if (isTimeout(err) || isQuota(err)) {
        if (last) throw err;
        console.warn(`[gemini] ${model} ${isQuota(err) ? "is out of quota" : "did not answer in time"}, trying ${next}`);
        continue;
      }
      if (!isRetryable(err)) throw err;
      await sleep(options.retryWaitMs ?? 30_000);
      try {
        response = await call(model);
      } catch (again) {
        if (!(isRetryable(again) || isTimeout(again)) || last) throw again;
        console.warn(`[gemini] ${model} is overloaded, trying ${next}`);
      }
    }
  }
  if (response === null) throw new Error("No model answered");

  const blocked = response.promptFeedback?.blockReason;
  if (blocked) {
    throw new Error(`Gemini refused the request (${blocked}); check the cast images and the video`);
  }
  const candidate = response.candidates?.[0];
  const finishReason: string | null = candidate?.finishReason ?? null;
  if (finishReason && finishReason !== "STOP") {
    const why =
      finishReason === "MAX_TOKENS"
        ? "the answer hit the output limit"
        : finishReason === "SAFETY"
          ? "the answer was blocked by the safety filter"
          : `the model stopped early (${finishReason})`;
    throw new Error(`Gemini did not finish the review: ${why}. Run it again`);
  }
  const text = response.text;
  if (!text || !text.trim()) throw new Error("Gemini returned an empty answer. Run it again");

  const u = response.usageMetadata;
  return {
    text,
    finishReason,
    model,
    attempts,
    usage: {
      input: u?.promptTokenCount ?? 0,
      output: u?.candidatesTokenCount ?? 0,
      thoughts: u?.thoughtsTokenCount ?? 0,
      cached: u?.cachedContentTokenCount ?? 0,
    },
  };
}

function retrySeconds(message: string): number | null {
  const m = /retryDelay"?\s*:?\s*"?(\d+)(?:\.\d+)?s/.exec(message) ?? /retry in (\d+)/i.exec(message);
  return m ? Number(m[1]) : null;
}

/** Maps SDK and network failures to one sentence a strategist can act on. Never includes the key. */
export function describeGeminiError(err: unknown): string {
  if (err instanceof ApiError) {
    const msg = err.message || "";
    if (err.status === 429) {
      if (/per[_ ]?day|daily|PerDay/i.test(msg)) {
        return "Daily free quota for this model is used up. It resets at midnight Pacific time.";
      }
      const wait = retrySeconds(msg);
      return wait ? `Rate limit hit, try again in ${wait} s` : "Rate limit hit, try again in a minute";
    }
    if (/location is not supported/i.test(msg)) {
      return "Gemini is not available in this region for this key; use a key from a supported region or a VPN";
    }
    if (err.status === 404 || /not found|is not supported for generateContent|limit: 0/i.test(msg)) {
      return "Model not available to this key: run npm run models and set GEMINI_MODEL";
    }
    if (err.status === 400 && /api key/i.test(msg)) {
      return "The API key was rejected: check GOOGLE_API_KEY in .env and restart the server";
    }
    if (err.status === 403) {
      return "The API key is not allowed to do this (403): check the key's project in AI Studio";
    }
    if (err.status === 503 || err.status === 504) {
      return `The model is overloaded right now (${err.status}). Run it again in a minute, or add a fallback model to GEMINI_MODEL`;
    }
    if (err.status >= 500) return `Gemini had a server error (${err.status}). Run it again in a minute`;
    const firstLine = msg.split("\n")[0].slice(0, 200);
    return `Gemini rejected the request (${err.status}): ${firstLine}`;
  }
  if (err instanceof Error) {
    if (err.name === "AbortError" || /timeout|timed out/i.test(err.message)) {
      return "Gemini did not answer in time. Run it again; large files take longer";
    }
    if (/fetch failed|ENOTFOUND|ECONNRESET|EAI_AGAIN/i.test(err.message)) {
      return "Could not reach the Gemini API: check the network connection";
    }
    return err.message.slice(0, 300);
  }
  return "Unknown error";
}
