import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CastPanel } from "@/components/CastPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { UploadCutForm } from "@/components/UploadCutForm";
import { parseId } from "@/lib/ids";
import { fmtUsd } from "@/lib/pricing";
import { getSeriesPage } from "@/lib/queries";

export async function generateMetadata(props: PageProps<"/series/[seriesId]">): Promise<Metadata> {
  const id = parseId((await props.params).seriesId);
  const data = id ? await getSeriesPage(id) : null;
  return { title: data ? data.series.name : "Series" };
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export default async function SeriesPage(props: PageProps<"/series/[seriesId]">) {
  const id = parseId((await props.params).seriesId);
  if (!id) notFound();
  const data = await getSeriesPage(id);
  if (!data) notFound();
  const { series, cast, episodes, costUsd } = data;

  return (
    <div className="space-y-6">
      <nav className="text-sm text-zinc-500">
        <Link href="/" className="hover:underline">
          Series
        </Link>
        <span className="mx-1">/</span>
        <span className="text-zinc-800">{series.name}</span>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{series.name}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {episodes.length} episode{episodes.length === 1 ? "" : "s"}. AI calls so far at list price:{" "}
            {fmtUsd(costUsd)} (a free-tier key is billed $0).
          </p>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Episodes</h2>
          </div>
          {episodes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">
              No episodes yet. Upload the first cut below.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Title</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Latest cut</th>
                    <th className="px-3 py-2 font-medium">Open notes</th>
                    <th className="px-3 py-2 font-medium">Last activity</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {episodes.map((e) => (
                    <tr key={e.id} className="hover:bg-zinc-50">
                      <td className="px-3 py-2 text-zinc-500">{e.number}</td>
                      <td className="px-3 py-2 font-medium">
                        <Link href={`/episodes/${e.id}`} className="hover:underline">
                          {e.title}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={e.status} />
                      </td>
                      <td className="px-3 py-2">
                        v{e.latestVersion}
                        {e.versionCount > 1 && <span className="text-zinc-400"> of {e.versionCount}</span>}
                      </td>
                      <td className="px-3 py-2">{e.openNotes}</td>
                      <td className="px-3 py-2 text-zinc-500">{fmtDate(e.lastActivity)}</td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          href={`/episodes/${e.id}`}
                          className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <UploadCutForm seriesId={series.id} episodes={episodes.map((e) => ({ id: e.id, number: e.number, title: e.title, latestVersion: e.latestVersion }))} />
        </section>

        <aside>
          <CastPanel seriesId={series.id} cast={cast} />
        </aside>
      </div>
    </div>
  );
}
