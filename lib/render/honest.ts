// Honest-site helpers shared by the three static renderers (luxe, prime,
// euphoria) and the React editor previews, so the preview and the deployed
// page say the same thing. Vendored byte-for-byte by the iOS app.
//
// Rule (spec 2026-10-22): a generated site states a fact about the shop
// only if it came from the barber — what they typed or ticked, their
// booking page, or their confirmed Google listing. Everything else is
// wording true of any barbershop.
//
// Pure functions, no DOM. Imports only other vendored modules.
import type { WebsiteData } from '../../types';
import { nicheByKey, type BooksyNiche } from '../booksyNiche.js';
import { isStockImage } from '../stockImages.js';

// Trailing "City, State" only, so a pasted street address never lands in
// a footer or meta line.
const cityStateOnly = (raw: string): string => {
  const parts = (raw || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 2) return (raw || '').trim();
  return parts.slice(-2).join(', ');
};

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

// "Reviews from Google" / "Selected reviews from Google" / "Reviews".
export function reviewsSourceLabel(site: Pick<WebsiteData, 'reviewsSource' | 'reviewsSelected' | 'bookingUrl'>): string {
  const source = (site.reviewsSource || '').trim() || labelFromBookingUrl(site.bookingUrl);
  const lead = site.reviewsSelected ? 'Selected reviews' : 'Reviews';
  return source ? `${lead} from ${source}` : lead;
}

// A review's star count, 1-5, or null when the source didn't give one.
export function reviewStars(r: { rating?: number | null } | null | undefined): number | null {
  const n = Number(r?.rating);
  if (r?.rating == null || !Number.isFinite(n) || n < 1) return null;
  return Math.min(5, Math.round(n));
}

// The scraped aggregate, or null when absent / unreadable.
export function aggregateToShow(site: Pick<WebsiteData, 'aggregateRating'>): { rating: number; count: number } | null {
  const a = site.aggregateRating;
  const rating = Number(a?.rating);
  if (!a || !Number.isFinite(rating) || rating <= 0) return null;
  const count = Number(a.count);
  return { rating: Math.min(5, rating), count: Number.isFinite(count) && count > 0 ? Math.round(count) : 0 };
}

// ── Photos ───────────────────────────────────────────────────────────
// True only when there are photos and none is a sample: the condition for
// Prime's "no stock photos" line.
export function galleryIsAllOwnPhotos(urls: (string | null | undefined)[]): boolean {
  const filled = urls.filter((u): u is string => !!u);
  return filled.length > 0 && !filled.some(isStockImage);
}

export function hasServices(site: Pick<WebsiteData, 'services'>): boolean {
  return Array.isArray(site.services) && site.services.some((s) => (s?.title || '').trim());
}
