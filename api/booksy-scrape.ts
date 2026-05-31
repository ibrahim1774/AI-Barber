import type { VercelRequest, VercelResponse } from '@vercel/node';

// Booksy scraper endpoint. Drives the /booksy generator page.
//
// Flow: visitor pastes a Booksy URL → we hand it to Apify's public
// `apify/web-scraper` actor with an inline pageFunction that pulls
// shop name, address, services + prices, gallery photos, and customer
// reviews. The run-sync endpoint blocks until the dataset is ready
// (no polling), and we shape the result into our WebsiteData payload.
//
// Apify auth: set `APIFY_TOKEN` in Vercel env vars.
// Get yours at https://console.apify.com/account/integrations.

const ACTOR_ID = 'apify~web-scraper'; // public general-purpose Puppeteer actor

interface ScrapeResult {
  shopName: string;
  area: string; // city, state — used for hero subhead
  address: string; // full street address for contact block
  phone?: string;
  services: { title: string; price?: string }[];
  photos: string[];
  reviews: { author: string; rating: number; comment: string; date?: string }[];
}

// Inline pageFunction the Apify actor runs INSIDE the headless browser
// on the Booksy page. Returns a single object that becomes one dataset
// item. Selectors are best-effort; Booksy ships JSON-LD that we lean
// on first, then fall back to DOM scraping.
const PAGE_FUNCTION = `
async function pageFunction(context) {
  const { page, request, log } = context;
  await page.waitForLoadState?.('networkidle').catch(() => {});

  return await page.evaluate(() => {
    const text = (el) => (el?.textContent || '').trim();
    const all = (sel) => Array.from(document.querySelectorAll(sel));

    // ── JSON-LD: business name, address, phone, aggregateRating ──
    let ld = null;
    for (const s of all('script[type="application/ld+json"]')) {
      try {
        const j = JSON.parse(s.textContent || '{}');
        const arr = Array.isArray(j) ? j : [j];
        for (const item of arr) {
          if (item && (item['@type'] === 'LocalBusiness' || item['@type'] === 'HairSalon' || item['@type'] === 'BarberShop' || item['@type'] === 'Organization')) {
            ld = item; break;
          }
        }
        if (ld) break;
      } catch {}
    }

    const shopName = (ld && ld.name) || text(document.querySelector('h1'));
    const phone = (ld && ld.telephone) || '';
    const addr = ld && ld.address;
    const street = (addr && (addr.streetAddress || '')) || '';
    const city = (addr && (addr.addressLocality || '')) || '';
    const region = (addr && (addr.addressRegion || '')) || '';
    const addressFull = [street, [city, region].filter(Boolean).join(', ')].filter(Boolean).join(', ');
    const area = [city, region].filter(Boolean).join(', ');

    // ── Services + prices ──
    // Booksy structures services as cards with a title and a price line.
    // Selector hits are kept loose; we try several patterns.
    const serviceNodes = all('[data-testid="service-item"], li[class*="service"], div[class*="ServiceCard"], div[class*="service-card"]');
    const services = serviceNodes.slice(0, 20).map((n) => {
      const title = text(n.querySelector('h3, h4, [class*="title"], [class*="name"]')) || text(n);
      const price = text(n.querySelector('[class*="price"], [data-testid*="price"]'));
      return { title: title.slice(0, 80), price };
    }).filter((s) => s.title && s.title.length > 1);

    // ── Photos ── prefer high-res from the gallery; dedupe by src
    const photoSet = new Set();
    all('img').forEach((img) => {
      const src = img.currentSrc || img.src || '';
      if (!src) return;
      if (!/booksy|cdn|images/i.test(src)) return;
      if (/icon|logo|avatar|profile/i.test(src)) return;
      // upscale tiny thumbnails when Booksy serves multiple sizes
      const big = src.replace(/_\\d+x\\d+/, '').replace(/\\?.*$/, '');
      photoSet.add(big);
    });
    const photos = Array.from(photoSet).slice(0, 12);

    // ── Reviews — author, star rating, comment, date ──
    const reviewNodes = all('[data-testid="review"], [class*="Review"], li[class*="review"]');
    const reviews = reviewNodes.slice(0, 12).map((n) => {
      const author = text(n.querySelector('[class*="author"], [class*="name"], h4, h5'));
      const comment = text(n.querySelector('[class*="comment"], [class*="content"], p'));
      const dateText = text(n.querySelector('[class*="date"], time'));
      const ratingEl = n.querySelector('[aria-label*="star" i], [class*="rating"]');
      let rating = 5;
      if (ratingEl) {
        const m = (ratingEl.getAttribute('aria-label') || ratingEl.textContent || '').match(/([0-9.]+)/);
        if (m) rating = Math.min(5, Math.round(parseFloat(m[1])));
      }
      return { author: author || 'Customer', rating, comment, date: dateText };
    }).filter((r) => r.comment && r.comment.length > 10);

    return { shopName, area, address: addressFull, phone, services, photos, reviews };
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.APIFY_TOKEN;
  if (!token) {
    console.error('[Booksy] Missing APIFY_TOKEN env var');
    return res.status(500).json({ error: 'Server misconfigured — APIFY_TOKEN not set' });
  }

  const url = ((req.body || {}) as { url?: string }).url?.trim() || '';
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  if (!isLikelyBooksyUrl(normalized)) {
    return res.status(400).json({ error: 'That does not look like a Booksy URL.' });
  }

  // Apify Web Scraper input shape.
  const input = {
    startUrls: [{ url: normalized }],
    pageFunction: PAGE_FUNCTION,
    proxyConfiguration: { useApifyProxy: true },
    maxRequestsPerCrawl: 1,
    maxConcurrency: 1,
  };

  console.log(`[Booksy] Scraping ${normalized}`);

  try {
    const runResp = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${token}&clean=1&timeout=90`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );

    if (!runResp.ok) {
      const text = await runResp.text();
      console.error('[Booksy] Apify error:', runResp.status, text.slice(0, 500));
      return res.status(502).json({ error: 'Apify scrape failed', details: text.slice(0, 200) });
    }

    const items = (await runResp.json()) as ScrapeResult[];
    const data = items?.[0];
    if (!data || !data.shopName) {
      return res.status(422).json({ error: 'Could not pull shop data from that URL — is it a public Booksy page?' });
    }

    // Trim to the caps the user asked for: 6 photos, 6 reviews.
    return res.status(200).json({
      shopName: data.shopName,
      area: data.area || data.address || '',
      address: data.address || '',
      phone: data.phone || '',
      services: (data.services || []).slice(0, 8),
      photos: (data.photos || []).slice(0, 6),
      reviews: (data.reviews || []).slice(0, 6),
    });
  } catch (error: any) {
    console.error('[Booksy] Unexpected error:', error?.message || error);
    return res.status(500).json({ error: 'Scrape failed', details: String(error?.message || error) });
  }
}
