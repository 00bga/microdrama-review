// Every read the pages need. Each function waits for a real request first, so nothing runs at build time.
// Never import this module from instrumentation.ts or scripts.
import { asc, desc, eq, inArray } from "drizzle-orm";
import { connection } from "next/server";
import { getDb, schema, type Note, type Version } from "@/db";
import type { EpisodeStatus } from "@/lib/enums";

const { castMembers, episodes, notes, series, versions } = schema;

export type HomeSeries = {
  id: number;
  name: string;
  createdAt: number;
  episodeCount: number;
  counts: Record<EpisodeStatus, number>;
};

export async function getHomeSeries(): Promise<HomeSeries[]> {
  await connection();
  const db = getDb();
  const rows = db.select().from(series).orderBy(desc(series.createdAt)).all();
  const eps = db.select({ seriesId: episodes.seriesId, status: episodes.status }).from(episodes).all();
  return rows.map((s) => {
    const counts: Record<EpisodeStatus, number> = { pending: 0, in_review: 0, approved: 0 };
    let episodeCount = 0;
    for (const e of eps) {
      if (e.seriesId !== s.id) continue;
      counts[e.status] += 1;
      episodeCount += 1;
    }
    return { id: s.id, name: s.name, createdAt: s.createdAt, episodeCount, counts };
  });
}

export type EpisodeRow = {
  id: number;
  number: number;
  title: string;
  status: EpisodeStatus;
  latestVersion: number;
  versionCount: number;
  lastActivity: number;
  openNotes: number;
};

export type SeriesPage = {
  series: { id: number; name: string; createdAt: number };
  cast: Array<{ id: number; name: string; description: string; updatedAt: number }>;
  episodes: EpisodeRow[];
  costUsd: number;
};

export async function getSeriesPage(seriesId: number): Promise<SeriesPage | null> {
  await connection();
  const db = getDb();
  const s = db.select().from(series).where(eq(series.id, seriesId)).get();
  if (!s) return null;
  const cast = db
    .select({
      id: castMembers.id,
      name: castMembers.name,
      description: castMembers.description,
      updatedAt: castMembers.updatedAt,
    })
    .from(castMembers)
    .where(eq(castMembers.seriesId, seriesId))
    .orderBy(asc(castMembers.id))
    .all();
  const eps = db.select().from(episodes).where(eq(episodes.seriesId, seriesId)).orderBy(asc(episodes.number)).all();
  const episodeIds = eps.map((e) => e.id);
  const vs =
    episodeIds.length > 0
      ? db.select().from(versions).where(inArray(versions.episodeId, episodeIds)).orderBy(asc(versions.number)).all()
      : [];
  const latestByEpisode = new Map<number, Version>();
  for (const v of vs) latestByEpisode.set(v.episodeId, v);
  const latestIds = [...latestByEpisode.values()].map((v) => v.id);
  const openByVersion = new Map<number, number>();
  if (latestIds.length > 0) {
    const open = db
      .select({ versionId: notes.versionId, status: notes.status })
      .from(notes)
      .where(inArray(notes.versionId, latestIds))
      .all();
    for (const n of open) {
      if (n.status === "open") openByVersion.set(n.versionId, (openByVersion.get(n.versionId) ?? 0) + 1);
    }
  }

  let costUsd = 0;
  for (const v of vs) costUsd += v.aiCostUsd ?? 0;

  return {
    series: { id: s.id, name: s.name, createdAt: s.createdAt },
    cast,
    costUsd,
    episodes: eps.map((e) => {
      const latest = latestByEpisode.get(e.id);
      const mine = vs.filter((v) => v.episodeId === e.id);
      const lastActivity = Math.max(e.updatedAt, ...mine.map((v) => Math.max(v.createdAt, v.aiFinishedAt ?? 0)));
      return {
        id: e.id,
        number: e.number,
        title: e.title,
        status: e.status,
        latestVersion: latest?.number ?? 0,
        versionCount: mine.length,
        lastActivity,
        openNotes: latest ? (openByVersion.get(latest.id) ?? 0) : 0,
      };
    }),
  };
}

export async function getLatestVersionNumber(episodeId: number): Promise<number | null> {
  await connection();
  const db = getDb();
  const row = db
    .select({ number: versions.number })
    .from(versions)
    .where(eq(versions.episodeId, episodeId))
    .orderBy(desc(versions.number))
    .limit(1)
    .get();
  return row?.number ?? null;
}

export type NoteView = Note & {
  castName: string | null;
  /** where this note sat in the cut it was carried from */
  carriedFrom: { version: number; tStart: number } | null;
  /** carried over, not yet assessed by the AI and not moved by a human */
  isGhost: boolean;
  /** what became of this note in later cuts, for the compare panel */
  outcome: string;
};

export type VersionSummary = {
  id: number;
  number: number;
  createdAt: number;
  aiStatus: Version["aiStatus"];
  noteCount: number;
  openCount: number;
  draftCount: number;
};

export type Workspace = {
  series: { id: number; name: string };
  episode: { id: number; number: number; title: string; status: EpisodeStatus };
  versions: VersionSummary[];
  current: Version;
  latestNumber: number;
  isLatest: boolean;
  notesByVersion: Record<number, NoteView[]>;
  cast: Array<{ id: number; name: string }>;
};

export async function getWorkspace(episodeId: number, versionNumber: number): Promise<Workspace | null> {
  await connection();
  const db = getDb();
  const ep = db
    .select({ episode: episodes, series: series })
    .from(episodes)
    .innerJoin(series, eq(series.id, episodes.seriesId))
    .where(eq(episodes.id, episodeId))
    .get();
  if (!ep) return null;
  const vs = db.select().from(versions).where(eq(versions.episodeId, episodeId)).orderBy(asc(versions.number)).all();
  const current = vs.find((v) => v.number === versionNumber);
  if (!current || vs.length === 0) return null;
  const latestNumber = vs[vs.length - 1].number;

  const cast = db
    .select({ id: castMembers.id, name: castMembers.name })
    .from(castMembers)
    .where(eq(castMembers.seriesId, ep.series.id))
    .orderBy(asc(castMembers.id))
    .all();
  const castName = new Map(cast.map((c) => [c.id, c.name]));
  const versionNumberById = new Map(vs.map((v) => [v.id, v.number]));

  const all = db
    .select()
    .from(notes)
    .where(inArray(notes.versionId, vs.map((v) => v.id)))
    .orderBy(asc(notes.tStart), asc(notes.id))
    .all();
  const byId = new Map(all.map((n) => [n.id, n]));
  const copyOf = new Map<number, Note>();
  for (const n of all) if (n.carriedFromNoteId !== null) copyOf.set(n.carriedFromNoteId, n);

  const outcomeOf = (n: Note): string => {
    if (n.status === "draft") return "untriaged draft";
    if (n.status === "resolved") return "resolved";
    let copy = copyOf.get(n.id);
    if (!copy) return "open";
    while (copyOf.has(copy.id)) copy = copyOf.get(copy.id)!;
    const v = versionNumberById.get(copy.versionId) ?? 0;
    if (copy.status === "resolved") return `resolved in v${v}`;
    if (copy.aiFixAssessment === "fixed") return `AI: fixed in v${v}`;
    if (copy.aiFixAssessment === "not_fixed") return `AI: not fixed in v${v}`;
    if (copy.aiFixAssessment === "unclear") return `AI: unclear in v${v}`;
    return `still open in v${v}`;
  };

  const notesByVersion: Record<number, NoteView[]> = {};
  for (const v of vs) notesByVersion[v.id] = [];
  for (const n of all) {
    const origin = n.carriedFromNoteId !== null ? byId.get(n.carriedFromNoteId) : undefined;
    const carriedFrom = origin
      ? { version: versionNumberById.get(origin.versionId) ?? 0, tStart: origin.tStart }
      : null;
    notesByVersion[n.versionId].push({
      ...n,
      castName: n.castMemberId !== null ? (castName.get(n.castMemberId) ?? null) : null,
      carriedFrom,
      isGhost: carriedFrom !== null && n.aiFixAssessment === null && n.tStart === carriedFrom.tStart,
      outcome: outcomeOf(n),
    });
  }

  return {
    series: { id: ep.series.id, name: ep.series.name },
    episode: { id: ep.episode.id, number: ep.episode.number, title: ep.episode.title, status: ep.episode.status },
    versions: vs.map((v) => {
      const list = notesByVersion[v.id];
      return {
        id: v.id,
        number: v.number,
        createdAt: v.createdAt,
        aiStatus: v.aiStatus,
        noteCount: list.length,
        openCount: list.filter((n) => n.status === "open").length,
        draftCount: list.filter((n) => n.status === "draft").length,
      };
    }),
    current,
    latestNumber,
    isLatest: current.number === latestNumber,
    notesByVersion,
    cast,
  };
}
