"use client";

import { useActionState } from "react";
import { updateSeriesBible } from "@/app/actions";

export function SeriesBibleForm({ seriesId, bible }: { seriesId: number; bible: string }) {
  const [state, action, pending] = useActionState(updateSeriesBible, null);
  const hint =
    bible.length > 0
      ? `${bible.length.toLocaleString("en-GB")} characters, sent with every AI review of this series`
      : "none yet: the AI reviews without the show's rules";
  return (
    <details className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        Series bible <span className="font-normal text-zinc-500">({hint})</span>
      </summary>
      <form action={action} className="space-y-2 border-t border-zinc-100 p-4">
        <input type="hidden" name="seriesId" value={seriesId} />
        <p className="text-xs text-zinc-500">
          Logline, tone, visual rules, non-negotiables and who the characters are. The AI judges every cut against
          this text, so a character who drifts from it gets a note.
        </p>
        <textarea
          name="bible"
          defaultValue={bible}
          rows={bible.length > 0 ? 16 : 6}
          maxLength={40000}
          placeholder="Paste the series bible here"
          className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-xs leading-relaxed focus:border-zinc-500 focus:outline-none"
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {pending ? "Saving" : "Save bible"}
          </button>
          {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
          {state?.savedAt && !state.error && <span className="text-xs text-zinc-500">Saved</span>}
        </div>
      </form>
    </details>
  );
}
