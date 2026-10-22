// Reads the example package Foxelli provides: one folder per series with series.json (bible,
// characters, which image shows whom), cast/ images and one folder per episode holding v1.mp4,
// v2.mp4 ... plus notes.json (the strategists' timecoded notes per cut).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { IMAGE_TYPES } from "@/lib/uploads";

export type PackageCast = { name: string; description: string; imagePath: string; mimeType: string };
export type StrategistNote = { time: number; timecode: string; text: string; replies: string[] };
export type PackageCut = { number: number; path: string };
export type PackageEpisode = {
  dir: string;
  title: string;
  number: number;
  cuts: PackageCut[];
  notesByVersion: Map<number, StrategistNote[]>;
};
export type PackageSeries = {
  dir: string;
  name: string;
  bibleText: string;
  cast: PackageCast[];
  /** images skipped because the character already had one (a second look, a duplicate sheet) */
  skippedLooks: string[];
  episodes: PackageEpisode[];
};

type SeriesJson = {
  series?: string;
  bible?: Record<string, unknown>;
  characters?: Array<{ name?: string; description?: string }>;
  reference_images?: Array<{ character?: string; image?: string }>;
};
type NotesJson = {
  versions?: Array<{
    version?: number;
    notes?: Array<{ time?: number; timecode?: string; text?: string; replies?: string[] }>;
  }>;
};

const BIBLE_ORDER = [
  "logline",
  "concept",
  "genre",
  "comparables",
  "audience",
  "tropes",
  "world",
  "tone",
  "heat_level",
  "darkness_level",
  "visual_style",
  "season_arc",
  "non_negotiables",
  "central_question",
];

const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(IMAGE_TYPES).map(([mime, ext]) => [ext, mime]),
);
MIME_BY_EXT[".jpeg"] = "image/jpeg";

/** letters only, lower case: "ELIAS VALE" and "Elias Vale, host" both become comparable */
function letters(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

/** letters and digits: "officer1" and "officer2" are different people, "siren" twice is one */
function labelKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s(])([a-z])/g, (m, pre: string, ch: string) => pre + ch.toUpperCase());
}

/** The bible as one text block: each section under its heading, then the characters. */
export function buildBibleText(json: SeriesJson): string {
  const blocks: string[] = [];
  const bible = json.bible ?? {};
  const keys = [...BIBLE_ORDER.filter((k) => k in bible), ...Object.keys(bible).filter((k) => !BIBLE_ORDER.includes(k))];
  for (const key of keys) {
    const value = bible[key];
    if (typeof value !== "string" || value.trim() === "") continue;
    blocks.push(`${key.replace(/_/g, " ").toUpperCase()}:\n${value.trim()}`);
  }
  const characters = (json.characters ?? []).filter((c) => c.name && c.description);
  if (characters.length > 0) {
    blocks.push(`CHARACTERS:\n${characters.map((c) => `- ${c.name}: ${c.description}`).join("\n\n")}`);
  }
  return blocks.join("\n\n");
}

/** One cast member per character label; the bible description is attached when a name matches. */
export function readCast(dir: string, json: SeriesJson): { cast: PackageCast[]; skippedLooks: string[] } {
  const cast: PackageCast[] = [];
  const skippedLooks: string[] = [];
  const seen = new Set<string>();
  const characters = (json.characters ?? []).filter((c) => c.name && c.description) as Array<{
    name: string;
    description: string;
  }>;
  for (const ref of json.reference_images ?? []) {
    const label = ref.character?.trim();
    if (!label || !ref.image) continue;
    const key = labelKey(label);
    if (seen.has(key)) {
      skippedLooks.push(ref.image);
      continue;
    }
    const imagePath = path.join(dir, ref.image);
    const mimeType = MIME_BY_EXT[path.extname(imagePath).toLowerCase()];
    if (!existsSync(imagePath) || !mimeType) {
      console.warn(`  skipping ${label}: no readable image at ${ref.image}`);
      continue;
    }
    seen.add(key);
    const probe = letters(label);
    const match =
      probe.length >= 3
        ? characters.find((c) => letters(c.name).includes(probe) || probe.includes(letters(c.name)))
        : undefined;
    const name = label === label.toUpperCase() && /[A-Z]/.test(label) ? titleCase(label) : label;
    const description = match
      ? letters(match.name) === probe
        ? match.description
        : `${match.name}. ${match.description}`
      : "";
    cast.push({ name, description, imagePath, mimeType });
  }
  return { cast, skippedLooks };
}

function readNotes(episodeDir: string): Map<number, StrategistNote[]> {
  const file = path.join(episodeDir, "notes.json");
  const map = new Map<number, StrategistNote[]>();
  if (!existsSync(file)) return map;
  const json = JSON.parse(readFileSync(file, "utf8")) as NotesJson;
  for (const v of json.versions ?? []) {
    if (typeof v.version !== "number") continue;
    const list: StrategistNote[] = [];
    for (const n of v.notes ?? []) {
      if (typeof n.time !== "number" || !Number.isFinite(n.time) || typeof n.text !== "string") continue;
      list.push({
        time: n.time,
        timecode: n.timecode ?? "",
        text: n.text,
        replies: Array.isArray(n.replies) ? n.replies.filter((r): r is string => typeof r === "string") : [],
      });
    }
    map.set(v.version, list);
  }
  return map;
}

function readEpisodes(seriesDir: string): PackageEpisode[] {
  const episodes: PackageEpisode[] = [];
  for (const entry of readdirSync(seriesDir, { withFileTypes: true })) {
    const m = /^episode\s*(\d+)/i.exec(entry.name);
    if (!entry.isDirectory() || !m) continue;
    const dir = path.join(seriesDir, entry.name);
    const cuts: PackageCut[] = [];
    for (const f of readdirSync(dir)) {
      const cm = /^v(\d+)\.mp4$/i.exec(f);
      if (cm) cuts.push({ number: Number(cm[1]), path: path.join(dir, f) });
    }
    cuts.sort((a, b) => a.number - b.number);
    if (cuts.length === 0) continue;
    episodes.push({ dir, title: entry.name, number: Number(m[1]), cuts, notesByVersion: readNotes(dir) });
  }
  episodes.sort((a, b) => a.number - b.number);
  return episodes;
}

export function loadSeries(dir: string): PackageSeries {
  const json = JSON.parse(readFileSync(path.join(dir, "series.json"), "utf8")) as SeriesJson;
  const name = json.series?.trim() || path.basename(dir);
  const { cast, skippedLooks } = readCast(dir, json);
  return { dir, name, bibleText: buildBibleText(json), cast, skippedLooks, episodes: readEpisodes(dir) };
}

/** Every series folder under root that has a series.json; `only` keeps names containing any of the terms. */
export function loadPackage(root: string, only: string[] = []): PackageSeries[] {
  const out: PackageSeries[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !existsSync(path.join(root, entry.name, "series.json"))) continue;
    const s = loadSeries(path.join(root, entry.name));
    if (only.length > 0 && !only.some((t) => s.name.toLowerCase().includes(t.toLowerCase()))) continue;
    out.push(s);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** The first line of a strategist note, cut at a word boundary, as the note title. */
export function noteTitle(text: string, max = 72): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= max) return line || "Note";
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > 30 ? cut.slice(0, space) : cut}...`;
}

/** The full note text with its replies, as the note body. */
export function strategistBody(n: StrategistNote): string {
  const parts = [n.text.trim()];
  for (const r of n.replies) parts.push(`Reply: ${r.trim()}`);
  return parts.join("\n\n");
}
