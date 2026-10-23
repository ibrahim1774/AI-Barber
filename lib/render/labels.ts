// Label registry (spec 2026-10-23-barber-experience, P3a).
//
// Every small visible literal of the three static renderers (nav items,
// button text, section eyebrows and headings, contact labels, ...) is a
// LABEL: the renderer prints `t(labels, key, ...)`, and the barber may
// override it through `WebsiteData.labels`. The registry is the ONE list of
// what can be overridden: stored keys that are not in it are ignored, so a
// saved value can never reach the page through an unknown name.
//
// Rules the renderers rely on:
//  - t() returns HTML-escaped text (& < > " '). It is for text nodes and
//    quoted attributes ONLY: never inside <script>, <style>, href or src.
//  - A stored value is capped to `max` BEFORE the app's editor markers go
//    around it (the app calls clampLabel), and t() re-applies the cap so a
//    value that never saw the app cannot be longer. The cap looks through one
//    whole editor marker wrapper so it is never cut in half.
//  - A default may depend on the niche (and, for the footer, the area).
//
// Pure, no DOM. Vendored byte-for-byte by the iOS app (scripts/sync-web.sh),
// so it imports only other vendored modules.
import type { TemplateId, WebsiteData } from '../../types';
import type { BooksyNiche } from '../booksyNiche.js';
import { nicheByKey } from '../booksyNiche.js';
import { safeHref } from './safeHref.js';
import { aggregateToShow, footerLine, hasServices, nicheCopy, reviewsSourceName, visibleReviews } from './honest.js';

export type LabelDefault = string | ((niche: BooksyNiche, site?: Pick<WebsiteData, 'area' | 'niche'>) => string);

export interface LabelDef {
  /** What the barber sees in the editor, e.g. "Gallery heading". */
  title: string;
  default: LabelDefault;
  /** Design that prints it. Absent = every design. */
  template?: TemplateId;
  /** Maximum length in characters (code points). */
  max: number;
  /** Whether the page prints it for this site (a hidden section has no label to tap). Absent = always. */
  shows?: (site: WebsiteData) => boolean;
  /** false = not tappable in the preview (the app edits it from its own control). */
  tap?: false;
}

const has = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';
const tidy = (s: string): string => s.trim();

// Section visibility, mirroring the renderers.
const LUXE_GALLERY = [2, 3, 4, 5, 6, 7];
const luxeGallery = (s: WebsiteData) => LUXE_GALLERY.some((i) => has(s.gallery?.[i]));
const primeGallery = (s: WebsiteData) => (s.gallery || []).slice(0, 6).some((u) => has(u));
const euGallery = (s: WebsiteData) => (s.gallery || []).some((u) => has(u));
const hasStaff = (s: WebsiteData) => Array.isArray(s.staff) && s.staff.length > 0;
const hasHours = (s: WebsiteData) => Array.isArray(s.hours) && s.hours.length > 0;
const hasReviews = (s: WebsiteData) => visibleReviews(s).length > 0;
const hasClosedDay = (s: WebsiteData) => hasHours(s) && s.hours!.some((h) => h.closed);
const canCall = (s: WebsiteData) => /\d/.test(s.phone || '');
const hasPhone = (s: WebsiteData) => has(s.phone);
const hasBook = (s: WebsiteData) => !!safeHref(s.bookingUrl);
const hasShop = (s: WebsiteData) => !!safeHref(s.shopUrl);
const hasAddress = (s: WebsiteData) => has(s.contact?.address);
const showsRating = (s: WebsiteData) => aggregateToShow(s) !== null;
const primeBook = (s: WebsiteData) => hasBook(s) || canCall(s);
const euNavBook = (s: WebsiteData) => hasBook(s) || canCall(s);

const copy = (niche: BooksyNiche) => nicheCopy({ niche: niche.key });

export const LABELS = {
  // ── Design 1 (luxe). These keys are already saved by barbers: never rename. ──
  galleryEyebrow: { title: 'Gallery eyebrow', default: 'Gallery', template: 'luxe', max: 40, shows: luxeGallery },
  galleryHeading: { title: 'Gallery heading', default: 'The Look', template: 'luxe', max: 60, shows: luxeGallery },
  teamEyebrow: { title: 'Team eyebrow', default: 'The Team', template: 'luxe', max: 40, shows: hasStaff },
  teamHeading: { title: 'Team heading', default: (n) => copy(n).teamHeading, template: 'luxe', max: 60, shows: hasStaff },
  hoursEyebrow: { title: 'Hours eyebrow', default: 'Hours', template: 'luxe', max: 40, shows: hasHours },
  hoursHeading: { title: 'Hours heading', default: "When We're Open", template: 'luxe', max: 60, shows: hasHours },
  reviewsEyebrow: { title: 'Reviews eyebrow', default: 'Reviews', template: 'luxe', max: 40, shows: hasReviews },
  reviewsHeading: { title: 'Reviews heading', default: 'What Our Clients Say', template: 'luxe', max: 60, shows: hasReviews },
  servicesEyebrow: { title: 'Services eyebrow', default: 'Services', template: 'luxe', max: 40, shows: hasServices },
  servicesHeading: { title: 'Services heading', default: 'What We Offer', template: 'luxe', max: 60, shows: hasServices },
  contactHeading: { title: 'Contact heading', default: 'Contact Us', template: 'luxe', max: 60 },
  contactLocationLabel: { title: 'Location label', default: 'LOCATION', template: 'luxe', max: 30, shows: hasAddress },
  contactPhoneLabel: { title: 'Phone label', default: 'PHONE', template: 'luxe', max: 30, shows: hasPhone },
  mapEyebrow: { title: 'Map eyebrow', default: 'Find Us', template: 'luxe', max: 40 },
  mapHeading: { title: 'Map heading', default: 'Stop By', template: 'luxe', max: 60 },
  // ── Design 1: new ──
  navHome: { title: 'Menu: Home', default: 'HOME', template: 'luxe', max: 20 },
  navServices: { title: 'Menu: Services', default: 'SERVICES', template: 'luxe', max: 20, shows: hasServices },
  navContact: { title: 'Menu: Contact', default: 'CONTACT', template: 'luxe', max: 20 },
  navShop: { title: 'Menu: Shop', default: 'SHOP', template: 'luxe', max: 20, shows: hasShop },
  callNow: { title: 'Call button text', default: 'Call Now:', template: 'luxe', max: 30, shows: canCall },
  bookButton: { title: 'Book button text', default: 'Book Appointment', template: 'luxe', max: 30, shows: hasBook },
  shopButton: { title: 'Shop button text', default: 'Shop online', template: 'luxe', max: 30, shows: hasShop },
  closedLabel: { title: 'Closed day text', default: 'Closed', template: 'luxe', max: 20, shows: hasClosedDay },
  footerLine: {
    title: 'Footer line',
    default: (_n, site) => footerLine(site ?? { area: '' }),
    template: 'luxe',
    max: 80,
  },

  // ── Design 2 (prime) ──
  bookingNote: { title: 'Booking note', default: '', template: 'prime', max: 140 },
  primeWelcome: { title: 'Welcome bar text', default: 'Welcome', template: 'prime', max: 30 },
  primeNavShop: { title: 'Menu: Shop', default: 'Shop', template: 'prime', max: 20, shows: hasShop },
  primeNavBook: { title: 'Menu: Book button', default: 'Book Now', template: 'prime', max: 24, shows: primeBook },
  primeHeroEyebrow: { title: 'Hero eyebrow', default: 'Welcome to', template: 'prime', max: 40 },
  primeBookButton: { title: 'Book button text', default: 'Book an Appointment', template: 'prime', max: 30, shows: primeBook },
  primeViewServices: { title: 'View services button', default: 'View Services', template: 'prime', max: 30, shows: hasServices },
  primeAboutEyebrow: { title: 'About eyebrow', default: 'Our Story', template: 'prime', max: 40 },
  primeServicesEyebrow: { title: 'Services eyebrow', default: 'Services & Prices', template: 'prime', max: 40, shows: hasServices },
  primeServicesLead: { title: 'Services heading, first part', default: 'What we', template: 'prime', max: 40, shows: hasServices },
  primeServicesAccent: { title: 'Services heading, accent part', default: 'offer.', template: 'prime', max: 40, shows: hasServices },
  primePolicyEyebrow: { title: 'Policy label', default: 'Please Note', template: 'prime', max: 30, shows: (s) => has(s.policy?.body) },
  primeGalleryEyebrow: { title: 'Gallery eyebrow', default: 'Gallery', template: 'prime', max: 40, shows: primeGallery },
  primeGalleryHeading: { title: 'Gallery heading', default: 'The look.', template: 'prime', max: 60, shows: primeGallery },
  primeReviewsEyebrow: { title: 'Reviews eyebrow', default: 'Client Reviews', template: 'prime', max: 40, shows: hasReviews },
  primeReviewsLead: { title: 'Reviews heading, first part', default: 'What clients', template: 'prime', max: 40, shows: hasReviews },
  primeReviewsAccent: { title: 'Reviews heading, accent part', default: 'are saying.', template: 'prime', max: 40, shows: hasReviews },
  primeStatRating: { title: 'Rating box label', default: 'Rating', template: 'prime', max: 20, shows: showsRating },
  primeStatReviews: { title: 'Review count box label', default: 'Reviews', template: 'prime', max: 20, shows: (s) => (aggregateToShow(s)?.count ?? 0) > 0 },
  primeBookingEyebrow: { title: 'Booking strip eyebrow', default: (n) => copy(n).bookingEyebrow, template: 'prime', max: 40 },
  primeBookingLead: { title: 'Booking strip heading, first part', default: 'Ready for', template: 'prime', max: 40 },
  primeBookingNext: { title: 'Booking strip heading, accent part', default: (n) => copy(n).bookingNext, template: 'prime', max: 40 },
  primeVisitEyebrow: { title: 'Visit eyebrow', default: (n) => copy(n).visitEyebrow, template: 'prime', max: 40 },
  primeVisitHeading: { title: 'Visit heading', default: 'Pay a visit.', template: 'prime', max: 60 },
  primeAddressLabel: { title: 'Address label', default: 'The Address', template: 'prime', max: 30, shows: hasAddress },
  primePhoneLabel: { title: 'Phone label', default: 'By Phone', template: 'prime', max: 30, shows: canCall },
  primeOnlineBookingLabel: { title: 'Online booking label', default: 'Online Booking', template: 'prime', max: 30, shows: hasBook },
  primeBookOnlineLink: { title: 'Online booking link text', default: 'Book online →', template: 'prime', max: 40, shows: hasBook },
  primeShopLabel: { title: 'Shop label', default: 'The Shop', template: 'prime', max: 30, shows: hasShop },
  primeShopLink: { title: 'Shop link text', default: 'Shop online → pickup or shipping', template: 'prime', max: 60, shows: hasShop },
  primeHoursEyebrow: { title: 'Hours label', default: 'Hours of Service', template: 'prime', max: 40, shows: hasHours },
  primeClosedLabel: { title: 'Closed day text', default: 'Closed', template: 'prime', max: 20, shows: hasClosedDay },

  // ── Design 3 (euphoria) ──
  euNavShop: { title: 'Menu: Shop', default: 'Shop', template: 'euphoria', max: 20, shows: hasShop },
  euNavBook: { title: 'Menu: Book button', default: 'Book now', template: 'euphoria', max: 24, shows: euNavBook },
  euCall: { title: 'Call button text', default: 'Call', template: 'euphoria', max: 24, shows: canCall },
  euBookButton: { title: 'Book button text', default: 'Book Appointment', template: 'euphoria', max: 30, shows: hasBook },
  euViewServices: { title: 'View services button', default: 'View services', template: 'euphoria', max: 30, shows: hasServices },
  euAboutEyebrow: { title: 'About eyebrow', default: 'About', template: 'euphoria', max: 40 },
  euServicesEyebrow: { title: 'Services eyebrow', default: 'Services', template: 'euphoria', max: 40, shows: hasServices },
  euServicesHeading: { title: 'Services heading', default: 'What we offer.', template: 'euphoria', max: 60, shows: hasServices },
  euGalleryEyebrow: { title: 'Gallery eyebrow', default: 'Gallery', template: 'euphoria', max: 40, shows: euGallery },
  euGalleryHeading: { title: 'Gallery heading', default: 'The look.', template: 'euphoria', max: 60, shows: euGallery },
  euVisitEyebrow: { title: 'Visit eyebrow', default: 'Visit', template: 'euphoria', max: 40 },
  euVisitHeading: { title: 'Visit heading', default: 'Come in.', template: 'euphoria', max: 60 },
  euLocationLabel: { title: 'Location label', default: 'Location', template: 'euphoria', max: 30, shows: hasAddress },
  euPhoneLabel: { title: 'Phone label', default: 'Phone', template: 'euphoria', max: 30, shows: hasPhone },
  euEmailLabel: { title: 'Email label', default: 'Email', template: 'euphoria', max: 30, shows: (s) => has(s.contact?.email) },
  euShopButton: { title: 'Shop button text', default: 'Shop online', template: 'euphoria', max: 30, shows: hasShop },

  // ── Rating wording (all designs). Edited from the app's rating control, not by tapping the page. ──
  ratingLine: { title: 'Rating wording', default: '', max: 80, tap: false },
} satisfies Record<string, LabelDef>;

export type LabelKey = keyof typeof LABELS;

export const LABEL_KEYS = Object.keys(LABELS) as LabelKey[];

const DEFS: Record<string, LabelDef> = LABELS;
export const isLabelKey = (k: unknown): k is LabelKey =>
  typeof k === 'string' && Object.prototype.hasOwnProperty.call(LABELS, k);

// ── Length cap, looking through an editor marker wrapper ────────────────
const SEP = '⁣'; // the app's editor marker character (invisible separator)
// One whole wrapper, id then text then close: SEP id SEP text SEP / SEP
const WRAPPED = /^(⁣[a-z]+⁣)([\s\S]*?)(⁣\/⁣)$/;

/** Split a value into [open marker, text, close marker]; markers are '' when there is no whole wrapper. */
function unwrap(value: string): [string, string, string] {
  const m = WRAPPED.exec(value);
  return m ? [m[1], m[2], m[3]] : ['', value, ''];
}

const cap = (s: string, max: number): string => {
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('') : s;
};

/**
 * Trim and cap a label value to `max` characters. The app calls this on the raw value BEFORE it
 * wraps it in editor markers; t() calls it again and, if the value arrives wrapped, caps the text
 * inside the wrapper so a marker is never cut in half. Stray separators are dropped.
 */
export function clampLabel(value: string, max: number): string {
  const [open, text, close] = unwrap(String(value ?? ''));
  const clean = cap(tidy(text.split(SEP).join('')), max);
  return clean === '' ? '' : open + clean + close;
}

const escapeText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The label's default text for this niche/site (unescaped). */
export function defaultLabel(key: LabelKey, niche?: BooksyNiche, site?: Pick<WebsiteData, 'area' | 'niche'>): string {
  const d = DEFS[key].default;
  const n = niche ?? nicheByKey(site?.niche);
  return typeof d === 'function' ? d(n, site) : d;
}

/** The text a barber has stored for `key`, capped, or '' when none / unknown / not a string. */
function storedLabel(labels: WebsiteData['labels'], key: LabelKey): string {
  if (!isLabelKey(key) || !labels || typeof labels !== 'object') return '';
  if (!Object.prototype.hasOwnProperty.call(labels, key)) return '';
  const v = (labels as Record<string, unknown>)[key];
  return typeof v === 'string' ? clampLabel(v, DEFS[key].max) : '';
}

/**
 * The label to print: the barber's text if set, else the default, HTML-escaped for text nodes and
 * quoted attributes. `site` supplies the area for the footer line.
 */
export function t(
  labels: WebsiteData['labels'],
  key: LabelKey,
  niche?: BooksyNiche,
  site?: Pick<WebsiteData, 'area' | 'niche'>,
): string {
  const stored = storedLabel(labels, key);
  return escapeText(stored !== '' ? stored : defaultLabel(key, niche, site));
}

/** The labels the preview can tap for this site: only those the page prints, only the design's own. */
export function visibleLabelKeys(site: WebsiteData): LabelKey[] {
  const template: TemplateId = site.template || 'luxe';
  return LABEL_KEYS.filter((k) => {
    const d = DEFS[k];
    if (d.tap === false) return false;
    if (d.template && d.template !== template) return false;
    return d.shows ? d.shows(site) : true;
  });
}

// ── Rating wording ──────────────────────────────────────────────────────
// The scraped rating and review count are facts from the booking page or Google listing. The barber
// may re-word the sentence around them or hide the rating, never type a number: a `ratingLine`
// may hold the placeholders {rating} {count} {source} and plain words, nothing numeric.
const PLACEHOLDER = /\{(rating|count|source)\}/g;
// Number words (and fractions of them) that would state a figure.
const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty',
  'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'hundreds', 'thousand', 'thousands', 'million',
  'millions', 'billion', 'dozen', 'dozens', 'perfect',
];
const NUMBER_WORD_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${NUMBER_WORDS.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
// What a wording may contain once the placeholders are taken out: Latin letters, spaces and
// punctuation. Digits in any script, stars, emoji and other symbols are out, and so are letters of
// other alphabets (a Cyrillic "о" would let "оne" slip past the number-word check).
const ALLOWED_REST = /^[\p{Script=Latin}\p{Zs}\p{P}]*$/u;
const PERCENTS = /[%％﹪٪‰]/u;

/** The text of a stored ratingLine without any editor marker wrapper or stray separators. */
function ratingText(value: string): string {
  const [, text] = unwrap(value);
  return text.split(SEP).join('');
}

/**
 * Whether `value` is an allowed rating wording: not empty, within the cap, no digit, star, percent
 * or number word outside the {rating} {count} {source} placeholders. The app refuses to save a value
 * this rejects; the renderer ignores one (default wording) so a hand-edited record is safe too.
 */
export function isValidRatingLine(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const text = ratingText(value).normalize('NFKC').trim();
  if (text === '' || Array.from(text).length > DEFS.ratingLine.max) return false;
  // Only whole placeholders are allowed to carry the figures; strip them, then look at what is left.
  // Zero-width and combining characters are dropped first so they cannot split a number word.
  const rest = text.replace(PLACEHOLDER, ' ').replace(/[\p{Cf}\p{M}]/gu, '');
  if (/[{}]/.test(rest)) return false; // an unknown placeholder or a stray brace
  if (PERCENTS.test(rest) || !ALLOWED_REST.test(rest)) return false;
  if (NUMBER_WORD_RE.test(rest)) return false;
  return true;
}

/** Why a wording was refused, for the app's message. '' when it is fine. */
export function ratingLineProblem(value: string): string {
  if (isValidRatingLine(value)) return '';
  const text = ratingText(value).normalize('NFKC').trim();
  if (text === '') return 'Write a short sentence.';
  if (Array.from(text).length > DEFS.ratingLine.max) return `Keep it under ${DEFS.ratingLine.max} characters.`;
  return 'Use plain words only: no numbers, stars, percent signs or symbols. {rating} and {count} fill in the real figures.';
}

/** The default sentence for a rating: "4.8 from 1,200 reviews" ("4.8" alone when the count is unknown). */
export function defaultRatingLine(agg: { rating: number; count: number }): string {
  return agg.count > 0 ? `${agg.rating.toFixed(1)} from ${agg.count.toLocaleString('en-US')} reviews` : agg.rating.toFixed(1);
}

/**
 * The barber's own rating sentence, filled in (plain text, NOT escaped: callers escape), or null
 * when the page should print its standard rating markup: nothing to show (no readable aggregate,
 * or display.rating is 'hide'), no wording set, or a wording that is not allowed (a hand-edited
 * record can hold one). {rating} {count} {source} always come from the data and are never typed.
 * A wording that needs {count} or {source} when the data has none falls back to the standard markup.
 */
export function ratingLineCustom(site: WebsiteData): string | null {
  const agg = aggregateToShow(site);
  if (!agg) return null;
  const raw = site.labels && Object.prototype.hasOwnProperty.call(site.labels, 'ratingLine')
    ? (site.labels as Record<string, unknown>).ratingLine
    : '';
  if (typeof raw !== 'string' || !isValidRatingLine(raw)) return null;
  const body = cap(tidy(ratingText(raw)), DEFS.ratingLine.max);
  const source = reviewsSourceName(site);
  if (agg.count <= 0 && /\{count\}/.test(body)) return null;
  if (!source && /\{source\}/.test(body)) return null;
  // One pass over the template, so a {source} that itself contains "{count}" is not expanded again.
  return body.replace(PLACEHOLDER, (_m, name: string) =>
    name === 'rating' ? agg.rating.toFixed(1) : name === 'count' ? agg.count.toLocaleString('en-US') : source);
}
