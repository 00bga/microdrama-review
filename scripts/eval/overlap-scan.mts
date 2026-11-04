// Confidentiality check: no tracked file (or any file passed on the command line) may share a run
// of five or more consecutive words with a strategist note from the review package. Prints nothing
// and exits 0 when clean; lists every hit otherwise.
//
//   npm run eval:scan                       every tracked text file (git ls-files)
//   npm run eval:scan -- path/to/file.txt   these files instead (the PDF text, the email draft)
//   [--dir microdrama-review-examples] [--words 5]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadPackage } from "../examples-package";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: "string", default: "microdrama-review-examples" },
    words: { type: "string", default: "5" },
  },
});
const N = Math.max(3, Number(values.words ?? "5"));
const TEXT = new Set([".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs", ".json", ".md", ".css", ".sql", ".txt", ".yml", ".yaml", ".html", ".example"]);

/** Lower-case words, letters and digits only, so punctuation and line breaks do not hide a copy. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

export function shingles(text: string, n: number): string[] {
  const w = words(text);
  const out: string[] = [];
  for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(" "));
  return out;
}

const pack = loadPackage(path.resolve(values.dir ?? "microdrama-review-examples"));
const noteShingles = new Map<string, string>();
for (const s of pack) {
  for (const e of s.episodes) {
    for (const [v, notes] of e.notesByVersion) {
      for (const n of notes) {
        for (const text of [n.text, ...n.replies]) {
          for (const sh of shingles(text, N)) noteShingles.set(sh, `${s.name}/${e.title}/v${v}`);
        }
      }
    }
  }
}

const files =
  positionals.length > 0
    ? positionals
    : execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
        .split("\0")
        .filter((f) => f && TEXT.has(path.extname(f)) && existsSync(f));

const hits: string[] = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const seen = new Set<string>();
  for (const sh of shingles(text, N)) {
    const where = noteShingles.get(sh);
    if (where && !seen.has(sh)) {
      seen.add(sh);
      hits.push(`${file}: "${sh}" (${where})`);
    }
  }
}

if (hits.length > 0) {
  console.error(`${hits.length} overlap(s) of ${N} words with a package note:\n${hits.join("\n")}`);
  process.exit(1);
}
console.log(`Clean: ${files.length} file(s), ${noteShingles.size} note shingles of ${N} words.`);
