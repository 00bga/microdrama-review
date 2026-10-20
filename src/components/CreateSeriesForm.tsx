"use client";

import { useActionState } from "react";
import { createSeries } from "@/app/actions";

export function CreateSeriesForm() {
  const [state, action, pending] = useActionState(createSeries, null);
  return (
    <form action={action} className="flex flex-wrap items-start gap-2">
      <div>
        <label htmlFor="series-name" className="sr-only">
          Series name
        </label>
        <input
          id="series-name"
          name="name"
          required
          maxLength={100}
          placeholder="New series name"
          className="w-56 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-zinc-500 focus:outline-none"
        />
        {state?.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? "Creating" : "New series"}
      </button>
    </form>
  );
}
