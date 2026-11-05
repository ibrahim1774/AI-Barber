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
// schema.org has no BarberShop (checked 2026-11-05: schema.org/BarberShop is a 404); HairSalon is the closest subtype, NailSalon
// the one for nails. To change a type, edit TYPE_BY_NICHE only.
//
// Rules that keep the markup honest:
//   - A property is emitted only when the page it sits on prints that content: the full node (hours, photos) is on Home only
//     (a photo only when Home prints its slot), Location adds hours only while its hours section is shown, Contact
//     carries name, url, phone and address.
//   - The business node needs an address (Google requires it): a shop without a street address gets NO business node.
//   - Owner text (shop name, service name, labels) goes through the spliceable whitelist or is omitted. areaServed comes from
//     the parsed address, never from free text.
//   - priceCurrency only when it is certain: an explicit ISO code, GBP for a pound sign, EUR for a euro sign, and USD/CAD for a
//     dollar sign only when the address names the US or Canada (or has a real state/province code plus its ZIP/postal code).
//     Anything else (Mexico, the UK, no country, an unknown country) leaves the offer out.
//
// The JSON is embedded in a <script type="application/ld+json">: `<`, `>`, `&`, U+2028 and U+2029 are written as \u escapes,
// so no value can close the tag or start markup, and the output is deterministic (fixed key order, no clock, no random).
//
// Pure, no DOM, no Node.
import type { WebsiteData } from '../../types';
import { isStockImage } from '../stockImages.js';
import { displayPrice, nicheOf, to12h } from './honest.js';
import { isMoney, spliceable } from './spliceable.js';
import { pageSectionsOf } from './sections.js';
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
/** A shop or service name as typed (editor markers removed): only when it passes the `name` whitelist, otherwise null (omit). Never repaired. */
export const nameOf = (v: unknown): string | null => spliceable('name', plainText(v));
/** A short label (the Home and Services labels of the breadcrumb) through the `label` whitelist; null when it fails. */
export const labelOf = (v: unknown): string | null => spliceable('label', plainText(v));
/** An https URL of a photo the barber uploaded (never a sample photo); null otherwise. */
export function ownPhotoUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 1000 || /[\s"'<>\\]/.test(s) || CONTROL.test(s) || isStockImage(s)) return null;
  try { const u = new URL(s); return u.protocol === 'https:' && u.hostname.includes('.') ? s : null; } catch { return null; }
}

const COUNTRIES: Record<string, string> = { usa: 'US', 'u.s.a.': 'US', 'u.s.a': 'US', us: 'US', 'u.s.': 'US', 'united states': 'US', 'united states of america': 'US', canada: 'CA', mexico: 'MX', 'méxico': 'MX', uk: 'GB', 'united kingdom': 'GB' };
// Closed lists: a two-letter region only counts when it is a real state / province / territory code.
const US_STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR GU VI AS MP'.split(' '));
const CA_PROVINCES = new Set('AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' '));
const US_REGION = /^([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/;
const CA_REGION = /^([A-Z]{2})(?:\s+([A-Z]\d[A-Z]\s?\d[A-Z]\d))?$/;

export interface ParsedAddress {
  node: JsonNode;
  /** ISO country when KNOWN: named in the address, or a real US state + ZIP / Canadian province + postal code. Otherwise null (never guessed). */
  country: string | null;
}
/** The street address as a PostalAddress. A value that is not a street address (a city, "Mobile - I come to you") gives null. */
export function parseAddress(raw: unknown): ParsedAddress | null {
  const v = spliceable('address', plainText(raw));
  if (v === null) return null;
  const parts = v.split(',').map((p) => p.trim()).filter(Boolean);
  let named: string | null = null;
  if (parts.length > 1 && COUNTRIES[parts[parts.length - 1].toLowerCase()]) named = COUNTRIES[parts.pop()!.toLowerCase()];
  const node: JsonNode = { '@type': 'PostalAddress' };
  let country = named;
  if (parts.length >= 3 && (named === null || named === 'US' || named === 'CA')) {
    const last = parts[parts.length - 1];
    const locality = parts[parts.length - 2];
    const us = named !== 'CA' ? US_REGION.exec(last) : null;
    const ca = !us || !US_STATES.has(us[1]) ? (named !== 'US' ? CA_REGION.exec(last) : null) : null;
    const hit = us && US_STATES.has(us[1]) ? { code: us[1], zip: us[2], cc: 'US' } : ca && CA_PROVINCES.has(ca[1]) ? { code: ca[1], zip: ca[2], cc: 'CA' } : null;
    if (hit && !/\d/.test(locality)) {
      node.streetAddress = parts.slice(0, -2).join(', ');
      node.addressLocality = locality;
      node.addressRegion = hit.code;
      if (hit.zip) { node.postalCode = hit.zip; if (country === null) country = hit.cc; }
    }
  }
  if (!node.streetAddress) node.streetAddress = parts.join(', ');
  if (named) node.addressCountry = named;
  return { node, country };
}

/** "Brooklyn, NY": the shop's place, only when the address parsed into a city and a region. Never free text. */
export function placeOf(a: ParsedAddress | null): string | null {
  const loc = a?.node.addressLocality;
  const reg = a?.node.addressRegion;
  return typeof loc === 'string' && typeof reg === 'string' ? `${loc}, ${reg}` : null;
}

/** "+1 " in front of a North American number, only when the country is known to be the US or Canada and the number is plainly 10 digits. */
export function telephoneOf(phone: string, country: string | null): string {
  if (country !== 'US' && country !== 'CA') return phone;
  return /^[\d\s().-]+$/.test(phone) && phone.replace(/\D/g, '').length === 10 ? `+1 ${phone}` : phone;
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
const hhmm = (mins: number): string => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}:00`;

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

const SYMBOL_CURRENCY: Record<string, string> = { '£': 'GBP', '€': 'EUR' };
const DOLLAR_CURRENCY: Record<string, string> = { US: 'USD', CA: 'CAD' };
/** One real numeric price as an Offer. A range, "25+", "from $20", a price of zero, or a "$" when the shop's country is not US/CA (known) gives null. */
export function offerOf(rawPrice: unknown, country: string | null): JsonNode | null {
  const shown = displayPrice(typeof rawPrice === 'string' ? plainText(rawPrice) : '');
  const v = spliceable('price', shown);
  if (v === null || !isMoney(v)) return null;
  let amount: RegExpExecArray | null;
  let currency: string | null = null;
  if ((amount = /^([$£€])\s?(\d{1,5})(?:\.(\d{1,2}))?$/.exec(v))) currency = amount[1] === '$' ? (country ? DOLLAR_CURRENCY[country] ?? null : null) : SYMBOL_CURRENCY[amount[1]];
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
  /** The Home page HTML as rendered (photos are still `{{key}}` placeholders): a photo is listed only when Home prints its placeholder. */
  homeHtml: string;
  /** Home link label of the breadcrumb (the site's own nav label). */
  homeLabel: string;
  /** Services page title as printed, for the breadcrumb. */
  servicesTitle: string;
  /** Placeholder key -> real photo URL. */
  imageUrls: Record<string, string>;
  /** hrefs of the thin (noindex) service pages. */
  thin: ReadonlySet<string>;
}

const businessId = (base: string): string => `${base}/#business`;

/**
 * The LocalBusiness node of Home, Location or Contact, or null when the shop has no whitelisted name or no street address
 * (Google requires `address`; a mobile shop gets no node rather than an invalid one). Home carries the full node (hours rows only as the design prints them); Location
 * adds hours only while its hours section is shown; Contact has name, url, phone and address only.
 */
export function businessNode(c: JsonLdContext, page: 'home' | 'location' | 'contact' = 'home'): JsonNode | null {
  const { d, base } = c;
  const name = nameOf(d.shopName);
  const addr = parseAddress(d.contact?.address);
  if (!name || !addr) return null;
  const node: JsonNode = { '@type': businessTypeOf(d), '@id': businessId(base), name, url: `${base}/` };
  const phone = spliceable('phone', plainText(d.phone));
  if (phone) node.telephone = telephoneOf(phone, addr.country);
  node.address = addr.node;
  // Hours: Location while its hours section is shown; Home only for the rows the design really prints there (Euphoria prints none).
  const rows: unknown[] = Array.isArray(d.hours) ? d.hours : [];
  const shownRows = page === 'home'
    ? rows.filter((r) => { const o = r as { open?: unknown; close?: unknown } | null; return !!o && c.homeHtml.includes(`${to12h(plainText(o.open))} – ${to12h(plainText(o.close))}`); })
    : page === 'location' && !pageSectionsOf(d, 'location').find((x) => x.id === 'hours')?.hidden ? rows : [];
  const hours = openingHours(shownRows);
  if (hours.length) node.openingHoursSpecification = hours;
  if (page === 'home') {
    const imgs: string[] = [];
    for (const k of ['hero', 'about', ...Object.keys(c.imageUrls).filter((x) => /^gallery\d+$/.test(x)).sort((a, b) => Number(a.slice(7)) - Number(b.slice(7)))]) {
      const u = ownPhotoUrl(c.imageUrls[k]);
      if (u && c.homeHtml.includes(`{{${k}}}`) && !imgs.includes(u)) imgs.push(u);
      if (imgs.length >= 4) break;
    }
    if (imgs.length) node.image = imgs;
  }
  return { '@context': 'https://schema.org', ...node };
}

/** Service + BreadcrumbList for a service page, or null (thin page, no whitelisted name, no base). */
export function serviceNodes(c: JsonLdContext, file: PageFile): JsonNode[] | null {
  if (file.key !== 'services' || !file.child || c.thin.has(file.href)) return null;
  const s = c.d.services?.[file.child.index];
  const name = nameOf(s?.title);
  const shop = nameOf(c.d.shopName);
  if (!s || !name || !shop) return null;
  const url = `${c.base}${file.href}`;
  const addr = parseAddress(c.d.contact?.address);
  // The business node exists on Home only with an address; refer to it by @id only then.
  const provider: JsonNode = { '@type': businessTypeOf(c.d), ...(addr ? { '@id': businessId(c.base) } : {}), name: shop, url: `${c.base}/` };
  const service: JsonNode = { '@type': 'Service', '@id': `${url}#service`, name, url, provider };
  const place = placeOf(addr);
  if (place) service.areaServed = place;
  const offer = offerOf(s.price, addr?.country ?? null);
  if (offer) service.offers = offer;
  const crumbs: JsonNode[] = [{ '@type': 'ListItem', position: 1, name: labelOf(c.homeLabel) ?? 'Home', item: `${c.base}/` }];
  const svcPage = c.set.files.find((f) => f.key === 'services' && !f.child);
  if (svcPage) crumbs.push({ '@type': 'ListItem', position: crumbs.length + 1, name: labelOf(c.servicesTitle) ?? 'Services', item: `${c.base}${svcPage.href}` });
  crumbs.push({ '@type': 'ListItem', position: crumbs.length + 1, name, item: url });
  return [service, { '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`, itemListElement: crumbs }];
}

/** The JSON-LD `<script>` for one page, or '' when the page gets none. */
export function jsonLdHtml(c: JsonLdContext, file: PageFile): string {
  if (!c.base) return '';
  if (BUSINESS_PAGES.includes(file.key) && !file.child) {
    const n = businessNode(c, file.key as 'home' | 'location' | 'contact');
    return n ? jsonLdScript(n) : '';
  }
  const nodes = serviceNodes(c, file);
  return nodes ? jsonLdScript({ '@context': 'https://schema.org', '@graph': nodes }) : '';
}
