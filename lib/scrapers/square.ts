// Square Appointments adapter. Booking pages live at
// book.squareup.com/appointments/<id>/... or <merchant>.square.site/
// — SPAs, so Apify is the primary path. We try JSON-LD first because
// some Square booking pages SSR a LocalBusiness block for SEO.
import { fetchHtml, findBusinessLd, ldToScrapedShop, runApifyWebScraper, finalize } from './util.js';
import type { PlatformAdapter, ScrapedShop } from './types.js';
import { ScrapeError } from './types.js';

const APIFY_PAGE_FUNCTION = `
async function pageFunction(context) {
  const { page } = context;
  await page.waitForLoadState?.('networkidle').catch(() => {});
  // Bumped 2s → 4s — Square's appointment SPA frequently takes 3s+
  // to hydrate the merchant name into the heading.
  await new Promise(r => setTimeout(r, 4000));
  return await page.evaluate(() => {
    const all = (sel) => Array.from(document.querySelectorAll(sel));
    const t = (el) => (el?.textContent || '').trim();
    // OpenGraph uses property=, not name= — the previous meta() helper
    // looked up name=og:title which never matches anything. Fixed.
    const ogProperty = (p) => (document.querySelector('meta[property="' + p + '"]')?.getAttribute('content') || '').trim();
    const metaName = (n) => (document.querySelector('meta[name="' + n + '"]')?.getAttribute('content') || '').trim();
    const shopName =
      t(document.querySelector('h1'))
      || t(document.querySelector('[data-test*="merchant-name" i], [data-test*="business-name" i], [class*="merchantName" i], [class*="businessName" i]'))
      || ogProperty('og:title')
      || ogProperty('og:site_name')
      || metaName('twitter:title')
      || document.title.split('|')[0].split('—')[0].trim();
    const addr = t(document.querySelector('[class*="address" i], [data-test*="address" i], address'));
    const phone = (t(document.querySelector('[href^="tel:"]')) || '').replace(/[^\\d()+\\- ]/g, '');
    const photos = Array.from(new Set(all('img').map(i => i.currentSrc || i.src || '')
      .filter(s => s && /^https?:/i.test(s))
      .filter(s => /square|squareup|cloudfront|squarecdn/i.test(s))
      .filter(s => !/icon|logo|avatar|placeholder|favicon|sprite/i.test(s))
      .map(s => s.split('?')[0]))).slice(0, 25);
    const services = all('[data-test*="service" i], [class*="service-card" i], [class*="appointment-type" i], [class*="ServiceItem" i], li[class*="service" i]').slice(0, 30).map(n => {
      const title = (t(n.querySelector('h3,h4,[class*="title" i],[class*="name" i]')) || t(n).split('\\n')[0]).slice(0, 80);
      const price = t(n.querySelector('[class*="price" i], [data-test*="price" i]'));
      const durEl = Array.from(n.querySelectorAll('span,div')).find(e => /\\b(\\d+\\s*(min|hr|h))\\b/i.test(t(e)));
      const duration = durEl ? (t(durEl).match(/(\\d+\\s*(?:hr|h|min))/i)?.[1] || '') : '';
      return { title, price, duration };
    }).filter(s => s.title.length > 1 && s.title.length < 80);
    return { shopName, addr, phone, services, photos, reviews: [] };
  });
}
`.trim();

export const squareAdapter: PlatformAdapter = {
  id: 'square',
  displayName: 'Square Appointments',
  // squareup.com (covers book.squareup.com), square.site (merchant
  // storefronts), and squarespace.com just in case someone confuses
  // the two — squarespace is rejected at the shop-data check below.
  hostMatchers: [
    /(^|\.)squareup\.com$/i,
    /(^|\.)square\.site$/i,
  ],

  async scrape(url, opts) {
    // Try JSON-LD first — some Square booking pages SSR a
    // LocalBusiness block for SEO. Free hit when it works.
    let shop: ScrapedShop | null = null;
    try {
      const { html } = await fetchHtml(url);
      const ld = findBusinessLd(html);
      if (ld?.name) {
        const base = ldToScrapedShop(ld);
        shop = {
          shopName: base.shopName || '',
          area: base.area || '',
          address: base.address || '',
          phone: base.phone || '',
          description: base.description || '',
          hours: base.hours || [],
          aggregateRating: base.aggregateRating,
          staff: [],
          services: base.services || [],
          photos: base.photos || [],
          reviews: base.reviews || [],
        };
      }
    } catch {
      /* fall through to Apify */
    }

    // Apify fallback (or enrichment when JSON-LD was sparse).
    const needsApify = !shop || !shop.shopName || shop.services.length === 0 || shop.photos.length < 6;
    if (needsApify) {
      if (!opts.apifyToken) {
        throw new ScrapeError(
          'Square Appointments pages render in the browser, so we need an APIFY_TOKEN env var set on Vercel to scrape them. Add it under Project → Settings → Environment Variables, then redeploy.',
        );
      }
      const data = await runApifyWebScraper({ url, pageFunction: APIFY_PAGE_FUNCTION, token: opts.apifyToken, timeoutSec: 150 });
      if (data?.shopName) {
        const addr: string = data.addr || (shop?.address || '');
        const parts = addr.split(',').map((s: string) => s.trim()).filter(Boolean);
        shop = {
          shopName: data.shopName,
          area: parts.length >= 2 ? parts.slice(-2).join(', ') : addr,
          address: addr,
          phone: data.phone || shop?.phone || '',
          description: shop?.description || '',
          hours: shop?.hours || [],
          aggregateRating: shop?.aggregateRating,
          staff: [],
          services: (data.services?.length ? data.services : shop?.services) || [],
          photos: [...(shop?.photos || []), ...(data.photos || [])],
          reviews: shop?.reviews || [],
        };
      }
    }

    if (!shop || !shop.shopName) {
      throw new ScrapeError(
        'Could not pull data from that Square Appointments page. Make sure the URL is the public booking link (book.squareup.com/appointments/...) and the page is publicly viewable — not a draft or unpublished site.',
      );
    }
    return finalize(shop);
  },
};
