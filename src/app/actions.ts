"use server";

// Small writes. Every action validates its input, refuses writes on a non-latest cut,
// keeps the episode status machine honest and refreshes the route when it is done.
import { and, count, desc, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { NOTE_CATEGORIES, SEVERITIES } from "@/lib/enums";
import { removeStored } from "@/lib/uploads";

const { castMembers, episodes, notes, series, versions } = schema;

export type ActionResult = { ok: true } | { ok: false; error: string };

const id = z.number().int().positive();
const seconds = z.number().min(0).max(36_000);

const noteFields = z.object({
  tStart: seconds,
  tEnd: seconds.nullable().optional(),
  category: z.enum(NOTE_CATEGORIES),
  severity: z.enum(SEVERITIES),
  title: z.string().trim().min(1, "Title is required").max(200),
  body: z.string().trim().max(4000).default(""),
  evidence: z.string().trim().max(2000).nullable().optional(),
  castMemberId: id.nullable().optional(),
});

function fail(error: string): ActionResult {
  return { ok: false, error };
}

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> | string {
  const r = schema.safeParse(input);
  return r.success ? r.data : (r.error.issues[0]?.message ?? "Invalid input");
}

/** The version row plus whether it is the newest cut of its episode. */
function loadVersion(versionId: number) {
  const db = getDb();
  const version = db.select().from(versions).where(eq(versions.id, versionId)).get();
  if (!version) return null;
  const latest = db
    .select({ number: versions.number })
    .from(versions)
    .where(eq(versions.episodeId, version.episodeId))
    .orderBy(desc(versions.number))
    .limit(1)
    .get();
  return { version, isLatest: latest?.number === version.number };
}

const READ_ONLY = "This cut is read only; switch to the latest version to change notes";

/** Status machine side effects shared by the note actions. */
function touchEpisode(episodeId: number, opts: { reopen: boolean }) {
  const db = getDb();
  const now = Date.now();
  db.update(episodes)
    .set({ status: "in_review", updatedAt: now })
    .where(and(eq(episodes.id, episodeId), eq(episodes.status, "pending")))
    .run();
  if (opts.reopen) {
    db.update(episodes)
      .set({ status: "in_review", updatedAt: now })
      .where(and(eq(episodes.id, episodeId), eq(episodes.status, "approved")))
      .run();
  }
}

export async function createSeries(
  _prev: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string }> {
  const name = parse(z.string().trim().min(1, "Give the series a name").max(100), formData.get("name"));
  if (typeof name !== "string" || name === "") return { error: typeof name === "string" ? name : "Invalid name" };
  const now = Date.now();
  const row = getDb().insert(series).values({ name, createdAt: now }).returning({ id: series.id }).get();
  redirect(`/series/${row.id}`);
}

/** The series bible is free text; the AI gets it with every review of the series. */
export async function updateSeriesBible(
  _prev: { error?: string; savedAt?: number } | null,
  formData: FormData,
): Promise<{ error?: string; savedAt?: number }> {
  const seriesId = parse(id, Number(formData.get("seriesId")));
  if (typeof seriesId === "string") return { error: "Series not found" };
  const bible = z.string().max(40_000, "The bible is longer than 40,000 characters").safeParse(formData.get("bible") ?? "");
  if (!bible.success) return { error: bible.error.issues[0]?.message ?? "Invalid text" };
  const result = getDb()
    .update(series)
    .set({ bible: bible.data.trim() })
    .where(eq(series.id, seriesId))
    .run();
  if (result.changes === 0) return { error: "Series not found" };
  refresh();
  return { savedAt: Date.now() };
}

export async function createNote(input: unknown): Promise<ActionResult> {
  const data = parse(noteFields.extend({ versionId: id }), input);
  if (typeof data === "string") return fail(data);
  const found = loadVersion(data.versionId);
  if (!found) return fail("Version not found");
  if (!found.isLatest) return fail(READ_ONLY);
  const now = Date.now();
  getDb()
    .insert(notes)
    .values({
      versionId: data.versionId,
      tStart: data.tStart,
      tEnd: data.tEnd != null && data.tEnd >= data.tStart ? data.tEnd : null,
      category: data.category,
      severity: data.severity,
      title: data.title,
      body: data.body,
      evidence: data.evidence || null,
      castMemberId: data.castMemberId ?? null,
      source: "human",
      status: "open",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  touchEpisode(found.version.episodeId, { reopen: true });
  refresh();
  return { ok: true };
}

export async function updateNote(input: unknown): Promise<ActionResult> {
  const data = parse(noteFields.extend({ noteId: id }), input);
  if (typeof data === "string") return fail(data);
  const db = getDb();
  const note = db.select().from(notes).where(eq(notes.id, data.noteId)).get();
  if (!note) return fail("Note not found");
  const found = loadVersion(note.versionId);
  if (!found || !found.isLatest) return fail(READ_ONLY);
  const now = Date.now();
  // Editing a draft is a decision to keep it.
  const status = note.status === "draft" ? "open" : note.status;
  db.update(notes)
    .set({
      tStart: data.tStart,
      tEnd: data.tEnd != null && data.tEnd >= data.tStart ? data.tEnd : null,
      category: data.category,
      severity: data.severity,
      title: data.title,
      body: data.body,
      evidence: data.evidence || null,
      castMemberId: data.castMemberId ?? null,
      status,
      updatedAt: now,
    })
    .where(eq(notes.id, note.id))
    .run();
  touchEpisode(found.version.episodeId, { reopen: status === "open" });
  refresh();
  return { ok: true };
}

async function setNoteStatus(
  noteId: unknown,
  from: Array<"draft" | "open" | "resolved">,
  to: "open" | "resolved",
  reopen: boolean,
): Promise<ActionResult> {
  const parsed = parse(id, noteId);
  if (typeof parsed === "string") return fail(parsed);
  const db = getDb();
  const note = db.select().from(notes).where(eq(notes.id, parsed)).get();
  if (!note) return fail("Note not found");
  const found = loadVersion(note.versionId);
  if (!found || !found.isLatest) return fail(READ_ONLY);
  if (!from.includes(note.status)) return fail(`This note is already ${note.status}`);
  db.update(notes).set({ status: to, updatedAt: Date.now() }).where(eq(notes.id, note.id)).run();
  touchEpisode(found.version.episodeId, { reopen });
  refresh();
  return { ok: true };
}

export async function keepNote(noteId: unknown): Promise<ActionResult> {
  return setNoteStatus(noteId, ["draft"], "open", true);
}

export async function resolveNote(noteId: unknown): Promise<ActionResult> {
  return setNoteStatus(noteId, ["open", "draft"], "resolved", false);
}

export async function reopenNote(noteId: unknown): Promise<ActionResult> {
  return setNoteStatus(noteId, ["resolved"], "open", true);
}

export async function deleteNote(noteId: unknown): Promise<ActionResult> {
  const parsed = parse(id, noteId);
  if (typeof parsed === "string") return fail(parsed);
  const db = getDb();
  const note = db.select().from(notes).where(eq(notes.id, parsed)).get();
  if (!note) return fail("Note not found");
  const found = loadVersion(note.versionId);
  if (!found || !found.isLatest) return fail(READ_ONLY);
  db.delete(notes).where(eq(notes.id, note.id)).run();
  db.update(episodes).set({ updatedAt: Date.now() }).where(eq(episodes.id, found.version.episodeId)).run();
  refresh();
  return { ok: true };
}

/** Re-anchors a carried note: to the AI suggestion, or to a time the strategist picked. */
export async function moveNote(input: unknown): Promise<ActionResult> {
  const data = parse(z.object({ noteId: id, tStart: seconds.nullable(), tEnd: seconds.nullable().optional() }), input);
  if (typeof data === "string") return fail(data);
  const db = getDb();
  const note = db.select().from(notes).where(eq(notes.id, data.noteId)).get();
  if (!note) return fail("Note not found");
  const found = loadVersion(note.versionId);
  if (!found || !found.isLatest) return fail(READ_ONLY);
  const tStart = data.tStart ?? note.suggestedTStart;
  if (tStart === null) return fail("There is no suggested position for this note");
  const tEnd = data.tStart === null ? note.suggestedTEnd : (data.tEnd ?? null);
  db.update(notes)
    .set({
      tStart,
      tEnd: tEnd !== null && tEnd >= tStart ? tEnd : null,
      suggestedTStart: null,
      suggestedTEnd: null,
      updatedAt: Date.now(),
    })
    .where(eq(notes.id, note.id))
    .run();
  refresh();
  return { ok: true };
}

export async function approveEpisode(episodeId: unknown): Promise<ActionResult> {
  const parsed = parse(id, episodeId);
  if (typeof parsed === "string") return fail(parsed);
  const db = getDb();
  const latest = db
    .select()
    .from(versions)
    .where(eq(versions.episodeId, parsed))
    .orderBy(desc(versions.number))
    .limit(1)
    .get();
  if (!latest) return fail("Episode not found");
  if (latest.aiStatus === "running") return fail("Wait for the AI review to finish");
  const open = db
    .select({ n: count() })
    .from(notes)
    .where(and(eq(notes.versionId, latest.id), eq(notes.status, "open")))
    .get();
  if (open && open.n > 0) return fail(`${open.n} open note${open.n === 1 ? "" : "s"} remaining`);
  db.update(episodes).set({ status: "approved", updatedAt: Date.now() }).where(eq(episodes.id, parsed)).run();
  refresh();
  return { ok: true };
}

export async function deleteCast(castId: unknown): Promise<ActionResult> {
  const parsed = parse(id, castId);
  if (typeof parsed === "string") return fail(parsed);
  const db = getDb();
  const member = db.select().from(castMembers).where(eq(castMembers.id, parsed)).get();
  if (!member) return fail("Cast member not found");
  db.delete(castMembers).where(eq(castMembers.id, parsed)).run();
  await removeStored(member.imagePath);
  refresh();
  return { ok: true };
}
