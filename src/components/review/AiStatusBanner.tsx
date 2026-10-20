"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Version } from "@/db";
import { fmtUsd } from "@/lib/pricing";

type Props = { version: Version; isLatest: boolean; draftCount: number };

const STAGE_TEXT: Record<string, string> = {
  uploading: "Uploading the cut to Gemini",
  processing: "Gemini is processing the video",
  analysing: "Analysing the cut",
};

export function AiStatusBanner({ version, isLatest, draftCount }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [live, setLive] = useState<{ stage: string | null; now: number } | null>(null);
  const [showSummary, setShowSummary] = useState(true);

  const running = version.aiStatus === "running";
  const startedAt = version.aiStartedAt;

  // While a job runs: tick the clock and poll the status; refresh the route when it ends.
  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => setLive((prev) => ({ stage: prev?.stage ?? null, now: Date.now() })), 1000);
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/versions/${version.id}/review`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { aiStatus: string; aiStage: string | null };
        if (json.aiStatus !== "running") {
          clearInterval(poll);
          router.refresh();
        } else {
          setLive({ stage: json.aiStage, now: Date.now() });
        }
      } catch {
        // transient; the next poll retries
      }
    }, 2000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [running, version.id, router]);

  async function start() {
    if (version.aiStatus === "done" && draftCount >= 0) {
      const ok = window.confirm(
        `Re-run with the current cast references. Replaces ${draftCount} untriaged AI draft${draftCount === 1 ? "" : "s"}; kept and human notes stay.`,
      );
      if (!ok) return;
    }
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/versions/${version.id}/review`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Could not start (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the review");
    } finally {
      setStarting(false);
    }
  }

  const elapsed = running && live && startedAt ? Math.max(0, Math.round((live.now - startedAt) / 1000)) : null;
  const stage = (live?.stage ?? version.aiStage) || "uploading";
  const tokens = version.aiInputTokens !== null;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-medium">AI review</span>
          {running && (
            <span className="ml-2 text-zinc-600" aria-live="polite">
              {STAGE_TEXT[stage] ?? stage}
              {elapsed !== null && <span className="font-mono"> {elapsed} s</span>}
            </span>
          )}
          {version.aiStatus === "done" && (
            <span className="ml-2 text-zinc-600">
              done with {version.aiModel}
              {tokens && (
                <>
                  : {version.aiInputTokens} in, {(version.aiOutputTokens ?? 0) + (version.aiThoughtTokens ?? 0)} out, list price{" "}
                  {fmtUsd(version.aiCostUsd)} (free tier: $0 billed)
                </>
              )}
            </span>
          )}
          {version.aiStatus === "error" && <span className="ml-2 text-red-700">{version.aiError}</span>}
          {version.aiStatus === "idle" && <span className="ml-2 text-zinc-500">not run yet</span>}
        </div>
        {isLatest && !running && (
          <button
            type="button"
            onClick={start}
            disabled={starting}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {starting ? "Starting" : version.aiStatus === "idle" ? "Run AI review" : version.aiStatus === "error" ? "Run again" : "Re-run AI review"}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {version.aiStatus === "done" && version.aiSummary && (
        <div className="mt-2 text-sm text-zinc-700">
          <button type="button" onClick={() => setShowSummary((s) => !s)} className="text-xs text-zinc-500 underline">
            {showSummary ? "Hide summary" : "Show summary"}
          </button>
          {showSummary && (
            <div className="mt-1 space-y-1">
              {version.aiSummary.split("\n").map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
