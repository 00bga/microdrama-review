// POST multipart: a cast member with one reference image.
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb, schema } from "@/db";
import { parseId } from "@/lib/ids";
import { readImageField, removeStored, streamToDisk } from "@/lib/uploads";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/series/[id]/cast">) {
  const seriesId = parseId((await ctx.params).id);
  if (!seriesId) return Response.json({ error: "Series not found" }, { status: 404 });
  const db = getDb();
  const exists = db.select({ id: schema.series.id }).from(schema.series).where(eq(schema.series.id, seriesId)).get();
  if (!exists) return Response.json({ error: "Series not found" }, { status: 404 });

  const form = await req.formData();
  const name = String(form.get("name") ?? "").trim();
  const description = String(form.get("description") ?? "").trim().slice(0, 500);
  if (!name || name.length > 80) return Response.json({ error: "Give the cast member a name" }, { status: 400 });
  const image = readImageField(form.get("image"));
  if ("error" in image) return Response.json({ error: image.error }, { status: 400 });

  await streamToDisk(image.file, image.storedPath);
  try {
    const now = Date.now();
    const row = db
      .insert(schema.castMembers)
      .values({
        seriesId,
        name,
        description,
        imagePath: image.storedPath,
        imageMime: image.file.type,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: schema.castMembers.id })
      .get();
    return Response.json({ castId: row.id }, { status: 201 });
  } catch (err) {
    await removeStored(image.storedPath);
    throw err;
  }
}
