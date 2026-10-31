// Acuity Scheduling adapter.
//
// An Acuity page (app.acuityscheduling.com/schedule.php?owner=<id>, acuityscheduling.com/schedule/<key>,
// <name>.as.me) is a scheduling widget, but its HTML carries one inline `var BUSINESS = {...}` object with no login:
// business name + description, currency, the active appointment types (name, price, duration, category, description,
// image, private flag) and the calendars (staff) with their location text and photo. That is all Acuity publishes:
// no phone, no opening hours (availability is per calendar and loaded on demand), no reviews. The business logo is a
// logo, not a photo, so it is not used as one. Verified on a public page (tests/fixtures/acuity-business.html).
import { extractJsonAssignment, fetchHtml, finalize, metaContent, decodeEntities } from './util.js';
import { currencySymbol, normalizeDuration, normalizePrice } from '../scrapeNormalize.js';
import type { PlatformAdapter, ScrapedShop } from './types.js';
import { ScrapeError } from './types.js';

const squash = (s: unknown) => decodeEntities(String(s ?? '')).replace(/\s+/g, ' ').trim();
const https = (u: unknown): string => {
  const s = String(u ?? '').trim();
  if (!s) return '';
  return s.startsWith('//') ? `https:${s}` : s;
};

export const acuityAdapter: PlatformAdapter = {
  id: 'acuity',
  displayName: 'Acuity Scheduling',
  hostMatchers: [/(^|\.)acuityscheduling\.com$/i, /(^|\.)as\.me$/i],

  async scrape(rawUrl) {
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    let html: string;
    try {
      ({ html } = await fetchHtml(url));
    } catch {
      throw new ScrapeError("Couldn't open that Acuity page. Check the link opens in your browser and try again.");
    }

    const b = extractJsonAssignment(html, 'BUSINESS');
    const name = squash(b?.name) || squash(metaContent(html, 'og:title'));
    if (!name) {
      throw new ScrapeError("Couldn't read that Acuity page. Paste your public scheduling link (app.acuityscheduling.com/schedule.php?owner=… or yourname.as.me).");
    }

    const sym = currencySymbol(b?.currencyAbbreviation);
    const services: ScrapedShop['services'] = [];
    const photos: string[] = [];
    const types = b?.appointmentTypes && typeof b.appointmentTypes === 'object' ? b.appointmentTypes : {};
    for (const [category, list] of Object.entries<any>(types)) {
      for (const t of Array.isArray(list) ? list : []) {
        if (!t || t.private || t.active === false) continue;
        const title = squash(t.name);
        if (!title) continue;
        services.push({
          title: title.slice(0, 80),
          price: b?.hidePrice ? undefined : normalizePrice(t.price, sym) || undefined,
          duration: b?.hideDuration ? undefined : normalizeDuration(Number(t.duration)) || undefined,
          description: squash(t.description).slice(0, 240) || undefined,
          category: squash(category) || undefined,
        });
        if (t.image) photos.push(https(t.image));
      }
    }

    // Calendars are the people (or rooms) clients book with; "Any available" is not one.
    const staff: NonNullable<ScrapedShop['staff']> = [];
    let address = '';
    for (const [location, list] of Object.entries<any>(b?.calendars && typeof b.calendars === 'object' ? b.calendars : {})) {
      for (const c of Array.isArray(list) ? list : []) {
        if (!c || c.id === 'any' || !squash(c.name)) continue;
        staff.push({ name: squash(c.name), role: squash(c.description) || undefined, photo: https(c.image || c.thumbnail) || undefined });
        if (!address) address = squash(c.location || location);
      }
    }

    const shop: ScrapedShop = {
      shopName: name,
      area: '',
      address,
      phone: '',
      description: squash(String(b?.description ?? '').replace(/<[^>]*>/g, ' ')).slice(0, 1200),
      hours: [],
      staff,
      services,
      photos,
      reviews: [],
    };
    return finalize(shop, { services: 24 });
  },
};
