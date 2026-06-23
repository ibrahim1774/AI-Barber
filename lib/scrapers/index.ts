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

const ADAPTERS: PlatformAdapter[] = [
  booksyAdapter,
  freshaAdapter,
  styleseatAdapter,
  squareAdapter,
  vagaroAdapter,
  theCutAdapter,
];

// Platforms we recognise but can't autofill from. These return a
// specific message instead of trying-and-failing.
const UNSUPPORTED: { host: RegExp; reason: string }[] = [
  {
    host: /(^|\.)getsquire\.com$/i,
    reason: "Squire keeps shop info inside their app, not on the public web. Use the regular generator and paste your Squire link as your booking link.",
  },
  {
    host: /(^|\.)glossgenius\.com$/i,
    reason: "GlossGenius doesn't expose enough info on their public pages for us to autofill. Use the regular generator and paste your link as your booking link.",
  },
  {
    host: /(^|\.)calendly\.com$/i,
    reason: "Calendly links are just a scheduling widget — there's no shop name, photos, or services to pull. Use the regular generator and paste your Calendly link as your booking link.",
  },
  {
    host: /(^|\.)acuityscheduling\.com$/i,
    reason: "Acuity links are just a scheduling widget — there's no shop info to pull. Use the regular generator and paste your Acuity link as your booking link.",
  },
  {
    host: /(^|\.)setmore\.com$/i,
    reason: "Setmore links are just a scheduling widget — there's no shop info to pull. Use the regular generator and paste your Setmore link as your booking link.",
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
      "We don't recognise that booking site yet. Supported: Booksy, theCut, Fresha, StyleSeat, Square Appointments, Vagaro.",
    );
  }

  const shop = await adapter.scrape(url, opts);
  return { platform: adapter.id, shop };
}

export { ScrapeError } from './types.js';
export type { ScrapedShop } from './types.js';
