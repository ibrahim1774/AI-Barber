// Cross-source enrichment: after a booking-page adapter ran, fill the fields the page did not have (opening hours,
// phone, address, rating) from the business's Google listing, using the SAME Places lookup the "Find me on Google"
// flow uses (lib/gbp/gbpPlaces.ts). Rules:
//   - ONLY empty fields are filled; anything the booking page gave is never touched.
//   - A Google match is accepted only when it is clearly the same business (see matchPlace); otherwise nothing
//     is filled. Ambiguous or wrong-business results are dropped, never guessed.
//   - Photos are NOT taken from Google: listing photos include customer uploads and street view, and the sites'
//     "your own photos" wording only holds for booking-page photos (photosAreFromBookingPage in lib/render/honest.ts).
//   - At most ONE lookup per import; any error or timeout leaves the shop exactly as the adapter returned it.
//   - What came from Google is recorded in `shop.enriched` (field -> 'google') so nothing is passed off as scraped.
// COST: one Places Text Search per import, only when something above was missing, and only when a key is configured.
import { normalizeHours, toHHMM } from '../scrapeNormalize.js';
import type { ScrapedShop } from './types.js';

export interface PlaceCandidate {
  name: string;
  address: string;
  phone: string;
  rating?: number;
  ratingCount?: number;
  hours: { day: string; hours: string; closed?: boolean }[];
}

export type PlaceLookup = (query: string) => Promise<PlaceCandidate[] | null>;

const GENERIC_WORDS = new Set([
  'the', 'and', 'of', 'barber', 'barbers', 'barbershop', 'barbershops', 'shop', 'shops', 'salon', 'salons', 'studio',
  'studios', 'cuts', 'cut', 'hair', 'llc', 'inc', 'co', 'company', 'lounge', 'parlor', 'parlour', 'spa',
]);

/** "Tony's Barber Shop, LLC" -> "tonys" ; lower-case, no accents/punctuation, generic trade words dropped. */
export function normalizeName(raw: string, dropGeneric = true): string {
  const base = String(raw || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const words = base.split(' ').filter(Boolean);
  if (!dropGeneric) return words.join(' ');
  const kept = words.filter((w) => !GENERIC_WORDS.has(w));
  return (kept.length ? kept : words).join(' ');
}

function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

function nameMatches(scraped: string, candidate: string): 'exact' | 'close' | null {
  const a = normalizeName(scraped);
  const b = normalizeName(candidate);
  if (!a || !b) return null;
  if (a === b) return 'exact';
  return levenshteinRatio(a, b) >= 0.92 ? 'close' : null;
}

const zipOf = (s: string): string => (s.match(/\b(\d{5})(?:-\d{4})?\b/) || [])[1] || '';

// "728 Franklin Ave" -> "728 franklin"; the house number plus the first street word.
function streetKey(s: string): string {
  const m = s.toLowerCase().match(/\b(\d{1,6})\s+([a-z]+)/);
  return m ? `${m[1]} ${m[2]}` : '';
}

function locationMatches(shop: Pick<ScrapedShop, 'address' | 'area'>, cand: PlaceCandidate): boolean {
  const addr = `${shop.address || ''}`;
  const zip = zipOf(addr);
  if (zip && zip === zipOf(cand.address)) return true;
  const street = streetKey(addr);
  if (street && street === streetKey(cand.address)) return true;
  // City: the scrape's area ("Brooklyn, NY") or the address's city part must equal a comma segment of Google's address.
  const city = String(shop.area || '').split(',')[0].trim().toLowerCase();
  if (city.length >= 3) {
    const segs = cand.address.split(',').map((x) => x.trim().toLowerCase());
    if (segs.includes(city)) return true;
  }
  return false;
}

export type MatchResult = { ok: true; place: PlaceCandidate } | { ok: false; reason: 'none' | 'ambiguous' | 'no-name' };

/**
 * The one candidate that is clearly this business, or why none. With an address/area on the scrape: name equal
 * (after normalising) or >= 92% similar, AND the same zip / street / city. Without: exact normalised name only.
 * More than one passing candidate (two branches) is "ambiguous" and fills nothing.
 */
export function matchPlace(shop: Pick<ScrapedShop, 'shopName' | 'address' | 'area'>, cands: PlaceCandidate[]): MatchResult {
  if (!normalizeName(shop.shopName)) return { ok: false, reason: 'no-name' };
  const hasLocation = !!(String(shop.address || '').trim() || String(shop.area || '').trim());
  const passing = cands.filter((c) => {
    const n = nameMatches(shop.shopName, c.name);
    if (!n) return false;
    if (hasLocation) return locationMatches(shop, c);
    return n === 'exact';
  });
  if (passing.length === 1) return { ok: true, place: passing[0] };
  return { ok: false, reason: passing.length ? 'ambiguous' : 'none' };
}

const RANGE_SEP = /\s*(?:–|—|-|\bto\b)\s*/i;

/** Google's weekday lines ("10:00 AM – 8:00 PM", "Closed", "Open 24 hours") as 24-hour HH:MM rows. */
export function hoursFromGoogle(rows: PlaceCandidate['hours']): NonNullable<ScrapedShop['hours']> {
  const raw = rows.map((r) => {
    const text = String(r.hours || '').replace(/\s+/g, ' ').trim();
    if (r.closed || /^closed$/i.test(text)) return { day: r.day, open: '', close: '', closed: true };
    if (/24 hours/i.test(text)) return { day: r.day, open: '00:00', close: '23:59' };
    const [open, close] = text.split(RANGE_SEP);
    // "9 – 5 PM": the opening time has no AM/PM; it must be the one that is before the closing time.
    const c = toHHMM(close);
    let o = toHHMM(open);
    if (open && !/[ap]\.?m/i.test(open) && /[ap]\.?m/i.test(close || '') && /^\d{1,2}(:\d{2})?$/.test(open.trim())) {
      // The opening time must come before the closing one: try the closing period first, then the other.
      const period = (close.match(/[ap]\.?m/i)?.[0] || '').toLowerCase().startsWith('p') ? ['PM', 'AM'] : ['AM', 'PM'];
      o = period.map((x) => toHHMM(`${open.trim()} ${x}`)).find((t) => /^\d{2}:\d{2}$/.test(t) && t < c) || '';
    }
    return { day: r.day, open: o, close: c };
  });
  // Rows whose times are not clock times (unparsed) are dropped rather than kept as text.
  const clock = /^\d{2}:\d{2}$/;
  return normalizeHours(raw.filter((r) => r.closed || (clock.test(r.open) && clock.test(r.close))));
}

function hasHours(h: ScrapedShop['hours']): boolean {
  return Array.isArray(h) && h.some((r) => !r.closed);
}

export function needsEnrichment(shop: ScrapedShop): boolean {
  return !hasHours(shop.hours) || !shop.phone || !shop.address || !shop.aggregateRating;
}

const cityOnly = (formatted: string): string => {
  const parts = formatted.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return '';
  const last = parts[parts.length - 1];
  const hasCountry = !/\d/.test(last);
  const stateZip = hasCountry ? parts[parts.length - 2] : last;
  const city = hasCountry ? parts[parts.length - 3] : parts[parts.length - 2];
  return [city, (stateZip.split(/\s+/)[0] || '')].filter(Boolean).join(', ');
};

/**
 * Fill the empty fields of `shop` from the Google listing `lookup` finds. Never throws, never overrides, at most
 * one `lookup` call. `shop.enriched` names the fields that came from Google.
 */
export async function enrichFromGoogle(shop: ScrapedShop, lookup: PlaceLookup | null): Promise<ScrapedShop> {
  if (!lookup || !needsEnrichment(shop) || !normalizeName(shop.shopName)) return shop;
  try {
    const where = (shop.address || shop.area || '').trim();
    const cands = await lookup(where ? `${shop.shopName} ${where}` : shop.shopName);
    if (!cands || !cands.length) return shop;
    const m = matchPlace(shop, cands);
    if (!m.ok) {
      console.log(`[Enrich] no Google match used (${(m as { reason: string }).reason}) for "${shop.shopName}"`);
      return shop;
    }
    const p = (m as { place: PlaceCandidate }).place;
    const out: ScrapedShop = { ...shop };
    const enriched: NonNullable<ScrapedShop['enriched']> = {};
    if (!hasHours(shop.hours)) {
      const hours = hoursFromGoogle(p.hours);
      if (hasHours(hours)) { out.hours = hours; enriched.hours = 'google'; }
    }
    if (!shop.phone && p.phone.trim()) { out.phone = p.phone.trim(); enriched.phone = 'google'; }
    if (!shop.address && p.address.trim()) {
      out.address = p.address.replace(/,\s*(USA|United States)$/i, '').trim();
      enriched.address = 'google';
      if (!shop.area) { out.area = cityOnly(p.address); if (out.area) enriched.area = 'google'; }
    }
    if (!shop.aggregateRating && typeof p.rating === 'number' && p.rating > 0) {
      out.aggregateRating = { rating: Math.round(p.rating * 10) / 10, count: p.ratingCount || 0 };
      enriched.aggregateRating = 'google';
    }
    if (Object.keys(enriched).length) out.enriched = { ...(shop.enriched || {}), ...enriched };
    return out;
  } catch (e: any) {
    console.warn('[Enrich] lookup failed, import continues without it:', e?.message || e);
    return shop;
  }
}
