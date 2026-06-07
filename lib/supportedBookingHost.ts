// Browser-safe host detection — used by the homepage / /5 / /7 /
// /free-barber quiz to decide whether to attempt a scrape on the
// pasted booking URL. Mirrors the hostMatchers in lib/scrapers/*.ts
// but lives in its own tiny module so the quiz form can import it
// without pulling the Node-only scraper adapters into the browser
// bundle.
//
// Keep in sync with the adapter `hostMatchers` arrays.
const SUPPORTED_HOST_PATTERNS: RegExp[] = [
  /(^|\.)booksy\.com$/i,
  /(^|\.)fresha\.com$/i,
  /(^|\.)styleseat\.com$/i,
  /(^|\.)squareup\.com$/i,
  /(^|\.)square\.site$/i,
  /(^|\.)vagaro\.com$/i,
];

export function isSupportedBookingHost(url: string | null | undefined): boolean {
  if (!url || !url.trim()) return false;
  const raw = url.trim();
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return SUPPORTED_HOST_PATTERNS.some((re) => re.test(parsed.hostname));
  } catch {
    return false;
  }
}

// Booksy's share sheet hands the user a sentence like:
//   "I'm using Willi Barber … Check it out on Booksy here:
//    https://booksy.com/en-us/dl/show-business/998736"
// — paste-as-is shouldn't fail. This helper pulls the first URL
// out of arbitrary text. Three passes:
//   1. Explicit http(s) URL anywhere in the string.
//   2. Bare host on a known booking platform (covers
//      "booksy.com/…" with no protocol).
//   3. Any bare host that looks domain-shaped.
// Returns the URL with https:// prepended when missing, or null
// if nothing URL-shaped was found.
export function extractFirstUrl(text: string | null | undefined): string | null {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;

  const explicit = trimmed.match(/https?:\/\/[^\s<>"'\]]+/i);
  if (explicit) return explicit[0];

  const knownBare = trimmed.match(/(?:[\w-]+\.)+(?:booksy|fresha|styleseat|squareup|square|vagaro)\.(?:com|site)(?:\/[^\s<>"'\]]*)?/i);
  if (knownBare) return `https://${knownBare[0]}`;

  const genericBare = trimmed.match(/(?:[\w-]+\.)+[a-z]{2,}(?:\/[^\s<>"'\]]*)?/i);
  if (genericBare) return `https://${genericBare[0]}`;

  return null;
}
