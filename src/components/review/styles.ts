import type { NoteCategory, Severity } from "@/lib/enums";

// Static class strings so Tailwind can see them.
export const CATEGORY_STYLES: Record<NoteCategory, { marker: string; pill: string }> = {
  hook: { marker: "bg-rose-500 border-rose-500", pill: "bg-rose-50 text-rose-700 ring-rose-200" },
  continuity: { marker: "bg-sky-500 border-sky-500", pill: "bg-sky-50 text-sky-700 ring-sky-200" },
  character: { marker: "bg-violet-500 border-violet-500", pill: "bg-violet-50 text-violet-700 ring-violet-200" },
  pacing: { marker: "bg-amber-500 border-amber-500", pill: "bg-amber-50 text-amber-700 ring-amber-200" },
  performance: { marker: "bg-emerald-500 border-emerald-500", pill: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  cliffhanger: { marker: "bg-fuchsia-500 border-fuchsia-500", pill: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200" },
  other: { marker: "bg-zinc-500 border-zinc-500", pill: "bg-zinc-100 text-zinc-700 ring-zinc-200" },
};

export const SEVERITY_SIZE: Record<Severity, string> = {
  low: "h-2.5 w-2.5",
  medium: "h-3.5 w-3.5",
  high: "h-4.5 w-4.5",
};

export const SEVERITY_TEXT: Record<Severity, string> = {
  low: "text-zinc-500",
  medium: "text-amber-700",
  high: "text-red-700",
};
