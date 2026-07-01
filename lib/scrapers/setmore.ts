// Setmore adapter (<slug>.setmore.com).
//
// Setmore booking pages are a Next.js app that server-renders the FULL
// business record into the page's __NEXT_DATA__ blob under
// props.pageProps.company. A plain server-side GET returns everything we
// need — name, address, services (title/price/duration/description),
// gallery photos, staff, hours, reviews — with no API key or browser.
//
// Fragility note: if Setmore stops embedding __NEXT_DATA__, parseNextData
// would need updating — the field mapping below stays the same.

import { finalize } from './util.js';
import type { PlatformAdapter, ScrapedShop } from './types.js';
import { ScrapeError } from './types.js';

// day index → name; Setmore ships openingHours with day 0 = Sunday.
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0]; // reorder to Mon-Sun for display

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$', CAD: '$', AUD: '$', NZD: '$', GBP: '£', EUR: '€', INR: '₹', ZAR: 'R',
};

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

function titleCase(s: unknown): string {
  return String(s || '').trim().replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function parseNextData(html: string): any {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function normalizeUrl(rawInput: string): string | null {
  const text = (rawInput || '').trim();
  const explicit = text.match(/https?:\/\/[^\s<>"'\])]+/i);
  const bare = text.match(/(?:[\w-]+\.)*setmore\.com(?:\/[^\s<>"'\])]*)?/i);
  const rawUrl = explicit ? explicit[0] : bare ? bare[0] : text;
  try {
    const u = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
    if (!/(^|\.)setmore\.com$/i.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export const setmoreAdapter: PlatformAdapter = {
  id: 'setmore',
  displayName: 'Setmore',
  hostMatchers: [/(^|\.)setmore\.com$/i],

  async scrape(url, _opts) {
    const pageUrl = normalizeUrl(url);
    if (!pageUrl) {
      throw new ScrapeError(
        "That doesn't look like a Setmore link. Paste your yourshop.setmore.com booking page link.",
      );
    }

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
      if (resp.status === 404) throw new ScrapeError("We couldn't find that Setmore business — double-check the link.");
      if (!resp.ok) throw new ScrapeError("Setmore didn't return your page. Try again in a moment.");
      html = await resp.text();
    } catch (e) {
      if (e instanceof ScrapeError) throw e;
      throw new ScrapeError('Could not reach Setmore. Try again in a moment.');
    }

    const next = parseNextData(html);
    const company = next?.props?.pageProps?.company;
    if (!company || !company.name) {
      throw new ScrapeError("Setmore didn't return a usable booking page.");
    }

    const sym = CURRENCY_SYMBOL[String(company.currencyCode || '').toUpperCase()] ?? '';
    // Setmore prices are already in major units (e.g. 31.05 = $31.05).
    const formatPrice = (n: unknown): string | undefined => {
      const x = Number(n);
      if (!Number.isFinite(x) || x <= 0) return undefined;
      return `${sym}${x.toFixed(2).replace(/\.00$/, '')}`;
    };

    const addr = company.address || {};
    const state = titleCase(addr.state);
    const area = [addr.city, state].map((s: any) => String(s || '').trim()).filter(Boolean).join(', ');
    const address = [addr.street, addr.city, state, addr.postalCode]
      .map((s: any) => String(s || '').trim())
      .filter(Boolean)
      .join(', ');

    const services = (Array.isArray(company.services) ? company.services : [])
      .map((s: any) => ({
        title: decodeEntities(s?.title || ''),
        price: formatPrice(s?.price),
        duration: s?.durationMins ? `${s.durationMins} min` : undefined,
        description: s?.description ? decodeEntities(s.description) : undefined,
      }))
      .filter((s: any) => s.title);

    // Gallery photos first, then service images to backfill the grid.
    const photos: string[] = [
      ...(Array.isArray(company.galleryImages) ? company.galleryImages : []).map((g: any) => g?.src).filter(Boolean),
      ...(Array.isArray(company.services) ? company.services : []).map((s: any) => s?.imageUrl).filter(Boolean),
    ].map(String);

    const staff = (Array.isArray(company.staff) ? company.staff : [])
      .map((s: any) => ({
        name: decodeEntities(s?.displayName || ''),
        role: s?.role ? String(s.role) : undefined,
        photo: s?.avatarUrl ? String(s.avatarUrl) : undefined,
      }))
      .filter((s: any) => s.name);

    // openingHours: [{ day: 0..6 (0=Sun), displayDay, isOpen, startDisplayTime, endDisplayTime }]
    const hoursByDay: Record<number, any> = {};
    for (const h of Array.isArray(company.openingHours) ? company.openingHours : []) {
      if (typeof h?.day === 'number') hoursByDay[h.day] = h;
    }
    const hours = MON_FIRST
      .map((d) => {
        const h = hoursByDay[d];
        if (!h) return null;
        return {
          day: DAY_NAME[d],
          open: h.isOpen ? String(h.startDisplayTime || '').trim() : '',
          close: h.isOpen ? String(h.endDisplayTime || '').trim() : '',
          closed: !h.isOpen,
        };
      })
      .filter(Boolean) as ScrapedShop['hours'];

    const meta = company.reviewsMeta || {};
    const aggregateRating =
      Number(meta.reviewCount) > 0
        ? { rating: Number(meta.averageRating) || 0, count: Number(meta.reviewCount) }
        : undefined;

    const reviews = (Array.isArray(company.reviews) ? company.reviews : [])
      .map((r: any) => ({
        author: decodeEntities(r?.customerName || r?.author || r?.name || 'Client'),
        rating: Number(r?.rating) || 5,
        comment: decodeEntities(r?.comment || r?.review || r?.description || ''),
        date: r?.date || r?.createdOn || undefined,
      }))
      .filter((r: any) => r.comment);

    const shop: ScrapedShop = {
      shopName: decodeEntities(company.name),
      area,
      address,
      phone: company.displayPhoneNumber ? String(company.displayPhoneNumber).trim() : '',
      description: company.aboutUs ? decodeEntities(company.aboutUs) : '',
      hours: hours && hours.length ? hours : [],
      aggregateRating,
      staff,
      services,
      photos,
      reviews,
    };

    return finalize(shop, { services: 24 });
  },
};
