"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteCast } from "@/app/actions";

type Member = { id: number; name: string; description: string; updatedAt: number };

export function CastPanel({ seriesId, cast }: { seriesId: number; cast: Member[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [fileKey, setFileKey] = useState(0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!image) return setError("Choose a reference image");
    setBusy(true);
    try {
      const body = new FormData();
      body.set("name", name.trim());
      body.set("description", description.trim());
      body.set("image", image);
      const res = await fetch(`/api/series/${seriesId}/cast`, { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Upload failed (${res.status})`);
      setName("");
      setDescription("");
      setImage(null);
      setFileKey((k) => k + 1);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  function remove(member: Member) {
    if (!window.confirm(`Remove ${member.name}? Notes that mention this member keep their text.`)) return;
    startTransition(async () => {
      const r = await deleteCast(member.id);
      setError(r.ok ? null : r.error);
    });
  }

  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div>
        <h2 className="text-lg font-medium">Cast references</h2>
        <p className="text-xs text-zinc-500">One clear face per member. The AI compares every shot against these.</p>
      </div>

      {cast.length === 0 ? (
        <p className="text-sm text-zinc-500">No cast yet. Without references the AI skips character checks.</p>
      ) : (
        <ul className="space-y-2">
          {cast.map((m) => (
            <li key={m.id} className="flex items-center gap-3">
              {/* A plain img: the file comes from a local Route Handler, not an optimizable remote. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/cast/${m.id}/image?v=${m.updatedAt}`}
                alt={m.name}
                className="h-12 w-12 flex-none rounded-md border border-zinc-200 object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.name}</p>
                {m.description && <p className="truncate text-xs text-zinc-500">{m.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => remove(m)}
                disabled={pending}
                className="text-xs text-zinc-500 hover:text-red-600 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="space-y-2 border-t border-zinc-100 pt-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
          placeholder="Name, e.g. Mira"
          className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          placeholder="Short description, e.g. lead, red coat, scar on left brow"
          className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none"
        />
        <input
          key={fileKey}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => setImage(e.target.files?.[0] ?? null)}
          className="w-full text-sm file:mr-2 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-2 file:py-1 file:text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50"
        >
          {busy ? "Adding" : "Add cast member"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </section>
  );
}
