// Platform dispatcher. Pick the right adapter for a URL, or surface a
// friendly rejection for platforms that deliberately hide their data.
import type { PlatformAdapter, ScrapedShop, ScrapeOptions } from './types.js';
import { ScrapeError } from './types.js';
import { booksyAdapter } from './booksy.js';
import { freshaAdapter } from './fresha.js';
import { styleseatAdapter } from './styleseat.js';
import { squareAdapter } from './square.js';
import { vagaroAdapter } from './vagaro.js';
import { theCutAdapter } from './thecut.js';
import { goldieAdapter } from './goldie.js';
import { setmoreAdapter } from './setmore.js';
import { glossGeniusAdapter } from './glossgenius.js';
import { squireAdapter } from './squire.js';
import { acuityAdapter } from './acuity.js';
import { enrichFromGoogle } from './enrich.js';

const ADAPTERS: PlatformAdapter[] = [
  booksyAdapter,
  freshaAdapter,
  styleseatAdapter,
  squareAdapter,
  vagaroAdapter,
  theCutAdapter,
  goldieAdapter,
  setmoreAdapter,
  glossGeniusAdapter,
  squireAdapter,
  acuityAdapter,
];

// Platforms we recognise but can't autofill from. These return a
// specific message instead of trying-and-failing.
const UNSUPPORTED: { host: RegExp; reason: string }[] = [
  {
    host: /(^|\.)calendly\.com$/i,
    reason: "Calendly links are just a scheduling widget — there's no shop name, photos, or services to pull. Use the regular generator and paste your Calendly link as your booking link.",
  },
];

export function detectPlatform(url: string): { adapter?: PlatformAdapter; unsupportedReason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return {};
  }
  const host = parsed.hostname;

  for (const u of UNSUPPORTED) {
    if (u.host.test(host)) return { unsupportedReason: u.reason };
  }
  for (const a of ADAPTERS) {
    if (a.hostMatchers.some((re) => re.test(host))) return { adapter: a };
  }
  return {};
}

export async function scrapeBookingUrl(rawUrl: string, opts: ScrapeOptions): Promise<{
  platform: string;
  shop: ScrapedShop;
}> {
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const { adapter, unsupportedReason } = detectPlatform(url);

  if (unsupportedReason) throw new ScrapeError(unsupportedReason);
  if (!adapter) {
    throw new ScrapeError(
      "We don't recognise that booking site yet. Supported: Booksy, theCut, Fresha, StyleSeat, Square Appointments, Vagaro, Goldie, Setmore, Squire, GlossGenius, Acuity.",
    );
  }

  const scraped = await adapter.scrape(url, opts);
  // Fill ONLY what the booking page lacked (hours, phone, address, rating) from the Google listing; never throws.
  const shop = await enrichFromGoogle(scraped, opts.placeLookup ?? null);
  return { platform: adapter.id, shop };
}

export { ScrapeError } from './types.js';
export type { ScrapedShop } from './types.js';
