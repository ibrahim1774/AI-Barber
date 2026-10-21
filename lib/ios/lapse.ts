// Cheap row-only PREFILTERS for the iOS sweep. Apple is the authority: the
// sweep never takes a site down or restores it on these alone; it asks Apple
// for the live subscription status first (appleVerify isActive: 1 active and
// 4 billing grace count as active). These rules only decide which rows are
// worth asking about, so the sweep doesn't call Apple for every row.
//
// Rows only ever move forward: expires_at never moves backwards (see
// purchases.ts), so a renewal or resubscribe makes a row active again by itself.
import type { PurchaseRow } from './purchases.js';

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
