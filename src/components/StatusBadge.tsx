import { STATUS_LABELS, type EpisodeStatus } from "@/lib/enums";

const STYLES: Record<EpisodeStatus, string> = {
  pending: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  in_review: "bg-amber-50 text-amber-800 ring-amber-200",
  approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
};

export function StatusBadge({ status }: { status: EpisodeStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
