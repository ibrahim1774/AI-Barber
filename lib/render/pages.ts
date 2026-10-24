// The pages of a multi-page site (spec 2026-10-23-barber-experience, P3b).
//
// A site is Home plus a page for every kind of content the barber actually gave us: nothing is
// generated to fill a page, and a page is never made from a generated or inherited value
// (honest-sites rule). This module holds the pure rules, shared by the server and (vendored) the
// iOS app, so the Pages sheet, the preview and the deploy all agree:
//   - which pages are eligible (eligiblePages), which are on (buildPageSet), in what order;
//   - the file path and the root-absolute link of each page (pageHref, pagePath);
//   - slugs for the per-service and per-barber pages, and the paths a site may never write;
//   - the canonical base URL and the sitemap.
//
// Pure, no DOM, no Node. Imports only other vendored modules (and nothing that imports labels).
import type { WebsiteData } from '../../types';
import { BOOKSY_NICHES } from '../booksyNiche.js';
import { isStockImage } from '../stockImages.js';
import { contactEmail, policyToShow, teamOf, visibleReviews, withoutLegacyCopy } from './honest.js';
import { safeHref } from './safeHref.js';
import { faqDataQuestions, isBeardTitle, isHaircutTitle } from './guides.js';
import { isSiteBookLink, isSiteShopLink } from './subpages.js';

/** One file of the deployed site. `path` is validated by assertSiteFilePath before it is written. */
export interface SiteFile {
  path: string;
  html: string;
}

/**
 * The guide pages a barber can add (plan 2026-10-24). They are NOT stored in `pages`: the on/off state lives in
 * `WebsiteData.extraPages.on`, because an older app build saves `pages` whole and would wipe anything kept there.
 */
export const EXTRA_KEYS = ['faq', 'first-visit', 'hair-care', 'beard-care'] as const;
export type ExtraKey = (typeof EXTRA_KEYS)[number];
export const isExtraKey = (k: unknown): k is ExtraKey => typeof k === 'string' && (EXTRA_KEYS as readonly string[]).includes(k);

export const PAGE_KEYS = ['home', 'about', 'services', 'team', 'gallery', 'reviews', 'hours', 'location', 'contact', 'book', 'shop', ...EXTRA_KEYS] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

/** WebsiteData.extraPages (plan 2026-10-24 §6a). Only `on` is read by Phase A; the rest is kept for Phases B to D. */
export interface ExtraPagesModel {
  on: ExtraKey[];
  serviceGuides?: boolean;
  seed?: number;
  pick?: Record<string, number>;
  images?: Partial<Record<ExtraKey, string>>;
}

/** Per-item pages live under these groups: `services/<slug>/`, `team/<slug>/`. */
export type PageGroup = 'services' | 'team';

/** WebsiteData.pages: the nav order and the pages the barber turned off. Data eligibility is computed, not stored. */
export interface PagesModel {
  order: PageKey[];
  hidden: PageKey[];
}

/** Placeholder key (`gallery3`, `staff0`, `about`) -> the real URL, when the caller has one (the pending shape). */
export interface PageContext {
  imageUrls?: Record<string, string> | null;
}

export const isPageKey = (k: unknown): k is PageKey => typeof k === 'string' && (PAGE_KEYS as readonly string[]).includes(k);

// ── Text from the editor ──────────────────────────────────────────────────────────────────────
// The app wraps editable text in U+2063 markers while previewing. Every comparison and every slug
// first removes them, so the preview and the deploy decide the same thing.
const RAW_MARKER = /⁣(?:[a-zA-Z]+|\/)⁣/g;

/** A value without the editor's markers, trimmed. Not a string -> ''. */
export function plainText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(RAW_MARKER, '').replace(/⁣/g, '').trim();
}

// ── Slugs and reserved paths ──────────────────────────────────────────────────────────────────

/** Top-level paths a page may never take: the proxied pages, the platform's own paths and the site's own files. */
export const RESERVED_PATHS: readonly string[] = [
  'book', 'shop', '_ab', 'api', 'manage', 'ab-site.json', 'sitemap.xml', 'robots.txt', 'index.html', 'styles.css', 'vercel.json',
];
export const isReservedPath = (segment: string): boolean => RESERVED_PATHS.includes(String(segment).toLowerCase());

export const SLUG_MAX = 60;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isPageSlug = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= SLUG_MAX && SLUG.test(s);

/**
 * A URL segment from free text: NFKD, marks stripped, only [a-z0-9-], dashes collapsed and trimmed, at
 * most 60 characters. Nothing usable (emoji, non-Latin names) -> `<group>-<n>`. Never '.', '..' or '/'.
 */
export function slugify(raw: unknown, group: string, n: number): string {
  const s = plainText(raw)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
  return s || `${group}-${n}`;
}

/** slugify() that is also unique among `taken` (which it adds to): `fade`, `fade-2`, `fade-3`. */
export function uniqueSlug(raw: unknown, group: string, n: number, taken: Set<string>): string {
  const base = slugify(raw, group, n);
  let slug = base;
  for (let k = 2; taken.has(slug); k++) {
    const suffix = `-${k}`;
    slug = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
  }
  taken.add(slug);
  return slug;
}

const SEG = '[a-z0-9]+(?:-[a-z0-9]+)*';
const FILE_PATH = new RegExp(`^(?:index\\.html|${SEG}/index\\.html|${SEG}/${SEG}/index\\.html)$`);

/**
 * A site file path is `index.html`, `<page>/index.html` or `<group>/<slug>/index.html` with segments of
 * [a-z0-9-], and its top segment is not reserved (a `book/index.html` would sit ahead of the proxy
 * rewrite). Throws otherwise.
 */
export function assertSiteFilePath(path: string): void {
  if (typeof path !== 'string' || !FILE_PATH.test(path)) throw new Error(`unsafe site file path: ${String(path).slice(0, 80)}`);
  const top = path.split('/')[0];
  if (path !== 'index.html' && isReservedPath(top)) throw new Error(`reserved site file path: ${path}`);
}

/** The file of a page: `index.html`, `about/index.html`, `services/fade/index.html`. Null for the proxied pages (book, shop). */
export function pagePath(key: PageKey, slug?: string): string | null {
  if (key === 'book' || key === 'shop') return null;
  if (key === 'home') return 'index.html';
  if ((key === 'services' || key === 'team') && slug !== undefined) {
    if (!isPageSlug(slug)) throw new Error(`bad page slug: ${String(slug).slice(0, 80)}`);
    return `${key}/${slug}/index.html`;
  }
  return `${key}/index.html`;
}

/**
 * The root-absolute link of a page. Built from the page set, never from site data, and never through
 * safeHref (which lets only /book and /shop through as relative links). A slug that is not a clean slug
 * falls back to the group's own page.
 */
export function pageHref(key: PageKey, slug?: string): string {
  if (key === 'home') return '/';
  if (key === 'book') return '/book';
  if (key === 'shop') return '/shop';
  if ((key === 'services' || key === 'team') && slug !== undefined && isPageSlug(slug)) return `/${key}/${slug}/`;
  return `/${key}/`;
}

// ── The pages model (untrusted JSON: the web editor writes arbitrary keys) ────────────────────

/** WebsiteData.pages cleaned: known keys only, no duplicates, 'home' never hidden. */
export function cleanPagesModel(raw: unknown): PagesModel {
  const list = (v: unknown): PageKey[] => {
    const out: PageKey[] = [];
    if (!Array.isArray(v)) return out;
    for (const k of v) if (isPageKey(k) && !out.includes(k)) out.push(k);
    return out;
  };
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return { order: list(r.order), hidden: list(r.hidden).filter((k) => k !== 'home') };
}

/** What a new site gets (decision 2): FAQ and First visit and service guides on; Hair care and Beard care suggested but off. The app adds `seed`. */
export function defaultExtraPages(seed?: number): ExtraPagesModel {
  const out: ExtraPagesModel = { on: ['faq', 'first-visit'], serviceGuides: true };
  if (typeof seed === 'number' && Number.isInteger(seed)) out.seed = seed;
  return out;
}

/** WebsiteData.extraPages cleaned (untrusted JSON): known page keys once, a safe seed, closed pick/images. */
export function cleanExtraPages(raw: unknown): ExtraPagesModel {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const on: ExtraKey[] = [];
  if (Array.isArray(r.on)) for (const k of r.on) if (isExtraKey(k) && !on.includes(k)) on.push(k);
  const out: ExtraPagesModel = { on, serviceGuides: r.serviceGuides === true };
  if (typeof r.seed === 'number' && Number.isInteger(r.seed) && Math.abs(r.seed) <= Number.MAX_SAFE_INTEGER) out.seed = r.seed;
  if (r.pick && typeof r.pick === 'object' && !Array.isArray(r.pick)) {
    const pick: Record<string, number> = Object.create(null);
    for (const [k, v] of Object.entries(r.pick as Record<string, unknown>)) {
      if (k.length <= 80 && typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 2) pick[k] = v;
    }
    out.pick = { ...pick };
  }
  if (r.images && typeof r.images === 'object' && !Array.isArray(r.images)) {
    const images: Partial<Record<ExtraKey, string>> = {};
    const src = r.images as Record<string, unknown>;
    for (const k of EXTRA_KEYS) if (Object.prototype.hasOwnProperty.call(src, k) && typeof src[k] === 'string') images[k] = src[k] as string;
    out.images = images;
  }
  return out;
}

// ── Eligibility ───────────────────────────────────────────────────────────────────────────────

const has = (v: unknown): boolean => plainText(v) !== '';
const norm = (s: string): string => plainText(s).replace(/\s+/g, ' ');

// The About text the generators write when the barber gave us none (so it is not the barber's):
//  - services/geminiService.ts (typed sites): "<Shop> is a barbershop[ in <area>]. Get in touch ..."
//  - lib/buildSiteFromScrape.ts: "<Shop> is a <noun> in <area>." or "<Shop> <aboutFallback[0]>", then aboutFallback[1]
//  - honest.ts withoutLegacyCopy: "<Shop> is a <noun>[ in <area>]." then aboutFallback[1]
// Matched by shape, not against the current shop name (a renamed shop must not turn generated text
// into an About page).
const NICHES = BOOKSY_NICHES;
const FALLBACK_SECOND = new Set(NICHES.map((n) => n.aboutFallback[1]));
const FALLBACK_FIRST = Array.from(new Set(NICHES.map((n) => n.aboutFallback[0])));
// A shop name or an area is a short run of words with no sentence end in it (an abbreviation like "St." is
// fine): so "... is a barbershop in Austin. We've cut hair since 1998." and "... in the heart of Austin where
// every cut is done by hand." are the barber's own text, not ours.
const TOKEN = String.raw`(?:[^\s.!?]+|(?:St|Mt|Ft|Mr|Dr|Jr|Sr)\.)`;
const NAME_RE = String.raw`${TOKEN}(?: ${TOKEN}){0,5}`;
const AREA_RE = String.raw`${TOKEN}(?: ${TOKEN}){0,4}`;
const NOUN_SENTENCE = new RegExp(`^${NAME_RE} is an? (?:${Array.from(new Set(NICHES.map((n) => n.noun))).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?: in ${AREA_RE})?\\.$`, 'i');
const GEMINI_COMBINED = new RegExp(`^${NAME_RE} is a barbershop(?: in ${AREA_RE})?\\. Get in touch to book your next appointment\\.$`, 'i');
const NAME_ONLY = new RegExp(`^${NAME_RE}$`);

/** Is this About paragraph one we wrote (not the barber)? `known` = the stored shop name and area, for an exact match. */
export function isGeneratedAbout(paragraph: unknown, known?: { shopName?: unknown; area?: unknown }): boolean {
  const p = norm(String(paragraph ?? ''));
  if (!p) return true;
  if (FALLBACK_SECOND.has(p)) return true;
  if (known) {
    const shop = norm(String(known.shopName ?? ''));
    const area = norm(String(known.area ?? ''));
    if (shop) {
      const lead = `${shop} is a`;
      const rest = p.startsWith(lead + ' ') || p.startsWith(lead + 'n ') ? p.slice(lead.length).replace(/^n? /, '') : null;
      if (rest !== null) {
        for (const n of new Set(NICHES.map((x) => x.noun))) {
          const sentence = `${n}${area ? ` in ${area}` : ''}.`;
          if (rest === sentence || rest === `${n}.` || rest === `${sentence} Get in touch to book your next appointment.`) return true;
        }
      }
    }
  }
  if (GEMINI_COMBINED.test(p) || NOUN_SENTENCE.test(p)) return true;
  return FALLBACK_FIRST.some((f) => {
    if (!p.endsWith(` ${f}`)) return false;
    return NAME_ONLY.test(p.slice(0, p.length - f.length - 1));
  });
}

/** The About paragraphs the barber wrote or imported (the page prints only these). */
export function aboutParagraphs(d: Pick<WebsiteData, 'about'> & Partial<Pick<WebsiteData, 'shopName' | 'area'>>): string[] {
  const list = Array.isArray(d.about?.description) ? d.about.description : [];
  return list.filter((p) => typeof p === 'string' && !isGeneratedAbout(p, d));
}

const imageUrlFor = (ctx: PageContext | undefined, key: string, raw: unknown): string =>
  (ctx?.imageUrls && typeof ctx.imageUrls[key] === 'string' && ctx.imageUrls[key]) || (typeof raw === 'string' ? raw : '');

/**
 * Gallery slots that hold the barber's own photo: a slot with a picture whose real URL is not one of
 * our samples. In the pending shape the slot holds a marker and the URL is in ctx.imageUrls, so the
 * URL is looked up there first.
 */
export function ownGallerySlots(d: Pick<WebsiteData, 'gallery'>, ctx?: PageContext): number[] {
  const out: number[] = [];
  (Array.isArray(d.gallery) ? d.gallery : []).forEach((raw, i) => {
    const url = imageUrlFor(ctx, `gallery${i}`, raw);
    if (url && !isStockImage(url)) out.push(i);
  });
  return out;
}

export const MIN_GALLERY_PHOTOS = 3;

/** At most this many services get their own page (the first ones, in the barber's order). */
export const SERVICE_PAGE_CAP = 12;

/**
 * Every service with a name gets its own page (owner feedback 2026-10-24: "each kind of service catered to"),
 * up to SERVICE_PAGE_CAP. The page prints only the service's real fields; it never invents any. (This
 * overrides the P3b rule that also required a description, price or duration.)
 */
export function servicePageEligible(s: { title?: string; description?: string; price?: string; duration?: string } | null | undefined): boolean {
  return !!s && has(s.title);
}

type HoursRows = { day?: string; open?: string; close?: string; closed?: boolean }[];
const hoursSig = (h: unknown): string =>
  JSON.stringify((Array.isArray(h) ? (h as HoursRows) : []).map((r) => [plainText(r?.day).toLowerCase(), plainText(r?.open), plainText(r?.close), !!r?.closed]));

/** Does this stored staff entry hold something of the member's own (a role alone does not count)? */
export function memberHasOwnContent(raw: unknown, shopHours: unknown): boolean {
  const s = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!s) return false;
  if (has(s.bio) || has(s.photo)) return true;
  if (Array.isArray(s.serviceIds) && s.serviceIds.some((id) => has(id))) return true;
  return Array.isArray(s.hours) && s.hours.length > 0 && hoursSig(s.hours) !== hoursSig(shopHours);
}

// ── Extra (guide) pages ─────────────────────────────────────────────────────────────────────────
// The page copy is the library's (copyLibrary.ts, guides.ts); a page exists when the barber turned it on and the data floor
// of plan 1c is met. Service types come from guides.ts matching.

const REASON: Record<ExtraKey, string> = {
  faq: 'Add your booking link or phone, hours, address, prices or durations to get this page',
  'first-visit': 'Add a booking link or phone, and an address or hours, to get this page',
  'hair-care': 'Add a haircut service to get this page',
  'beard-care': 'Add a beard or shave service to get this page',
};

/** The data floor of one extra page (plan 1c) on the cleaned site: true when the page has the real data it needs. */
function extraFloorMet(key: ExtraKey, d: WebsiteData): boolean {
  const titled = (Array.isArray(d.services) ? d.services : []).filter((s) => has(s?.title));
  const book = !!safeHref(d.bookingUrl);
  const phone = has(d.phone);
  const address = has(d.contact?.address);
  const hours = Array.isArray(d.hours) && d.hours.length > 0;
  if (key === 'first-visit') return (book || phone) && (address || hours);
  if (key === 'hair-care') return titled.some((s) => isHaircutTitle(s.title));
  if (key === 'beard-care') return titled.some((s) => isBeardTitle(s.title));
  // FAQ: at least 3 questions the data can answer (guides.ts faqDataQuestions).
  return faqDataQuestions(d) >= 3;
}

/**
 * The extra pages as the Pages sheet lists them: `on` = the barber turned it on (and has not hidden it),
 * `eligible` = it has its data floor and its copy, `reason` = why not ('' when eligible).
 */
export function extraPageRows(input: WebsiteData, _ctx?: PageContext): { key: ExtraKey; on: boolean; eligible: boolean; reason: string }[] {
  const d = withoutLegacyCopy(input);
  const on = cleanExtraPages(d.extraPages).on;
  const hidden = cleanPagesModel(d.pages).hidden;
  return EXTRA_KEYS.map((key) => {
    const floor = extraFloorMet(key, d);
    const eligible = floor;
    return { key, on: on.includes(key) && !hidden.includes(key), eligible, reason: eligible ? '' : REASON[key] };
  });
}

/** Pages with data behind them, in the default order, ignoring what the barber turned off. Runs on withoutLegacyCopy(d). */
export function eligiblePages(input: WebsiteData, ctx?: PageContext): PageKey[] {
  const d = withoutLegacyCopy(input);
  const out: PageKey[] = ['home'];
  if (aboutParagraphs(d).length > 0) out.push('about');
  if ((Array.isArray(d.services) ? d.services : []).some((s) => has(s?.title))) out.push('services');
  if (teamOf(d, { legacyUncapped: true }).length > 0) out.push('team');
  if (ownGallerySlots(d, ctx).length >= MIN_GALLERY_PHOTOS) out.push('gallery');
  if (visibleReviews(d).length > 0) out.push('reviews');
  if (Array.isArray(d.hours) && d.hours.length > 0) out.push('hours');
  if (has(d.contact?.address)) out.push('location');
  if (has(d.phone) || contactEmail(d) || has(d.contact?.address) || safeHref(d.bookingUrl)) out.push('contact');
  // Extra pages exist only when the barber turned them on (extraPages.on), they have their data floor and their copy.
  const on = cleanExtraPages(d.extraPages).on;
  for (const k of EXTRA_KEYS) if (on.includes(k) && extraFloorMet(k, d)) out.push(k);
  if (isSiteBookLink(d.bookingUrl)) out.push('book');
  if (safeHref(d.shopUrl)) out.push('shop');
  return out;
}

// ── The page set ──────────────────────────────────────────────────────────────────────────────

/** A per-item page: a service (index into services[]) or a barber (index into staff[], the `staff<i>` key). */
export interface ChildPage {
  group: PageGroup;
  slug: string;
  index: number;
  title: string;
}

export interface PageFile {
  key: PageKey;
  /** Where the file goes in the deploy. */
  path: string;
  /** Its root-absolute link. */
  href: string;
  /** Set for a per-item page. */
  child?: ChildPage;
}

export interface PageSet {
  /** Pages with data, in the barber's order, hidden ones included (the Pages sheet lists these). */
  eligible: PageKey[];
  hidden: PageKey[];
  /** eligible minus hidden, in order, home first: the nav and the sitemap. */
  nav: PageKey[];
  /** Every file to deploy (home first), per-item pages after their group's page. */
  files: PageFile[];
  services: ChildPage[];
  /** Titled services past SERVICE_PAGE_CAP: they are listed on the Services page but have no page of their own. */
  servicesOverCap: number;
  team: ChildPage[];
  /** The extra (guide) pages that are files in this set (eligible and not hidden), in menu order. */
  extras: ExtraKey[];
  /** The Shop entry is this site's own proxied /shop page (else it is the barber's own store link). */
  shopInternal: boolean;
}

/** The pages with the barber's order applied: ordered keys first (only eligible ones), then the rest as is; home first. */
function ordered(eligible: PageKey[], order: PageKey[]): PageKey[] {
  const rest = eligible.filter((k) => k !== 'home');
  const first = order.filter((k) => k !== 'home' && rest.includes(k));
  return ['home', ...first, ...rest.filter((k) => !first.includes(k))];
}

/**
 * The page set of a site. `d` is the site as stored (or as edited); eligibility runs on
 * withoutLegacyCopy(d) and `ctx.imageUrls` supplies the real photo URLs in the pending shape.
 * Hidden pages are not in nav, files or the sitemap, and hiding a group drops its per-item pages.
 */
export function buildPageSet(d: WebsiteData, ctx?: PageContext): PageSet {
  const clean = withoutLegacyCopy(d);
  const model = cleanPagesModel(d.pages);
  const eligible = ordered(eligiblePages(d, ctx), model.order);
  const hidden = model.hidden.filter((k) => eligible.includes(k));
  // A setup saved before Location existed (it hid Hours & Location and does not list `location`) keeps that
  // choice: the address and map moved to Location, so it stays off until the barber turns it on.
  if (eligible.includes('location') && model.hidden.includes('hours') && !model.order.includes('location') && !hidden.includes('location')) hidden.push('location');
  const nav = eligible.filter((k) => !hidden.includes(k));

  // Slugs are numbered over every titled item (not only those with a page), so adding a description to
  // one "Fade" never renames the other's address.
  const services: ChildPage[] = [];
  const takenS = new Set<string>();
  let n = 0;
  let servicesOverCap = 0;
  (Array.isArray(clean.services) ? clean.services : []).forEach((s, index) => {
    if (!has(s?.title)) return;
    n++;
    const slug = uniqueSlug(s.title, 'services', n, takenS);
    if (servicePageEligible(s)) {
      if (services.length < SERVICE_PAGE_CAP) services.push({ group: 'services', slug, index, title: plainText(s.title) });
      else servicesOverCap++;
    }
  });

  const team: ChildPage[] = [];
  const takenT = new Set<string>();
  const staff = Array.isArray(clean.staff) ? clean.staff : [];
  teamOf(clean, { legacyUncapped: true }).forEach((card, i) => {
    const slug = uniqueSlug(card.name, 'team', i + 1, takenT);
    if (memberHasOwnContent(staff[card.index], clean.hours)) team.push({ group: 'team', slug, index: card.index, title: plainText(card.name) });
  });

  const files: PageFile[] = [];
  for (const key of nav) {
    const p = pagePath(key);
    if (p) files.push({ key, path: p, href: pageHref(key) });
    const kids = key === 'services' ? services : key === 'team' ? team : [];
    for (const c of kids) files.push({ key, path: pagePath(key, c.slug) as string, href: pageHref(key, c.slug), child: c });
  }
  return { eligible, hidden, nav, files, services, servicesOverCap, team, extras: nav.filter(isExtraKey), shopInternal: isSiteShopLink(clean.shopUrl) };
}

/** Multi-page is opt-in: only a site whose data carries `pages` (the app writes it) gets more than Home. */
export const isMultiPage = (d: Pick<WebsiteData, 'pages'>): boolean => !!d.pages && typeof d.pages === 'object';

/** The page set of a site that has not opted in: Home alone, exactly the pre-P3b single page. */
export function singlePageSet(set: PageSet): PageSet {
  const home = set.files.find((f) => f.key === 'home') ?? { key: 'home' as PageKey, path: 'index.html', href: '/' };
  return { eligible: ['home'], hidden: [], nav: ['home'], files: [home], services: [], servicesOverCap: 0, team: [], extras: [], shopInternal: set.shopInternal };
}

/** True when the site has pages beyond Home that are files (so the nav on Home links to them). */
export const hasFilePages = (set: PageSet): boolean => set.files.some((f) => f.key !== 'home');

/**
 * What the Pages sheet lists: every eligible page, in the barber's order, with its on/off state and
 * link. Home is locked on. `children` counts the per-item pages behind services and team.
 */
export function pageList(d: WebsiteData, ctx?: PageContext): { key: PageKey; on: boolean; locked: boolean; href: string; children: number }[] {
  const set = buildPageSet(d, ctx);
  return set.eligible.map((key) => ({
    key,
    on: !set.hidden.includes(key),
    locked: key === 'home',
    href: pageHref(key),
    children: key === 'services' ? set.services.length : key === 'team' ? set.team.length : 0,
  }));
}

/** The file of a chosen page for the preview, or undefined when that page is off or has no data. */
export function pageFileFor(set: PageSet, key: PageKey, slug?: string): PageFile | undefined {
  return set.files.find((f) => f.key === key && (slug === undefined ? !f.child : f.child?.slug === slug));
}

// ── Public base, canonical and sitemap ────────────────────────────────────────────────────────

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** `https://host` for a bare host or an https URL of just a host; null for anything else (paths, ports, other schemes). */
export function httpsOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/\/+$/, '');
  if (!s) return null;
  const host = /^https:\/\//i.test(s) ? s.slice('https://'.length) : /^[a-z0-9.-]+$/i.test(s) ? s : '';
  return HOSTNAME.test(host) ? `https://${host.toLowerCase()}` : null;
}

/**
 * The base for canonical links and the sitemap: the site's verified custom domain, else the stored
 * public base (ab_shops.site_base_url); null when neither is known (then no canonical and no sitemap).
 * A *.vercel.app custom domain is not a custom domain, and a vercel.app base never wins over one.
 */
export function canonicalBase(src: { customDomain?: string | null; siteBaseUrl?: string | null }): string | null {
  const custom = httpsOrigin(src.customDomain);
  if (custom && !custom.endsWith('.vercel.app')) return custom;
  return httpsOrigin(src.siteBaseUrl);
}

const xmlEsc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** sitemap.xml for the pages in the set (including the proxied /book and /shop), or null with no base. */
export function sitemapXml(set: PageSet, base: string | null): string | null {
  const origin = httpsOrigin(base);
  if (!origin) return null;
  const hrefs = [
    ...set.files.map((f) => f.href),
    ...(set.nav.includes('book') ? [pageHref('book')] : []),
    ...(set.nav.includes('shop') && set.shopInternal ? [pageHref('shop')] : []),
  ];
  const urls = hrefs.map((h) => `  <url><loc>${xmlEsc(origin + h)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
