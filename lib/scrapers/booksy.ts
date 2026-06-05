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
  // Extra settle: Booksy lazy-loads gallery + staff a moment after networkidle.
  await new Promise(r => setTimeout(r, 1500));
  return await page.evaluate(() => {
    const all = (sel) => Array.from(document.querySelectorAll(sel));
    const t = (el) => (el?.textContent || '').trim();

    // Photos — pull up to 25, filter the obvious junk.
    const photos = Array.from(new Set(all('img').map(i => i.currentSrc || i.src || '')
      .filter(s => s && /cloudfront|booksy|cdn/i.test(s) && !/icon|logo|avatar|sprite|placeholder/i.test(s))
      .map(s => s.replace(/_\\d+x\\d+/, '').replace(/\\?.*$/, '')))).slice(0, 25);

    // Services — try to capture category headings + duration in addition to title/price.
    // Booksy renders service cards under category section headers; we walk the DOM in order
    // to associate each card with the most-recently-seen category heading.
    const services = [];
    let currentCategory = '';
    const serviceContainers = all('[data-testid*="service" i], [class*="ServiceCard" i] li, [class*="service-list" i] > *');
    // Pre-scan: build a list of category headings + their offsets.
    const headingNodes = all('[class*="category" i] h2, [class*="category" i] h3, h2[class*="title" i]');
    const headingPositions = headingNodes.map(h => ({ y: h.getBoundingClientRect().top + window.scrollY, text: t(h) }));
    headingPositions.sort((a, b) => a.y - b.y);

    for (const n of serviceContainers.slice(0, 40)) {
      const title = (t(n.querySelector('h3,h4,[class*="title" i],[class*="name" i]')) || t(n).split('\\n')[0]).slice(0, 80);
      if (!title || title.length < 2) continue;
      const price = t(n.querySelector('[class*="price" i]'));
      // Duration usually lives in a sibling element with "min", "h", or "hr".
      const durEl = Array.from(n.querySelectorAll('span,div')).find(e => /\\b(\\d+\\s*(min|hr|h))\\b/i.test(t(e)));
      const duration = durEl ? (t(durEl).match(/(\\d+\\s*(?:hr|h|min))/i)?.[1] || '') : '';
      const description = t(n.querySelector('[class*="description" i], p')).slice(0, 240);
      // Pick the latest heading above this card.
      const cardY = n.getBoundingClientRect().top + window.scrollY;
      const lastHeading = headingPositions.filter(h => h.y < cardY).slice(-1)[0];
      const category = (lastHeading?.text || '').slice(0, 50);
      services.push({ title, price, duration, description, category });
    }

    // Staff — Booksy renders barber profiles in a "Our staff" / "Meet the team" block.
    const staff = all('[data-testid*="staff" i], [class*="StaffCard" i], [class*="staff-list" i] li, [class*="employee" i]').slice(0, 12).map(n => {
      const name = (t(n.querySelector('h3,h4,[class*="name" i]')) || t(n).split('\\n')[0]).slice(0, 60);
      const role = t(n.querySelector('[class*="role" i], [class*="title" i], [class*="position" i]')).slice(0, 60);
      const photoEl = n.querySelector('img');
      const photo = photoEl ? (photoEl.currentSrc || photoEl.src || '').replace(/\\?.*$/, '') : '';
      return { name, role, photo };
    }).filter(s => s.name && s.name.length > 1 && s.name.length < 60);

    const reviews = all('[data-testid*="review" i], [class*="ReviewCard" i]').slice(0, 15).map(n => {
      const ratingEl = n.querySelector('[aria-label*="star" i], [class*="rating" i]');
      const m = ratingEl ? (ratingEl.getAttribute('aria-label') || ratingEl.textContent || '').match(/([0-9.]+)/) : null;
      return {
        author: t(n.querySelector('[class*="author" i], h4, h5')) || 'Customer',
        rating: m ? Math.min(5, Math.round(parseFloat(m[1]))) : 5,
        comment: t(n.querySelector('[class*="comment" i], p')),
        date: t(n.querySelector('[class*="date" i], time')),
      };
    }).filter(r => r.comment && r.comment.length > 10);

    return { services, photos, reviews, staff };
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
      description: base.description || '',
      hours: base.hours || [],
      aggregateRating: base.aggregateRating,
      staff: [],
      services: base.services || [],
      photos: base.photos || [],
      reviews: base.reviews || [],
    };

    // Apify enrichment for the bits JSON-LD doesn't expose on Booksy
    // (full services list with duration/category, staff profiles, full
    // gallery up to 25, more reviews).
    const needsEnrichment =
      shop.services.length === 0 ||
      shop.photos.length < 12 ||
      shop.reviews.length < 6 ||
      (shop.staff?.length || 0) === 0;
    if (opts.apifyToken && needsEnrichment) {
      const apify = await runApifyWebScraper({ url, pageFunction: APIFY_PAGE_FUNCTION, token: opts.apifyToken });
      if (apify) {
        // Services: prefer Apify (richer — has duration + category) when it returned anything.
        if (apify.services?.length) shop.services = apify.services;
        if (apify.photos?.length) shop.photos = [...shop.photos, ...apify.photos];
        if (apify.reviews?.length) shop.reviews = [...shop.reviews, ...apify.reviews];
        if (apify.staff?.length) shop.staff = apify.staff;
      }
    }

    return finalize(shop);
  },
};
