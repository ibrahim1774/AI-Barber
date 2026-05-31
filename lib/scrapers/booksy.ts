// Booksy adapter. Pulls JSON-LD from the SSR'd Booksy shop page.
// Vanity subdomains (gyroshop.booksy.com) get resolved against
// Booksy's public sitemap before scraping.
import { findCanonicalBooksyUrl, extractVanitySubdomainSlug } from '../booksySitemap.js';
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
      .filter(s => s && /cloudfront|booksy|cdn/i.test(s) && !/icon|logo|avatar|sprite/i.test(s))
      .map(s => s.replace(/_\\d+x\\d+/, '').replace(/\\?.*$/, '')))).slice(0, 12);
    const services = all('[data-testid*="service" i], [class*="ServiceCard" i] li').slice(0, 20).map(n => ({
      title: (t(n.querySelector('h3,h4,[class*="title" i]')) || t(n).split('\\n')[0]).slice(0, 80),
      price: t(n.querySelector('[class*="price" i]')),
    })).filter(s => s.title.length > 1);
    const reviews = all('[data-testid*="review" i], [class*="ReviewCard" i]').slice(0, 12).map(n => {
      const ratingEl = n.querySelector('[aria-label*="star" i], [class*="rating" i]');
      const m = ratingEl ? (ratingEl.getAttribute('aria-label') || ratingEl.textContent || '').match(/([0-9.]+)/) : null;
      return {
        author: t(n.querySelector('[class*="author" i], h4, h5')) || 'Customer',
        rating: m ? Math.min(5, Math.round(parseFloat(m[1]))) : 5,
        comment: t(n.querySelector('[class*="comment" i], p')),
        date: t(n.querySelector('[class*="date" i], time')),
      };
    }).filter(r => r.comment && r.comment.length > 10);
    return { services, photos, reviews };
  });
}
`.trim();

function isHomepage(finalUrl: string): boolean {
  try {
    const u = new URL(finalUrl);
    if (!/(^|\.)booksy\.com$/i.test(u.hostname)) return false;
    const p = u.pathname.replace(/\/+$/, '');
    return p === '' || /^\/[a-z]{2}-[a-z]{2}$/i.test(p);
  } catch {
    return false;
  }
}

export const booksyAdapter: PlatformAdapter = {
  id: 'booksy',
  displayName: 'Booksy',
  hostMatchers: [/(^|\.)booksy\.com$/i],

  async scrape(rawUrl, opts) {
    let url = rawUrl;

    // Vanity subdomain rescue.
    const vanity = extractVanitySubdomainSlug(url);
    if (vanity) {
      const canonical = await findCanonicalBooksyUrl(vanity).catch(() => null);
      if (!canonical) {
        throw new ScrapeError(`Couldn't find a Booksy shop matching "${vanity}". Open your shop on Booksy in a browser and copy the full URL from the address bar.`);
      }
      url = canonical;
    }

    const { html, finalUrl } = await fetchHtml(url);
    const ld = findBusinessLd(html);

    if (!ld?.name && isHomepage(finalUrl)) {
      throw new ScrapeError('That link redirected to the Booksy homepage. Copy the full URL from your shop page on Booksy — it should look like booksy.com/en-us/12345_your-shop-name.');
    }
    if (!ld?.name) {
      throw new ScrapeError('Could not pull shop data from that Booksy URL.');
    }

    const base = ldToScrapedShop(ld);
    let shop: ScrapedShop = {
      shopName: base.shopName || '',
      area: base.area || '',
      address: base.address || '',
      phone: base.phone || '',
      services: base.services || [],
      photos: base.photos || [],
      reviews: base.reviews || [],
    };

    // Apify enrichment for the bits JSON-LD doesn't expose on Booksy
    // (services list and full gallery).
    const needsEnrichment = shop.services.length === 0 || shop.photos.length < 6 || shop.reviews.length < 6;
    if (opts.apifyToken && needsEnrichment) {
      const apify = await runApifyWebScraper({ url, pageFunction: APIFY_PAGE_FUNCTION, token: opts.apifyToken });
      if (apify) {
        if (apify.services?.length) shop.services = apify.services;
        if (apify.photos?.length) shop.photos = [...shop.photos, ...apify.photos];
        if (apify.reviews?.length) shop.reviews = [...shop.reviews, ...apify.reviews];
      }
    }

    return finalize(shop);
  },
};
