// Where uploaded files live and how they get there. Server only.
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

export const DATA_DIR = path.join(process.cwd(), "data");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const DB_PATH = path.join(DATA_DIR, "app.db");

export const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};
export const IMAGE_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};
export const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DURATION_S = 600;

/** Stored paths are POSIX, relative to DATA_DIR, and never climb out of it. */
export function resolveDataPath(rel: string): string {
  const parts = rel.split("/");
  const ok =
    /^[A-Za-z0-9_\-./]+$/.test(rel) &&
    parts.every((p) => p !== "" && p !== "." && p !== "..");
  if (!ok) throw new Error("Invalid stored path");
  return path.join(DATA_DIR, ...parts);
}

export function newStoredName(folder: "videos" | "cast", ext: string): string {
  return `uploads/${folder}/${crypto.randomUUID()}${ext}`;
}

/** Streams a multipart File to disk without buffering it in memory. */
export async function streamToDisk(file: File, rel: string): Promise<void> {
  const abs = resolveDataPath(rel);
  await mkdir(path.dirname(abs), { recursive: true });
  const source = Readable.fromWeb(file.stream() as unknown as NodeReadableStream);
  await pipeline(source, createWriteStream(abs));
}

export type VideoUpload = { file: File; durationS: number; storedPath: string };

/** Validates the multipart video field and the browser-measured duration; picks the stored name. */
export function readVideoField(
  fileField: FormDataEntryValue | null,
  durationField: FormDataEntryValue | null,
): VideoUpload | { error: string } {
  if (!(fileField instanceof File) || fileField.size === 0) return { error: "Choose a video file" };
  const ext = VIDEO_TYPES[fileField.type];
  if (!ext) return { error: "Unsupported video type: upload an H.264 MP4 (WebM and MOV are accepted too)" };
  if (fileField.size > MAX_VIDEO_BYTES) return { error: "The file is larger than 300 MB" };
  const durationS = Number(durationField);
  if (!Number.isFinite(durationS) || durationS < 1 || durationS > MAX_DURATION_S) {
    return { error: "Could not read the video length (1 s to 10 min); the file may not be playable in this browser" };
  }
  return {
    file: fileField,
    durationS: Math.round(durationS * 1000) / 1000,
    storedPath: newStoredName("videos", ext),
  };
}

export function readImageField(fileField: FormDataEntryValue | null): { file: File; storedPath: string } | { error: string } {
  if (!(fileField instanceof File) || fileField.size === 0) return { error: "Choose a reference image" };
  const ext = IMAGE_TYPES[fileField.type];
  if (!ext) return { error: "Unsupported image type: use PNG, JPEG or WebP" };
  if (fileField.size > MAX_IMAGE_BYTES) return { error: "The image is larger than 10 MB" };
  return { file: fileField, storedPath: newStoredName("cast", ext) };
}

export async function removeStored(rel: string): Promise<void> {
  try {
    await unlink(resolveDataPath(rel));
  } catch {
    // already gone
  }
}
