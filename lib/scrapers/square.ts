// Square Appointments adapter. Booking pages live at
// book.squareup.com/appointments/<id>/... — SPA, Apify-only.
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
      .filter(s => s && /square|squareup|cloudfront/i.test(s) && !/icon|logo|avatar|placeholder/i.test(s))
      .map(s => s.replace(/\\?.*$/, '')))).slice(0, 12);
    const services = all('[data-test*="service" i], [class*="service" i] li, [class*="appointment-type" i]').slice(0, 30).map(n => {
      const title = (t(n.querySelector('h3,h4,[class*="title" i],[class*="name" i]')) || t(n).split('\\n')[0]).slice(0, 80);
      const price = t(n.querySelector('[class*="price" i], [data-test*="price" i]'));
      return { title, price };
    }).filter(s => s.title.length > 1 && s.title.length < 80);
    return { shopName, addr, phone, services, photos, reviews: [] };
  });
}
`.trim();

export const squareAdapter: PlatformAdapter = {
  id: 'square',
  displayName: 'Square Appointments',
  hostMatchers: [
    /(^|\.)squareup\.com$/i,
    /(^|\.)square\.site$/i,
  ],

  async scrape(url, opts) {
    if (!opts.apifyToken) {
      throw new ScrapeError('Square pages render in the browser, so we need APIFY_TOKEN set to scrape them. Add it in Vercel or paste your shop info in the regular generator.');
    }
    const data = await runApifyWebScraper({ url, pageFunction: APIFY_PAGE_FUNCTION, token: opts.apifyToken, timeoutSec: 120 });
    if (!data?.shopName) {
      throw new ScrapeError('Could not pull data from that Square Appointments page — is it your public booking link?');
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
