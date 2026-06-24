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
// fills or omits them.

import { fetchHtml, finalize } from './util.js';
import type { PlatformAdapter, ScrapedShop } from './types.js';
import { ScrapeError } from './types.js';

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#0*34;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// Read a <meta property|name="key" content="…"> value. Scopes the
// search to a single <meta> tag (so a missing key never lets the
// content capture run across tags and grab garbage), uses a backref to
// the opening quote so apostrophes inside the value (Dan's) don't
// truncate it, and handles either attribute order.
function metaContent(html: string, key: string): string {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyRe = new RegExp(`(?:property|name)=("|')${k}\\1`, 'i');
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!keyRe.test(tag)) continue;
    const m = tag.match(/\bcontent=("|')([\s\S]*?)\1/i);
    if (m) return decodeEntities(m[2]).trim();
  }
  return '';
}

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

  async scrape(url, _opts) {
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
    return finalize(shop);
  },
};
