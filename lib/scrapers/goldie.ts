// Goldie adapter (book.heygoldie.com — formerly Appointfix).
//
// Goldie booking pages are a Next.js app that server-renders the FULL
// business record into the page's __NEXT_DATA__ blob. A plain server-side
// GET returns everything we need — name, description, services + prices,
// hours, photos — with no API key, browser, or Apify run.
//
// Data lives under props.pageProps.fallback, keyed by SWR cache keys:
//   @"/book/business","<slug>",      → name, description, contact, businessHours, photos
//   @"/book/services","<businessId>" → services (price in cents, duration in min)
//   @"/book/portfolio","<businessId>"→ gallery photos
//
// Fragility note: if Goldie stops embedding __NEXT_DATA__, parseNextData
// would need updating — the field mapping below stays the same.

import { finalize } from './util.js';
import type { PlatformAdapter, ScrapedShop } from './types.js';
import { ScrapeError } from './types.js';

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEEK_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// Minimal HTML-entity decode for the handful that show up in Goldie copy.
function decodeEntities(s: string): string {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// cents → "$80" / "$125.50". Returns undefined for 0/empty (free/variable).
function formatPrice(cents: unknown): string | undefined {
  const n = Number(cents);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return `$${(n / 100).toFixed(2).replace(/\.00$/, '')}`;
}

// Pull the booking-link slug out of any heygoldie.com URL or pasted blob.
function extractSlug(rawInput: string): string | null {
  const text = (rawInput || '').trim();
  const explicit = text.match(/https?:\/\/[^\s<>"'\])]+/i);
  const bare = text.match(/(?:[\w-]+\.)*heygoldie\.com(?:\/[^\s<>"'\])]*)?/i);
  const rawUrl = explicit ? explicit[0] : bare ? bare[0] : text;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    return null;
  }
  if (!/(^|\.)heygoldie\.com$/i.test(u.hostname)) return null;
  const segs = u.pathname.split('/').filter(Boolean);
  return segs.length ? decodeURIComponent(segs[0]) : null;
}

// Goldie week schedule → ScrapedShop hours ({ day, open, close, closed }).
// Intervals ship as 24h "HH:MM" strings; the renderer formats to 12h.
function buildHours(weekSchedule: any): ScrapedShop['hours'] {
  if (!weekSchedule || typeof weekSchedule !== 'object') return [];
  let any = false;
  const out = DAY_ORDER.map((day, i) => {
    const d = weekSchedule[WEEK_KEYS[i]];
    const intervals = Array.isArray(d?.intervals) ? d.intervals : [];
    if (d?.enabled && intervals.length) {
      any = true;
      const open = String(intervals[0]?.start || '').trim();
      const close = String(intervals[intervals.length - 1]?.end || '').trim();
      return { day, open, close };
    }
    return { day, open: '', close: '', closed: true };
  });
  return any ? out : [];
}

function parseNextData(html: string): any {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

export const goldieAdapter: PlatformAdapter = {
  id: 'goldie',
  displayName: 'Goldie',
  hostMatchers: [/(^|\.)heygoldie\.com$/i],

  async scrape(url, _opts) {
    const slug = extractSlug(url);
    if (!slug) {
      throw new ScrapeError(
        "That doesn't look like a Goldie link. Paste your book.heygoldie.com/your-name profile link.",
      );
    }

    const pageUrl = `https://book.heygoldie.com/${encodeURIComponent(slug)}`;
    let html: string;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      const resp = await fetch(pageUrl, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          accept: 'text/html',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (resp.status === 404) throw new ScrapeError("We couldn't find that Goldie business — double-check the link.");
      if (!resp.ok) throw new ScrapeError("Goldie didn't return your page. Try again in a moment.");
      html = await resp.text();
    } catch (e) {
      if (e instanceof ScrapeError) throw e;
      throw new ScrapeError('Could not reach Goldie. Try again in a moment.');
    }

    const next = parseNextData(html);
    const fallback = next?.props?.pageProps?.fallback;
    if (!fallback || typeof fallback !== 'object') {
      throw new ScrapeError("Goldie didn't return a usable profile.");
    }

    const keys = Object.keys(fallback);
    const biz = fallback[keys.find((k) => k.includes('/book/business')) || ''];
    if (!biz || !biz.name) {
      throw new ScrapeError("Goldie didn't return a usable profile.");
    }
    const svcMap = fallback[keys.find((k) => k.includes('/book/services')) || ''] || {};
    const portMap = fallback[keys.find((k) => k.includes('/book/portfolio')) || ''] || {};

    const contact = biz.contact || {};
    const area = [contact.city, contact.region]
      .map((s: any) => String(s || '').trim())
      .filter(Boolean)
      .join(', ');

    const services = Object.values(svcMap)
      .map((s: any) => ({
        title: decodeEntities(s?.name || ''),
        price: formatPrice(s?.price),
        duration: s?.duration ? `${s.duration} min` : undefined,
        description: s?.description ? decodeEntities(s.description) : undefined,
      }))
      .filter((s: any) => s.title);

    // Hero/cover first, then portfolio shots for the gallery.
    const photos: string[] = [];
    const cover = biz.photos?.coverPresignedUrl || biz.photos?.photoPresignedUrl;
    if (cover) photos.push(String(cover));
    for (const p of Object.values(portMap) as any[]) {
      if (p?.src) photos.push(String(p.src));
    }

    const shop: ScrapedShop = {
      shopName: decodeEntities(biz.name),
      area,
      address: '',
      phone: '',
      description: biz.description ? decodeEntities(biz.description) : '',
      hours: buildHours(biz.businessHours?.weekSchedule),
      services,
      photos,
      reviews: [],
    };

    return finalize(shop, { services: 24 });
  },
};
