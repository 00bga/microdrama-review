import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReviewWorkspace } from "@/components/review/ReviewWorkspace";
import { parseId } from "@/lib/ids";
import { getWorkspace } from "@/lib/queries";

type Props = PageProps<"/episodes/[episodeId]/v/[n]">;

async function load(props: Props) {
  const { episodeId, n } = await props.params;
  const id = parseId(episodeId);
  const number = parseId(n);
  if (!id || !number) return null;
  return getWorkspace(id, number);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const data = await load(props);
  return { title: data ? `Ep ${data.episode.number} v${data.current.number}: ${data.episode.title}` : "Episode" };
}

export default async function WorkspacePage(props: Props) {
  const data = await load(props);
  if (!data) notFound();
  // A different cut is a different workspace; a refresh of the same cut keeps its state.
  return <ReviewWorkspace key={data.current.id} data={data} />;
}
