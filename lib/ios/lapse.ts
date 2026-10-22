// Cheap row-only PREFILTERS for the iOS sweep. Apple is the authority: the
// sweep never takes a site down or restores it on these alone; it asks Apple
// for the live subscription status first (appleVerify isActive: 1 active and
// 4 billing grace count as active). These rules only decide which rows are
// worth asking about, so the sweep doesn't call Apple for every row.
//
// Rows only ever move forward: expires_at never moves backwards (see
// purchases.ts), so a renewal or resubscribe makes a row active again by itself.
import type { PurchaseRow } from './purchases.js';
import { grants, type Entitlement } from './tiers.js';

/**
 * How long after the stored expiry a row becomes a takedown candidate. Short on
 * purpose: Apple decides (billing grace keeps a site up), this only absorbs a
 * renewal notification that is a little late.
 */
export const GRACE_MS = 60 * 60 * 1000;

type LapseFields = Pick<PurchaseRow, 'expires_at' | 'revoked_at'>;

const expiryMs = (row: LapseFields): number => (row.expires_at == null ? NaN : Date.parse(row.expires_at));

/** Takedown prefilter: revoked, or expired at least GRACE_MS ago. No expiry and no revocation is not lapsed. */
export function isLapsed(row: LapseFields, now: number): boolean {
  if (row.revoked_at != null) return true;
  const exp = expiryMs(row);
  return Number.isFinite(exp) && exp <= now - GRACE_MS;
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
 * instead (expired at least GRACE_MS ago), so linking a purchase that is not the site's can't
 * keep Bookings or the Store open after it ends.
 */
export function purchaseLive(row: GateFields | null | undefined, now: number = Date.now()): boolean {
  if (!row || row.revoked_at || row.taken_down_at) return false;
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
