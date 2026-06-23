// theCut adapter.
//
// theCut (thecut.co) is a pure client-rendered SPA — its public profile
// page only shows the barber's name + city, so there's no JSON-LD/OG to
// scrape. BUT theCut's own public API returns the COMPLETE profile
// (services, hours, address, bio, rating, photo) for any barber, gated
// only by a static HTTP Basic client credential shipped in their web app:
//
//   GET https://api.thecut.co/v2/barbers/<id>      (Authorization: Basic …)
//
// where <id> is the username or Mongo id from the booking link:
//   book.thecut.co/<id> · app.thecut.co/barbers/<id> · search.thecut.co/barbers/<id>
//
// A plain server-side GET with the Basic header returns the JSON — no
// browser, signature, or Apify run. Verified across multiple barbers.
//
// Fragility note: if theCut rotates the client credential or adds an
// origin check, only THECUT_BASIC below needs updating.

import { finalize } from './util.js';
import type { PlatformAdapter, ScrapedShop } from './types.js';
import { ScrapeError } from './types.js';

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const API_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// Static client credential from theCut's public web app. "<id>:<secret>".
const THECUT_BASIC = '812c5cd6-4244-4279-a62d-f784a6113617:d77d8f44-e1c5-4126-9bb7-041fe45754e2';

// Pull the barber id/username out of any theCut link (or a pasted blob).
function extractBarberId(rawInput: string): string | null {
  const text = (rawInput || '').trim();
  const explicit = text.match(/https?:\/\/[^\s<>"'\])]+/i);
  const bare = text.match(/(?:[\w-]+\.)*thecut\.co(?:\/[^\s<>"'\])]*)?/i);
  const rawUrl = explicit ? explicit[0] : bare ? bare[0] : text;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    return null;
  }
  const segs = u.pathname.split('/').filter(Boolean);
  const bi = segs.indexOf('barbers');
  if (bi !== -1 && segs[bi + 1]) return decodeURIComponent(segs[bi + 1]);
  if (segs.length >= 1) return decodeURIComponent(segs[0]);
  return null;
}

// theCut ships hours as minutes-since-midnight. 420 → "7 AM", 1140 → "7 PM".
function minutesTo12h(min: number): string {
  if (!Number.isFinite(min)) return '';
  let h = Math.floor(min / 60);
  const m = min % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h} ${period}` : `${h}:${String(m).padStart(2, '0')} ${period}`;
}

function buildHours(apiHours: any): ScrapedShop['hours'] {
  if (!apiHours || typeof apiHours !== 'object') return [];
  let any = false;
  const out = DAY_ORDER.map((day, i) => {
    const ranges = apiHours[API_DAYS[i]];
    if (Array.isArray(ranges) && ranges.length) {
      any = true;
      // ScrapedShop has a single open/close per day — span the first
      // range's start to the last range's end.
      const open = minutesTo12h(Number(ranges[0]?.start));
      const close = minutesTo12h(Number(ranges[ranges.length - 1]?.end));
      return { day, open, close };
    }
    return { day, open: '', close: '', closed: true };
  });
  return any ? out : [];
}

export const theCutAdapter: PlatformAdapter = {
  id: 'thecut',
  displayName: 'theCut',
  // Covers book./app./search./www. and bare thecut.co.
  hostMatchers: [/(^|\.)thecut\.co$/i],

  async scrape(url, _opts) {
    const id = extractBarberId(url);
    if (!id) {
      throw new ScrapeError(
        "That doesn't look like a theCut link. Paste your book.thecut.co/your-name or app.thecut.co/barbers/your-name link.",
      );
    }

    const api = `https://api.thecut.co/v2/barbers/${encodeURIComponent(id)}`;
    let resp: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      resp = await fetch(api, {
        headers: {
          authorization: 'Basic ' + Buffer.from(THECUT_BASIC).toString('base64'),
          accept: 'application/json',
          'user-agent': 'Mozilla/5.0',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch {
      throw new ScrapeError('Could not reach theCut. Try again in a moment.');
    }

    if (resp.status === 404) throw new ScrapeError("We couldn't find that theCut barber — double-check the link.");
    if (!resp.ok) throw new ScrapeError("theCut didn't return your profile. Try again in a moment.");

    const b: any = await resp.json().catch(() => null);
    if (!b || !b.name) throw new ScrapeError("theCut didn't return a usable profile.");

    const addr = b.address || {};
    const city = String(addr.city || '').trim();
    const region = String(addr.region || '').trim();
    const area = [city, region].filter(Boolean).join(', ');
    const address =
      [addr.title, addr.line1, addr.line2, [city, region].filter(Boolean).join(', '), addr.postalCode]
        .map((s: any) => String(s || '').trim())
        .filter(Boolean)
        .join(', ');

    const services = Array.isArray(b.services)
      ? b.services
          .map((s: any) => ({
            title: String(s?.name || '').trim(),
            price: s?.price != null && s?.price !== '' ? `$${s.price}` : undefined,
            duration: s?.duration ? `${s.duration} min` : undefined,
            description: s?.description ? String(s.description).trim() : undefined,
          }))
          .filter((s: any) => s.title)
      : [];

    const pic = String(b.profilePictureUrl || '').trim();
    const photos = pic ? [pic] : [];

    const rating = Number(b.starRating);
    const count = Number(b.reviewCount);
    const aggregateRating =
      Number.isFinite(rating) && rating > 0
        ? { rating: Math.round(rating * 10) / 10, count: Number.isFinite(count) ? count : 0 }
        : undefined;

    const shop: ScrapedShop = {
      shopName: String(b.name).trim(),
      area,
      address,
      phone: '',
      description: b.bio ? String(b.bio).trim() : '',
      hours: buildHours(b.hours),
      aggregateRating,
      services,
      photos,
      reviews: [],
    };

    return finalize(shop, { services: 24 });
  },
};
