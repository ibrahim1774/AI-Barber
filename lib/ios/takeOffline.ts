// "Take my website offline" for a customer with NO account (App Store 5.1.1(v)): keyed by an
// Apple transaction id, with the same ownership proof the publish API uses. Apple verifies the
// transaction (appleVerify: signed JWS, our bundle id, one of our products); the site removed is
// the one bound to the verified originalTransactionId, never a slug the caller names. A
// transaction that is not ours, or has no site, removes nothing.
//
// A purchase linked to an account (ios_purchases.user_id) is removed only by a bearer token for
// that same account, so a leaked transaction id cannot take down an account-holder's site. (The
// publish API accepts the bare id; this destructive call is stricter on purpose.) A lapsed or
// refunded subscription may still remove its own site.
import { VerifyFailure, type VerifiedTx } from './appleVerify.js';
import type { PurchasesRepo } from './purchases.js';
import { removeSite, type RemoveSiteDeps } from './removeSite.js';

export interface TakeOfflineDeps extends RemoveSiteDeps {
  verify(transactionId: string): Promise<VerifiedTx>;
  repo: Pick<PurchasesRepo, 'get'>;
  /** The account behind a bearer token (null = invalid; throws on an outage). */
  userOf?(token: string): Promise<{ id: string } | null>;
}

export type TakeOfflineResult =
  | { status: 200; body: { removed: true } }
  | { status: 400 | 401 | 403 | 404 | 500 | 503; body: { error: string } };

const VERIFY_STATUS = { 'not-found': 404, 'bad-bundle': 400, 'bad-product': 400, 'apple-unavailable': 503 } as const;

const bearer = (h: unknown): string => {
  const v = Array.isArray(h) ? h[0] : h;
  return typeof v === 'string' ? v.replace(/^Bearer\s+/i, '').trim() : '';
};

export async function takeSiteOffline(body: unknown, deps: TakeOfflineDeps, ctx: { authorization?: unknown } = {}): Promise<TakeOfflineResult> {
  const txId = (body as { transactionId?: unknown } | null)?.transactionId;
  if (typeof txId !== 'string' || !txId.trim() || txId.length > 64) return { status: 400, body: { error: 'bad-request' } };

  let tx: VerifiedTx;
  try {
    tx = await deps.verify(txId.trim());
  } catch (e) {
    if (e instanceof VerifyFailure) return { status: VERIFY_STATUS[e.code], body: { error: e.code } };
    return { status: 503, body: { error: 'apple-unavailable' } };
  }

  let row;
  try {
    row = await deps.repo.get(tx.originalTransactionId);
  } catch {
    return { status: 503, body: { error: 'temporarily-unavailable' } };
  }
  // Ids are separate per environment: a Sandbox transaction never removes a Production row (or the reverse).
  if (!row || !row.site_slug || row.environment !== tx.environment) return { status: 404, body: { error: 'no-site' } };

  if (row.user_id) {
    const token = bearer(ctx.authorization);
    if (!token || !deps.userOf) return { status: 403, body: { error: 'sign-in-required' } };
    let u: { id: string } | null;
    try {
      u = await deps.userOf(token);
    } catch {
      return { status: 503, body: { error: 'temporarily-unavailable' } };
    }
    if (!u || u.id !== row.user_id) return { status: 403, body: { error: 'not-owner' } };
  }

  try {
    await removeSite(row, deps);
  } catch (e: any) {
    console.error('[ios/take-offline] failed:', e?.message || e);
    return { status: 500, body: { error: 'remove-failed' } };
  }
  return { status: 200, body: { removed: true } };
}
