import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-zinc-500">
        That series, episode or cut does not exist. It may have been deleted, or the link is wrong.
      </p>
      <Link href="/" className="mt-4 inline-block text-sm font-medium underline">
        Back to the series list
      </Link>
    </div>
  );
}
