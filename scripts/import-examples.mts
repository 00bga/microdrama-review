// Loads the example package into the app: each series with its bible and cast, each episode with
// every cut uploaded in order (open notes carry forward exactly as in the app) and the strategists'
// notes on each cut as human notes.
//
//   npm run import:examples                       (expects ./microdrama-review-examples)
//   npm run import:examples -- --dir E:/examples --series "Haunted"
//
// Safe to re-run: a series that already exists by name is skipped. The server does not need to be
// running. Writes data/examples-manifest.json so that npm run eval:examples can find each cut.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { boot } from "@/lib/boot";
import { mp4Duration } from "@/lib/mp4";
import { DATA_DIR, newStoredName, resolveDataPath } from "@/lib/uploads";
import { createEpisodeWithFirstCut, createVersionWithCarryForward } from "@/lib/versions";
import { loadPackage, noteTitle, strategistBody } from "./examples-package";

const { values } = parseArgs({
  options: {
    dir: { type: "string", default: "microdrama-review-examples" },
    series: { type: "string", multiple: true, default: [] },
  },
});

const root = path.resolve(values.dir ?? "microdrama-review-examples");
if (!existsSync(root)) {
  console.error(`No such folder: ${root}\nPut the example package there or pass --dir <folder>.`);
  process.exit(1);
}

const pack = loadPackage(root, values.series ?? []);
if (pack.length === 0) {
  console.error(`No series folders with a series.json under ${root}`);
  process.exit(1);
}

boot();
const db = getDb();
const { castMembers, episodes, notes, series } = schema;

type ManifestVersion = { id: number; number: number; file: string };
type ManifestEpisode = { id: number; title: string; dir: string; versions: ManifestVersion[] };
type ManifestSeries = { id: number; name: string; dir: string; episodes: ManifestEpisode[] };
type Manifest = { importedAt: string; dir: string; series: ManifestSeries[] };

const manifestPath = path.join(DATA_DIR, "examples-manifest.json");
const manifest: Manifest = existsSync(manifestPath)
  ? (JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest)
  : { importedAt: "", dir: root, series: [] };

function store(src: string, folder: "videos" | "cast"): string {
  const ext = path.extname(src).toLowerCase();
  const rel = newStoredName(folder, ext === ".jpeg" ? ".jpg" : ext);
  const abs = resolveDataPath(rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  copyFileSync(src, abs);
  return rel;
}

const started = Date.now();
for (const s of pack) {
  const existing = db.select({ id: series.id }).from(series).where(eq(series.name, s.name)).get();
  if (existing) {
    console.log(`${s.name}: already imported as series #${existing.id}, skipped`);
    continue;
  }
  const now = Date.now();
  const seriesRow = db
    .insert(series)
    .values({ name: s.name, bible: s.bibleText, createdAt: now })
    .returning({ id: series.id })
    .get();
  for (const c of s.cast) {
    db.insert(castMembers)
      .values({
        seriesId: seriesRow.id,
        name: c.name,
        description: c.description,
        imagePath: store(c.imagePath, "cast"),
        imageMime: c.mimeType,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
  const extra = s.skippedLooks.length > 0 ? `, ${s.skippedLooks.length} extra looks skipped` : "";
  console.log(`${s.name}: series #${seriesRow.id}, ${s.cast.length} cast members${extra}, bible ${s.bibleText.length} chars`);

  const mSeries: ManifestSeries = { id: seriesRow.id, name: s.name, dir: s.dir, episodes: [] };
  for (const e of s.episodes) {
    let episodeId: number | null = null;
    const mEpisode: ManifestEpisode = { id: 0, title: e.title, dir: e.dir, versions: [] };
    let noteTotal = 0;
    for (const cut of e.cuts) {
      const durationS = mp4Duration(readFileSync(cut.path));
      if (!durationS || !Number.isFinite(durationS)) throw new Error(`Could not read the duration of ${cut.path}`);
      const stored = {
        videoPath: store(cut.path, "videos"),
        mimeType: "video/mp4",
        durationS: Math.round(durationS * 1000) / 1000,
      };
      let versionId: number;
      let number: number;
      if (episodeId === null) {
        const created = createEpisodeWithFirstCut(seriesRow.id, e.title, stored, e.number);
        episodeId = created.episodeId;
        versionId = created.versionId;
        number = created.number;
        mEpisode.id = episodeId;
      } else {
        const created = createVersionWithCarryForward(episodeId, stored);
        versionId = created.versionId;
        number = created.number;
      }
      if (number !== cut.number) {
        console.warn(`  ${e.title}: ${path.basename(cut.path)} was stored as v${number}`);
      }
      const list = e.notesByVersion.get(cut.number) ?? [];
      if (list.length > 0) {
        const t = Date.now();
        db.insert(notes)
          .values(
            list.map((n, i) => ({
              versionId,
              tStart: Math.min(Math.max(n.time, 0), stored.durationS),
              tEnd: null,
              category: "other" as const,
              severity: "medium" as const,
              title: noteTitle(n.text),
              body: strategistBody(n),
              evidence: null,
              castMemberId: null,
              source: "human" as const,
              status: "open" as const,
              createdAt: t + i,
              updatedAt: t + i,
            })),
          )
          .run();
        noteTotal += list.length;
      }
      mEpisode.versions.push({ id: versionId, number, file: cut.path });
    }
    if (episodeId !== null) {
      db.update(episodes)
        .set({ status: noteTotal > 0 ? "in_review" : "pending", updatedAt: Date.now() })
        .where(eq(episodes.id, episodeId))
        .run();
      mSeries.episodes.push(mEpisode);
      console.log(`  ${e.title}: episode #${episodeId}, ${e.cuts.length} cuts, ${noteTotal} strategist notes`);
    }
  }
  manifest.series = manifest.series.filter((m) => m.name !== s.name);
  manifest.series.push(mSeries);
}

manifest.importedAt = new Date().toISOString();
manifest.dir = root;
mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)} s. Start the app with npm run dev and open http://127.0.0.1:3000`);
