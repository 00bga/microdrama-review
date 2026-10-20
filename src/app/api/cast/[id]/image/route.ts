import { eq } from "drizzle-orm";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { getDb, schema } from "@/db";
import { parseId } from "@/lib/ids";
import { resolveDataPath } from "@/lib/uploads";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/cast/[id]/image">) {
  const castId = parseId((await ctx.params).id);
  if (!castId) return new Response("Not found", { status: 404 });
  const member = getDb()
    .select({ imagePath: schema.castMembers.imagePath, imageMime: schema.castMembers.imageMime })
    .from(schema.castMembers)
    .where(eq(schema.castMembers.id, castId))
    .get();
  if (!member) return new Response("Not found", { status: 404 });
  const abs = resolveDataPath(member.imagePath);
  const info = await stat(abs).catch(() => null);
  if (!info) return new Response("File missing", { status: 404 });
  const stream = Readable.toWeb(createReadStream(abs)) as unknown as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": member.imageMime,
      "Content-Length": String(info.size),
      "Cache-Control": "no-store",
    },
  });
}
