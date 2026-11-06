// Timecode helpers shared by the server, the prompt layer and the UI.

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Seconds to "MM:SS" (floored). Minutes keep counting past 59. */
export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Lenient parser for "M:SS", "MM:SS", "H:MM:SS", with optional fractional seconds,
 * or a bare number of seconds. Returns null for anything else.
 */
export function parseTimecode(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 ? input : null;
  if (typeof input !== "string") return null;
  const text = input.trim();
  if (text === "") return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const m = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{1,2}(?:\.\d+)?)$/.exec(text);
  if (!m) return null;
  const hours = m[1] ? Number(m[1]) : 0;
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  if (seconds >= 60 || (m[1] && minutes >= 60)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * The free quota resets at midnight Pacific, so calls are counted per Pacific calendar day
 * (12:00 Tbilisi while the US is on standard time, 11:00 during US daylight time).
 */
export function pacificDate(ms: number = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export type Block = { n: number; startS: number; endS: number };

/** 10 s blocks over a cut; a last block shorter than 5 s merges into the one before it. */
export function blocksFor(durationS: number, sizeS = 10, minLastS = 5): Block[] {
  const blocks: Block[] = [];
  const total = Math.max(0, durationS);
  for (let start = 0, n = 1; start < total; start += sizeS, n++) {
    blocks.push({ n, startS: start, endS: Math.min(total, start + sizeS) });
  }
  if (blocks.length >= 2) {
    const last = blocks[blocks.length - 1];
    if (last.endS - last.startS < minLastS) {
      blocks.pop();
      blocks[blocks.length - 1].endS = last.endS;
    }
  }
  return blocks;
}

export type Span = { startS: number; endS: number };

/**
 * Windows of sizeS seconds with overlapS seconds of overlap, from 0 to the end of the cut; the last
 * window is cut at the end. One whole-cut call plus these gives 1 + ceil((D - overlap) / (size - overlap)) calls.
 */
export function windowSpans(durationS: number, sizeS = 40, overlapS = 5): Span[] {
  const out: Span[] = [];
  const total = Math.max(0, durationS);
  const step = Math.max(1, sizeS - overlapS);
  for (let start = 0; ; start += step) {
    const end = Math.min(total, start + sizeS);
    out.push({ startS: start, endS: end });
    if (end >= total) break;
  }
  return out;
}
