// Squire adapter.
//
// Squire (getsquire.com) sits behind a Cloudflare managed challenge ("Security Check"): a plain server-side GET gets
// 403 and no page content at all (observed 2026-10-28 on both /discover/... and /booking/... pages). We do NOT try to get
// around that challenge. What the adapter does:
//   1. Plain GET. If the page comes back, read it with the generic structured reader (JSON-LD LocalBusiness, services,
//      OpenGraph, tel:, <address>), exactly the data a public page exposes without login.
//   2. If it is blocked and an Apify token exists, ONE Apify web-scraper run (a real browser) loads the page, waits for
//      the check to clear and hands back the rendered HTML plus gallery photos; the same reader parses it. UNVERIFIED
//      against the live site: Cloudflare may refuse Apify's browser too, in which case the import ends with the
//      friendly message below and the barber uses "Find me on Google".
//   3. No token / still blocked -> ScrapeError (never a made-up shop).
import { apifyGalleryPhotos, fetchHtmlLoose, finalize, galleryPageFunction, needsPhotoEnrichment, runApifyWebScraper, cleanPhotoUrls } from './util.js';
import { shopFromStructuredHtml } from './structured.js';
import type { PlatformAdapter } from './types.js';
import { ScrapeError } from './types.js';

export function isBlockedPage(status: number, html: string): boolean {
  return status === 403 || status === 429 || status === 503 || /<title>[^<]*(Security Check|Just a moment|Attention Required)/i.test(html) || /_cf_chl_opt/.test(html);
}

export const squireAdapter: PlatformAdapter = {
  id: 'squire',
  displayName: 'Squire',
  hostMatchers: [/(^|\.)getsquire\.com$/i],

  async scrape(rawUrl, opts) {
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    let status = 0;
    let html = '';
    try {
      ({ status, html } = await fetchHtmlLoose(url));
    } catch {
      /* treated as blocked below */
    }

    let extraPhotos: string[] = [];
    let usedApify = false;
    if (!html || isBlockedPage(status, html)) {
      if (!opts.apifyToken) {
        throw new ScrapeError("Squire doesn't let us read its pages directly. Tap “I don't have a link” and we'll find you on Google instead.");
      }
      const rendered = await runApifyWebScraper({ url, pageFunction: galleryPageFunction('', 1500, true), token: opts.apifyToken, label: 'squire', timeoutSec: 120 });
      usedApify = true;
      html = typeof rendered?.html === 'string' ? rendered.html : '';
      extraPhotos = cleanPhotoUrls(rendered?.photos);
      if (!html || isBlockedPage(200, html)) {
        throw new ScrapeError("Squire blocked us from reading that page. Tap “I don't have a link” and we'll find you on Google instead.");
      }
    }

    const shop = shopFromStructuredHtml(html);
    if (!shop) {
      throw new ScrapeError("Couldn't read shop details from that Squire page. Paste your public Squire booking link, or tap “I don't have a link”.");
    }
    shop.photos = [...shop.photos, ...extraPhotos];
    if (!usedApify && needsPhotoEnrichment(shop.photos.length)) {
      shop.photos.push(...(await apifyGalleryPhotos({ url, token: opts.apifyToken, label: 'squire-photos' })));
    }
    return finalize(shop, { services: 24 });
  },
};
