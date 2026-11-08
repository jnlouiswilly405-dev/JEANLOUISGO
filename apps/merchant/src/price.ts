/** Parses a user-typed dollar amount ("12", "12.5", "12.50") into integer cents; null when invalid. */
export function parsePriceToCents(input: string): number | null {
  const m = /^\s*(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}
