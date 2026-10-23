/**
 * A phone typed as bare digits ("5125550142", or with a leading 1) is shown the
 * way imported numbers are: "(512) 555-0142". Anything the barber punctuated
 * themselves, or that is not a plain US number, is left exactly as typed.
 */
export function formatPhone(raw: string): string {
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return t;
  const d = t.length === 11 && t.startsWith('1') ? t.slice(1) : t;
  if (d.length !== 10) return t;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
