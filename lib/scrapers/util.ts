// Shared helpers used by every platform adapter.
import type { ScrapedShop } from './types.js';
import { currencySymbol, normalizeDuration, normalizeHours, normalizePrice, priceFromBounds } from '../scrapeNormalize.js';

// A review's star rating as a whole number 1-5, or undefined when the
// source didn't give a readable one. Never defaulted: a review with no
// rating shows no stars, and the Google ≥4★ filter drops it.
export function parseReviewRating(raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.min(5, Math.round(n));
}

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

  // Image — Booksy often ships these as `{@type: 'ImageObject', url: '...'}`
  // (or `contentUrl`) instead of plain strings. Accept both forms so we
  // don't drop a venue's whole gallery on a JSON-LD shape detail.
  const imgs = Array.isArray(ld?.image) ? ld.image : ld?.image ? [ld.image] : [];
  result.photos = imgs
    .map((x: any) => {
      if (typeof x === 'string') return x;
      if (x && typeof x === 'object') return x.url || x.contentUrl || '';
      return '';
    })
    .filter((s: string) => typeof s === 'string' && /^https?:\/\//i.test(s));

  // Services — `hasOfferCatalog.itemListElement[].itemOffered.name` is
  // the schema.org pattern. Also handle `makesOffer` and `offers` arrays.
  // We pull title + price + duration + description; renderers use what
  // they have and skip the rest.
  const services: { title: string; price?: string; duration?: string; description?: string }[] = [];
  const collectOffer = (o: any) => {
    const item = o?.itemOffered || {};
    const name = item.name || o?.name || (typeof o === 'string' ? o : '');
    // The offer can sit on the entry, its priceSpecification or the item's own `offers` (an object or a list); it can be a
    // single `price` or an AggregateOffer's low/high. Every form lands in one display text; no number means ''.
    const itemOffers = Array.isArray(item?.offers) ? item.offers[0] : item?.offers;
    const spec = o?.priceSpecification ?? itemOffers?.priceSpecification;
    const src = [o, spec, itemOffers].find((x) => x && (x.price != null || x.lowPrice != null || x.minPrice != null)) ?? {};
    const sym = currencySymbol(src.priceCurrency ?? o?.priceCurrency ?? spec?.priceCurrency ?? itemOffers?.priceCurrency);
    const price = src.price != null && src.price !== ''
      ? normalizePrice(src.price, sym)
      : priceFromBounds(src.lowPrice ?? src.minPrice, src.highPrice ?? src.maxPrice, sym);
    const duration =
      normalizeDuration(item?.estimatedDuration || o?.estimatedDuration || item?.duration || o?.duration || '') || '';
    const description = String(item?.description || o?.description || '').slice(0, 240);
    if (name) services.push({ title: String(name).slice(0, 80), price, duration, description });
  };
  if (Array.isArray(ld?.hasOfferCatalog?.itemListElement)) {
    ld.hasOfferCatalog.itemListElement.forEach(collectOffer);
  }
  if (Array.isArray(ld?.makesOffer)) ld.makesOffer.forEach(collectOffer);
  if (Array.isArray(ld?.offers)) ld.offers.forEach(collectOffer);
  result.services = services;

  // Shop bio / description.
  if (typeof ld?.description === 'string' && ld.description.trim()) {
    (result as any).description = ld.description.trim().slice(0, 1200);
  }

  // Aggregate rating.
  if (ld?.aggregateRating) {
    const rating = Number(ld.aggregateRating.ratingValue);
    const count = Number(ld.aggregateRating.reviewCount || ld.aggregateRating.ratingCount);
    if (Number.isFinite(rating) && rating > 0) {
      (result as any).aggregateRating = {
        rating: Math.round(rating * 10) / 10,
        count: Number.isFinite(count) ? count : 0,
      };
    }
  }

  // Hours of operation — schema.org openingHoursSpecification.
  // Each entry: { dayOfWeek: "Monday"|["Monday","Tuesday"], opens: "09:00", closes: "19:00" }
  // We flatten + normalize to Mon-Sun, marking closed days as `closed: true`.
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const hoursMap: Record<string, { open: string; close: string; closed?: boolean }> = {};
  const hoursSpec = ld?.openingHoursSpecification;
  const hoursList = Array.isArray(hoursSpec) ? hoursSpec : hoursSpec ? [hoursSpec] : [];
  for (const spec of hoursList) {
    const days = Array.isArray(spec?.dayOfWeek) ? spec.dayOfWeek : spec?.dayOfWeek ? [spec.dayOfWeek] : [];
    const opens = String(spec?.opens || '').slice(0, 5);
    const closes = String(spec?.closes || '').slice(0, 5);
    for (const d of days) {
      const key = String(d).replace(/^https?:\/\/schema\.org\//, '').trim();
      if (DAYS.includes(key)) hoursMap[key] = { open: opens, close: closes };
    }
  }
  if (Object.keys(hoursMap).length) {
    (result as any).hours = DAYS.map((day) => {
      const h = hoursMap[day];
      return h ? { day, open: h.open, close: h.close } : { day, open: '', close: '', closed: true };
    });
  }

  // Reviews
  const ldReviews = Array.isArray(ld?.review) ? ld.review : ld?.review ? [ld.review] : [];
  result.reviews = ldReviews
    .map((r: any) => ({
      author: r?.author?.name || r?.author || 'Customer',
      rating: parseReviewRating(r?.reviewRating?.ratingValue),
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
// photos/reviews/staff by signature, preserves the rich fields the
// renderer wants (description, hours, aggregateRating, staff).
export function finalize(
  shop: ScrapedShop,
  opts: { photos?: number; reviews?: number; services?: number; staff?: number } = {},
): ScrapedShop {
  const photoCap = opts.photos ?? 20;
  const reviewCap = opts.reviews ?? 12;
  const serviceCap = opts.services ?? 12;
  const staffCap = opts.staff ?? 12;
  return {
    shopName: shop.shopName,
    area: shop.area,
    address: shop.address,
    phone: shop.phone || '',
    description: shop.description || '',
    hours: normalizeHours(shop.hours),
    aggregateRating: shop.aggregateRating,
    staff: dedupeBy(shop.staff || [], (s) => s.name.toLowerCase()).slice(0, staffCap),
    services: dedupeBy(shop.services || [], (s) => s.title.toLowerCase()).slice(0, serviceCap).map((s) => ({
      ...s,
      price: normalizePrice(s.price) || undefined,
      duration: normalizeDuration(s.duration) || undefined,
    })),
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
