// Only http(s) URLs may become a link on a published site. Anything else (javascript:, data:, …)
// is dropped so site data can never inject script through an href.
export function safeHref(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s) return null;
  try {
    const p = new URL(s).protocol;
    return p === 'http:' || p === 'https:' ? s : null;
  } catch {
    return null;
  }
}
