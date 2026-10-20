import Link from "next/link";
import { CreateSeriesForm } from "@/components/CreateSeriesForm";
import { getHomeSeries } from "@/lib/queries";

export default async function Home() {
  const list = await getHomeSeries();
  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Series</h1>
          <p className="mt-1 text-sm text-zinc-500">
            A series holds its cast references and episodes. Open one to upload cuts and run reviews.
          </p>
        </div>
        <CreateSeriesForm />
      </section>

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500">
          No series yet. Create one above, add the cast references, then upload the first cut.
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((s) => (
            <li key={s.id}>
              <Link
                href={`/series/${s.id}`}
                className="block rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-400"
              >
                <h2 className="font-medium">{s.name}</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  {s.episodeCount} episode{s.episodeCount === 1 ? "" : "s"}
                </p>
                <dl className="mt-3 flex gap-4 text-xs text-zinc-600">
                  <div>
                    <dt className="text-zinc-400">Pending</dt>
                    <dd className="font-medium">{s.counts.pending}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">In review</dt>
                    <dd className="font-medium">{s.counts.in_review}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">Approved</dt>
                    <dd className="font-medium">{s.counts.approved}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
