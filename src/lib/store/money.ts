/**
 * Parses a dollar amount typed by the owner ("$7.50", "5", "1,000") into cents.
 * "12,50" (digits, a comma, exactly two digits) is a decimal comma: $12.50. Any other comma is a
 * thousands separator and must group exactly three digits ("1,250.00"; never "1,0,0").
 * Null when it is not a plain amount with at most two decimals.
 */
export function parseDollars(text: string): number | null {
  let t = text.trim().replace(/^\$/, '').trim();
  if (/^\d+,\d{2}$/.test(t)) t = t.replace(',', '.');
  else if (/^((\d+|\d{1,3}(,\d{3})+)(\.\d{0,2})?|\.\d{1,2})$/.test(t)) t = t.replace(/,/g, '');
  else return null;
  return Math.round(Number(t) * 100);
}
