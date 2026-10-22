// Only http(s) URLs may become a link on a published site. Anything else (javascript:, data:, …)
// is dropped so site data can never inject script through an href.
// The one exception is the site's own booking and shop pages, the relative /book and /shop
// (lib/render/subpages.ts): exactly those paths, optionally with a query or fragment. Never
// another relative path, and never a protocol-relative //host or /\host.
const SITE_PAGE = /^\/(book|shop)(?=[?#]|$)/;

export function safeHref(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s) return null;
  if (SITE_PAGE.test(s)) return s;
  try {
    const p = new URL(s).protocol;
    return p === 'http:' || p === 'https:' ? s : null;
  } catch {
    return null;
  }
}
