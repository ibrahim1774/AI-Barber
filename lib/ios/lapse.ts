// When an iOS purchase stops entitling its site. Pure, row-only rules shared by
// the sweep (takedown / restore) and the /api/deploy-site gate.
//
// Rows only ever move forward: expires_at never moves backwards (see
// purchases.ts), so a renewal or resubscribe makes a lapsed row active again by
// itself, with no extra bookkeeping.
import type { PurchaseRow } from './purchases.js';

/**
 * Grace after expiry before a site is taken down. Absorbs late renewal
 * notifications; a failed card counts as lapsed once it is this far past expiry.
 */
export const GRACE_MS = 24 * 60 * 60 * 1000;

type LapseFields = Pick<PurchaseRow, 'expires_at' | 'revoked_at'>;

const expiryMs = (row: LapseFields): number => (row.expires_at == null ? NaN : Date.parse(row.expires_at));

/** Revoked, or expired at least GRACE_MS ago. No expiry and no revocation is not lapsed. */
export function isLapsed(row: LapseFields, now: number): boolean {
  if (row.revoked_at != null) return true;
  const exp = expiryMs(row);
  return Number.isFinite(exp) && exp <= now - GRACE_MS;
}

/** Not revoked and expires in the future. */
export function isActiveRow(row: LapseFields, now: number): boolean {
  if (row.revoked_at != null) return false;
  const exp = expiryMs(row);
  return Number.isFinite(exp) && exp > now;
}
