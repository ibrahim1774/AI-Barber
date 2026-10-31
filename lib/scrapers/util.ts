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
//
// COST: every call here is ONE paid Apify run (headless Chromium + Apify proxy, one page). It is the only place
// the scrapers spend Apify money; adapters call it at most once per import and only when the plain-HTTP data was
// thin (see needsPhotoEnrichment). Tests and development never call it (the tests stub fetch).
export async function runApifyWebScraper(opts: {
  url: string;
  pageFunction: string;
  token: string;
  timeoutSec?: number;
  label?: string;
}): Promise<any | null> {
  console.log(`[Apify] web-scraper run (${opts.label || 'unlabelled'}) ${opts.url}`);
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
    photos: dedupeBy(cleanPhotoUrls(shop.photos), (p) => p.replace(/\?.*$/, '')).slice(0, photoCap),
    reviews: dedupeBy(shop.reviews || [], (r) => r.comment.slice(0, 80)).slice(0, reviewCap),
  };
}

// Photo URLs the sites can hotlink: https only (a protocol-relative "//cdn…" becomes https), no data: URIs, no
// SVG/GIF (logos, spinners), nothing absurdly long. Applied to every provider's photos in finalize.
export function cleanPhotoUrls(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    let u = raw.trim();
    if (u.startsWith('//')) u = `https:${u}`;
    if (!/^https:\/\/[^\s]+$/i.test(u) || u.length > 1500) continue;
    if (/\.(svg|gif)(\?|#|$)/i.test(u)) continue;
    out.push(u);
  }
  return out;
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

// ── Shared HTML helpers (used by the Vagaro / Squire / GlossGenius / Acuity adapters) ───────────────────────────

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#0*34;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

// Read a <meta property|name="key" content="…"> value. Scopes the search to a single <meta> tag (so a missing key
// never lets the content capture run across tags), uses a backref to the opening quote so apostrophes inside the
// value (Dan's) don't truncate it, and handles either attribute order.
export function metaContent(html: string, key: string): string {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyRe = new RegExp(`(?:property|name)=("|')${k}\\1`, 'i');
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!keyRe.test(tag)) continue;
    const m = tag.match(/\bcontent=("|')([\s\S]*?)\1/i);
    if (m) return decodeEntities(m[2]).trim();
  }
  return '';
}

// "+19122552067" / "9122552067" -> "(912) 255-2067"; anything else is kept as written.
export function formatUsPhone(raw: unknown): string {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return String(raw || '').trim();
}

// The Next.js page state (<script id="__NEXT_DATA__">), or null.
export function parseNextData(html: string): any | null {
  const m = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

// `var NAME = {...};` inline-script state (Acuity ships its whole business as one). String-aware brace matching,
// so a "}" inside a service description cannot end the object early. Null when absent or unparsable.
export function extractJsonAssignment(html: string, name: string): any | null {
  const at = html.search(new RegExp(`\\b(?:var|let|const)\\s+${name}\\s*=\\s*[{[]`));
  if (at < 0) return null;
  const start = html.slice(at).search(/[{[]/) + at;
  const open = html[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

// Like fetchHtml but returns a refusal (403 / bot check) instead of throwing, so an adapter can choose what to do.
export async function fetchHtmlLoose(
  url: string,
  timeoutMs = 12_000,
): Promise<{ status: number; html: string; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      signal: controller.signal,
    });
    return { status: resp.status, html: await resp.text(), finalUrl: resp.url || url };
  } finally {
    clearTimeout(timer);
  }
}

// ── Photo enrichment through the EXISTING Apify actor (apify/web-scraper) ───────────────────────────────────────
//
// Same actor and call as the Booksy / Fresha / Square enrichment (runApifyWebScraper), now also used for the
// providers whose plain HTTP data carries fewer than PHOTO_ENRICH_BELOW photos. It renders the page in a real
// browser, so it can read a gallery that a client-rendered page draws after load. One run per import, at most,
// and only with a token. Set APIFY_PHOTO_ENRICH=off to switch the new providers' photo runs off without a deploy.
export const PHOTO_ENRICH_BELOW = 6;

export function needsPhotoEnrichment(photoCount: number): boolean {
  return photoCount < PHOTO_ENRICH_BELOW && process.env.APIFY_PHOTO_ENRICH !== 'off';
}

// Page function for apify/web-scraper: the page's own <img> photos. `cdnPattern` (a RegExp source) limits the host
// when the provider's CDN is known; empty means any https host that is not an ad/analytics/map/payment domain.
// Skips logos, icons, avatars, sprites, tiny images, and anything inside the header, nav, footer or a "similar /
// nearby / recommended" block (those are OTHER businesses). `settleMs` waits for lazy galleries.
export function galleryPageFunction(cdnPattern = '', settleMs = 2000, withHtml = false): string {
  return `
async function pageFunction(context) {
  const { page } = context;
  // Bot-check pages ("Security Check" / "Just a moment") get up to ~24 s to clear before the page is read.
  for (let i = 0; i < 12 && /Security Check|Just a moment/i.test(await page.title()); i++) await new Promise(r => setTimeout(r, 2000));
  await page.waitForLoadState?.('networkidle').catch(() => {});
  await new Promise(r => setTimeout(r, ${Math.round(settleMs)}));
  return await page.evaluate(() => {
    const cdn = ${JSON.stringify(cdnPattern)} ? new RegExp(${JSON.stringify(cdnPattern)}, 'i') : null;
    const junkHost = /google|gstatic|facebook|fbcdn|doubleclick|analytics|gravatar|stripe|apple\\.com|maps|mapbox|openstreetmap|recaptcha|segment|hotjar|intercom/i;
    const junkName = /logo|icon|avatar|sprite|placeholder|favicon|emoji|badge|flag|pixel|spinner|profile-pic|default/i;
    const other = '[class*="similar" i],[class*="nearby" i],[class*="recommend" i],[class*="related" i],[class*="suggest" i],[class*="explore" i]';
    const urls = [];
    const og = document.querySelector('meta[property="og:image"]')?.content;
    if (og) urls.push(og);
    for (const img of Array.from(document.querySelectorAll('img'))) {
      if (img.closest('header,nav,footer,aside,' + other)) continue;
      const src = (img.currentSrc || img.src || '').trim();
      if (!/^https:/i.test(src) || junkName.test(src) || junkHost.test(src)) continue;
      if (cdn && !cdn.test(src)) continue;
      const w = img.naturalWidth || img.width || 0;
      if (w && w < 200) continue;
      urls.push(src.split('#')[0]);
    }
    return { photos: Array.from(new Set(urls)).slice(0, 25) };
  }).then(async (r) => ${withHtml ? '({ ...r, html: await page.content() })' : 'r'});
}
`.trim();
}

// One Apify run that returns the page's gallery photos, or [] (no token, switched off, run failed). The caller
// merges the result AFTER the provider's own photos; finalize() dedupes, keeps https only and caps the count.
export async function apifyGalleryPhotos(opts: {
  url: string;
  token?: string;
  label: string;
  cdnPattern?: string;
}): Promise<string[]> {
  if (!opts.token) return [];
  const data = await runApifyWebScraper({
    url: opts.url,
    pageFunction: galleryPageFunction(opts.cdnPattern || ''),
    token: opts.token,
    label: opts.label,
  });
  return cleanPhotoUrls(data?.photos);
}
