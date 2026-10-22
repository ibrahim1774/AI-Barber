import type { WebsiteData } from '@/web/types';
import { getEntitlements, type Entitlements } from '@/lib/entitlements';
import { stripLapsedLinks } from '@/lib/tierLinks';
import { isAiBarberBookingUrl, isAiBarberShopUrl, type Shop } from '@/lib/shop';
import { SITE_BOOK_PATH, SITE_SHOP_PATH } from '@/web/lib/render/subpages';
import type { SiteRecord } from '@/lib/siteStore';

/**
 * The barber's Book button choice. App-only (kept in the site record's `inputs`, never sent as
 * website data): `ownBookingUrl` is their own Booksy / Square / etc. link and is never lost;
 * `bookingChoice` says which one the website uses.
 */
export type BookingChoice = 'own' | 'aibarber';
export type BookingPrefs = {
  ownBookingUrl?: string;
  bookingChoice?: BookingChoice;
  /**
   * The barber cleared their own link. Until they type a new one, no own link is derived from the
   * site data or the import's / restore's `inputs.bookingUrl`, so a cleared link never comes back.
   */
  ownBookingCleared?: boolean;
};

const ownLinkOf = (url?: string | null): string | null => {
  const u = url?.trim();
  return u && !isAiBarberBookingUrl(u) ? u : null;
};

/**
 * The barber's own link from a record: the stored one, else (unless they cleared it) a non-AI-Barber
 * Book link in the data or inputs.
 */
const deriveOwn = (rec: { inputs: Partial<SiteRecord['inputs']>; data: WebsiteData }): string | null => {
  const stored = rec.inputs.ownBookingUrl?.trim();
  if (stored) return stored;
  if (rec.inputs.ownBookingCleared) return null;
  return ownLinkOf(rec.data.bookingUrl) || ownLinkOf(rec.inputs.bookingUrl);
};

/** The own link and the effective choice (default: own when an own link exists, else AI Barber). */
export function bookingPrefs(rec: { inputs: Partial<SiteRecord['inputs']>; data: WebsiteData }): { own: string | null; choice: BookingChoice } {
  const own = deriveOwn(rec);
  // A record from before the choice existed: an AI Barber link means AI Barber, an own link means keep it.
  const choice = rec.inputs.bookingChoice ?? (isAiBarberBookingUrl(rec.data.bookingUrl) ? 'aibarber' : own ? 'own' : 'aibarber');
  return { own: own || null, choice: own ? choice : 'aibarber' };
}

/**
 * Writes the prefs into a record saved before they existed (the readers derive the same values, so
 * nothing depends on this having run). Returns the same object when nothing changes.
 */
export function migrateBooking(rec: SiteRecord): SiteRecord {
  const i = rec.inputs;
  const own = deriveOwn(rec);
  if (i.bookingChoice !== undefined && ('ownBookingUrl' in i || !own)) return rec;
  const choice: BookingChoice = i.bookingChoice ?? (isAiBarberBookingUrl(rec.data.bookingUrl) ? 'aibarber' : own ? 'own' : 'aibarber');
  const inputs = { ...i, ...(own ? { ownBookingUrl: own } : {}), bookingChoice: choice };
  if (inputs.ownBookingUrl === i.ownBookingUrl && inputs.bookingChoice === i.bookingChoice) return rec;
  return { ...rec, inputs };
}

/** The record with the choice applied: the prefs, and the Book link the editor and preview show. */
export function withChoice(rec: SiteRecord, choice: BookingChoice, _shop?: Pick<Shop, 'slug'>): SiteRecord {
  const { own } = bookingPrefs(rec);
  const data = { ...rec.data };
  // AI Barber booking is the site's own /book page (served from the barber's domain).
  const url = choice === 'aibarber' ? SITE_BOOK_PATH : own;
  if (url) data.bookingUrl = url;
  else delete data.bookingUrl;
  const inputs = { ...rec.inputs, bookingChoice: choice, ...(own ? { ownBookingUrl: own } : {}) };
  return { ...rec, data, inputs };
}

/**
 * After an edit of the website data: a changed Book link that isn't an AI Barber one is the
 * barber's own link (and the choice follows it); clearing it clears the own link.
 */
export function syncOwnLink(prev: SiteRecord, next: SiteRecord): SiteRecord {
  const before = prev.data.bookingUrl?.trim() || '';
  const after = next.data.bookingUrl?.trim() || '';
  if (before === after || isAiBarberBookingUrl(after)) return next;
  const inputs = { ...next.inputs };
  if (after) {
    inputs.ownBookingUrl = after;
    inputs.bookingChoice = 'own';
    delete inputs.ownBookingCleared;
  } else if (isAiBarberBookingUrl(before)) {
    // They cleared a link they didn't type: the own link is kept, and the site goes back to it.
    inputs.bookingChoice = 'own';
  } else {
    // Cleared on purpose: remembered, so the import's copy (inputs.bookingUrl) is never used again.
    delete inputs.ownBookingUrl;
    inputs.ownBookingCleared = true;
  }
  return { ...next, inputs };
}

/** "booksy.com/fade-lab": no scheme, www, query or trailing slash, kept short. */
export function shortLink(url: string): string {
  const s = url.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  // By code points, so an emoji is never cut in half.
  const chars = Array.from(s);
  return chars.length > 34 ? `${chars.slice(0, 33).join('')}…` : s;
}

export type LinkContext = {
  ents: Entitlements;
  /** The owner's shop row (null when there is none). */
  shop: Pick<Shop, 'slug' | 'purchaseLinked'> & { bookingsEnabled?: boolean } | null;
  storeEnabled: boolean;
};

/**
 * The website data to publish, with the Book and Shop links decided from the choice and the plan, never from
 * whatever the server stored last time. Book: AI Barber's link only when chosen AND the plan has bookings AND a shop
 * exists; otherwise the barber's own link, or none. Shop: only with the Store plan and an open, linked shop.
 * Does nothing until the entitlements are known and hosting is visibly active (the server still decides).
 */
export function resolveLinks(
  data: WebsiteData,
  inputs: Partial<SiteRecord['inputs']> | undefined,
  ctx: LinkContext,
): WebsiteData & { shopUrl?: string } {
  const { ents, shop } = ctx;
  if (!ents.known || !ents.hosting) return data;
  const { own, choice } = bookingPrefs({ data, inputs: inputs ?? {} });
  const out: WebsiteData & { shopUrl?: string } = { ...data };
  // The site's own /book and /shop pages (the server serves them from the barber's domain and renders the homepage strips).
  const book = choice === 'aibarber' && ents.bookings && shop && shop.bookingsEnabled && shop.purchaseLinked ? SITE_BOOK_PATH : own;
  if (book) out.bookingUrl = book;
  else delete out.bookingUrl;
  if (ents.store && shop && shop.purchaseLinked && ctx.storeEnabled) out.shopUrl = SITE_SHOP_PATH;
  else delete out.shopUrl;
  return out;
}

/**
 * The website data a publish sends, with its Book and Shop links decided: resolveLinks when the shop facts are
 * known, else only what the plan lacks is dropped; a dropped AI Barber link falls back to the own link. The one
 * resolution publish and the setup prompt share.
 */
export function linksToSend(
  data: WebsiteData,
  inputs: Partial<SiteRecord['inputs']> | undefined,
  ctx: LinkContext | null,
): WebsiteData & { shopUrl?: string } {
  const own = bookingPrefs({ data, inputs: inputs ?? {} }).own;
  return ctx
    ? stripLapsedLinks(resolveLinks(data, inputs, ctx), ctx.ents, own)
    : stripLapsedLinks(data, getEntitlements(), own);
}

/** The Book and Shop links a website shows (what was last published, or what a publish would send). */
export type LiveLinks = { bookingUrl: string | null; shopUrl: string | null };

export function linksOf(d: unknown): LiveLinks {
  const o = d && typeof d === 'object' ? (d as { bookingUrl?: unknown; shopUrl?: unknown }) : {};
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { bookingUrl: str(o.bookingUrl), shopUrl: str(o.shopUrl) };
}

/**
 * The same button whatever form it is stored in: the old aibarber.org/book/{slug} and /shop/{slug}
 * links and the site's own /book and /shop are one AI Barber button each (the server renders both
 * as the site page). A barber's own link stays as it is.
 */
export function canonicalLinks(l: LiveLinks): LiveLinks {
  return {
    bookingUrl: isAiBarberBookingUrl(l.bookingUrl) ? SITE_BOOK_PATH : l.bookingUrl,
    shopUrl: l.shopUrl == null ? null : isAiBarberShopUrl(l.shopUrl) ? SITE_SHOP_PATH : l.shopUrl,
  };
}
