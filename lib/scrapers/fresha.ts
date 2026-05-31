// Fresha adapter. Verified live against fresha.com/lvp/<slug>:
// JSON-LD ships full HealthAndBeautyBusiness schema with name,
// address (already as one string), telephone, services (via
// hasOfferCatalog), and 1 hero photo. Reviews and extra photos
// require Apify since they live in the hydrated DOM.
import { fetchHtml, findBusinessLd, ldToScrapedShop, runApifyWebScraper, finalize } from './util.js';
import type { PlatformAdapter, ScrapedShop } from './types.js';
import { ScrapeError } from './types.js';

const APIFY_PAGE_FUNCTION = `
async function pageFunction(context) {
  const { page } = context;
  await page.waitForLoadState?.('networkidle').catch(() => {});
  return await page.evaluate(() => {
    const all = (sel) => Array.from(document.querySelectorAll(sel));
    const t = (el) => (el?.textContent || '').trim();
    const photos = Array.from(new Set(all('img').map(i => i.currentSrc || i.src || '')
      .filter(s => s && /fresha|images-fresha|cdn/i.test(s) && !/icon|logo|avatar|placeholder/i.test(s))
      .map(s => s.replace(/\\?.*$/, '')))).slice(0, 12);
    const reviews = all('[data-qa*="review" i], [class*="Review" i] [class*="card" i], article').slice(0, 12).map(n => {
      const ratingEl = n.querySelector('[aria-label*="star" i], [class*="rating" i]');
      const m = ratingEl ? (ratingEl.getAttribute('aria-label') || '').match(/([0-9.]+)/) : null;
      return {
        author: t(n.querySelector('[class*="author" i], [class*="reviewer" i], h4, h5')) || 'Customer',
        rating: m ? Math.min(5, Math.round(parseFloat(m[1]))) : 5,
        comment: t(n.querySelector('[class*="text" i], [class*="comment" i], p')),
        date: t(n.querySelector('time, [class*="date" i]')),
      };
    }).filter(r => r.comment && r.comment.length > 10);
    return { photos, reviews };
  });
}
`.trim();

export const freshaAdapter: PlatformAdapter = {
  id: 'fresha',
  displayName: 'Fresha',
  hostMatchers: [/(^|\.)fresha\.com$/i],

  async scrape(url, opts) {
    const { html } = await fetchHtml(url);
    const ld = findBusinessLd(html);
    if (!ld?.name) {
      throw new ScrapeError('Could not pull shop data from that Fresha URL. Make sure it points to a venue page (fresha.com/lvp/... or fresha.com/a/...).');
    }

    const base = ldToScrapedShop(ld);
    // Fresha JSON-LD names look like "Shop Name | Fresha" — already
    // stripped by ldToScrapedShop, but reassert just in case.
    let shop: ScrapedShop = {
      shopName: (base.shopName || '').replace(/\s*\|.*$/, ''),
      area: base.area || '',
      address: base.address || '',
      phone: base.phone || '',
      services: base.services || [],
      photos: base.photos || [],
      reviews: base.reviews || [],
    };

    // Fresha JSON-LD ships 1 photo and 0 reviews. Enrich when token set.
    const needsEnrichment = shop.photos.length < 6 || shop.reviews.length < 6;
    if (opts.apifyToken && needsEnrichment) {
      const apify = await runApifyWebScraper({ url, pageFunction: APIFY_PAGE_FUNCTION, token: opts.apifyToken });
      if (apify) {
        if (apify.photos?.length) shop.photos = [...shop.photos, ...apify.photos];
        if (apify.reviews?.length) shop.reviews = apify.reviews;
      }
    }

    return finalize(shop);
  },
};
