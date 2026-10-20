import Link from "next/link";
import type { VersionSummary } from "@/lib/queries";

type Props = { episodeId: number; versions: VersionSummary[]; currentNumber: number; latestNumber: number };

export function VersionSwitcher({ episodeId, versions, currentNumber, latestNumber }: Props) {
  return (
    <nav aria-label="Cuts" className="flex flex-wrap gap-1 border-b border-zinc-200">
      {versions.map((v) => {
        const active = v.number === currentNumber;
        return (
          <Link
            key={v.id}
            href={`/episodes/${episodeId}/v/${v.number}`}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              active ? "border-zinc-900 font-medium text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800"
            }`}
          >
            v{v.number}
            {v.number === latestNumber && <span className="ml-1 text-xs text-zinc-400">latest</span>}
            <span className="ml-1 text-xs text-zinc-400">
              {v.openCount} open{v.draftCount > 0 ? `, ${v.draftCount} draft` : ""}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
