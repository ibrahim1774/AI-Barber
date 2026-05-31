// Shared helpers used by every platform adapter.
import type { ScrapedShop } from './types.js';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

export async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string }> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  if (!resp.ok) throw new Error(`Source returned ${resp.status}`);
  return { html: await resp.text(), finalUrl: resp.url };
}

// Pulls JSON-LD blocks from HTML, returns parsed objects (flattened
// if a block is an array). Caller filters by @type.
export function parseJsonLd(html: string): any[] {
  const out: any[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      const data = JSON.parse(m[1]);
      if (Array.isArray(data)) out.push(...data);
      else out.push(data);
    } catch {
      /* ignore bad blocks */
    }
  }
  return out;
}

const BUSINESS_TYPES = new Set([
  'LocalBusiness',
  'HairSalon',
  'BarberShop',
  'BeautySalon',
  'HealthAndBeautyBusiness',
  'DaySpa',
]);

// Find the first JSON-LD object that looks like a business.
export function findBusinessLd(html: string): any | null {
  for (const item of parseJsonLd(html)) {
    const t = item?.['@type'];
    if (typeof t === 'string' && BUSINESS_TYPES.has(t)) return item;
    if (Array.isArray(t) && t.some((x) => BUSINESS_TYPES.has(x))) return item;
  }
  return null;
}

// Walk a JSON-LD LocalBusiness-shaped object and produce our ScrapedShop.
// Handles common variations: address as object or string, image as
// array or string, reviews nested under `review`, services under
// `hasOfferCatalog.itemListElement`.
export function ldToScrapedShop(ld: any): Partial<ScrapedShop> {
  const result: Partial<ScrapedShop> = {
    shopName: String(ld?.name || '').replace(/\s*\|.+$/, '').trim(),
    services: [],
    photos: [],
    reviews: [],
  };

  // Phone
  if (typeof ld?.telephone === 'string') result.phone = ld.telephone;

  // Address — can be a string or PostalAddress object.
  if (typeof ld?.address === 'string') {
    result.address = ld.address;
    // best-effort area: last two comma-separated chunks
    const parts = ld.address.split(',').map((s: string) => s.trim()).filter(Boolean);
    result.area = parts.slice(-2).join(', ');
  } else if (ld?.address && typeof ld.address === 'object') {
    const a = ld.address;
    const locality = a.addressLocality || '';
    const region = a.addressRegion || '';
    const postal = a.postalCode || '';
    const street = a.streetAddress || '';
    result.area = [locality, region].filter(Boolean).join(', ');
    result.address = [street, [locality, region].filter(Boolean).join(', '), postal]
      .filter(Boolean)
      .join(', ');
  }

  // Image
  const imgs = Array.isArray(ld?.image) ? ld.image : ld?.image ? [ld.image] : [];
  result.photos = imgs.filter((x: any) => typeof x === 'string');

  // Services — `hasOfferCatalog.itemListElement[].itemOffered.name` is
  // the schema.org pattern. Also handle `makesOffer` and `offers` arrays.
  const services: { title: string; price?: string }[] = [];
  const collectOffer = (o: any) => {
    const name =
      o?.itemOffered?.name ||
      o?.name ||
      (typeof o === 'string' ? o : '');
    const price = o?.price ? `$${o.price}` : o?.priceSpecification?.price ? `$${o.priceSpecification.price}` : '';
    if (name) services.push({ title: String(name).slice(0, 80), price });
  };
  if (Array.isArray(ld?.hasOfferCatalog?.itemListElement)) {
    ld.hasOfferCatalog.itemListElement.forEach(collectOffer);
  }
  if (Array.isArray(ld?.makesOffer)) ld.makesOffer.forEach(collectOffer);
  if (Array.isArray(ld?.offers)) ld.offers.forEach(collectOffer);
  result.services = services;

  // Reviews
  const ldReviews = Array.isArray(ld?.review) ? ld.review : ld?.review ? [ld.review] : [];
  result.reviews = ldReviews
    .map((r: any) => ({
      author: r?.author?.name || r?.author || 'Customer',
      rating: Math.max(1, Math.min(5, Math.round(Number(r?.reviewRating?.ratingValue) || 5))),
      comment: r?.reviewBody || '',
      date: r?.datePublished || '',
    }))
    .filter((r: { comment: string }) => r.comment && r.comment.length > 5);

  return result;
}

// Apify Web Scraper invoker. Returns whatever the inline pageFunction
// returns as the first dataset item, or null on any failure.
export async function runApifyWebScraper(opts: {
  url: string;
  pageFunction: string;
  token: string;
  timeoutSec?: number;
}): Promise<any | null> {
  const body = {
    startUrls: [{ url: opts.url }],
    pageFunction: opts.pageFunction,
    proxyConfiguration: { useApifyProxy: true },
    maxRequestsPerCrawl: 1,
    maxConcurrency: 1,
  };
  try {
    const resp = await fetch(
      `https://api.apify.com/v2/acts/apify~web-scraper/run-sync-get-dataset-items?token=${opts.token}&clean=1&timeout=${opts.timeoutSec || 90}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!resp.ok) {
      console.error('[Apify] non-200', resp.status, (await resp.text()).slice(0, 300));
      return null;
    }
    const items = (await resp.json()) as any[];
    return items?.[0] || null;
  } catch (e: any) {
    console.error('[Apify] threw:', e?.message || e);
    return null;
  }
}

// Trim a ScrapedShop to user-specified caps. Removes duplicate
// photos/reviews by signature.
export function finalize(shop: ScrapedShop, opts: { photos?: number; reviews?: number; services?: number } = {}): ScrapedShop {
  const photoCap = opts.photos ?? 6;
  const reviewCap = opts.reviews ?? 6;
  const serviceCap = opts.services ?? 8;
  return {
    shopName: shop.shopName,
    area: shop.area,
    address: shop.address,
    phone: shop.phone || '',
    services: dedupeBy(shop.services || [], (s) => s.title.toLowerCase()).slice(0, serviceCap),
    photos: dedupeBy(shop.photos || [], (p) => p.replace(/\?.*$/, '')).slice(0, photoCap),
    reviews: dedupeBy(shop.reviews || [], (r) => r.comment.slice(0, 80)).slice(0, reviewCap),
  };
}

function dedupeBy<T>(arr: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    const k = key(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}
