"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { approveEpisode } from "@/app/actions";
import { StatusBadge } from "@/components/StatusBadge";
import { UploadCutForm } from "@/components/UploadCutForm";
import type { NoteView, Workspace } from "@/lib/queries";
import { fmtTime } from "@/lib/time";
import { AiStatusBanner } from "./AiStatusBanner";
import { ComparePanel } from "./ComparePanel";
import { NoteCard } from "./NoteCard";
import { NoteForm } from "./NoteForm";
import { Timeline } from "./Timeline";
import { VersionSwitcher } from "./VersionSwitcher";
import { VideoPlayer } from "./VideoPlayer";

type Editing = { mode: "add"; tStart: number } | { mode: "edit"; noteId: number } | null;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName);
}

export function ReviewWorkspace({ data }: { data: Workspace }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const compareRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [compareId, setCompareId] = useState<number | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approving, startApprove] = useTransition();

  const { current, episode, series, versions, isLatest, cast } = data;
  const notes = data.notesByVersion[current.id] ?? [];
  const readOnly = !isLatest;
  const running = current.aiStatus === "running";
  const openCount = notes.filter((n) => n.status === "open").length;
  const draftCount = notes.filter((n) => n.status === "draft").length;
  const previous = versions.filter((v) => v.number < current.number).at(-1);
  const defaultCompare = (previous ?? versions.find((v) => v.number === data.latestNumber && v.id !== current.id))?.id ?? null;

  /** The note in another cut that this note was carried from, or carried into. */
  function related(note: NoteView, targetVersionId: number): NoteView | null {
    const all = Object.values(data.notesByVersion).flat();
    const byId = new Map(all.map((n) => [n.id, n]));
    let back: NoteView | undefined = note;
    while (back) {
      if (back.versionId === targetVersionId) return back;
      back = back.carriedFromNoteId !== null ? byId.get(back.carriedFromNoteId) : undefined;
    }
    let forward: NoteView | undefined = note;
    while (forward) {
      if (forward.versionId === targetVersionId) return forward;
      const id: number = forward.id;
      forward = all.find((n) => n.carriedFromNoteId === id);
    }
    return null;
  }

  function seek(t: number, play = false) {
    const v = videoRef.current;
    if (v) {
      if (play) {
        v.currentTime = Math.max(0, t - 0.5);
        void v.play();
      } else {
        v.currentTime = t;
      }
    }
    setCurrentTime(t);
  }

  function selectNote(note: NoteView, play = false) {
    setSelectedId(note.id);
    seek(note.tStart, play);
    const c = compareRef.current;
    if (c && compareId !== null) {
      const twin = related(note, compareId);
      c.currentTime = twin ? twin.tStart : note.tStart;
    }
  }

  function stepNote(delta: 1 | -1) {
    if (notes.length === 0) return;
    const index = notes.findIndex((n) => n.id === selectedId);
    const next = index === -1 ? (delta === 1 ? 0 : notes.length - 1) : Math.min(notes.length - 1, Math.max(0, index + delta));
    selectNote(notes[next]);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const v = videoRef.current;
      if (e.key === " ") {
        e.preventDefault();
        if (!v) return;
        if (v.paused) void v.play();
        else v.pause();
      } else if (e.key === "j" || e.key === "J") {
        stepNote(-1);
      } else if (e.key === "k" || e.key === "K") {
        stepNote(1);
      } else if ((e.key === "n" || e.key === "N") && !readOnly) {
        setEditing({ mode: "add", tStart: v?.currentTime ?? 0 });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const approveReason = !isLatest
    ? "Open the latest cut to approve"
    : episode.status === "approved"
      ? "Already approved"
      : running
        ? "AI review running"
        : openCount > 0
          ? `${openCount} open note${openCount === 1 ? "" : "s"} remaining`
          : null;

  const btn = "rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50";

  return (
    <div className="space-y-4">
      <nav className="text-sm text-zinc-500">
        <Link href="/" className="hover:underline">
          Series
        </Link>
        <span className="mx-1">/</span>
        <Link href={`/series/${series.id}`} className="hover:underline">
          {series.name}
        </Link>
        <span className="mx-1">/</span>
        <span className="text-zinc-800">
          Ep {episode.number}: {episode.title}
        </span>
      </nav>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Ep {episode.number}: {episode.title}
          </h1>
          <StatusBadge status={episode.status} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isLatest && (
            <UploadCutForm
              seriesId={series.id}
              episodes={[]}
              fixedEpisode={{ id: episode.id, nextVersion: current.number + 1, draftCount, aiRunning: running }}
            />
          )}
          <button
            type="button"
            disabled={approveReason !== null || approving}
            title={approveReason ?? "Approve this episode"}
            onClick={() =>
              startApprove(async () => {
                const r = await approveEpisode(episode.id);
                setApproveError(r.ok ? null : r.error);
              })
            }
            className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {episode.status === "approved" ? "Approved" : "Approve"}
          </button>
        </div>
      </header>
      {approveReason && episode.status !== "approved" && isLatest && (
        <p className="text-xs text-zinc-500">
          Approve: {approveReason}
          {draftCount > 0 && ` (${draftCount} AI draft${draftCount === 1 ? "" : "s"} untriaged)`}
        </p>
      )}
      {approveError && <p className="text-sm text-red-600">{approveError}</p>}

      <VersionSwitcher episodeId={episode.id} versions={versions} currentNumber={current.number} latestNumber={data.latestNumber} />

      {readOnly && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Viewing v{current.number}: read only. Notes change on the latest cut (
          <Link href={`/episodes/${episode.id}/v/${data.latestNumber}`} className="underline">
            v{data.latestNumber}
          </Link>
          ).
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-3">
          <div className={compareId !== null ? "grid grid-cols-2 gap-3" : ""}>
            <VideoPlayer
              src={`/api/versions/${current.id}/video`}
              videoRef={videoRef}
              label={`Cut v${current.number}`}
              onTimeUpdate={setCurrentTime}
            />
            {compareId !== null && (
              <ComparePanel
                versions={versions}
                currentId={current.id}
                compareId={compareId}
                notes={data.notesByVersion[compareId] ?? []}
                videoRef={compareRef}
                onChange={setCompareId}
                onClose={() => setCompareId(null)}
              />
            )}
          </div>
          <Timeline
            notes={notes}
            durationS={current.durationS}
            currentTime={currentTime}
            selectedId={selectedId}
            onSeek={(t) => seek(t)}
            onSelect={(n) => selectNote(n)}
          />
          <div className="flex flex-wrap items-center gap-2">
            {versions.length > 1 && compareId === null && (
              <button type="button" onClick={() => setCompareId(defaultCompare)} className={btn}>
                Compare with v{versions.find((v) => v.id === defaultCompare)?.number}
              </button>
            )}
            <span className="text-xs text-zinc-500">Space play or pause, J and K previous or next note, N adds a note at the playhead.</span>
          </div>
        </div>

        <div className="space-y-3">
          <AiStatusBanner version={current} isLatest={isLatest} draftCount={draftCount} />

          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">
              Notes <span className="text-sm font-normal text-zinc-500">({notes.length})</span>
            </h2>
            {!readOnly && (
              <button
                type="button"
                onClick={() => setEditing({ mode: "add", tStart: videoRef.current?.currentTime ?? currentTime })}
                className={btn}
              >
                Add note at {fmtTime(currentTime)}
              </button>
            )}
          </div>

          {editing?.mode === "add" && (
            <NoteForm
              versionId={current.id}
              durationS={current.durationS}
              cast={cast}
              note={null}
              defaultTime={editing.tStart}
              onDone={() => setEditing(null)}
              onCancel={() => setEditing(null)}
            />
          )}

          {notes.length === 0 && editing === null && (
            <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500">
              No notes on this cut yet. Run the AI review, or press N while the video plays to add one.
            </div>
          )}

          <ul className="space-y-2">
            {notes.map((n) =>
              editing?.mode === "edit" && editing.noteId === n.id ? (
                <li key={n.id}>
                  <NoteForm
                    versionId={current.id}
                    durationS={current.durationS}
                    cast={cast}
                    note={n}
                    defaultTime={n.tStart}
                    onDone={() => setEditing(null)}
                    onCancel={() => setEditing(null)}
                  />
                </li>
              ) : (
                <NoteCard
                  key={n.id}
                  note={n}
                  durationS={current.durationS}
                  selected={n.id === selectedId}
                  readOnly={readOnly}
                  currentTime={currentTime}
                  onSelect={(note) => selectNote(note)}
                  onPlayFrom={(note) => selectNote(note, true)}
                  onEdit={(note) => setEditing({ mode: "edit", noteId: note.id })}
                />
              ),
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
