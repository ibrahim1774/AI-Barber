// JSON-LD for the pages of a web-created pages-v2 multi-page site (Phase 1, step 3).
//
// What is emitted, and only from data the barber really gave us AND the page really shows:
//   Home, Location, Contact   one LocalBusiness node (HairSalon / NailSalon / LocalBusiness by niche)
//   each indexable service    a Service node (+ offer only for a real single numeric price) and a BreadcrumbList
//   every other page          nothing
// Never emitted, whatever the data holds: aggregateRating, review, AggregateOffer, FAQPage, priceRange, sameAs, hasMap,
// makesOffer. Thin (`noindex`) service pages get nothing. Every optional property goes through a strict whitelist (the
// spliceable gates plus the parsers below) and is OMITTED when the value does not pass: nothing is repaired or guessed.
//
// BarberShop is a real schema.org type, but its presence could not be verified offline when this was written, so a barber
// shop is typed HairSalon (a type every consumer knows). To change that, edit TYPE_BY_NICHE only.
//
// The JSON is embedded in a <script type="application/ld+json">: `<`, `>`, `&`, U+2028 and U+2029 are written as \u escapes,
// so no value can close the tag or start markup, and the output is deterministic (fixed key order, no clock, no random).
//
// Pure, no DOM, no Node.
import type { WebsiteData } from '../../types';
import { isStockImage } from '../stockImages.js';
import { displayPrice, nicheOf } from './honest.js';
import { isMoney, spliceable } from './spliceable.js';
import { plainText, type PageFile, type PageSet } from './pages.js';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type JsonNode = { [k: string]: JsonValue };

/** niche key -> schema.org type. Anything not listed is a plain LocalBusiness. */
export const TYPE_BY_NICHE: Readonly<Record<string, string>> = { barber: 'HairSalon', hair: 'HairSalon', nails: 'NailSalon' };
export const businessTypeOf = (d: Pick<WebsiteData, 'niche'>): string => TYPE_BY_NICHE[nicheOf(d).key] ?? 'LocalBusiness';

/** The pages that carry the business node. */
export const BUSINESS_PAGES: readonly string[] = ['home', 'location', 'contact'];

// ── Serialising ──
/** JSON that is safe inside <script type="application/ld+json">. */
export function jsonLdString(node: JsonValue): string {
  return JSON.stringify(node)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
export const jsonLdScript = (node: JsonValue): string => `<script type="application/ld+json">${jsonLdString(node)}</script>`;

// ── Whitelists ──
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2060\ufeff]/;
/** A shop, place or service name: the editor markers removed, spaces collapsed; null when empty, over the cap, holding a control character or no letter/digit. */
export function cleanName(v: unknown, max = 120): string | null {
  const s = plainText(v).replace(/[ \t\u00a0]+/g, ' ').trim();
  if (!s || s.length > max || CONTROL.test(s) || !/[\p{L}\p{N}]/u.test(s)) return null;
  return s;
}
/** An https URL of a photo the barber uploaded (never a sample photo); null otherwise. */
export function ownPhotoUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 1000 || /[\s"'<>\\]/.test(s) || CONTROL.test(s) || isStockImage(s)) return null;
  try { const u = new URL(s); return u.protocol === 'https:' && u.hostname.includes('.') ? s : null; } catch { return null; }
}

const COUNTRIES: Record<string, string> = { usa: 'US', 'u.s.a.': 'US', 'u.s.a': 'US', us: 'US', 'u.s.': 'US', 'united states': 'US', 'united states of america': 'US', canada: 'CA', mexico: 'MX', uk: 'GB', 'united kingdom': 'GB' };
const US_STATE_ZIP = /^([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/;

export interface ParsedAddress { node: JsonNode; us: boolean }
/** The street address as a PostalAddress. A value that is not a street address (a city, "Mobile - I come to you") gives null. */
export function parseAddress(raw: unknown): ParsedAddress | null {
  const v = spliceable('address', plainText(raw));
  if (v === null) return null;
  const parts = v.split(',').map((p) => p.trim()).filter(Boolean);
  let country: string | null = null;
  if (parts.length > 1 && COUNTRIES[parts[parts.length - 1].toLowerCase()]) country = COUNTRIES[parts.pop()!.toLowerCase()];
  const node: JsonNode = { '@type': 'PostalAddress' };
  let us = country === 'US';
  if (parts.length >= 3) {
    const last = parts[parts.length - 1];
    const locality = parts[parts.length - 2];
    const sz = US_STATE_ZIP.exec(last);
    if (!/\d/.test(locality) && (sz || (!/\d/.test(last) && last.length <= 30))) {
      node.streetAddress = parts.slice(0, -2).join(', ');
      node.addressLocality = locality;
      node.addressRegion = sz ? sz[1] : last;
      if (sz?.[2]) node.postalCode = sz[2];
      if (sz?.[2]) us = true;
    }
  }
  if (!node.streetAddress) node.streetAddress = parts.join(', ');
  if (country) node.addressCountry = country;
  return { node, us };
}

const DAYS: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const dayOf = (raw: unknown): string | null => {
  const s = plainText(raw).toLowerCase().replace(/\.$/, '');
  if (!/^(?:mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday|s)?$/.test(s)) return null;
  return DAYS[s.slice(0, 3)] ?? null;
};
/** "09:00", "9", "5:30 PM", "noon" -> minutes after midnight; null when it does not parse cleanly. */
export function minutesOf(raw: unknown): number | null {
  const s = plainText(raw).toLowerCase().replace(/\s+/g, ' ');
  if (s === 'noon') return 720;
  const m = /^(\d{1,2})(?::(\d{2}))?\s?(am|pm)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return null;
  if (m[3]) { if (h < 1 || h > 12) return null; h = (h % 12) + (m[3] === 'pm' ? 12 : 0); } else if (h > 23) return null;
  return h * 60 + min;
}
const hhmm = (mins: number): string => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/** Open rows that parse and run forward in one day; closed rows, bad days and bad times are left out. Exact duplicates once. */
export function openingHours(rows: unknown): JsonNode[] {
  const out: JsonNode[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== 'object' || (r as { closed?: unknown }).closed === true) continue;
    const day = dayOf((r as { day?: unknown }).day);
    const open = minutesOf((r as { open?: unknown }).open);
    const close = minutesOf((r as { close?: unknown }).close);
    if (!day || open === null || close === null || close <= open) continue;
    const key = `${day}|${open}|${close}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: day, opens: hhmm(open), closes: hhmm(close) });
  }
  return out;
}

/** Coordinates, when the site carries real ones (`geo: {lat, lng}`): in range, not 0/0, at most 7 decimals. The site model has no such field today, so this is normally null. */
export function geoOf(d: unknown): JsonNode | null {
  const g = (d as { geo?: { lat?: unknown; lng?: unknown } } | null)?.geo;
  if (!g || typeof g.lat !== 'number' || typeof g.lng !== 'number') return null;
  const { lat, lng } = g;
  const dec = (n: number): boolean => (String(n).split('.')[1] ?? '').length <= 7;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0) || !dec(lat) || !dec(lng)) return null;
  return { '@type': 'GeoCoordinates', latitude: lat, longitude: lng };
}

const SYMBOL_CURRENCY: Record<string, string> = { '£': 'GBP', '€': 'EUR' };
/** One real numeric price as an Offer. A range, "25+", "from $20", a price of zero, or a "$" on a shop not known to be in the US gives null. */
export function offerOf(rawPrice: unknown, usShop: boolean): JsonNode | null {
  const shown = displayPrice(typeof rawPrice === 'string' ? plainText(rawPrice) : '');
  const v = spliceable('price', shown);
  if (v === null || !isMoney(v)) return null;
  let amount: RegExpExecArray | null;
  let currency: string | null = null;
  if ((amount = /^([$£€])\s?(\d{1,5})(?:\.(\d{1,2}))?$/.exec(v))) currency = amount[1] === '$' ? (usShop ? 'USD' : null) : SYMBOL_CURRENCY[amount[1]];
  else if ((amount = /^(\d{1,5})(?:\.(\d{1,2}))?\s?(USD|CAD|GBP|EUR|MXN)$/i.exec(v))) currency = amount[3].toUpperCase();
  if (!amount || !currency) return null;
  const whole = /^[^\d]*(\d+)/.exec(v)![1];
  const cents = (/^[^\d]*\d+\.(\d{1,2})/.exec(v) ?? [])[1];
  const price = cents ? `${Number(whole)}.${cents}` : String(Number(whole));
  if (Number(price) <= 0) return null;
  return { '@type': 'Offer', price, priceCurrency: currency };
}

// ── The nodes ──
export interface JsonLdContext {
  d: WebsiteData;
  set: PageSet;
  /** https origin of the site (canonicalBase). Without one nothing is emitted: every @id and url is absolute. */
  base: string;
  /** The shop's real place ("Brooklyn, NY"), '' when it has none. */
  place: string;
  /** Services page title as printed, for the breadcrumb. */
  servicesTitle: string;
  /** Placeholder key -> real photo URL. */
  imageUrls: Record<string, string>;
  /** hrefs of the thin (noindex) service pages. */
  thin: ReadonlySet<string>;
}

const businessId = (base: string): string => `${base}/#business`;

/** The LocalBusiness node, or null when the shop has no usable name. */
export function businessNode(c: JsonLdContext): JsonNode | null {
  const { d, base } = c;
  const name = cleanName(d.shopName);
  if (!name) return null;
  const node: JsonNode = { '@type': businessTypeOf(d), '@id': businessId(base), name, url: `${base}/` };
  const phone = spliceable('phone', plainText(d.phone));
  if (phone) node.telephone = phone;
  const addr = parseAddress(d.contact?.address);
  if (addr) node.address = addr.node;
  const hours = openingHours(d.hours);
  if (hours.length) node.openingHoursSpecification = hours;
  const geo = geoOf(d);
  if (geo) node.geo = geo;
  const imgs: string[] = [];
  for (const k of ['hero', 'about', ...Object.keys(c.imageUrls).filter((x) => /^gallery\d+$/.test(x)).sort((a, b) => Number(a.slice(7)) - Number(b.slice(7)))]) {
    const u = ownPhotoUrl(c.imageUrls[k]);
    if (u && !imgs.includes(u)) imgs.push(u);
    if (imgs.length >= 4) break;
  }
  if (imgs.length) node.image = imgs;
  return { '@context': 'https://schema.org', ...node };
}

/** Service + BreadcrumbList for a service page, or null (thin page, no name, no base). */
export function serviceNodes(c: JsonLdContext, file: PageFile): JsonNode[] | null {
  if (file.key !== 'services' || !file.child || c.thin.has(file.href)) return null;
  const s = c.d.services?.[file.child.index];
  const name = cleanName(s?.title);
  const shop = cleanName(c.d.shopName);
  if (!s || !name || !shop) return null;
  const url = `${c.base}${file.href}`;
  const service: JsonNode = {
    '@type': 'Service', '@id': `${url}#service`, name, url,
    provider: { '@type': businessTypeOf(c.d), '@id': businessId(c.base), name: shop, url: `${c.base}/` },
  };
  const place = cleanName(c.place, 60);
  if (place) service.areaServed = place;
  const us = parseAddress(c.d.contact?.address)?.us ?? false;
  const offer = offerOf(s.price, us);
  if (offer) service.offers = offer;
  const crumbs: JsonNode[] = [{ '@type': 'ListItem', position: 1, name: 'Home', item: `${c.base}/` }];
  const svcPage = c.set.files.find((f) => f.key === 'services' && !f.child);
  if (svcPage) crumbs.push({ '@type': 'ListItem', position: crumbs.length + 1, name: cleanName(c.servicesTitle, 60) ?? 'Services', item: `${c.base}${svcPage.href}` });
  crumbs.push({ '@type': 'ListItem', position: crumbs.length + 1, name, item: url });
  return [service, { '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`, itemListElement: crumbs }];
}

/** The JSON-LD `<script>` for one page, or '' when the page gets none. */
export function jsonLdHtml(c: JsonLdContext, file: PageFile): string {
  if (!c.base) return '';
  if (BUSINESS_PAGES.includes(file.key) && !file.child) {
    const n = businessNode(c);
    return n ? jsonLdScript(n) : '';
  }
  const nodes = serviceNodes(c, file);
  return nodes ? jsonLdScript({ '@context': 'https://schema.org', '@graph': nodes }) : '';
}
