"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type EpisodeOption = { id: number; number: number; title: string; latestVersion: number };

type Props = {
  seriesId: number;
  episodes: EpisodeOption[];
  /** Workspace mode: only a new cut of this episode. */
  fixedEpisode?: { id: number; nextVersion: number; draftCount: number; aiRunning: boolean };
};

/** The browser measures the length so the server and the AI always know the exact duration. */
function measureDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      fn();
    };
    video.onloadedmetadata = () => {
      const d = video.duration;
      finish(() =>
        Number.isFinite(d) && d > 0 ? resolve(d) : reject(new Error("Could not read the video length")),
      );
    };
    video.onerror = () => finish(() => reject(new Error("This browser cannot play the file; use an H.264 MP4")));
    setTimeout(() => finish(() => reject(new Error("Timed out while reading the video length"))), 15_000);
    video.src = url;
  });
}

export function UploadCutForm({ seriesId, episodes, fixedEpisode }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"new" | "version">(fixedEpisode || episodes.length === 0 ? "version" : "new");
  const [episodeId, setEpisodeId] = useState<number>(fixedEpisode?.id ?? episodes[0]?.id ?? 0);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveMode = fixedEpisode ? "version" : mode;
  const target = fixedEpisode ? fixedEpisode.id : episodeId;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) return setError("Choose a video file");
    if (effectiveMode === "new" && !title.trim()) return setError("Give the episode a title");
    if (fixedEpisode?.aiRunning) return setError("Wait for the AI review to finish");
    if (
      fixedEpisode &&
      fixedEpisode.draftCount > 0 &&
      !window.confirm(
        `${fixedEpisode.draftCount} AI draft${fixedEpisode.draftCount === 1 ? " is" : "s are"} still untriaged and will not carry over. Upload the new cut anyway?`,
      )
    ) {
      return;
    }
    try {
      setBusy("Reading the video length");
      const durationS = await measureDuration(file);
      const body = new FormData();
      body.set("video", file);
      body.set("durationS", String(durationS));
      let url = `/api/episodes/${target}/versions`;
      if (effectiveMode === "new") {
        url = "/api/episodes";
        body.set("seriesId", String(seriesId));
        body.set("title", title.trim());
      }
      setBusy("Uploading");
      const res = await fetch(url, { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { error?: string; episodeId?: number; number?: number };
      if (!res.ok) throw new Error(json.error ?? `Upload failed (${res.status})`);
      const ep = effectiveMode === "new" ? json.episodeId : target;
      setBusy("Opening the cut");
      router.push(`/episodes/${ep}/v/${json.number ?? 1}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setBusy(null);
    }
  }

  const compact = Boolean(fixedEpisode);

  return (
    <form
      onSubmit={submit}
      className={compact ? "flex flex-wrap items-center gap-2" : "space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"}
    >
      {!compact && (
        <div className="flex flex-wrap items-center gap-4">
          <h3 className="font-medium">Upload a cut</h3>
          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-1">
              <input type="radio" name="mode" checked={mode === "new"} onChange={() => setMode("new")} /> New episode
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="mode"
                checked={mode === "version"}
                disabled={episodes.length === 0}
                onChange={() => setMode("version")}
              />
              New cut of an episode
            </label>
          </div>
        </div>
      )}

      {!compact && effectiveMode === "new" && (
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="Episode title"
          className="w-full max-w-md rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none"
        />
      )}
      {!compact && effectiveMode === "version" && (
        <select
          value={episodeId}
          onChange={(e) => setEpisodeId(Number(e.target.value))}
          className="w-full max-w-md rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm"
        >
          {episodes.map((ep) => (
            <option key={ep.id} value={ep.id}>
              Ep {ep.number}: {ep.title} (next: v{ep.latestVersion + 1})
            </option>
          ))}
        </select>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm file:mr-2 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-2 file:py-1 file:text-sm"
        />
        <button
          type="submit"
          disabled={busy !== null || !file || Boolean(fixedEpisode?.aiRunning)}
          title={fixedEpisode?.aiRunning ? "Wait for the AI review to finish" : undefined}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {busy ?? (compact ? `Upload v${fixedEpisode?.nextVersion}` : "Upload")}
        </button>
      </div>
      {!compact && (
        <p className="text-xs text-zinc-500">H.264 MP4 up to 300 MB and 10 minutes. The length is read in the browser before upload.</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
