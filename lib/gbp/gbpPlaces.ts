// Google Places API (New) FAST PATH for the homepage importer.
//
// The Apify actor (lib/gbp/gbp.ts) literally browses Google Maps and
// takes 10-60s per import. This module asks Google's Places API for
// the SAME listing data (name, address, phone, website, hours, rating,
// reviews, 10 photos, categories) and answers in ~1s. It returns the
// exact same `GbpBusiness` shape, so api/import-business.ts maps it
// with the code it already had.
//
// Contract with the API routes:
//   - returns GbpBusiness / candidate[] on success
//   - returns null on "couldn't resolve → let Apify try"
//   - NEVER throws for a miss; the routes fall through to Apify
//
// Requires GOOGLE_PLACES_SERVER_KEY (server key, API-restricted to
// Places API (New), NO referrer lock). When it is absent, `placesKey()`
// returns '' and the routes skip this module entirely — Apify keeps
// working exactly as it did before this file existed.
//
// ── The AI-Barber-specific difference from PrimeHub ──────────────────
// PrimeHub builds photo URLs as `<base>/<photo.name>/media?key=<KEY>`
// and re-hosts the bytes to Vercel Blob. AI-Barber has NO Blob store
// and must not gain one, so a keyed URL would end up baked into a
// deployed customer site with the API key sitting in the query string.
//
// Instead every photo reference is resolved SERVER-SIDE to its final
// Google-hosted image URL (lh3/lh4/lh5.googleusercontent.com), which is
// unsigned and hot-linkable — the same kind of URL the Apify path has
// always returned and the same kind the live customer sites already
// use. The key travels only in the `X-Goog-Api-Key` REQUEST HEADER, so
// it is never in a URL at all, and every resolved URL is re-validated
// before it is returned (see `isSafePhotoUrl`).

import { extractSearchQuery } from './gbp.js';
import { resolveFinalUrl } from './util.js';
import type { GbpBusiness } from './types.js';

const PLACES_BASE = 'https://places.googleapis.com/v1';

// One lookup covers everything the Apify crawler returned.
const DETAIL_FIELDS = [
  'id',
  'displayName',
  'formattedAddress',
  'nationalPhoneNumber',
  'internationalPhoneNumber',
  'websiteUri',
  'regularOpeningHours.weekdayDescriptions',
  'rating',
  'userRatingCount',
  'reviews',
  'photos',
  'types',
  'primaryTypeDisplayName',
  'editorialSummary',
].join(',');

const SEARCH_FIELDS = DETAIL_FIELDS.split(',').map((f) => `places.${f}`).join(',');

// Candidate search is the cheap SKU on purpose: no reviews, no photos.
const CANDIDATE_FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.primaryTypeDisplayName',
  'places.rating',
  'places.userRatingCount',
].join(',');

const SHORT_HOSTS = /(^|\.)(maps\.app\.goo\.gl|share\.google|g\.co|goo\.gl|g\.page)$/i;

const GENERIC_TYPES = new Set([
  'point_of_interest', 'establishment', 'service', 'health', 'store', 'food',
]);

// Single place the key is read. Routes never touch process.env for it,
// never log it, never pass it to the client.
export function placesKey(): string {
  return process.env.GOOGLE_PLACES_SERVER_KEY || process.env.GOOGLE_PLACES_KEY || '';
}

function placesFetch(
  path: string,
  init: { method: 'GET' | 'POST'; key: string; fieldMask: string; body?: string },
): Promise<Response> {
  return fetch(`${PLACES_BASE}${path}`, {
    method: init.method,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': init.key,
      'X-Goog-FieldMask': init.fieldMask,
    },
    ...(init.body ? { body: init.body } : {}),
    signal: AbortSignal.timeout(9000),
  });
}

// ── photos ──────────────────────────────────────────────────────────

// Google serves listing photos from lh3/lh4/lh5/lh6.googleusercontent.com
// (and occasionally *.ggpht.com). Pinning the literal "lh3" host would
// silently drop most photos, so match the family.
const PHOTO_HOST = /^https:\/\/[a-z0-9-]+\.(?:googleusercontent|ggpht)\.com\//i;

// Photo resource names look like `places/<id>/photos/<ref>`. This is
// STRUCTURAL validation only — it blocks the things that could actually
// distort the request URL (extra path segments, query strings, fragments,
// traversal) without betting on a character alphabet for Google's photo
// reference that we cannot verify without a key. A stricter class that
// guessed wrong would reject every photo, which (via the zero-photo rule
// in scrapeViaPlaces) would silently disable the whole fast path.
const PHOTO_NAME = /^places\/[^/?#]+\/photos\/[^/?#]+$/;

// The security assertion. A URL only leaves this module if it is a
// Google image host AND carries no key material of any kind.
function isSafePhotoUrl(u: unknown, key: string): u is string {
  if (typeof u !== 'string' || !PHOTO_HOST.test(u)) return false;
  if (/[?&](key|api_?key)=/i.test(u)) return false;
  if (key && u.includes(key)) return false;
  return true;
}

// Resolve ONE photo reference to its final Google-hosted URL.
// 1) skipHttpRedirect=true → Places API (New) answers with JSON
//    { photoUri: "https://lh3.googleusercontent.com/..." }.
// 2) If that shape doesn't come back, re-request WITHOUT
//    skipHttpRedirect using redirect:'manual' and read `Location`,
//    which is the same URL. (Under Node/undici a manual redirect
//    exposes both the 302 status and its headers; the opaque-redirect
//    behaviour that hides them is browser-only.)
//
// NOTE: plain `fetch` here, not `placesFetch` — photo media is not a
// field-masked resource and sending X-Goog-FieldMask can 400 it.
// Budget: up to `timeoutMs` per ATTEMPT and there are two attempts, so
// a single stubborn photo can occupy ~2x timeoutMs. The batch-level
// deadline in resolvePhotos() is the real ceiling.
async function resolveOnePhoto(name: string, key: string, timeoutMs: number): Promise<string | null> {
  if (!PHOTO_NAME.test(name) || name.includes('..')) return null;
  const base = `${PLACES_BASE}/${name}/media?maxWidthPx=1200`;

  try {
    const r = await fetch(`${base}&skipHttpRedirect=true`, {
      headers: { 'X-Goog-Api-Key': key },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.ok) {
      const d = (await r.json().catch(() => null)) as { photoUri?: unknown } | null;
      if (isSafePhotoUrl(d?.photoUri, key)) return d!.photoUri as string;
    }
  } catch {
    /* fall through to the redirect probe */
  }

  try {
    const r = await fetch(base, {
      headers: { 'X-Goog-Api-Key': key },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const loc = r.headers.get('location');
    if (isSafePhotoUrl(loc, key)) return loc;
  } catch {
    /* give up on this photo */
  }

  return null;
}

// A resolved photo keeps BOTH halves: the URL we ship today and the raw
// Places photo resource name it came from. The ref is what lets a photo
// be re-resolved (or re-hosted) later without redoing the whole import.
export interface ResolvedPhoto {
  url: string;
  ref: string;
}

// ── THE PHOTO-HOSTING SEAM ──────────────────────────────────────────
// This is the ONE function that decides what photo URL a generated
// customer site actually gets. Today it is a pass-through: the resolved
// googleusercontent URL goes straight out, exactly like the Apify path
// has always done, and AI-Barber stays free of a Blob store.
//
// Photo-URL longevity is UNVERIFIED — Google's issue tracker carries
// reports that Places photo base URLs can expire. If imported images
// ever start 404-ing on live customer sites, THIS function is where
// re-hosting goes (upload the bytes somewhere durable, return the new
// URLs). `ResolvedPhoto.ref` is carried through precisely so that can be
// done from the stored refs without re-importing. Nothing else in the
// importer needs to change.
export function hostPhotos(photos: ResolvedPhoto[]): string[] {
  return photos.map((p) => p.url);
}

// Resolve up to 10 photos concurrently. Each photo self-catches, so one
// failure can never take the batch down, and whatever has landed when
// the overall deadline fires is what we ship.
async function resolvePhotos(
  names: string[],
  key: string,
  opts: { perPhotoMs?: number; deadlineMs?: number } = {},
): Promise<ResolvedPhoto[]> {
  const perPhotoMs = opts.perPhotoMs ?? 6_000;
  const deadlineMs = opts.deadlineMs ?? 15_000;
  const wanted = names.slice(0, 10);
  if (!wanted.length) return [];

  const out: (ResolvedPhoto | null)[] = new Array(wanted.length).fill(null);
  const tasks = wanted.map((n, i) =>
    resolveOnePhoto(n, key, perPhotoMs)
      .then((u) => { if (u) out[i] = { url: u, ref: n }; })
      .catch(() => { /* dropped, never fatal */ }),
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => { timer = setTimeout(resolve, deadlineMs); });
  try {
    await Promise.race([Promise.all(tasks), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }

  return out.filter((p): p is ResolvedPhoto => !!p);
}

// ── field mapping ───────────────────────────────────────────────────

// "728 Franklin Ave, Brooklyn, NY 11238, USA" → "Brooklyn, NY"
function locationFromAddress(formatted: string): string {
  const parts = formatted.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return formatted;
  const tail = parts[parts.length - 1];
  const hasCountry = !/\d/.test(tail);
  const stateZip = hasCountry ? parts[parts.length - 2] : parts[parts.length - 1];
  const city = hasCountry ? parts[parts.length - 3] : parts[parts.length - 2];
  const state = stateZip.split(/\s+/)[0] || '';
  return [city, state].filter(Boolean).join(', ') || formatted;
}

const RANGE_SEP = /\s*(?:–|—|-|\bto\b)\s*/i;

// import-business.ts's splitHours() wants ONE "open – close" pair per
// day. Google can send a split shift ("9:00 AM – 12:00 PM, 1:00 – 5:00
// PM"); collapse it to opening → final closing rather than letting the
// splitter render "12:00 PM, 1:00 – 5:00 PM" as a closing time.
function collapseRanges(value: string): string {
  const segs = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (segs.length < 2) return value;
  const first = segs[0].split(RANGE_SEP);
  const last = segs[segs.length - 1].split(RANGE_SEP);
  if (first.length < 2 || last.length < 2) return value;
  const open = first[0].trim();
  const close = last[last.length - 1].trim();
  return open && close ? `${open} – ${close}` : value;
}

// "Monday: 10:00 AM – 8:00 PM" → { day, hours, closed }
function hoursFromWeekdayDescriptions(desc: unknown): { day: string; hours: string; closed?: boolean }[] {
  if (!Array.isArray(desc)) return [];
  return desc
    .map((line) => {
      const m = String(line).match(/^([^:]+):\s*(.+)$/);
      if (!m) return null;
      const value = m[2].trim();
      return {
        day: m[1].trim(),
        hours: /closed/i.test(value) ? 'Closed' : collapseRanges(value),
        closed: /closed/i.test(value),
      };
    })
    .filter((h): h is { day: string; hours: string; closed: boolean } => !!h);
}

// barber_shop → "Barber shop"
function humaniseType(t: string): string {
  const s = t.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── lookup ──────────────────────────────────────────────────────────

async function lookupPlace(rawUrl: string, key: string): Promise<any | null> {
  // Resolve short links (share.google, maps.app.goo.gl, g.page…) to the
  // canonical maps URL. Full google.com URLs skip the round trip.
  const cleanedRaw = rawUrl.replace(/\/review\/?(\?.*)?$/i, '');
  let resolved = cleanedRaw;
  try {
    const host = new URL(/^https?:\/\//i.test(cleanedRaw) ? cleanedRaw : `https://${cleanedRaw}`).hostname;
    if (SHORT_HOSTS.test(host)) resolved = await resolveFinalUrl(cleanedRaw);
  } catch {
    /* fall through with the raw string */
  }

  // App-bound share.google codes are a dead end for Places too. Return
  // null rather than throwing: gbp.ts detects the SAME pattern and
  // throws its own user-facing ScrapeError BEFORE it spends an Apify
  // run, so the fallback costs nothing and there is exactly one copy of
  // that message in the codebase.
  if (/share\.google\/error/i.test(resolved) || /google\.[a-z.]+\/share\.google/i.test(resolved)) {
    return null;
  }

  // place_id URLs (?q=place_id:XXXX) → direct details lookup. This is
  // what the "pick your listing" buttons send.
  const pidMatch = resolved.match(/place_id:([A-Za-z0-9_-]{10,})/);
  if (pidMatch) {
    const r = await placesFetch(`/places/${encodeURIComponent(pidMatch[1])}`, {
      method: 'GET',
      key,
      fieldMask: DETAIL_FIELDS,
    });
    if (r.ok) return r.json();
    console.warn('[GBP Places] details lookup failed', r.status);
    return null;
  }

  // Everything else → text query (same extraction the Apify path uses,
  // so typed "Name, City" strings work identically).
  const query = extractSearchQuery(resolved) || (!/^https?:\/\//i.test(cleanedRaw) ? cleanedRaw.trim() : null);
  if (!query || query.length < 2) return null;

  const r = await placesFetch('/places:searchText', {
    method: 'POST',
    key,
    fieldMask: SEARCH_FIELDS,
    body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
  });
  if (!r.ok) {
    console.warn('[GBP Places] searchText failed', r.status);
    return null;
  }
  const d: any = await r.json();
  return d?.places?.[0] || null;
}

// Full listing import. Returns null for "no match / not usable →
// let Apify try". Never throws for a miss.
export async function scrapeViaPlaces(rawUrl: string, key: string): Promise<GbpBusiness | null> {
  let place: any = null;
  try {
    place = await lookupPlace(rawUrl, key);
  } catch (e: any) {
    console.warn('[GBP Places] lookup error, falling back to Apify:', e?.message || e);
    return null;
  }
  if (!place?.displayName?.text) return null;

  const companyName = String(place.displayName.text);

  const photoNames = ((place.photos || []) as any[])
    .map((p) => (typeof p?.name === 'string' ? p.name : ''))
    .filter(Boolean)
    .slice(0, 10);
  const resolved = await resolvePhotos(photoNames, key);
  const photos = hostPhotos(resolved);

  // Deliberate: a listing that HAS photos but whose photos all failed to
  // resolve would generate an image-less site — worse than a slow one.
  // Hand it to Apify instead. A listing with genuinely no photos is a
  // fine Places success; Apify would find none either.
  if (photoNames.length > 0 && photos.length === 0) {
    console.warn('[GBP Places] all photos failed to resolve, falling back to Apify');
    return null;
  }

  const categories = [
    place.primaryTypeDisplayName?.text,
    ...((place.types || []) as string[]).filter((t) => !GENERIC_TYPES.has(t)).map(humaniseType),
  ].filter((c): c is string => typeof c === 'string' && c.length > 0);

  return {
    source: 'gbp',
    companyName,
    location: locationFromAddress(String(place.formattedAddress || '')),
    address: String(place.formattedAddress || ''),
    phone: String(place.nationalPhoneNumber || place.internationalPhoneNumber || ''),
    description: String(place.editorialSummary?.text || ''),
    website: String(place.websiteUri || ''),
    // Google listings never carry a booking link we can trust as the
    // shop's own booking page — same as the Apify path's contract.
    bookingUrl: '',
    aggregateRating: typeof place.rating === 'number'
      ? { rating: place.rating, count: Number(place.userRatingCount) || 0 }
      : undefined,
    hours: hoursFromWeekdayDescriptions(place.regularOpeningHours?.weekdayDescriptions),
    categories,
    photos,
    // Raw Places refs, parallel to `photos`. Surfaced by the API route as
    // `_photoRefs` metadata so a photo can be re-resolved later.
    photoRefs: resolved.map((p) => p.ref),
    reviews: ((place.reviews || []) as any[])
      .map((r) => ({
        author: String(r?.authorAttribution?.displayName || 'Customer'),
        rating: Math.max(1, Math.min(5, Math.round(Number(r?.rating) || 5))),
        comment: String(r?.text?.text || ''),
        date: String(r?.publishTime || ''),
      }))
      // Testimonials section — only ship reviews worth showing off.
      .filter((r) => r.comment && r.rating >= 4)
      .slice(0, 5),
  };
}

export interface GbpCandidate {
  title: string;
  address: string;
  category: string;
  placeId: string;
  rating: number | null;
  reviews: number | null;
}

// Search-only candidates for /api/find-business — the same shape the
// Apify search pass returns, in ~500ms instead of 10-20s.
export async function findCandidatesViaPlaces(
  query: string,
  near: string | undefined,
  key: string,
): Promise<GbpCandidate[] | null> {
  const textQuery = query.includes(',') || !near ? query : `${query} in ${near}`;
  let r: Response;
  try {
    r = await placesFetch('/places:searchText', {
      method: 'POST',
      key,
      fieldMask: CANDIDATE_FIELDS,
      body: JSON.stringify({ textQuery, maxResultCount: 6 }),
    });
  } catch (e: any) {
    console.warn('[FindBiz Places] request failed:', e?.message || e);
    return null;
  }
  if (!r.ok) {
    console.warn('[FindBiz Places] searchText failed', r.status);
    return null;
  }
  const d: any = await r.json().catch(() => null);
  const candidates = ((d?.places || []) as any[])
    .filter((p) => p?.displayName?.text && p?.id)
    .slice(0, 6)
    .map((p) => ({
      title: String(p.displayName.text),
      address: String(p.formattedAddress || ''),
      category: String(p.primaryTypeDisplayName?.text || ''),
      placeId: String(p.id),
      rating: typeof p.rating === 'number' ? p.rating : null,
      reviews: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
    }));
  return candidates.length ? candidates : null;
}
