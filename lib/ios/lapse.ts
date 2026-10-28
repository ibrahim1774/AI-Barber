// Cheap row-only PREFILTERS for the iOS sweep. Apple is the authority: the
// sweep never takes a site down or restores it on these alone; it asks Apple
// for the live subscription status first (appleVerify isActive: 1 active and
// 4 billing grace count as active). These rules only decide which rows are
// worth asking about, so the sweep doesn't call Apple for every row.
//
// Rows only ever move forward: expires_at never moves backwards (see
// purchases.ts), so a renewal or resubscribe makes a row active again by itself.
import type { PurchaseRow } from './purchases.js';
import { grants, tierOf, type Entitlement } from './tiers.js';

/**
 * The renewal window. App Store Connect Billing Grace Period is OFF for this app, so Apple
 * calls a subscription inactive the moment it expires or a renewal payment fails. We give
 * the owner 3 days of our own: the website, Bookings and Store stay LIVE for customers until
 * expiresAt + LAPSE_CUSHION_MS, then the sweep (after asking Apple) takes the site down.
 * Revoked / refunded is immediate (no cushion). The OWNER is locked out of editing and
 * publishing for the whole window (publish asks Apple and answers 402 once it says inactive).
 * Every "is the site live" decision reads this one constant.
 */
export const LAPSE_CUSHION_MS = 3 * 24 * 60 * 60 * 1000;
/** Old name, kept for compatibility. Same value. */
export const GRACE_MS = LAPSE_CUSHION_MS;

/** When a lapsed (expired, not revoked) purchase goes offline unless renewed; null without an expiry. */
export function renewByMs(row: Pick<PurchaseRow, 'expires_at'>): number | null {
  const exp = row.expires_at == null ? NaN : Date.parse(row.expires_at);
  return Number.isFinite(exp) ? exp + LAPSE_CUSHION_MS : null;
}

type LapseFields = Pick<PurchaseRow, 'expires_at' | 'revoked_at'>;

const expiryMs = (row: LapseFields): number => (row.expires_at == null ? NaN : Date.parse(row.expires_at));

/** Takedown prefilter: revoked, or expired at least LAPSE_CUSHION_MS ago. No expiry and no revocation is not lapsed. */
export function isLapsed(row: LapseFields, now: number): boolean {
  if (row.revoked_at != null) return true;
  const exp = expiryMs(row);
  return Number.isFinite(exp) && exp <= now - LAPSE_CUSHION_MS;
}

/** Restore prefilter: not revoked and expires in the future. */
export function isActiveRow(row: LapseFields, now: number): boolean {
  if (row.revoked_at != null) return false;
  const exp = expiryMs(row);
  return Number.isFinite(exp) && exp > now;
}

/** The ios_purchases columns the gates read. */
export interface GateFields {
  product_id: string | null;
  revoked_at: string | null;
  taken_down_at: string | null;
  expires_at?: string | null;
  site_slug?: string | null;
  published_at?: string | null;
  environment?: string | null;
}

/**
 * Does the iOS sweep watch this purchase (ask Apple and stamp taken_down_at when it lapses)?
 * Bound, published rows, Production and Sandbox alike (sweep.ts).
 */
export function sweepWatches(row: Partial<GateFields>): boolean {
  return row.site_slug != null && row.published_at != null;
}

/**
 * Is the linked purchase live for the gates? Not revoked and not taken down. For a purchase
 * the sweep watches, a whole-subscription lapse reaches here only through taken_down_at (the
 * sweep, Apple-confirmed), so billing grace and a renewing Sandbox purchase stay open. A
 * purchase the sweep never watches (unbound or unpublished) closes on the lapse prefilter
 * instead (expired at least LAPSE_CUSHION_MS ago), so linking a purchase that is not the site's can't
 * keep Bookings or the Store open after it ends.
 */
export function purchaseLive(row: GateFields | null | undefined, now: number = Date.now()): boolean {
  if (!row || row.revoked_at || row.taken_down_at) return false;
  // Only the six site products (tiers.ts) can be live for a gate. The domain subscription is
  // never written here (notifications route it away), and must never open a gate if it were.
  if (tierOf(row.product_id) == null) return false;
  if (!sweepWatches(row) && isLapsed({ expires_at: row.expires_at ?? null, revoked_at: row.revoked_at }, now)) return false;
  return true;
}

/**
 * Tier gate (Phase 4): the purchase is live (purchaseLive) and its current product grants
 * `ent`. A downgrade reaches the gates through product_id.
 */
export function entitlementActive(row: GateFields | null | undefined, ent: Entitlement, now: number = Date.now()): boolean {
  return purchaseLive(row, now) && grants(row!.product_id, ent);
}
