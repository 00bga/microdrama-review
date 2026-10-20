// List prices per 1M tokens (USD, Gemini API pricing page, 2026-10-19). The free tier bills $0;
// the figure is shown so a strategist can see what a round would cost on a paid key.
export const LIST_PRICES: Record<string, { input: number; output: number; cached: number }> = {
  "gemini-3.8-flash": { input: 0.75, output: 3.75, cached: 0.075 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5, cached: 0.03 },
};

export type TokenUsage = {
  input: number;
  output: number;
  thoughts: number;
  cached: number;
};

/** Thinking tokens are billed at the output rate; cached tokens at the cached rate. */
export function estimateCost(model: string, usage: TokenUsage): number | null {
  const price = LIST_PRICES[model];
  if (!price) return null;
  const freshInput = Math.max(0, usage.input - usage.cached);
  const usd =
    (freshInput * price.input +
      usage.cached * price.cached +
      (usage.output + usage.thoughts) * price.output) /
    1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

export function fmtUsd(usd: number | null): string {
  if (usd === null) return "n/a";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}
