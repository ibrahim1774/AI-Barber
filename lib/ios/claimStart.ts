// POST /api/ios/claim-start (pay-then-sign-up, plan 2026-10-26). Called right after the purchase,
// before any account exists: Apple verifies the transaction and the server records ONE row,
// user_id null, no slug, no content, with claim_expires_at = +30 days. Nothing is published and
// nothing is linked here; the account step later calls POST /api/ios/publish with a Bearer, which
// links the purchase and goes live in a single request.
//
// Idempotent per originalTransactionId: a retry (offline queue, relaunch mid-flow) returns the same
// deadline and never extends it. A refunded / revoked / inactive purchase answers 402 so the phone
// can clear its pending record. Past the 30 days nothing happens to the row except a sweep log line
// (no refund, no takedown; owner ruling 2026-10-26): it can still be claimed.
import { VerifyFailure, isActive, type VerifiedTx } from './appleVerify.js';
import type { PurchasesRepo } from './purchases.js';

export const CLAIM_WINDOW_MS = 30 * 86_400_000;

export interface ClaimStartDeps {
  verify(transactionId: string): Promise<VerifiedTx>;
  repo: PurchasesRepo;
  /** Optional Bearer lookup, only to let the already-linked owner see an idempotent 200 on a retry. */
  userOf?(token: string): Promise<{ id: string } | null>;
  now(): number;
}

export type ClaimStartResult =
  | { status: 200; body: { ok: true; state: 'unclaimed' | 'claimed'; claimExpiresAt: string | null } }
  | { status: 400 | 402 | 404 | 409 | 503; body: { error: string; reason?: string } };

const VERIFY_STATUS = { 'not-found': 404, 'bad-bundle': 400, 'bad-product': 400, 'apple-unavailable': 503 } as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function runClaimStart(input: unknown, deps: ClaimStartDeps, ctx: { authorization?: unknown } = {}): Promise<ClaimStartResult> {
  const transactionId = input && typeof input === 'object' && typeof (input as any).transactionId === 'string'
    ? (input as any).transactionId.trim() : '';
  if (!transactionId || transactionId.length > 64) return { status: 400, body: { error: 'bad-request' } };

  const checkedAt = deps.now();
  let tx: VerifiedTx;
  try {
    tx = await deps.verify(transactionId);
  } catch (e) {
    if (e instanceof VerifyFailure) return { status: VERIFY_STATUS[e.code], body: { error: e.code } };
    console.error('[ios/claim-start] verify threw unexpectedly:', (e as Error)?.message || e);
    return { status: 503, body: { error: 'apple-unavailable' } };
  }
  if (tx.revoked) return { status: 402, body: { error: 'subscription-inactive', reason: 'revoked' } };
  if (!isActive(tx, deps.now())) return { status: 402, body: { error: 'subscription-inactive' } };

  const otid = tx.originalTransactionId;
  try {
    const row = await deps.repo.upsertVerified(tx, { checkedAt });
    // A revocation recorded by Apple's notification that this active answer did not supersede.
    if (row.revoked_at) return { status: 402, body: { error: 'subscription-inactive', reason: 'revoked' } };

    if (row.user_id) {
      // Already linked. The owner retrying gets an idempotent 200; anybody else learns nothing.
      const h = Array.isArray(ctx.authorization) ? ctx.authorization[0] : ctx.authorization;
      const token = (typeof h === 'string' ? h : '').replace(/^Bearer\s+/i, '').trim();
      if (token && deps.userOf) {
        try {
          const u = await deps.userOf(token);
          if (u?.id && UUID_RE.test(u.id) && u.id === row.user_id) {
            return { status: 200, body: { ok: true, state: 'claimed', claimExpiresAt: row.claim_expires_at ?? null } };
          }
        } catch { /* fall through to the plain 409 */ }
      }
      return { status: 409, body: { error: 'purchase-claimed' } };
    }
    // A legacy purchase that already has a site bound is not a fresh claim (no content is touched here).
    if (row.site_slug) return { status: 409, body: { error: 'purchase-has-site' } };

    if (!deps.repo.setClaimExpiryIfUnset) return { status: 503, body: { error: 'temporarily-unavailable' } };
    await deps.repo.setClaimExpiryIfUnset(otid, deps.now() + CLAIM_WINDOW_MS);
    const after = (await deps.repo.get(otid)) ?? row;
    // Lost a race to a claim between the stamp and this read: report it as claimed, not unclaimed.
    if (after.user_id) return { status: 409, body: { error: 'purchase-claimed' } };
    return { status: 200, body: { ok: true, state: 'unclaimed', claimExpiresAt: after.claim_expires_at ?? null } };
  } catch (e) {
    console.error(`[ios/claim-start] ${otid}: unexpected error:`, (e as Error)?.message || e);
    return { status: 503, body: { error: 'temporarily-unavailable' } };
  }
}
