// Vagaro adapter.
//
// Vagaro (vagaro.com/<slug>) is a client-rendered SPA — its bookable
// service menu, hours and reviews load from an AES-encrypted-id public
// API whose endpoints aren't reachable without the live app, so those
// can't be pulled instantly. BUT the booking page IS server-rendered
// with rich Open Graph + breadcrumb metadata, which gives the shop's
// name, city/state and a profile image from a plain GET — no browser or
// Apify run (verified across multiple shops).
//
//   og:title       → "<Shop Name> - <City ST> | Vagaro"
//   breadcrumb     → /listings/barber/<city>--<st>  (cleanest location)
//   og:description → shop blurb
//   og:image       → profile/cover image (a 340×340 thumbnail)
//
// Services, hours and reviews come back empty; the generator/renderer
// fills or omits them. Photos: og:image, plus the Apify gallery step when
// there are fewer than 6 (token only).

import { fetchHtml, finalize, metaContent, apifyGalleryPhotos, needsPhotoEnrichment } from './util.js';
import type { PlatformAdapter, ScrapedShop } from './types.js';
import { ScrapeError } from './types.js';

function titleCase(s: string): string {
  return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

// Location, in priority order: the breadcrumb slug (clean "city--st"),
// then the "City ST" tail of og:title.
function deriveLocation(html: string, titleLoc: string): string {
  const bc = html.match(/\/listings\/[a-z0-9-]+\/([a-z0-9-]+)/i);
  if (bc) {
    const parts = bc[1].split('--');
    const city = titleCase(parts[0] || '');
    const state = (parts[1] || '').toUpperCase();
    if (city) return state ? `${city}, ${state}` : city;
  }
  return titleLoc.replace(/\s+([A-Za-z]{2})$/, ', $1').trim();
}

export const vagaroAdapter: PlatformAdapter = {
  id: 'vagaro',
  displayName: 'Vagaro',
  hostMatchers: [/(^|\.)vagaro\.com$/i],

  async scrape(url, opts) {
    let html: string;
    try {
      ({ html } = await fetchHtml(/^https?:\/\//i.test(url) ? url : `https://${url}`));
    } catch {
      throw new ScrapeError('Could not reach Vagaro. Try again in a moment.');
    }

    let title = metaContent(html, 'og:title').replace(/\s*\|\s*Vagaro\s*$/i, '').trim();
    if (!title) {
      throw new ScrapeError(
        "Couldn't read that Vagaro page — make sure it's your public vagaro.com booking link.",
      );
    }
    // Split off the trailing "<City ST>" segment; shop names may contain
    // their own " - " so keep everything before the last separator.
    let shopName = title;
    let titleLoc = '';
    const parts = title.split(' - ');
    if (parts.length > 1) {
      titleLoc = (parts.pop() || '').trim();
      shopName = parts.join(' - ').trim();
    }

    const area = deriveLocation(html, titleLoc);
    const img = metaContent(html, 'og:image');

    const shop: ScrapedShop = {
      shopName,
      area,
      address: '',
      phone: '',
      description: metaContent(html, 'og:description') || '',
      hours: [],
      services: [],
      photos: img && /^https?:\/\//i.test(img) ? [img] : [],
      reviews: [],
    };
    // og:image is one 340x340 thumbnail. The gallery is drawn client-side, so with fewer than a handful of photos
    // the shared Apify gallery step (one run, only with a token) reads the rendered page.
    if (needsPhotoEnrichment(shop.photos.length)) {
      shop.photos.push(...(await apifyGalleryPhotos({ url, token: opts.apifyToken, label: 'vagaro' })));
    }
    return finalize(shop);
  },
};
