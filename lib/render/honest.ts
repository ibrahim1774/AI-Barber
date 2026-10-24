// Honest-site helpers shared by the three static renderers (luxe, prime,
// euphoria) and the React editor previews, so the preview and the deployed
// page say the same thing. Vendored byte-for-byte by the iOS app.
//
// Rule (spec 2026-10-22): a generated site states a fact about the shop
// only if it came from the barber — what they typed or ticked, their
// booking page, or their confirmed Google listing. Everything else is
// wording true of any barbershop.
//
// Page-length copy (pages v2, 2026-10-24) is held to a stricter version of "wording true of any barbershop": the
// rules R1 to R9 in copyRules.ts (no "we/our", no ranking, no years or licences, no walk-in/parking/free, no promises,
// no figures except advice like "2-4 weeks", no place names, no service the shop does not list). The library
// (copyLibrary.ts) is tested against them sentence by sentence and guides.ts checks again when it renders.
//
// Pure functions, no DOM. Imports only other vendored modules.
import type { TeamMember, WebsiteData } from '../../types';
import { nicheByKey, type BooksyNiche } from '../booksyNiche.js';
import { isStockImage } from '../stockImages.js';
import { safeHref } from './safeHref.js';

// Trailing "City, State" only, so a pasted street address never lands in
// a footer or meta line.
export const cityStateOnly = (raw: string): string => {
  const parts = (raw || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 2) return (raw || '').trim();
  return parts.slice(-2).join(', ');
};

// The shop's one place for page titles (pgPlace default): "City, ST" from whatever `area` holds. The app importer stores
// the whole street address when no area is given, so "123 Main St, Brooklyn, NY 11201, USA" must give "Brooklyn, NY".
// Drops a trailing country and a ZIP, then takes the city and state like gbpPlaces locationFromAddress. A result that
// still holds a digit (a street address) or is longer than 60 characters is not a place: '' (the page keeps its old
// title and shows no place line). cityStateOnly above is untouched: the single-page renderers use it.
const COUNTRY = /^(?:usa|u\.s\.a\.?|us|u\.s\.|united states(?: of america)?|canada|mexico|uk|united kingdom)$/i;
export function placeFromArea(raw: string): string {
  const parts = String(raw || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1 && COUNTRY.test(parts[parts.length - 1])) parts.pop();
  let place: string;
  if (parts.length >= 3) {
    const state = parts[parts.length - 1].replace(/\s+\S*\d\S*(?:\s+\S*\d\S*)?$/, '').trim();
    place = [parts[parts.length - 2], state].filter(Boolean).join(', ');
  } else {
    place = parts.join(', ');
  }
  return /\d/.test(place) || Array.from(place).length > 60 ? '' : place;
}

export function nicheOf(site: Pick<WebsiteData, 'niche'>): BooksyNiche {
  return nicheByKey(site.niche);
}

// "<Shop> in <Area>" (or just "<Shop>" with no area).
export function siteTitle(site: Pick<WebsiteData, 'shopName' | 'area'>): string {
  const area = (site.area || '').trim();
  return area ? `${site.shopName} in ${area}` : site.shopName;
}

// "<Shop> — <niche label> in <Area>. Book online." The last sentence only
// when there is a booking link to book online with.
export function siteDescription(site: Pick<WebsiteData, 'shopName' | 'area' | 'niche' | 'bookingUrl'>): string {
  const area = (site.area || '').trim();
  const label = nicheOf(site).industry;
  const base = `${site.shopName} — ${label}${area ? ` in ${area}` : ''}.`;
  return (site.bookingUrl || '').trim() ? `${base} Book online.` : base;
}

// Footer line: "Barbershop in Austin, TX".
export function footerLine(site: Pick<WebsiteData, 'area' | 'niche'>): string {
  const city = cityStateOnly(site.area || '');
  const label = nicheOf(site).industry;
  return city ? `${label} in ${city}` : label;
}

export function copyrightYear(): number {
  // UTC so the same render gives the same year on any server or test machine.
  return new Date().getUTCFullYear();
}

// Alt text for any shop photo. Never "atmosphere" / "our work": the photo
// may be a sample.
export function photoAlt(site: Pick<WebsiteData, 'shopName'>): string {
  const name = (site.shopName || '').trim();
  return name ? `${name} photo` : 'Shop photo';
}

// ── Phone ────────────────────────────────────────────────────────────
// How a phone number is PRINTED: "(512) 555-0142" when it is exactly ten digits with ordinary
// separators, otherwise as typed ("call us", "+44 20 7946 0958", "5125550142 ext 2" stay). Idempotent.
// The tel: link keeps using the digits of the stored value. A value wrapped in the app's editor
// markers (U+2063 id U+2063 ... U+2063 / U+2063) keeps its wrapper, so the preview stays tappable.
const PHONE_WRAPPED = /^(\u2063[a-z]+\u2063)([\s\S]*?)(\u2063\/\u2063)$/;
export function displayPhone(raw: string | null | undefined): string {
  const value = String(raw ?? '');
  const m = PHONE_WRAPPED.exec(value);
  const [open, text, close] = m ? [m[1], m[2], m[3]] : ['', value, ''];
  const typed = text.trim();
  if (!/^[\d\s().\-]+$/.test(typed)) return value;
  const d = typed.replace(/\D/g, '');
  if (d.length !== 10) return value;
  return `${open}(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}${close}`;
}

// ── Policy ───────────────────────────────────────────────────────────
// The invented Prime default every site used to carry. Sites saved with
// it (in full or with only the title edited) must not show it.
const LEGACY_POLICY_BODY =
  'We work appointment-only — your booked time is held for you. Cancellations within 4 hours of the appointment, and no-shows, are billed in full. Please come freshly washed; products and a hot-towel finish are included in every cut.';

// The barber's own policy, or null. Renders only from barber text.
export function policyToShow(site: Pick<WebsiteData, 'policy'>): { title: string; body: string } | null {
  const p = site.policy;
  const body = (p?.body || '').trim();
  if (!body || body === LEGACY_POLICY_BODY) return null;
  return { title: (p?.title || '').trim(), body };
}

// ── Feature cards ────────────────────────────────────────────────────
// The invented hero cards older sites were seeded with.
const INVENTED_CARDS = new Set([
  'experience|professional',
  'service|trusted',
  'open monday to friday|9am - 7pm',
]);

// Only cards the barber wrote. Empty → templates omit the card strip.
export function visibleFeatureCards(site: Pick<WebsiteData, 'featureCards'>): { title: string; sub: string }[] {
  return (site.featureCards || []).filter((c) => {
    const title = (c?.title || '').trim();
    const sub = (c?.sub || '').trim();
    if (!title && !sub) return false;
    return !INVENTED_CARDS.has(`${title.toLowerCase()}|${sub.toLowerCase()}`);
  });
}

// ── Email ────────────────────────────────────────────────────────────
// Older typed sites carry an invented contact@<shopname>.com. Hide that
// exact address; anything else was typed or scraped.
export function inventedEmailFor(shopName: string): string {
  const slug = (shopName || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'contact';
  return `contact@${slug}.com`;
}

export function contactEmail(site: Pick<WebsiteData, 'contact' | 'shopName'>): string {
  const email = (site.contact?.email || '').trim();
  if (!email) return '';
  if (email.toLowerCase() === inventedEmailFor(site.shopName).toLowerCase()) return '';
  return email;
}

// ── Reviews ──────────────────────────────────────────────────────────
// Scrape platform id (`_platform` on the import responses) → the name
// shown in "Reviews from <platform>".
export const PLATFORM_LABELS: Record<string, string> = {
  gbp: 'Google',
  google: 'Google',
  booksy: 'Booksy',
  thecut: 'theCut',
  fresha: 'Fresha',
  square: 'Square',
  styleseat: 'StyleSeat',
  vagaro: 'Vagaro',
  goldie: 'Goldie',
  setmore: 'Setmore',
};

export function platformLabel(id?: string | null): string | undefined {
  if (!id) return undefined;
  return PLATFORM_LABELS[String(id).toLowerCase()];
}

// Older sites have no reviewsSource; infer it from the booking link host.
const HOST_LABELS: { re: RegExp; label: string }[] = [
  { re: /(^|\.)booksy\.com$/i, label: 'Booksy' },
  { re: /(^|\.)thecut\.co$/i, label: 'theCut' },
  { re: /(^|\.)fresha\.com$/i, label: 'Fresha' },
  { re: /(^|\.)(squareup|square)\.(com|site)$/i, label: 'Square' },
  { re: /(^|\.)styleseat\.com$/i, label: 'StyleSeat' },
  { re: /(^|\.)vagaro\.com$/i, label: 'Vagaro' },
  { re: /(^|\.)heygoldie\.com$/i, label: 'Goldie' },
  { re: /(^|\.)setmore\.com$/i, label: 'Setmore' },
];

function labelFromBookingUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
    return HOST_LABELS.find((h) => h.re.test(host))?.label;
  } catch {
    return undefined;
  }
}

// The platform the reviews came from ("Google", "Booksy"), or '' when unknown.
export function reviewsSourceName(site: Pick<WebsiteData, 'reviewsSource' | 'bookingUrl'>): string {
  return (site.reviewsSource || '').trim() || labelFromBookingUrl(site.bookingUrl) || '';
}

// "Reviews from Google" / "Selected reviews from Google" / "Selected
// reviews". Empty when the source is unknown and nothing was filtered:
// templates then print no source line at all (no lone "Reviews").
export function reviewsSourceLabel(site: Pick<WebsiteData, 'reviewsSource' | 'reviewsSelected' | 'bookingUrl'>): string {
  const source = reviewsSourceName(site);
  const lead = site.reviewsSelected ? 'Selected reviews' : 'Reviews';
  if (source) return `${lead} from ${source}`;
  return site.reviewsSelected ? lead : '';
}

// A review's star count, 1-5, or null when the source didn't give one.
export function reviewStars(r: { rating?: number | null } | null | undefined): number | null {
  const n = Number(r?.rating);
  if (r?.rating == null || !Number.isFinite(n) || n < 1) return null;
  return Math.min(5, Math.round(n));
}

// The scraped aggregate, or null when absent / unreadable / hidden by the barber
// (display.rating 'hide'). Every place a template prints the rating or the review count asks here.
export function aggregateToShow(
  site: Pick<WebsiteData, 'aggregateRating'> & { display?: WebsiteData['display'] },
): { rating: number; count: number } | null {
  if (site.display?.rating === 'hide') return null;
  const a = site.aggregateRating;
  const rating = Number(a?.rating);
  if (!a || !Number.isFinite(rating) || rating <= 0) return null;
  const count = Number(a.count);
  return { rating: Math.min(5, rating), count: Number.isFinite(count) && count > 0 ? Math.round(count) : 0 };
}

// A review's identity for hiding: a 32-bit FNV-1a hash of author + comment (trimmed, lower-cased), in
// base 36. Not the array position: importing again reorders reviews. Pure JS (the app runs this in
// Hermes, which has no Node crypto).
export function reviewKey(r: { author?: string; comment?: string } | null | undefined): string {
  const text = `${(r?.author || '').trim()}\n${(r?.comment || '').trim()}`.toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// The reviews the page shows: those the barber has not hidden. Applied BEFORE any slice, and the
// reviews section appears only if something is left.
export function visibleReviews<T extends { author?: string; comment?: string }>(
  site: { reviews?: T[]; hiddenReviews?: string[] },
): T[] {
  const reviews = Array.isArray(site.reviews) ? site.reviews : [];
  const hidden = new Set(Array.isArray(site.hiddenReviews) ? site.hiddenReviews.filter((k) => typeof k === 'string') : []);
  return hidden.size === 0 ? reviews : reviews.filter((r) => !hidden.has(reviewKey(r)));
}

// ── Photos ───────────────────────────────────────────────────────────
// Photos pulled from the shop's own booking page (Booksy, theCut …). Not
// Google: listing photos include customer uploads, exteriors and Street
// View, so "real cuts from inside the shop" can't be claimed for them.
// Older sites without `importedFrom` count only if their booking link is
// a known booking platform.
export function photosAreFromBookingPage(site: Pick<WebsiteData, 'importedFrom' | 'bookingUrl'>): boolean {
  if (site.importedFrom) return site.importedFrom === 'booking';
  return !!labelFromBookingUrl(site.bookingUrl);
}

// True only when there are photos and none is a sample: the condition for
// Prime's "no stock photos" line.
export function galleryIsAllOwnPhotos(urls: (string | null | undefined)[]): boolean {
  const filled = urls.filter((u): u is string => !!u);
  return filled.length > 0 && !filled.some(isStockImage);
}

export function hasServices(site: Pick<WebsiteData, 'services'>): boolean {
  return Array.isArray(site.services) && site.services.some((s) => (s?.title || '').trim());
}

// ── Prices ───────────────────────────────────────────────────────────
// A bare number ("25", "25.50") is a dollar price → "$25". Anything else
// ("$25", "25+", "£20", "from $30") is shown as typed.
export function displayPrice(raw: string | null | undefined): string {
  const p = (raw || '').trim();
  return /^\d+(\.\d{1,2})?$/.test(p) ? `$${p}` : p;
}

// The small line under a service title: duration, else subtitle. Never a
// second copy of the price (older scraped sites stored "30 min · $30" or
// just "$30" as the subtitle).
export function serviceMeta(s: { duration?: string; subtitle?: string; price?: string }): string {
  let meta = (s.duration || s.subtitle || '').trim();
  const price = (s.price || '').trim();
  if (!meta || !price) return meta;
  if (meta === price || meta === displayPrice(price)) return '';
  for (const p of [price, displayPrice(price)]) {
    const suffix = ` · ${p}`;
    if (meta.endsWith(suffix)) meta = meta.slice(0, -suffix.length).trim();
  }
  return meta;
}

// ── Niche-aware body copy ────────────────────────────────────────────
export function nicheCopy(site: Pick<WebsiteData, 'niche'>): {
  teamHeading: string;
  bookingEyebrow: string;
  bookingNext: string;
  visitEyebrow: string;
  pullQuote: string;
} {
  if (nicheOf(site).key === 'barber') {
    return {
      teamHeading: 'Meet Our Barbers',
      bookingEyebrow: 'Take a Chair',
      bookingNext: 'your next cut?',
      visitEyebrow: 'Find the chair',
      pullQuote: "A great cut isn't a transaction — it's a craft.",
    };
  }
  return {
    teamHeading: 'Meet the Team',
    bookingEyebrow: 'Book a Visit',
    bookingNext: 'your next visit?',
    visitEyebrow: 'Find us',
    pullQuote: 'We look forward to seeing you.',
  };
}

// ── Legacy invented copy on older stored sites ───────────────────────
// Sites saved before 2026-10-22 carry copy we wrote on the barber's
// behalf. Hidden on render by EXACT match only (same tradeoff as the
// invented email): anything the barber changed is kept.

// The 5-service menus every typed site (luxe / euphoria) and every old
// Google import (GbpImportPage's default: luxe titles + descriptions, no
// subtitle) received. [title, description, original subtitle].
const LEGACY_SERVICE_SETS: [string, string, string][][] = [
  [
    ['Classic Haircut', 'A clean, considered cut tailored to how you actually wear your hair.', 'Cut, washed, styled'],
    ['Beard Trim & Styling', 'Defined lines, blended length, and a finish that holds between visits.', 'Shaped and finished'],
    ['Hot Towel Shave', 'A traditional straight-razor shave with warm towels and a clean, close finish.', 'Straight razor, classic finish'],
    ['Skin Fade', 'Precise tapering from skin upward, blended for a clean, modern shape.', 'Sharp, blended, exact'],
    ['Hair & Scalp Treatment', 'A thorough cleanse and conditioning treatment to reset the scalp.', 'Cleanse and condition'],
  ],
  [
    ['Classic Haircut', 'A clean, considered cut shaped around how you actually wear your hair.', 'Cut, washed, finished'],
    ['Beard Trim & Styling', 'Defined edges and blended length — a finish that reads on and off the chair.', 'Shaped and refined'],
    ['Hot Towel Shave', 'Warm towels and a straight razor, finished close and clean.', 'Straight razor, traditional'],
    ['Skin Fade', 'Precise skin-up tapering blended into a clean, modern shape.', 'Tapered, blended, exact'],
    ['Hair & Scalp Treatment', 'A deep cleanse and conditioning treatment to reset the scalp between cuts.', 'Reset and condition'],
  ],
];

const LEGACY_BOOK_AHEAD = 'Book ahead — same care every visit.';

const LEGACY_TAGLINES = new Set([
  'Premium grooming, considered every step.',
  'Hand-cut, head by head.',
  'Premium grooming services tailored to your style.',
  'Lash and brow work done with a careful, steady hand.',
  'Braids and locs styled with patience and care.',
  'Nail care that lasts, in a space you can relax in.',
  'Aesthetic treatments planned around what you actually want changed.',
  'Facials and skin treatments matched to your skin.',
  'Massage and bodywork in a calm, unhurried space.',
  'Hair removal done quickly, cleanly, and comfortably.',
  'Makeup for the day you actually have planned.',
  'Custom tattoo work, start to finish.',
  'Grooming your pet is comfortable with.',
  'Training built around where you are starting from.',
  'Dental care explained plainly, at a pace you are comfortable with.',
  'Care that treats the cause, not just the symptom.',
  'Reliable work at your place, when we say we will be there.',
  'Straightforward service from someone who answers the phone.',
  'Cut, color, and styling tailored to your hair.',
]);

const LEGACY_ABOUT_HEADINGS = new Set(['Built around the cut.', 'Craft, character, and community.']);

// Old generateContent about paragraphs (shop name and area stitched in).
const LEGACY_ABOUT_PATTERNS: RegExp[] = [
  /^.+ is a neighborhood barbershop in .* built around honest work and consistent craft\. Every visit starts with a real conversation and ends with a cut you can wear with confidence\.$/,
  /^.+ is a barbershop in .* built around the cut you want — sharp, considered, and made for the people we serve\. Every appointment is real conversation followed by real craft\.$/,
];

// Old niche fallbacks: "<shop> " + first, then second as its own paragraph.
const LEGACY_FALLBACK_FIRST = [
  'is a neighborhood barbershop built around honest work and consistent craft.',
  'is a lash and brow studio built around detail and a comfortable appointment.',
  'is a braiding and locs salon built around protective styles that last.',
  'is a neighborhood nail salon built around clean work and careful detail.',
  'is a medical aesthetics clinic built around careful assessment before any treatment.',
  'is a skin care studio built around treatments that suit your skin, not a script.',
  'is a massage studio built around real bodywork and a calm room.',
  'is a waxing studio built around fast, comfortable appointments.',
  'is a makeup studio built around looks that hold up all day and photograph well.',
  'is a tattoo studio built around custom work and a clean, careful process.',
  'is a pet grooming salon built around low-stress handling and a clean finish.',
  'is a training studio built around steady progress, not quick fixes.',
  'is a dental practice built around clear explanations and unhurried appointments.',
  'is a wellness clinic built around getting to the root of the problem.',
  'is a local home services company built around showing up on time and doing the job properly.',
  'is a local business built around doing right by the people it works with.',
  'is a neighborhood hair salon built around honest work and consistent results.',
];
const LEGACY_FALLBACK_SECOND = new Set([
  'Every visit starts with a real conversation and ends with a cut you can wear with confidence.',
  'Every set is shaped to suit your eyes, your routine, and how much upkeep you want.',
  'Every appointment is unhurried, so your style is installed the way it should be.',
  'Every appointment is unhurried, so your set is finished the way you want it.',
  'Every visit starts with a consultation so the plan fits your face and your budget.',
  'Every appointment starts with a proper look at your skin before anything else.',
  'Every session is adjusted to how you feel that day, not a fixed routine.',
  'Every service is done with clean technique so you are in and out without fuss.',
  'Every appointment starts with what you are getting ready for.',
  'Every piece starts with a consult so the design is right before the needle.',
  'Every groom goes at your pet’s pace, however long that takes.',
  'Every session is planned around your goals and how your week actually looks.',
  'Every visit starts by listening, so you know what is happening and why.',
  'Every plan is built around your history and how your body actually responds.',
  'Every job is quoted clearly up front, so there are no surprises at the end.',
  'Every job starts with a proper conversation about what you actually need.',
  'Every appointment starts with a real conversation about your hair before anything is cut.',
]);

const isLegacyAboutParagraph = (p: string): boolean => {
  const t = (p || '').trim();
  if (LEGACY_FALLBACK_SECOND.has(t)) return true;
  if (LEGACY_ABOUT_PATTERNS.some((re) => re.test(t))) return true;
  return LEGACY_FALLBACK_FIRST.some((f) => t.endsWith(` ${f}`));
};

// The stored menu is the invented default only when every row is
// untouched: title + description match, no price, no duration, and the
// subtitle is empty or the original default. Any barber edit (a price, a
// duration, a changed subtitle) keeps the whole menu.
const isLegacyServiceSet = (services: WebsiteData['services']): boolean => {
  if (!Array.isArray(services) || services.length !== 5) return false;
  return LEGACY_SERVICE_SETS.some((set) => {
    const remaining = [...set];
    return services.every((s) => {
      if ((s?.price || '').trim() || (s?.duration || '').trim()) return false;
      const title = (s?.title || '').trim();
      const description = (s?.description || '').trim();
      const subtitle = (s?.subtitle || '').trim();
      const k = remaining.findIndex(([t, d, sub]) => t === title && d === description && (subtitle === '' || subtitle === sub));
      if (k === -1) return false;
      remaining.splice(k, 1);
      return true;
    });
  });
};

// The filler descriptions old booking-link imports wrote.
const legacyFiller = (s: { description?: string; price?: string }): boolean => {
  const d = (s.description || '').trim();
  if (d === LEGACY_BOOK_AHEAD) return true;
  const m = d.match(/^Starting at (.+)\.$/);
  return !!m && m[1].trim() === (s.price || '').trim();
};

// A copy of the site with the known invented legacy copy removed:
// the default 5-service set, filler service descriptions, "Premium…" and
// old niche taglines, and the templated about heading / text (replaced by
// today's generic niche wording). Returns the site unchanged (same
// object) when none of it is present.
export function withoutLegacyCopy<T extends WebsiteData>(site: T): T {
  if (!site) return site;
  const niche = nicheOf(site);
  let out: T = site;
  const patch = (p: Partial<WebsiteData>) => { out = { ...out, ...p }; };

  const services = Array.isArray(site.services) ? site.services : [];
  if (isLegacyServiceSet(services)) {
    patch({ services: [] });
  } else if (services.some(legacyFiller)) {
    patch({ services: services.map((s) => (legacyFiller(s) ? { ...s, description: '' } : s)) });
  }

  const tagline = (site.hero?.tagline || '').trim();
  if (LEGACY_TAGLINES.has(tagline)) patch({ hero: { ...site.hero, tagline: niche.heroTagline } });

  const heading = (site.about?.heading || '').trim();
  const desc = Array.isArray(site.about?.description) ? site.about.description : [];
  const legacyParas = desc.filter(isLegacyAboutParagraph);
  if (LEGACY_ABOUT_HEADINGS.has(heading) || legacyParas.length > 0) {
    let kept = desc.filter((p) => !isLegacyAboutParagraph(p));
    if (kept.length === 0 && legacyParas.length > 0) {
      const area = (site.area || '').trim();
      const article = /^[aeiou]/i.test(niche.noun) ? 'an' : 'a';
      kept = [
        `${site.shopName} is ${article} ${niche.noun}${area ? ` in ${area}` : ''}.`,
        niche.aboutFallback[1],
      ];
    }
    patch({
      about: {
        ...site.about,
        heading: LEGACY_ABOUT_HEADINGS.has(heading) ? niche.aboutHeading : site.about.heading,
        description: kept,
      },
    });
  }
  return out;
}


// ── Team (spec 2026-10-23, P2) ────────────────────────────────────────────
/** Renders show at most this many team cards. The stored staff[] is never cut. */
export const TEAM_DISPLAY_CAP = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cleanStr = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ').trim();
  return t ? Array.from(t).slice(0, max).join('') : undefined;
};

/** A team member as the renderers see it: cleaned, plus `index` = its position in the stored staff[] (the `staff<i>` image key). */
export interface TeamCard extends TeamMember {
  index: number;
  /** URL-safe id for the card anchor (#team-<slug>), unique within the team. */
  slug: string;
}

const slugOf = (name: string): string =>
  name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'member';

/**
 * The ONLY reader of `staff` for the renderers. Entries without a name are skipped, text fields are
 * cleaned and capped, `memberId` survives only as a UUID and `bookingUrl` only as an absolute http(s)
 * link. At most TEAM_DISPLAY_CAP cards come back (with legacyUncapped, only entries that have a
 * memberId are capped; older entries without one all stay); the stored array is not changed.
 */
export function teamOf(site: Pick<WebsiteData, 'staff'>, opts: { legacyUncapped?: boolean } = {}): TeamCard[] {
  const staff = Array.isArray(site.staff) ? site.staff : [];
  const out: TeamCard[] = [];
  const used = new Set<string>();
  for (let index = 0; index < staff.length; index++) {
    const s = staff[index] as Partial<TeamMember> | null;
    if (!s || typeof s !== 'object') continue;
    const name = cleanStr(s.name, 80);
    if (!name) continue;
    const hasId = typeof s.memberId === 'string' && UUID.test(s.memberId);
    // legacyUncapped (luxe, which always showed every staff entry): the cap counts only entries with a
    // memberId. Otherwise (prime, euphoria: a new section) every entry counts toward the cap.
    if (opts.legacyUncapped) {
      if (hasId && out.filter((c) => c.memberId).length >= TEAM_DISPLAY_CAP) continue;
    } else if (out.length >= TEAM_DISPLAY_CAP) break;
    let slug = slugOf(name);
    for (let n = 2; used.has(slug); n++) slug = `${slugOf(name)}-${n}`;
    used.add(slug);
    const url = typeof s.bookingUrl === 'string' && /^https?:\/\//i.test(s.bookingUrl.trim()) ? safeHref(s.bookingUrl) : null;
    const names = Array.isArray(s.serviceNames)
      ? s.serviceNames.map((n) => cleanStr(n, 40)).filter((n): n is string => !!n).slice(0, 3)
      : [];
    out.push({
      index, slug, name,
      role: cleanStr(s.role, 80),
      photo: typeof s.photo === 'string' && s.photo ? s.photo : undefined,
      bio: cleanStr(s.bio, 600),
      bookingUrl: url ?? undefined,
      serviceNames: names.length ? names : undefined,
      memberId: typeof s.memberId === 'string' && UUID.test(s.memberId) ? s.memberId : undefined,
    });
  }
  return out;
}

/** "Sam Fade" -> "Sam". */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] || name;

/**
 * Where a team card's Book button goes, or null for no button:
 *  1. the site's own booking page is live (`bookingLive`, i.e. bookingUrl is /book) and the member
 *     is a booking member (UUID memberId): /book?barber=<id>, same tab;
 *  2. else the member's own booking link, new tab;
 *  3. else the shop's booking link (the site's /book same tab, another site new tab);
 *  4. else none.
 * `kind` is 'member' when the link goes to this member (1, 2) and 'shop' otherwise (3): only 'member'
 * may say "Book with <name>". The caller escapes `href` for the attribute.
 */
export function teamBookLink(
  site: Pick<WebsiteData, 'bookingUrl'>,
  member: Pick<TeamCard, 'memberId' | 'bookingUrl'>,
  bookingLive: boolean,
): { href: string; newTab: boolean; kind: 'member' | 'shop' } | null {
  if (bookingLive && member.memberId && UUID.test(member.memberId)) {
    return { href: `/book?barber=${encodeURIComponent(member.memberId)}`, newTab: false, kind: 'member' };
  }
  if (member.bookingUrl) {
    const own = safeHref(member.bookingUrl);
    if (own && /^https?:\/\//i.test(own)) return { href: own, newTab: true, kind: 'member' };
  }
  const shop = safeHref(site.bookingUrl);
  return shop ? { href: shop, newTab: !shop.startsWith('/'), kind: 'shop' } : null;
}
