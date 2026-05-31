// Vagaro adapter. Booking pages live at vagaro.com/<slug> — SPA that
// requires browser hydration, so Apify-only.
import { runApifyWebScraper, finalize } from './util.js';
import type { PlatformAdapter, ScrapedShop } from './types.js';
import { ScrapeError } from './types.js';

const APIFY_PAGE_FUNCTION = `
async function pageFunction(context) {
  const { page } = context;
  await page.waitForLoadState?.('networkidle').catch(() => {});
  await new Promise(r => setTimeout(r, 2000));
  return await page.evaluate(() => {
    const all = (sel) => Array.from(document.querySelectorAll(sel));
    const t = (el) => (el?.textContent || '').trim();
    const meta = (n) => (document.querySelector('meta[name="' + n + '"]')?.getAttribute('content') || '').trim();
    const shopName = t(document.querySelector('h1')) || meta('og:title') || document.title.split('|')[0].trim();
    const addr = t(document.querySelector('[class*="address" i], [data-test*="address" i]'));
    const phone = (t(document.querySelector('[href^="tel:"]')) || '').replace(/[^\\d()+\\- ]/g, '');
    const photos = Array.from(new Set(all('img').map(i => i.currentSrc || i.src || '')
      .filter(s => s && /vagaro|cloudfront|cdn/i.test(s) && !/icon|logo|avatar|sprite|placeholder/i.test(s))
      .map(s => s.replace(/\\?.*$/, '')))).slice(0, 12);
    const services = all('[data-bind*="service" i], [class*="service" i] [class*="card" i], [class*="ServiceItem" i]').slice(0, 30).map(n => ({
      title: (t(n.querySelector('h3,h4,[class*="title" i],[class*="name" i]')) || t(n).split('\\n')[0]).slice(0, 80),
      price: t(n.querySelector('[class*="price" i]')),
    })).filter(s => s.title.length > 1 && s.title.length < 80);
    const reviews = all('[class*="Review" i] [class*="card" i], [class*="testimonial" i], [data-bind*="review" i]').slice(0, 12).map(n => {
      const ratingEl = n.querySelector('[aria-label*="star" i], [class*="rating" i]');
      const m = ratingEl ? (ratingEl.getAttribute('aria-label') || '').match(/([0-9.]+)/) : null;
      return {
        author: t(n.querySelector('[class*="author" i], h4, h5')) || 'Customer',
        rating: m ? Math.min(5, Math.round(parseFloat(m[1]))) : 5,
        comment: t(n.querySelector('[class*="comment" i], [class*="text" i], p')),
        date: t(n.querySelector('time, [class*="date" i]')),
      };
    }).filter(r => r.comment && r.comment.length > 10);
    return { shopName, addr, phone, services, photos, reviews };
  });
}
`.trim();

export const vagaroAdapter: PlatformAdapter = {
  id: 'vagaro',
  displayName: 'Vagaro',
  hostMatchers: [/(^|\.)vagaro\.com$/i],

  async scrape(url, opts) {
    if (!opts.apifyToken) {
      throw new ScrapeError('Vagaro pages render in the browser, so we need APIFY_TOKEN set to scrape them. Add it in Vercel or paste your shop info in the regular generator.');
    }
    const data = await runApifyWebScraper({ url, pageFunction: APIFY_PAGE_FUNCTION, token: opts.apifyToken, timeoutSec: 120 });
    if (!data?.shopName) {
      throw new ScrapeError('Could not pull data from that Vagaro page — is the link public?');
    }
    const addr: string = data.addr || '';
    const parts = addr.split(',').map((s: string) => s.trim()).filter(Boolean);
    const shop: ScrapedShop = {
      shopName: data.shopName,
      area: parts.length >= 2 ? parts.slice(-2).join(', ') : addr,
      address: addr,
      phone: data.phone || '',
      services: data.services || [],
      photos: data.photos || [],
      reviews: data.reviews || [],
    };
    return finalize(shop);
  },
};
