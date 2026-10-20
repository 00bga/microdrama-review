// POST multipart: a new episode with its first cut, in one transaction.
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb, schema } from "@/db";
import { parseId } from "@/lib/ids";
import { readVideoField, removeStored, streamToDisk } from "@/lib/uploads";
import { createEpisodeWithFirstCut } from "@/lib/versions";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const seriesId = parseId(form.get("seriesId"));
  const title = String(form.get("title") ?? "").trim();
  if (!seriesId) return Response.json({ error: "Missing series" }, { status: 400 });
  if (!title || title.length > 200) return Response.json({ error: "Give the episode a title" }, { status: 400 });
  const exists = getDb().select({ id: schema.series.id }).from(schema.series).where(eq(schema.series.id, seriesId)).get();
  if (!exists) return Response.json({ error: "Series not found" }, { status: 404 });

  const video = readVideoField(form.get("video"), form.get("durationS"));
  if ("error" in video) return Response.json({ error: video.error }, { status: 400 });

  await streamToDisk(video.file, video.storedPath);
  try {
    const created = createEpisodeWithFirstCut(seriesId, title, {
      videoPath: video.storedPath,
      mimeType: video.file.type,
      durationS: video.durationS,
    });
    return Response.json(created, { status: 201 });
  } catch (err) {
    await removeStored(video.storedPath);
    throw err;
  }
}
