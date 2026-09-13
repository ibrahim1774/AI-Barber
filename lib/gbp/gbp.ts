// Google Business Profile scraper. Ported from PrimeHub
// (lib/scrapers/gbp.ts) with three deliberate changes for AI-Barber:
//
//   1. No niche detection. PrimeHub routes 20+ trades off the Google
//      category text; AI-Barber is barber-only, so the whole
//      NICHES / NicheSlug dependency is gone.
//   2. No Vercel Blob re-hosting. PrimeHub re-uploads every photo via
//      photoHosting.ts, which needs BLOB_READ_WRITE_TOKEN — a var the
//      AI-Barber Vercel project does NOT have. With no token
//      @vercel/blob's put() throws for every photo and the import
//      would ship a zero-image site. Google's own lh3.googleusercontent
//      URLs are unsigned and hot-linkable (unlike Instagram/Facebook's
//      expiring signed URLs), so we pass them straight through — the
//      same thing AI-Barber's existing Booksy/Fresha adapters do.
//   3. No Places API (New) fast path. That path needs
//      GOOGLE_PLACES_SERVER_KEY (absent here) AND it builds photo URLs
//      with the API key embedded in the query string, which would leak
//      the key into every deployed customer site once photos are no
//      longer re-hosted. Apify is the only path.
//
// Live-testing learning kept from PrimeHub: the actor's `startUrls`
// input fails with "Unexpected value of fid: 'null'" on most
// user-pasted Google Maps URLs because short / share URLs don't embed
// the fid. The reliable input is `searchStringsArray` — the business
// name + address as a search query.

import { runApifyActor, resolveFinalUrl } from './util.js';
import type { GbpBusiness, GbpScrapeOptions } from './types.js';
import { ScrapeError } from './types.js';

const APIFY_ACTOR = 'compass~crawler-google-places';

// Hostnames the Google importer owns.
export const GBP_HOSTS: RegExp[] = [
  /(^|\.)google\.com$/i,
  /(^|\.)google\.[a-z.]+$/i, // google.co.uk, google.ca, …
  /(^|\.)maps\.app\.goo\.gl$/i,
  /(^|\.)share\.google$/i,
  /(^|\.)g\.co$/i,
  /(^|\.)goo\.gl$/i,
  // g.page — Google's business short domain ("g.page/your-shop",
  // "g.page/r/XXXX/review"). Owners paste these constantly.
  /(^|\.)g\.page$/i,
];

export function isGbpUrl(url: string): boolean {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const host = u.hostname.toLowerCase();
    return GBP_HOSTS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

// Pull business name (+ optional address chunk) out of any of the
// common Google URL shapes. Returns a search-ready string.
export function extractSearchQuery(googleUrl: string): string | null {
  try {
    const u = new URL(googleUrl);

    // Pattern A: /maps/place/<Name>/@lat,lng,zoom/...
    const mapsPlace = u.pathname.match(/\/maps\/place\/([^/@]+)/i);
    if (mapsPlace) {
      const raw = decodeURIComponent(mapsPlace[1]).replace(/\+/g, ' ').trim();
      const q = raw.replace(/!.*$/, '').trim();
      // Guard against /maps/place//data=… (empty name) — the regex
      // would otherwise capture the 'data=…' blob as the "name".
      if (q && !/^data=/i.test(q)) return q;
    }

    // Pattern B: /search?q=<Name>  AND  /maps/place/?q=place_id:XXXX
    const q = u.searchParams.get('q');
    if (q) return q.trim();

    // Pattern C: /maps/search/<query>
    const mapsSearch = u.pathname.match(/\/maps\/search\/([^/]+)/i);
    if (mapsSearch) return decodeURIComponent(mapsSearch[1]).replace(/\+/g, ' ').trim();

    return null;
  } catch {
    return null;
  }
}

// Apify hours shape: [{day: 'Monday', hours: '10AM to 10PM'}, ...]
function normaliseHours(rawHours: any): { day: string; hours: string; closed?: boolean }[] {
  if (!Array.isArray(rawHours)) return [];
  return rawHours
    .filter((h: any) => h?.day)
    .map((h: any) => ({
      day: String(h.day),
      hours: String(h.hours || 'Closed'),
      closed: /closed/i.test(String(h.hours || '')),
    }));
}

export async function scrapeGoogleBusiness(
  rawUrl: string,
  opts: GbpScrapeOptions,
): Promise<GbpBusiness> {
  // Step 1: resolve short links to the canonical maps URL. g.page
  // review links ("g.page/r/XXX/review") resolve to a review dialog —
  // strip the review suffix so the place page resolves instead.
  const cleanedRaw = rawUrl.replace(/\/review\/?(\?.*)?$/i, '');
  const resolved = await resolveFinalUrl(cleanedRaw);

  // share.google codes minted by the Google app are app-bound: for any
  // server (or even a fresh browser) they 301 to share.google/error.
  // There is nothing to scrape — tell the visitor the paths that work.
  if (/share\.google\/error/i.test(resolved) || /google\.[a-z.]+\/share\.google/i.test(resolved)) {
    throw new ScrapeError(
      "That Google share link only opens inside the Google app, so we can't read it. Instead, just type your shop name and city into the box — e.g. \"Fade Factory, Houston\" — or paste the web address from your listing (google.com/maps/place/…).",
    );
  }

  // Step 2: extract a search query the actor will accept.
  const query = extractSearchQuery(resolved);
  if (!query || query.length < 2) {
    throw new ScrapeError(
      "Couldn't read your Google link. Type your shop name and city instead — e.g. \"Your Barbershop, Houston\" — or copy the URL straight from the address bar of your Google Maps listing (google.com/maps/place/Your+Business).",
    );
  }

  // Step 3: run the actor. 55s budget — name-only searches with no city
  // take the actor longer to disambiguate than direct place URLs. Stays
  // inside the function's 120s ceiling and the page's "about a minute".
  let items: any[];
  try {
    items = await runApifyActor({
      actorId: APIFY_ACTOR,
      input: {
        searchStringsArray: [query],
        maxCrawledPlacesPerSearch: 1,
        language: 'en',
        scrapePlaceDetailPage: true,
        maxImages: 10,
        maxReviews: 5,
      },
      token: opts.apifyToken,
      timeoutSec: 55,
    });
  } catch {
    // Actor timeout / transient run failure / missing token → retryable
    // guidance, not a generic 500.
    const cityHint = query.includes(',') ? '' : ` Adding your city helps too, e.g. "${query}, Houston".`;
    throw new ScrapeError(
      `Google took a little too long to answer for "${query}". Tap the button once more — the second try is usually faster.${cityHint}`,
    );
  }

  if (!items.length || !items[0]?.title) {
    throw new ScrapeError(
      `Couldn't find a Google Business listing matching "${query}". Double-check the link points to your published Google Business profile, not a search results page.`,
    );
  }
  const item = items[0];

  const city = item.city || '';
  const state = item.state || '';
  const location = [city, state].filter(Boolean).join(', ') || item.address || '';
  const categories = [item.categoryName, ...(item.categories || [])]
    .filter((c: any): c is string => typeof c === 'string' && c.length > 0);

  return {
    source: 'gbp',
    companyName: String(item.title),
    location,
    address: String(item.address || ''),
    phone: String(item.phone || ''),
    description: String(item.description || ''),
    website: String(item.website || ''),
    bookingUrl: String(item.reserveTableUrl || ''),
    aggregateRating: typeof item.totalScore === 'number'
      ? { rating: item.totalScore, count: Number(item.reviewsCount) || 0 }
      : undefined,
    hours: normaliseHours(item.openingHours),
    categories,
    // Pass-through, NOT re-hosted — see the header note.
    photos: ((item.imageUrls || []) as any[])
      .filter((u: any): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
      .slice(0, 10),
    reviews: ((item.reviews || []) as any[])
      .slice(0, 5)
      .map((r: any) => ({
        author: String(r?.name || 'Customer'),
        rating: Math.max(1, Math.min(5, Math.round(Number(r?.stars) || 5))),
        comment: String(r?.text || ''),
        date: String(r?.publishedAtDate || ''),
      }))
      // Testimonials section — only ship reviews worth showing off.
      .filter((r) => r.comment && r.rating >= 4),
  };
}
