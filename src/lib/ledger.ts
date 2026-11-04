// The call ledger: one line per generateContent attempt, in data/eval/ledger.jsonl, so the free
// quota (about 20 calls per model per Pacific day) can be counted before a sweep starts. Both the
// app and the eval runner append to it; the eval runner refuses to pass the reserve.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pacificDate } from "@/lib/time";
import { DATA_DIR } from "@/lib/uploads";

export const LEDGER_PATH = path.join(DATA_DIR, "eval", "ledger.jsonl");

/** Calls per model per Pacific day that a sweep may reach; the rest is the reserve for the app. */
export const RESERVE_PER_DAY = 15;

export type AttemptStatus = "ok" | "overloaded" | "quota" | "timeout" | "rejected" | "error";

export type LedgerEntry = {
  at: string;
  pacificDate: string;
  model: string;
  source: "app" | "eval";
  cut: string;
  status: AttemptStatus;
  httpStatus: number | null;
  generateS: number;
  promptVersion: string;
  runIndex: number | null;
  /** set when the run was forced over a completed one with the same key */
  forced?: true;
};

export function appendLedger(entry: LedgerEntry): void {
  mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  appendFileSync(LEDGER_PATH, JSON.stringify(entry) + "\n");
}

export function readLedger(): LedgerEntry[] {
  if (!existsSync(LEDGER_PATH)) return [];
  return readFileSync(LEDGER_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LedgerEntry);
}

/** Attempts logged for a model on one Pacific day; every attempt counts, failed ones included. */
export function callsOn(model: string, day: string = pacificDate()): number {
  return readLedger().filter((e) => e.model === model && e.pacificDate === day).length;
}

/** Per model, calls made today and what is left under the reserve. */
export function budget(day: string = pacificDate()): Array<{ model: string; used: number; left: number }> {
  const used = new Map<string, number>();
  for (const e of readLedger()) {
    if (e.pacificDate !== day) continue;
    used.set(e.model, (used.get(e.model) ?? 0) + 1);
  }
  return [...used.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([model, n]) => ({ model, used: n, left: Math.max(0, RESERVE_PER_DAY - n) }));
}
