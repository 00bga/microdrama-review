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

/** 3.8 Flash for the best notes, 3.6 Flash behind it for the hours when 3.8 is overloaded. */
export const DEFAULT_MODEL = "gemini-3.8-flash,gemini-3.6-flash";

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

export type GenerateResult = {
  text: string;
  usage: TokenUsage;
  finishReason: string | null;
  /** the model that answered (the first in the list that was not overloaded) */
  model: string;
};

export function isRetryable(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 500 || err.status === 503 || err.status === 504);
}

/** The SDK's own timeout (AbortError) or a socket timeout: the model hung, so it is not worth a retry. */
export function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || /timeout|timed out/i.test(err.message));
}

/**
 * One structured-output call. On 500, 503 or 504 the same model is retried once after a pause; after
 * that, or when the model hangs until the timeout, the next model in the list gets its turn. Never
 * retries on 429, which would burn the free quota.
 */
export async function generateReview(
  ai: GoogleGenAI,
  models: string | string[],
  contents: Content[],
  responseJsonSchema: unknown,
  systemInstruction: string,
): Promise<GenerateResult> {
  const list = parseModelList(models);
  if (list.length === 0) throw new Error("No model id: set GEMINI_MODEL");
  const call = (model: string) =>
    ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseJsonSchema,
        httpOptions: { timeout: TIMEOUTS.generateMs, retryOptions: { attempts: 1 } },
      },
    });

  let response: Awaited<ReturnType<typeof call>> | null = null;
  let model = list[0];
  for (let i = 0; i < list.length && response === null; i++) {
    model = list[i];
    const last = i === list.length - 1;
    try {
      response = await call(model);
    } catch (err) {
      if (isTimeout(err)) {
        if (last) throw err;
        console.warn(`[gemini] ${model} did not answer in time, trying ${list[i + 1]}`);
        continue;
      }
      if (!isRetryable(err)) throw err;
      await sleep(4_000);
      try {
        response = await call(model);
      } catch (again) {
        if (!(isRetryable(again) || isTimeout(again)) || last) throw again;
        console.warn(`[gemini] ${model} is overloaded, trying ${list[i + 1]}`);
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
