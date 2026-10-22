"use client";

import { useState, useTransition } from "react";
import { deleteNote, keepNote, moveNote, reopenNote, resolveNote, type ActionResult } from "@/app/actions";
import { CATEGORY_LABELS } from "@/lib/enums";
import type { NoteView } from "@/lib/queries";
import { fmtTime } from "@/lib/time";
import { CATEGORY_STYLES, SEVERITY_TEXT } from "./styles";

type Props = {
  note: NoteView;
  durationS: number;
  selected: boolean;
  readOnly: boolean;
  currentTime: number;
  onSelect: (note: NoteView) => void;
  onPlayFrom: (note: NoteView) => void;
  onEdit: (note: NoteView) => void;
};

const FIX_LABEL = { fixed: "AI: fixed", not_fixed: "AI: not fixed", unclear: "AI: unclear" } as const;
const FIX_STYLE = {
  fixed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  not_fixed: "bg-red-50 text-red-700 ring-red-200",
  unclear: "bg-zinc-100 text-zinc-700 ring-zinc-200",
} as const;

export function NoteCard({ note, durationS, selected, readOnly, currentTime, onSelect, onPlayFrom, onEdit }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const r = await fn();
      setError(r.ok ? null : r.error);
    });

  const style = CATEGORY_STYLES[note.category];
  const gone = note.tStart >= durationS;
  const btn = "rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50";

  return (
    <li
      id={`note-${note.id}`}
      className={`rounded-lg border bg-white p-3 shadow-sm transition ${
        selected ? "border-zinc-900 ring-1 ring-zinc-900" : "border-zinc-200 hover:border-zinc-400"
      } ${note.status === "resolved" ? "opacity-70" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => onSelect(note)}
          className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-white hover:bg-zinc-700"
          title="Seek to this moment"
        >
          {fmtTime(note.tStart)}
          {note.tEnd !== null && `-${fmtTime(note.tEnd)}`}
        </button>
        <span className={`rounded-full px-2 py-0.5 font-medium ring-1 ${style.pill}`}>{CATEGORY_LABELS[note.category]}</span>
        <span className={`font-medium ${SEVERITY_TEXT[note.severity]}`}>{note.severity}</span>
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600">{note.source === "ai" ? "AI" : "Human"}</span>
        <span className="text-zinc-500">
          {note.status === "draft" ? "draft, untriaged" : note.status === "open" ? "open" : "resolved"}
        </span>
        {note.castName && <span className="text-zinc-500">about {note.castName}</span>}
        {note.carriedFrom && (
          <span className="text-zinc-500">
            was {fmtTime(note.carriedFrom.tStart)} in v{note.carriedFrom.version}
          </span>
        )}
        {note.aiFixAssessment && (
          <span className={`rounded-full px-2 py-0.5 font-medium ring-1 ${FIX_STYLE[note.aiFixAssessment]}`}>
            {FIX_LABEL[note.aiFixAssessment]}
          </span>
        )}
      </div>

      <h3 className="mt-2 text-sm font-medium">{note.title}</h3>
      {note.body && <p className="mt-1 text-sm text-zinc-700">{note.body}</p>}
      {note.evidence && <p className="mt-1 text-xs text-zinc-500">Evidence: {note.evidence}</p>}
      {note.aiFixRationale && <p className="mt-1 text-xs text-zinc-500">AI rationale: {note.aiFixRationale}</p>}

      {note.isGhost && !gone && (
        <p className="mt-1 text-xs text-amber-700">
          Carried from v{note.carriedFrom?.version} at {fmtTime(note.carriedFrom?.tStart ?? 0)}, not re-checked in this cut.
        </p>
      )}
      {gone && (
        <p className="mt-1 text-xs text-amber-700">
          This moment may be gone: {fmtTime(note.tStart)} is past the end of this cut ({fmtTime(durationS)}).
        </p>
      )}

      {!readOnly && note.suggestedTStart !== null && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
          <span>AI suggests {fmtTime(note.suggestedTStart)} in this cut.</span>
          <button type="button" disabled={pending} onClick={() => run(() => moveNote({ noteId: note.id, tStart: null }))} className={btn}>
            Accept
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => moveNote({ noteId: note.id, tStart: currentTime }))}
            className={btn}
          >
            Move to playhead ({fmtTime(currentTime)})
          </button>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => onPlayFrom(note)} className={btn}>
          Play from note
        </button>
        {!readOnly && (
          <>
            {note.status === "draft" && (
              <button type="button" disabled={pending} onClick={() => run(() => keepNote(note.id))} className={btn}>
                Keep
              </button>
            )}
            <button type="button" disabled={pending} onClick={() => onEdit(note)} className={btn}>
              Edit
            </button>
            {note.status === "open" && (
              <button type="button" disabled={pending} onClick={() => run(() => resolveNote(note.id))} className={btn}>
                Resolve
              </button>
            )}
            {note.status === "resolved" && (
              <button type="button" disabled={pending} onClick={() => run(() => reopenNote(note.id))} className={btn}>
                Reopen
              </button>
            )}
            {note.suggestedTStart === null && note.carriedFrom && note.status === "open" && (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => moveNote({ noteId: note.id, tStart: currentTime }))}
                className={btn}
                title="Re-anchor this carried note to the current playhead"
              >
                Move to playhead
              </button>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (note.status === "draft" || window.confirm("Delete this note?")) run(() => deleteNote(note.id));
              }}
              className={`${btn} text-red-700`}
            >
              Delete
            </button>
          </>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </li>
  );
}
