import type { VercelRequest, VercelResponse } from '@vercel/node';
import { scrapeBookingUrl, ScrapeError } from '../lib/scrapers/index.js';

// Generic booking-platform scrape endpoint. Replaces api/booksy-scrape.
// Dispatches to the right adapter based on URL hostname:
//   booksy.com  → JSON-LD (+ Apify enrichment for services/extra photos)
//   fresha.com  → JSON-LD
//   styleseat   → Apify only (SPA, needs APIFY_TOKEN)
//   squareup    → Apify only
//   vagaro.com  → Apify only
//
// Returns 200 with the scraped shop, or 422 with a friendly message
// when the platform isn't supported / the URL doesn't have shop data.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const url = ((req.body || {}) as { url?: string }).url?.trim() || '';
  if (!url) return res.status(400).json({ error: 'Missing URL' });

  console.log('[Import] Scraping', url);

  try {
    const { platform, shop } = await scrapeBookingUrl(url, {
      apifyToken: process.env.APIFY_TOKEN,
      apifyTestEventCode: process.env.APIFY_TEST_EVENT_CODE,
    });
    return res.status(200).json({ ...shop, _platform: platform });
  } catch (error: any) {
    if (error instanceof ScrapeError) {
      return res.status(422).json({ error: error.message });
    }
    console.error('[Import] Unexpected error:', error?.message || error);
    return res.status(500).json({ error: 'Scrape failed', details: String(error?.message || error) });
  }
}
