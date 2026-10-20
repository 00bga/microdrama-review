/** Route params and form fields arrive as strings; only small positive integers are valid ids. */
export function parseId(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d{1,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 ? n : null;
}
