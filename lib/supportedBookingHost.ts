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
