// StyleSeat adapter. SPA — no useful HTML server-side, so this is
// Apify-only. Selectors are best-effort and may need tuning after the
// first real scrape.
import { runApifyWebScraper, finalize } from './util.js';
import type { PlatformAdapter, ScrapedShop } from './types.js';
import { ScrapeError } from './types.js';

const APIFY_PAGE_FUNCTION = `
async function pageFunction(context) {
  const { page } = context;
  await page.waitForLoadState?.('networkidle').catch(() => {});
  await new Promise(r => setTimeout(r, 1500)); // extra settle for SPA hydration
  return await page.evaluate(() => {
    const all = (sel) => Array.from(document.querySelectorAll(sel));
    const t = (el) => (el?.textContent || '').trim();
    const meta = (name) => (document.querySelector('meta[name="' + name + '"]')?.getAttribute('content') || '').trim();
    const shopName = t(document.querySelector('h1')) || meta('og:title') || document.title.split('|')[0].trim();
    const addr = t(document.querySelector('[class*="address" i], [data-testid*="address" i]'));
    const phone = (t(document.querySelector('[href^="tel:"], [class*="phone" i]')) || '').replace(/[^\\d()+\\- ]/g, '');
    const photos = Array.from(new Set(all('img').map(i => i.currentSrc || i.src || '')
      .filter(s => s && /styleseat|cdn|cloudfront/i.test(s) && !/icon|logo|avatar|sprite/i.test(s))
      .map(s => s.replace(/\\?.*$/, '')))).slice(0, 12);
    const services = all('[data-testid*="service" i], [class*="service-card" i], [class*="Service" i] li').slice(0, 20).map(n => ({
      title: (t(n.querySelector('h3,h4,[class*="title" i]')) || t(n).split('\\n')[0]).slice(0, 80),
      price: t(n.querySelector('[class*="price" i]')),
    })).filter(s => s.title.length > 1);
    const reviews = all('[data-testid*="review" i], [class*="ReviewCard" i], [class*="testimonial" i]').slice(0, 12).map(n => {
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

export const styleseatAdapter: PlatformAdapter = {
  id: 'styleseat',
  displayName: 'StyleSeat',
  hostMatchers: [/(^|\.)styleseat\.com$/i],

  async scrape(url, opts) {
    if (!opts.apifyToken) {
      throw new ScrapeError('StyleSeat pages render in the browser, so we need APIFY_TOKEN set to scrape them. Ask your developer to add it in Vercel, or paste your shop info in the regular generator.');
    }
    const data = await runApifyWebScraper({ url, pageFunction: APIFY_PAGE_FUNCTION, token: opts.apifyToken, timeoutSec: 120 });
    if (!data?.shopName) {
      throw new ScrapeError('Could not pull data from that StyleSeat page — is it a public profile?');
    }

    // Best-effort split of address into "area" + full string.
    const addr: string = data.addr || '';
    const parts = addr.split(',').map((s: string) => s.trim()).filter(Boolean);
    const area = parts.length >= 2 ? parts.slice(-2).join(', ') : addr;

    const shop: ScrapedShop = {
      shopName: data.shopName,
      area,
      address: addr,
      phone: data.phone || '',
      services: data.services || [],
      photos: data.photos || [],
      reviews: data.reviews || [],
    };
    return finalize(shop);
  },
};
