// StyleSeat adapter.
//
// StyleSeat (styleseat.com) is a client-rendered SPA with almost nothing
// in its server HTML. BUT StyleSeat's own public provider API returns
// the pro's core profile with no auth at all:
//
//   GET https://www.styleseat.com/api/v2/providers/<username>
//
// where <username> is the vanity segment from any StyleSeat link form:
//   styleseat.com/m/v/<u> · styleseat.com/v/<u> · styleseat.com/m/<u>
//   · styleseat.com/<u> (optionally with a trailing /booking or query).
//
// That JSON gives name, bio, phone, rating, profile photo and the shop's
// location instantly — a plain server-side GET, no browser or Apify run
// (verified across multiple pros). The service menu, hours and reviews
// sit behind an OAuth-gated endpoint (401), so those come back empty and
// the generator/renderer fills or omits them.

import { finalize } from './util.js';
import type { PlatformAdapter, ScrapedShop } from './types.js';
import { ScrapeError } from './types.js';

// "7187818305" → "(718) 781-8305"; leaves anything non-standard as-is.
function formatPhone(raw: unknown): string {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return String(raw || '').trim();
}

// Pull the vanity username out of any StyleSeat link form (or pasted
// share text). Skips StyleSeat's structural path segments (/m/, /v/, …).
function extractUsername(rawInput: string): string | null {
  const text = (rawInput || '').trim();
  const explicit = text.match(/https?:\/\/[^\s<>"'\])]+/i);
  const bare = text.match(/(?:[\w-]+\.)*styleseat\.com(?:\/[^\s<>"'\])]*)?/i);
  const rawUrl = explicit ? explicit[0] : bare ? bare[0] : text;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    return null;
  }
  const segs = u.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  const skip = new Set(['m', 'v', 'pro', 'join', 'listings', 'explore', 'search', 'booking', 'book']);
  const vi = segs.indexOf('v');
  if (vi !== -1 && segs[vi + 1] && !skip.has(segs[vi + 1].toLowerCase())) return segs[vi + 1];
  for (const s of segs) {
    if (!skip.has(s.toLowerCase())) return s;
  }
  return null;
}

export const styleseatAdapter: PlatformAdapter = {
  id: 'styleseat',
  displayName: 'StyleSeat',
  hostMatchers: [/(^|\.)styleseat\.com$/i],

  async scrape(url, _opts) {
    const username = extractUsername(url);
    if (!username) {
      throw new ScrapeError(
        "That doesn't look like a StyleSeat link. Paste your styleseat.com/v/your-name profile link.",
      );
    }

    const api = `https://www.styleseat.com/api/v2/providers/${encodeURIComponent(username)}`;
    let resp: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      resp = await fetch(api, {
        headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' },
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch {
      throw new ScrapeError('Could not reach StyleSeat. Try again in a moment.');
    }

    if (resp.status === 404) throw new ScrapeError("We couldn't find that StyleSeat pro — double-check the link.");
    if (!resp.ok) throw new ScrapeError("StyleSeat didn't return that profile. Try again in a moment.");

    const d: any = await resp.json().catch(() => null);
    if (!d || !d.name) throw new ScrapeError("StyleSeat didn't return a usable profile — is the link public?");

    const loc: any = Array.isArray(d.locations) && d.locations[0] ? d.locations[0] : {};
    const city = String(loc.city || '').trim();
    const state = String(loc.state || '').trim();
    const area = [city, state].filter(Boolean).join(', ');
    const address =
      [loc.address1, loc.address2, [city, state].filter(Boolean).join(', '), loc.zipcode]
        .map((s: any) => String(s || '').trim())
        .filter(Boolean)
        .join(', ');

    // Prefer the location's business name ("Massivekutt barbershop")
    // over the pro's personal display name ("Massive") for the title.
    const shopName = String(loc.name || '').trim() || String(d.name).trim();

    const shop: ScrapedShop = {
      shopName,
      area,
      address,
      phone: formatPhone(d.public_phone_number || d.phone_number),
      description: d.blurb ? String(d.blurb).trim() : '',
      // StyleSeat ships a star rating but no public review count — omit
      // aggregateRating rather than render "from 0 reviews".
      hours: [],
      services: [],
      // No photo: the API `profile_photo` is a truncated, non-resolving
      // URL (404s for every pro) and the page og:image is just the
      // StyleSeat logo — so leave photos empty and let the owner upload.
      photos: [],
      reviews: [],
    };
    return finalize(shop);
  },
};
