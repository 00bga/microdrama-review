"use client";

import type { RefObject } from "react";
import { CATEGORY_LABELS } from "@/lib/enums";
import type { NoteView, VersionSummary } from "@/lib/queries";
import { fmtTime } from "@/lib/time";
import { CATEGORY_STYLES } from "./styles";
import { VideoPlayer } from "./VideoPlayer";

type Props = {
  versions: VersionSummary[];
  currentId: number;
  compareId: number;
  notes: NoteView[];
  videoRef: RefObject<HTMLVideoElement | null>;
  onChange: (id: number) => void;
  onClose: () => void;
};

/** A second, muted player for another cut, with that cut's notes and what became of each. */
export function ComparePanel({ versions, currentId, compareId, notes, videoRef, onChange, onClose }: Props) {
  const compare = versions.find((v) => v.id === compareId);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-zinc-600">Compare with</span>
          <select
            value={compareId}
            onChange={(e) => onChange(Number(e.target.value))}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm"
          >
            {versions
              .filter((v) => v.id !== currentId)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.number}
                </option>
              ))}
          </select>
        </label>
        <button type="button" onClick={onClose} className="text-xs text-zinc-500 underline">
          Close
        </button>
      </div>
      <VideoPlayer
        src={`/api/versions/${compareId}/video`}
        videoRef={videoRef}
        label={`Cut v${compare?.number ?? ""}, muted`}
        muted
      />
      <ul className="space-y-1 text-xs">
        {notes.length === 0 && <li className="text-zinc-500">No notes on v{compare?.number}.</li>}
        {notes.map((n) => (
          <li key={n.id} className="flex items-start gap-2 rounded border border-zinc-200 bg-white px-2 py-1">
            <span className="font-mono text-zinc-700">{fmtTime(n.tStart)}</span>
            <span className={`rounded-full px-1.5 ring-1 ${CATEGORY_STYLES[n.category].pill}`}>{CATEGORY_LABELS[n.category]}</span>
            <span className="min-w-0 flex-1 truncate" title={n.title}>
              {n.title}
            </span>
            <span className="whitespace-nowrap text-zinc-500">{n.outcome}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
