import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runApifyActor } from '../lib/gbp/util.js';
import { findCandidatesViaPlaces, placesKey } from '../lib/gbp/gbpPlaces.js';

// "Find my business" — first phase of the typed-name flow on the
// homepage importer. Runs a SEARCH-ONLY pass of the Google Places
// crawler (no detail page, no photos, no reviews → fast + cheap) and
// returns up to 6 candidate businesses for the visitor to pick from.
// The pick then goes through /api/import-business with a place_id URL,
// which scrapes exactly that listing — no more "typed Asar Barbershop,
// got a random shop".
//
// TWO PATHS, one response shape:
//   1. Google Places API (New) — ~1s. Used whenever
//      GOOGLE_PLACES_SERVER_KEY is configured on the project.
//   2. The Apify Google-Places crawler — 10-60s. Used when the key is
//      absent, when Places matches nothing, or when Places errors.
// The fallback is silent: a visitor never sees a failure just because
// Places is unconfigured or missed. Each request logs which path served
// it and how long it took ("places 840ms" / "apify 12400ms").
//
// "Near me" bias without any Google API: Vercel stamps the visitor's
// city onto every request (x-vercel-ip-city). When the typed query has
// no comma (no city of their own), we pass that city as the crawler's
// locationQuery so results are local.

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // GET = warm-up ping from the importer page.
  if (req.method === 'GET') return res.status(200).json({ ok: true, warm: true });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = (req.body || {}) as { query?: string; near?: string };
  const query = String(body.query || '').trim();
  if (query.length < 2) {
    return res.status(400).json({ error: 'Type your shop name first.' });
  }

  // Location priority: (1) the browser's real geolocation, reverse-
  // geocoded client-side and passed as `near` — IP geolocation is
  // unreliable (carrier IPs put NYC visitors in Washington); (2) the
  // Vercel IP-city headers as fallback; (3) nothing — the query's own
  // city if the visitor typed one.
  const clientNear = String(body.near || '').trim().slice(0, 80);
  const ipCity = decodeURIComponent(String(req.headers['x-vercel-ip-city'] || ''));
  const ipRegion = decodeURIComponent(String(req.headers['x-vercel-ip-country-region'] || ''));
  const locationQuery = query.includes(',')
    ? undefined
    : clientNear || [ipCity, ipRegion].filter(Boolean).join(', ') || undefined;

  console.log('[FindBiz] query:', query, '| near:', locationQuery || '(none)');
  const startedAt = Date.now();

  // ── Fast path ─────────────────────────────────────────────────────
  const key = placesKey();
  if (key) {
    try {
      const fast = await findCandidatesViaPlaces(query, locationQuery, key);
      if (fast?.length) {
        console.log(`[find-business] places ${Date.now() - startedAt}ms — ${fast.length} candidates`);
        return res.status(200).json({ candidates: fast, searchedNear: locationQuery || null });
      }
      console.log(`[find-business] places miss after ${Date.now() - startedAt}ms → apify`);
    } catch (e: any) {
      // Never fatal: Places is an accelerator, Apify is the contract.
      console.warn('[find-business] places errored → apify:', e?.message || e);
    }
  }

  // ── Fallback: the existing Apify path, unchanged ──────────────────
  const apifyToken = process.env.APIFY_TOKEN || '';
  if (!apifyToken) {
    return res.status(503).json({
      error: "Business search is temporarily unavailable. Use the manual form below and we'll build your site from what you type.",
    });
  }

  try {
    const items = await runApifyActor({
      actorId: 'compass~crawler-google-places',
      input: {
        searchStringsArray: [query],
        ...(locationQuery ? { locationQuery } : {}),
        maxCrawledPlacesPerSearch: 6,
        scrapePlaceDetailPage: false,
        maxImages: 0,
        maxReviews: 0,
        language: 'en',
      },
      token: apifyToken,
      timeoutSec: 40,
    });
    const candidates = (items || [])
      .filter((i: any) => i?.title && i?.placeId)
      .slice(0, 6)
      .map((i: any) => ({
        title: String(i.title),
        address: String(i.address || [i.street, i.city, i.state].filter(Boolean).join(', ') || ''),
        category: String(i.categoryName || ''),
        placeId: String(i.placeId),
        rating: typeof i.totalScore === 'number' ? i.totalScore : null,
        reviews: typeof i.reviewsCount === 'number' ? i.reviewsCount : null,
      }));
    console.log(`[find-business] apify ${Date.now() - startedAt}ms — ${candidates.length} candidates`);
    return res.status(200).json({ candidates, searchedNear: locationQuery || null });
  } catch (e: any) {
    console.error(`[find-business] apify failed after ${Date.now() - startedAt}ms:`, e?.message || e);
    return res.status(422).json({
      error: `Couldn't search for "${query}" right now. Try again in a moment — adding your city helps too, e.g. "${query}, Houston".`,
    });
  }
}
