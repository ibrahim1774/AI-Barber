import type { WebsiteData } from '@/web/types';
import type { Entitlements } from '@/lib/entitlements';
import { bookingUrl, isAiBarberBookingUrl, type Shop } from '@/lib/shop';
import { shopUrl } from '@/lib/store/data';
import type { SiteRecord } from '@/lib/siteStore';

/**
 * The barber's Book button choice. App-only (kept in the site record's `inputs`, never sent as
 * website data): `ownBookingUrl` is their own Booksy / Square / etc. link and is never lost;
 * `bookingChoice` says which one the website uses.
 */
export type BookingChoice = 'own' | 'aibarber';
export type BookingPrefs = { ownBookingUrl?: string; bookingChoice?: BookingChoice };

const ownLinkOf = (url?: string | null): string | null => {
  const u = url?.trim();
  return u && !isAiBarberBookingUrl(u) ? u : null;
};

/** The own link and the effective choice (default: own when an own link exists, else AI Barber). */
export function bookingPrefs(rec: { inputs: Partial<SiteRecord['inputs']>; data: WebsiteData }): { own: string | null; choice: BookingChoice } {
  const own = rec.inputs.ownBookingUrl?.trim() || ownLinkOf(rec.data.bookingUrl);
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
  if (i.ownBookingUrl !== undefined && i.bookingChoice !== undefined) return rec;
  const own = i.ownBookingUrl?.trim() || ownLinkOf(rec.data.bookingUrl) || ownLinkOf(i.bookingUrl);
  const choice: BookingChoice = i.bookingChoice ?? (isAiBarberBookingUrl(rec.data.bookingUrl) ? 'aibarber' : own ? 'own' : 'aibarber');
  const inputs = { ...i, ...(own ? { ownBookingUrl: own } : {}), bookingChoice: choice };
  if (inputs.ownBookingUrl === i.ownBookingUrl && inputs.bookingChoice === i.bookingChoice) return rec;
  return { ...rec, inputs };
}

/** The record with the choice applied: the prefs, and the Book link the editor and preview show. */
export function withChoice(rec: SiteRecord, choice: BookingChoice, shop: Pick<Shop, 'slug'>): SiteRecord {
  const { own } = bookingPrefs(rec);
  const data = { ...rec.data };
  const url = choice === 'aibarber' ? bookingUrl(shop) : own;
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
  } else {
    delete inputs.ownBookingUrl;
  }
  return { ...next, inputs };
}

/** "booksy.com/fade-lab": no scheme, www, query or trailing slash, kept short. */
export function shortLink(url: string): string {
  const s = url.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  return s.length > 34 ? `${s.slice(0, 33)}…` : s;
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
  const book = choice === 'aibarber' && ents.bookings && shop && shop.bookingsEnabled ? bookingUrl(shop) : own;
  if (book) out.bookingUrl = book;
  else delete out.bookingUrl;
  if (ents.store && shop && shop.purchaseLinked && ctx.storeEnabled) out.shopUrl = shopUrl(shop);
  else delete out.shopUrl;
  return out;
}
