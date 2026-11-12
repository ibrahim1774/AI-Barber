import type { VercelRequest, VercelResponse } from '@vercel/node';
import { scrapeBookingUrl, scrapeWebsiteUrl, ScrapeError } from '../lib/scrapers/index.js';
import { clientIp, memoryStore } from '../lib/bookings/rateLimit.js';
import { placesKey, searchPlacesForEnrichment } from '../lib/gbp/gbpPlaces.js';

// Generic booking-platform scrape endpoint. Replaces api/booksy-scrape.
// Dispatches to the right adapter based on URL hostname:
//   booksy.com  → JSON-LD (+ Apify enrichment for services/extra photos)
//   fresha.com  → JSON-LD
//   styleseat / vagaro / theCut / Square / Squire / GlossGenius / Acuity / Goldie / Setmore: see lib/scrapers/*
//
// COST (see the PR): Apify runs happen only inside lib/scrapers (runApifyWebScraper, at most one per import, only with
// APIFY_TOKEN); one Google Places Text Search happens in lib/scrapers/enrich.ts, only when the page lacked hours,
// phone, address or rating and GOOGLE_PLACES_SERVER_KEY is set.
//
// Returns 200 with the scraped shop, or 422 with a friendly message
// when the platform isn't supported / the URL doesn't have shop data.

// Website imports can cost an Apify run, and the endpoint has no login: per-IP cap (per warm instance).
const WEBSITE_PER_MINUTE = 6;
const websiteLimiter = memoryStore();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = (req.body || {}) as { url?: string; source?: string };
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) return res.status(400).json({ error: 'Missing URL' });
  const isWebsite = body.source === 'website';

  if (isWebsite && !(await websiteLimiter.hit(`website-import:${clientIp(req.headers as any)}`, WEBSITE_PER_MINUTE, 60_000, Date.now()))) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Too many imports. Wait a minute and try again.', code: 'rate_limited' });
  }

  console.log('[Import] Scraping', isWebsite ? '(website)' : '', url);

  try {
    const scrape = isWebsite ? scrapeWebsiteUrl : scrapeBookingUrl;
    const { platform, shop } = await scrape(url, {
      apifyToken: process.env.APIFY_TOKEN,
      apifyTestEventCode: process.env.APIFY_TEST_EVENT_CODE,
      // One Google Places Text Search at most, only for fields the page lacked; absent key = no lookup.
      placeLookup: placesKey() ? (q) => searchPlacesForEnrichment(q, placesKey()) : null,
    });
    return res.status(200).json({ ...shop, _platform: platform });
  } catch (error: any) {
    if (error instanceof ScrapeError) {
      return res.status(422).json(error.code ? { error: error.message, code: error.code } : { error: error.message });
    }
    console.error('[Import] Unexpected error:', error?.message || error);
    return res.status(500).json({ error: 'Scrape failed', details: String(error?.message || error) });
  }
}
