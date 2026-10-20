import { notFound, redirect } from "next/navigation";
import { parseId } from "@/lib/ids";
import { getLatestVersionNumber } from "@/lib/queries";

/** An episode always opens on its latest cut. */
export default async function EpisodePage(props: PageProps<"/episodes/[episodeId]">) {
  const id = parseId((await props.params).episodeId);
  if (!id) notFound();
  const latest = await getLatestVersionNumber(id);
  if (latest === null) notFound();
  redirect(`/episodes/${id}/v/${latest}`);
}
