"use client";

import { useState, useTransition } from "react";
import { createNote, updateNote } from "@/app/actions";
import { CATEGORY_LABELS, NOTE_CATEGORIES, SEVERITIES, type NoteCategory, type Severity } from "@/lib/enums";
import type { NoteView } from "@/lib/queries";
import { fmtTime, parseTimecode } from "@/lib/time";

type Props = {
  versionId: number;
  durationS: number;
  cast: Array<{ id: number; name: string }>;
  /** editing an existing note, or null to add one */
  note: NoteView | null;
  defaultTime: number;
  onDone: () => void;
  onCancel: () => void;
};

export function NoteForm({ versionId, durationS, cast, note, defaultTime, onDone, onCancel }: Props) {
  const [tStart, setTStart] = useState(fmtTime(note ? note.tStart : defaultTime));
  const [tEnd, setTEnd] = useState(note?.tEnd !== null && note?.tEnd !== undefined ? fmtTime(note.tEnd) : "");
  const [category, setCategory] = useState<NoteCategory>(note?.category ?? "other");
  const [severity, setSeverity] = useState<Severity>(note?.severity ?? "medium");
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [evidence, setEvidence] = useState(note?.evidence ?? "");
  const [castMemberId, setCastMemberId] = useState<number | null>(note?.castMemberId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const start = parseTimecode(tStart);
    if (start === null || start > durationS) return setError(`Start must be a time between 00:00 and ${fmtTime(durationS)}`);
    const end = tEnd.trim() ? parseTimecode(tEnd) : null;
    if (tEnd.trim() && (end === null || end < start || end > durationS)) return setError("End must be a time after the start");
    if (!title.trim()) return setError("Title is required");
    const payload = {
      tStart: start,
      tEnd: end,
      category,
      severity,
      title: title.trim(),
      body: body.trim(),
      evidence: evidence.trim() || null,
      castMemberId,
    };
    startTransition(async () => {
      const r = note ? await updateNote({ ...payload, noteId: note.id }) : await createNote({ ...payload, versionId });
      if (!r.ok) return setError(r.error);
      setError(null);
      onDone();
    });
  }

  const field = "rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-zinc-500 focus:outline-none";

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-zinc-300 bg-zinc-50 p-3">
      <div className="flex flex-wrap gap-2">
        <label className="text-xs text-zinc-600">
          Start
          <input value={tStart} onChange={(e) => setTStart(e.target.value)} placeholder="MM:SS" className={`${field} ml-1 w-20 font-mono`} />
        </label>
        <label className="text-xs text-zinc-600">
          End
          <input value={tEnd} onChange={(e) => setTEnd(e.target.value)} placeholder="optional" className={`${field} ml-1 w-20 font-mono`} />
        </label>
        <select value={category} onChange={(e) => setCategory(e.target.value as NoteCategory)} className={field}>
          {NOTE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} className={field}>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {cast.length > 0 && (
          <select
            value={castMemberId ?? ""}
            onChange={(e) => setCastMemberId(e.target.value ? Number(e.target.value) : null)}
            className={field}
          >
            <option value="">No cast member</option>
            {cast.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={200}
        placeholder="Title"
        autoFocus
        className={`${field} w-full`}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={4000}
        rows={3}
        placeholder="What is wrong, why it hurts, the fix"
        className={`${field} w-full`}
      />
      <input
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        maxLength={2000}
        placeholder="Evidence (optional): what you saw or heard"
        className={`${field} w-full`}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-3 py-1 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {pending ? "Saving" : note ? "Save" : "Add note"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-200">
          Cancel
        </button>
      </div>
    </form>
  );
}
