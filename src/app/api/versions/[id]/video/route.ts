// Serves an uploaded cut with HTTP Range support so the <video> element can seek.
import { eq } from "drizzle-orm";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { getDb, schema } from "@/db";
import { parseId } from "@/lib/ids";
import { resolveDataPath } from "@/lib/uploads";

const CHUNK = 8 * 1024 * 1024;

type Target = { abs: string; size: number; mimeType: string };

async function locate(ctx: RouteContext<"/api/versions/[id]/video">): Promise<Target | null> {
  const versionId = parseId((await ctx.params).id);
  if (!versionId) return null;
  const row = getDb()
    .select({ videoPath: schema.versions.videoPath, mimeType: schema.versions.mimeType })
    .from(schema.versions)
    .where(eq(schema.versions.id, versionId))
    .get();
  if (!row) return null;
  const abs = resolveDataPath(row.videoPath);
  const info = await stat(abs).catch(() => null);
  if (!info) return null;
  return { abs, size: info.size, mimeType: row.mimeType };
}

/** Returns the byte window for a Range header, "full" for none or malformed, or "unsatisfiable". */
export function parseRange(header: string | null, size: number): { start: number; end: number } | "full" | "unsatisfiable" {
  if (!header) return "full";
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "full";
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(m[1]);
  if (start >= size) return "unsatisfiable";
  const requestedEnd = m[2] === "" ? start + CHUNK - 1 : Number(m[2]);
  const end = Math.min(requestedEnd, size - 1);
  if (end < start) return "unsatisfiable";
  return { start, end };
}

function baseHeaders(target: Target): Record<string, string> {
  return {
    "Content-Type": target.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };
}

function respond(req: NextRequest, target: Target, withBody: boolean): Response {
  const range = parseRange(req.headers.get("range"), target.size);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders(target), "Content-Range": `bytes */${target.size}` },
    });
  }
  const window = range === "full" ? { start: 0, end: target.size - 1 } : range;
  const headers: Record<string, string> = {
    ...baseHeaders(target),
    "Content-Length": String(window.end - window.start + 1),
  };
  if (range !== "full") headers["Content-Range"] = `bytes ${window.start}-${window.end}/${target.size}`;
  const status = range === "full" ? 200 : 206;
  if (!withBody || target.size === 0) return new Response(null, { status, headers });

  const file = createReadStream(target.abs, { start: window.start, end: window.end });
  req.signal.addEventListener("abort", () => file.destroy(), { once: true });
  return new Response(Readable.toWeb(file) as unknown as ReadableStream, { status, headers });
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/versions/[id]/video">) {
  const target = await locate(ctx);
  if (!target) return new Response("Not found", { status: 404 });
  return respond(req, target, true);
}

export async function HEAD(req: NextRequest, ctx: RouteContext<"/api/versions/[id]/video">) {
  const target = await locate(ctx);
  if (!target) return new Response(null, { status: 404 });
  return respond(req, target, false);
}
