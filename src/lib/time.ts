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
