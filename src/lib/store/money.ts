/**
 * Parses a dollar amount typed by the owner ("$7.50", "5", "1,000") into cents.
 * Null when it is not a plain amount with at most two decimals.
 */
export function parseDollars(text: string): number | null {
  const t = text.trim().replace(/^\$/, '').replace(/,/g, '').trim();
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
