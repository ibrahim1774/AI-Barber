// Is a verified App Store subscription live? Kept free of the Apple SDK so
// light modules (purchases.ts, used by /api/deploy-site) can import it.
import type { VerifiedTx } from './appleVerify.js';

const ACTIVE_STATUSES = new Set([1, 4]); // Active, Billing grace period

export function isActive(tx: VerifiedTx, now: number = Date.now()): boolean {
  if (tx.revoked) return false;
  // Apple's status is authoritative when we have it (grace period is active past expiresDate).
  if (tx.status != null) return ACTIVE_STATUSES.has(tx.status);
  return tx.expiresAt === null || tx.expiresAt > now;
}
