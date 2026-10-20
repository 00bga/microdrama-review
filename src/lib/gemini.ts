// Gemini client, Files API handling and the single generateContent call. No database here.
import {
  ApiError,
  FileState,
  GoogleGenAI,
  type Content,
  type File as GeminiFile,
} from "@google/genai";
import { setTimeout as sleep } from "node:timers/promises";
import type { TokenUsage } from "@/lib/pricing";

export const DEFAULT_MODEL = "gemini-3.8-flash";

export const TIMEOUTS = {
  uploadMs: 2 * 60_000,
  processingMs: 5 * 60_000,
  generateMs: 3 * 60_000,
  pollMs: 3_000,
};

/** An empty GEMINI_MODEL= line loads as "", which is why this is || and not ??. */
export function getModelId(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

export function getApiKey(): string | null {
  return process.env.GOOGLE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || null;
}

/** One client per job. The SDK retries 429 by default, which would burn the free quota, so retries are off. */
export function createClient(): GoogleGenAI {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("No API key: set GOOGLE_API_KEY in .env and restart the server");
  return new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } });
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
  let file = await ai.files.upload({
    file: absPath,
    config: { mimeType: geminiMime, displayName, httpOptions: { timeout: TIMEOUTS.uploadMs } },
  });
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
    const detail = file.error?.message ? `: ${file.error.message}` : "";
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

export type GenerateResult = {
  text: string;
  usage: TokenUsage;
  finishReason: string | null;
};

export function isRetryable(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 500 || err.status === 503);
}

/** One structured-output call. Retries once, after a pause, on 500 or 503 only; never on 429. */
export async function generateReview(
  ai: GoogleGenAI,
  model: string,
  contents: Content[],
  responseJsonSchema: unknown,
  systemInstruction: string,
): Promise<GenerateResult> {
  const call = () =>
    ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseJsonSchema,
        httpOptions: { timeout: TIMEOUTS.generateMs },
      },
    });

  let response;
  try {
    response = await call();
  } catch (err) {
    if (!isRetryable(err)) throw err;
    await sleep(4_000);
    response = await call();
  }

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
