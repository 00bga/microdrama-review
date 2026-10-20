// Lists the Gemini models this API key can call with generateContent.
// Run: npm run models   (reads GOOGLE_API_KEY or GEMINI_API_KEY from .env; prints no secrets)
import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GOOGLE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
if (!apiKey) {
  console.error("Set GOOGLE_API_KEY (or GEMINI_API_KEY) in .env first.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const rows: { id: string; input: number; output: number; actions: string }[] = [];

for await (const model of await ai.models.list({ config: { pageSize: 100 } })) {
  const actions = model.supportedActions ?? [];
  if (!actions.includes("generateContent")) continue;
  rows.push({
    id: (model.name ?? "").replace(/^models\//, ""),
    input: model.inputTokenLimit ?? 0,
    output: model.outputTokenLimit ?? 0,
    actions: actions.join(","),
  });
}

rows.sort((a, b) => a.id.localeCompare(b.id));
console.log(`${rows.length} models support generateContent:\n`);
for (const r of rows) {
  console.log(`${r.id.padEnd(44)} in ${String(r.input).padStart(9)}  out ${String(r.output).padStart(7)}  ${r.actions}`);
}
console.log("\nPick a stable id (no preview, no -latest alias) and set GEMINI_MODEL in .env.");
