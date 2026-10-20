"use client";

import { CATEGORY_LABELS } from "@/lib/enums";
import type { NoteView } from "@/lib/queries";
import { fmtTime } from "@/lib/time";
import { CATEGORY_STYLES, SEVERITY_SIZE } from "./styles";

type Props = {
  notes: NoteView[];
  durationS: number;
  currentTime: number;
  selectedId: number | null;
  onSeek: (t: number) => void;
  onSelect: (note: NoteView) => void;
};

/**
 * The scrub bar with one marker per note. Hollow dashed = AI draft, filled = open,
 * rotated faded square = resolved; colour by category, size by severity; carried notes that
 * nobody has re-checked yet are ghosts. Markers past the end of this cut are not drawn.
 */
export function Timeline({ notes, durationS, currentTime, selectedId, onSeek, onSelect }: Props) {
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / durationS) * 100))}%`;
  const visible = notes.filter((n) => n.tStart < durationS);

  function seekFromClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeek(Math.min(durationS, Math.max(0, ratio * durationS)));
  }

  return (
    <div className="select-none">
      <div
        role="slider"
        aria-label="Timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationS)}
        aria-valuenow={Math.round(currentTime)}
        tabIndex={-1}
        onClick={seekFromClick}
        className="relative h-12 cursor-pointer rounded-md border border-zinc-200 bg-white"
      >
        <div className="absolute inset-x-2 top-1/2 h-1 -translate-y-1/2 rounded bg-zinc-200" />
        <div className="absolute inset-x-2 inset-y-0">
          {visible.map((n) => {
            const style = CATEGORY_STYLES[n.category];
            const shape =
              n.status === "draft"
                ? `rounded-full border-2 border-dashed bg-transparent ${style.marker.replace(/bg-\S+/, "")}`
                : n.status === "resolved"
                  ? `rotate-45 rounded-none opacity-40 border-2 ${style.marker}`
                  : `rounded-full border-2 ${style.marker}`;
            const ghost = n.isGhost ? " opacity-40 border-dotted" : "";
            const selected = n.id === selectedId ? " ring-2 ring-zinc-900 ring-offset-1" : "";
            const label = `${fmtTime(n.tStart)} ${CATEGORY_LABELS[n.category]} (${n.severity}) ${n.title}${
              n.isGhost ? ` from v${n.carriedFrom?.version} at ${fmtTime(n.carriedFrom?.tStart ?? 0)}, not re-checked` : ""
            }`;
            return (
              <button
                key={n.id}
                type="button"
                title={label}
                aria-label={label}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(n);
                }}
                style={{ left: pct(n.tStart) }}
                className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 ${SEVERITY_SIZE[n.severity]} ${shape}${ghost}${selected} hover:scale-125`}
              />
            );
          })}
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-zinc-900"
            style={{ left: pct(currentTime) }}
          />
        </div>
      </div>
      <div className="mt-1 flex justify-between font-mono text-xs text-zinc-500">
        <span>00:00</span>
        <span>{fmtTime(currentTime)}</span>
        <span>{fmtTime(durationS)}</span>
      </div>
    </div>
  );
}
