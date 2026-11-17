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
import { purgeOffline, removeSite, safeTakeOfflineOn, takeDown, type RemoveSiteDeps } from './removeSite.js';

export interface TakeOfflineDeps extends RemoveSiteDeps {
  verify(transactionId: string): Promise<VerifiedTx>;
  repo: Pick<PurchasesRepo, 'get'>;
  /** The account behind a bearer token (null = invalid; throws on an outage). */
  userOf?(token: string): Promise<{ id: string } | null>;
  /**
   * Deletes the account's own `sites` rows (the app's copy, with its deployed_url) that belong to the
   * removed slug, so a signed-in phone cannot reload the removed site on its next launch. Idempotent;
   * throws on failure (the call answers 500 and a retry finishes the job).
   */
  deleteAccountRows?(userId: string, slug: string): Promise<void>;
}

export type TakeOfflineResult =
  | { status: 200; body: { removed: true } }
  | { status: 400 | 401 | 403 | 404 | 409 | 500 | 503; body: { error: string } };

const VERIFY_STATUS = { 'not-found': 404, 'bad-bundle': 400, 'bad-product': 400, 'apple-unavailable': 503 } as const;

const bearer = (h: unknown): string => {
  const v = Array.isArray(h) ? h[0] : h;
  return typeof v === 'string' ? v.replace(/^Bearer\s+/i, '').trim() : '';
};

type SiteRow = NonNullable<Awaited<ReturnType<PurchasesRepo['get']>>>;

/**
 * Every precondition of "take this purchase's site offline", before anything is removed: the body, Apple's verification, the row bound to the verified purchase (same environment,
 * has a site), the optional expected slug, and ownership. Shared with the native single route, which needs the answer before it decides what to do. Changes nothing.
 */
export async function resolveSiteToRemove(body: unknown, deps: Pick<TakeOfflineDeps, 'verify' | 'repo' | 'userOf'>, ctx: { authorization?: unknown } = {}): Promise<{ row: SiteRow | null; result: Exclude<TakeOfflineResult, { status: 200 }> | null }> {
  const fail = (status: 400 | 401 | 403 | 404 | 409 | 500 | 503, error: string) => ({ row: null, result: { status, body: { error } } });
  const txId = (body as { transactionId?: unknown } | null)?.transactionId;
  if (typeof txId !== 'string' || !txId.trim() || txId.length > 64) return fail(400, 'bad-request');
  // Optional: the slug the caller believes it is removing (the site shown on the phone). The site is
  // still the one bound to the verified purchase; a different slug is refused, never removed.
  const expected = (body as { expectedSlug?: unknown } | null)?.expectedSlug;
  if (expected !== undefined && expected !== null && (typeof expected !== 'string' || !expected.trim() || expected.length > 100)) {
    return fail(400, 'bad-request');
  }

  let tx: VerifiedTx;
  try {
    tx = await deps.verify(txId.trim());
  } catch (e) {
    if (e instanceof VerifyFailure) return fail(VERIFY_STATUS[e.code], e.code);
    return fail(503, 'apple-unavailable');
  }

  let row;
  try {
    row = await deps.repo.get(tx.originalTransactionId);
  } catch {
    return fail(503, 'temporarily-unavailable');
  }
  // Ids are separate per environment: a Sandbox transaction never removes a Production row (or the reverse).
  if (!row || !row.site_slug || row.environment !== tx.environment) return fail(404, 'no-site');

  if (typeof expected === 'string' && expected.trim().toLowerCase() !== row.site_slug.toLowerCase()) {
    return fail(409, 'site-mismatch');
  }

  if (row.user_id) {
    const token = bearer(ctx.authorization);
    if (!token || !deps.userOf) return fail(403, 'sign-in-required');
    let u: { id: string } | null;
    try {
      u = await deps.userOf(token);
    } catch {
      return fail(503, 'temporarily-unavailable');
    }
    if (!u || u.id !== row.user_id) return fail(403, 'not-owner');
  }

  return { row, result: null };
}

export async function takeSiteOffline(body: unknown, deps: TakeOfflineDeps, ctx: { authorization?: unknown } = {}): Promise<TakeOfflineResult> {
  const found = await resolveSiteToRemove(body, deps, ctx);
  if (found.result) return found.result;
  const row = found.row!;

  try {
    if (safeTakeOfflineOn()) {
      // Keeps the stored copy and photos; the owner can publish again. markRemoved/markTakenDown still run first.
      await takeDown(row, deps);
      await purgeOffline(row, deps);
    } else {
      await removeSite(row, deps);
    }
    if (row.user_id && deps.deleteAccountRows) await deps.deleteAccountRows(row.user_id, row.site_slug);
  } catch (e: any) {
    console.error('[ios/take-offline] failed:', e?.message || e);
    return { status: 500, body: { error: 'remove-failed' } };
  }
  return { status: 200, body: { removed: true } };
}
