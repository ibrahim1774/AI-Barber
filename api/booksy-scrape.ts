import type { VercelRequest, VercelResponse } from '@vercel/node';

// Booksy scraper endpoint. Drives the /booksy generator page.
//
// Strategy: hybrid scrape that minimises Apify spend.
//   1. Server-side fetch the public Booksy URL and parse the JSON-LD
//      block. Booksy SSRs <script type="application/ld+json"> with
//      name, address, hero photo, aggregateRating, and up to 3
//      reviews. Free, instant, no headless browser needed.
//   2. If JSON-LD covered everything we care about, return immediately.
//      Otherwise hand the URL to Apify's web-scraper actor to pick up
//      gallery photos, services, and any remaining reviews from the
//      hydrated DOM.
//
// Apify auth: set `APIFY_TOKEN` in Vercel env vars.
// Get yours at https://console.apify.com/account/integrations.

const APIFY_ACTOR_ID = 'apify~web-scraper';

interface ScrapeResult {
  shopName: string;
  area: string;
  address: string;
  phone?: string;
  services: { title: string; price?: string }[];
  photos: string[];
  reviews: { author: string; rating: number; comment: string; date?: string }[];
}

// Inline pageFunction that runs INSIDE Apify's headless browser on the
// hydrated Booksy page. Pulls the bits JSON-LD doesn't expose.
const APIFY_PAGE_FUNCTION = `
async function pageFunction(context) {
  const { page } = context;
  await page.waitForLoadState?.('networkidle').catch(() => {});

  return await page.evaluate(() => {
    const text = (el) => (el?.textContent || '').trim();
    const all = (sel) => Array.from(document.querySelectorAll(sel));

    // Services with prices — Booksy renders these as cards under
    // a "Services" header. Be loose about selectors so a minor
    // class rename doesn't break us.
    const serviceNodes = all('[data-testid*="service" i], [class*="ServiceCard" i], [class*="service-card" i], section[class*="service" i] li');
    const services = serviceNodes.slice(0, 20).map((n) => {
      const title = text(n.querySelector('h3, h4, [class*="title" i], [class*="name" i]')) || text(n).split('\\n')[0];
      const price = text(n.querySelector('[class*="price" i], [data-testid*="price" i]'));
      return { title: title.slice(0, 80), price };
    }).filter((s) => s.title && s.title.length > 1 && s.title.length < 80);

    // Photos — pull every Booksy CDN image, dedupe, drop avatars/icons.
    const photoSet = new Set();
    all('img').forEach((img) => {
      const src = img.currentSrc || img.src || '';
      if (!src) return;
      if (!/cloudfront|booksy|cdn/i.test(src)) return;
      if (/icon|logo|avatar|profile|sprite/i.test(src)) return;
      const big = src.replace(/_\\d+x\\d+/, '').replace(/\\?.*$/, '');
      photoSet.add(big);
    });
    const photos = Array.from(photoSet).slice(0, 12);

    // Reviews — author, star rating, comment, date.
    const reviewNodes = all('[data-testid*="review" i], [class*="Review" i] li, [class*="review-card" i]');
    const reviews = reviewNodes.slice(0, 12).map((n) => {
      const author = text(n.querySelector('[class*="author" i], [class*="name" i], h4, h5'));
      const comment = text(n.querySelector('[class*="comment" i], [class*="content" i], p'));
      const dateText = text(n.querySelector('[class*="date" i], time'));
      const ratingEl = n.querySelector('[aria-label*="star" i], [class*="rating" i]');
      let rating = 5;
      if (ratingEl) {
        const m = (ratingEl.getAttribute('aria-label') || ratingEl.textContent || '').match(/([0-9.]+)/);
        if (m) rating = Math.min(5, Math.round(parseFloat(m[1])));
      }
      return { author: author || 'Customer', rating, comment, date: dateText };
    }).filter((r) => r.comment && r.comment.length > 10);

    return { services, photos, reviews };
  });
}
`.trim();

function isLikelyBooksyUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return /(^|\.)booksy\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

// Pulls the LocalBusiness/HairSalon JSON-LD block out of the SSR'd
// Booksy HTML. Returns null when missing or unparseable.
function parseBooksyJsonLd(html: string) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      const data = JSON.parse(m[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const t = item?.['@type'];
        if (t === 'HairSalon' || t === 'BarberShop' || t === 'BeautySalon' || t === 'LocalBusiness') {
          return item;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

// Booksy ships street + city smashed together ("127 Allen StNew York NY 10002, New York, 10002").
// Best-effort cleanup: split on the locality marker.
function cleanBooksyAddress(streetAddress: string, locality: string, postal: string): string {
  if (!streetAddress) return [locality, postal].filter(Boolean).join(' ').trim();
  let street = streetAddress;
  if (locality && street.includes(locality)) {
    street = street.split(locality)[0];
  }
  street = street.replace(/[,\s]+$/, '').trim();
  const tail = [locality, postal].filter(Boolean).join(' ').trim();
  return [street, tail].filter(Boolean).join(', ');
}

async function fetchBooksyHtml(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!resp.ok) throw new Error(`Booksy returned ${resp.status}`);
  return resp.text();
}

async function callApify(url: string, token: string): Promise<{ services: any[]; photos: string[]; reviews: any[] } | null> {
  const input = {
    startUrls: [{ url }],
    pageFunction: APIFY_PAGE_FUNCTION,
    proxyConfiguration: { useApifyProxy: true },
    maxRequestsPerCrawl: 1,
    maxConcurrency: 1,
  };
  const resp = await fetch(
    `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items?token=${token}&clean=1&timeout=90`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  if (!resp.ok) {
    console.error('[Booksy] Apify non-200:', resp.status, (await resp.text()).slice(0, 300));
    return null;
  }
  const items = (await resp.json()) as any[];
  return items?.[0] || null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const url = ((req.body || {}) as { url?: string }).url?.trim() || '';
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  if (!isLikelyBooksyUrl(normalized)) {
    return res.status(400).json({ error: 'That does not look like a Booksy URL.' });
  }

  console.log(`[Booksy] Scraping ${normalized}`);

  // ── Step 1: server-side JSON-LD fetch ──
  let ld: any = null;
  try {
    const html = await fetchBooksyHtml(normalized);
    ld = parseBooksyJsonLd(html);
  } catch (e: any) {
    console.error('[Booksy] HTML fetch failed:', e?.message || e);
  }

  if (!ld?.name) {
    return res.status(422).json({
      error: 'Could not pull shop data from that URL — is it a public Booksy page?',
    });
  }

  const addr = ld.address || {};
  const locality = addr.addressLocality || '';
  const region = addr.addressRegion || '';
  const postal = addr.postalCode || '';
  const area = [locality, region].filter(Boolean).join(', ');
  const address = cleanBooksyAddress(addr.streetAddress || '', locality, postal);

  // Reviews from JSON-LD (Booksy ships up to 3 here).
  const ldReviews = Array.isArray(ld.review) ? ld.review : (ld.review ? [ld.review] : []);
  const reviewsFromLd = ldReviews
    .map((r: any) => ({
      author: r?.author?.name || r?.author || 'Customer',
      rating: Math.max(1, Math.min(5, Math.round(Number(r?.reviewRating?.ratingValue) || 5))),
      comment: r?.reviewBody || '',
      date: r?.datePublished || '',
    }))
    .filter((r: { comment: string }) => r.comment && r.comment.length > 5);

  const ldImage = typeof ld.image === 'string' ? [ld.image] : (Array.isArray(ld.image) ? ld.image : []);

  const result: ScrapeResult = {
    shopName: String(ld.name),
    area: area || locality,
    address,
    phone: typeof ld.telephone === 'string' ? ld.telephone : '',
    services: [], // JSON-LD doesn't expose services for most Booksy pages
    photos: ldImage,
    reviews: reviewsFromLd,
  };

  // ── Step 2: optional Apify enrichment when we're missing services
  // or low on photos/reviews. Skipped silently when APIFY_TOKEN
  // is not set — JSON-LD payload is still returned. ──
  const token = process.env.APIFY_TOKEN;
  const needsEnrichment =
    result.services.length === 0 ||
    result.photos.length < 6 ||
    result.reviews.length < 6;

  if (token && needsEnrichment) {
    try {
      const apifyData = await callApify(normalized, token);
      if (apifyData) {
        if (apifyData.services?.length) result.services = apifyData.services;
        if (apifyData.photos?.length) {
          // Merge + dedupe — JSON-LD photo first, then Apify catches.
          const merged = new Set([...result.photos, ...apifyData.photos]);
          result.photos = Array.from(merged);
        }
        if (apifyData.reviews?.length) {
          // Merge JSON-LD + Apify reviews, dedupe by comment text.
          const seen = new Set(result.reviews.map((r) => r.comment.slice(0, 80)));
          for (const r of apifyData.reviews) {
            if (!seen.has(r.comment.slice(0, 80))) {
              result.reviews.push(r);
              seen.add(r.comment.slice(0, 80));
            }
          }
        }
      }
    } catch (e: any) {
      console.error('[Booksy] Apify enrichment failed (non-fatal):', e?.message || e);
    }
  } else if (!token && needsEnrichment) {
    console.warn('[Booksy] APIFY_TOKEN not set — returning JSON-LD only');
  }

  // Cap to the requested sizes.
  return res.status(200).json({
    shopName: result.shopName,
    area: result.area,
    address: result.address,
    phone: result.phone || '',
    services: (result.services || []).slice(0, 8),
    photos: (result.photos || []).slice(0, 6),
    reviews: (result.reviews || []).slice(0, 6),
    // Surface which path served the data — useful for the form to
    // show a friendly "partial" notice when Apify wasn't called.
    _meta: {
      jsonLd: true,
      apifyUsed: token && needsEnrichment,
      hasServices: result.services.length > 0,
    },
  });
}
