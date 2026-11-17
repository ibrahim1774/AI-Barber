// The 1.2 app's SINGLE routes (ACCOUNT_PLAN_V2=1 and X-PB-Build present): one call per action, the server does the right thing for every account kind and reports what it did.
// With ACCOUNT_PLAN_V2 off, or without the header, the handlers never come here: today's behaviour, byte for byte, no new fields.
//
// DELETE (api/ios/delete-account.ts): never refused for the kind. Any live card plan is cancelled first (whatever APP_DELETE_CANCELS_WEB and WEB_APP_ENTITLEMENTS say), every site of the
//   account goes down and is purged (web sites, and Apple sites tied to its purchases). A failed cancel: 500 delete-failed, retryable, cardCancelFailed, nothing deleted.
//   200 adds outcome { cardPlanCanceled, appleSubscriptionActive }.
// TAKE OFFLINE (api/ios/take-offline.ts): body { transactionId?, expect? }. kind web, or mixed with no transaction: the web site goes offline, content and phone kept, live address forgotten.
//   apple / neither / mixed with a transaction: today's Apple flow. expect 'keep' when the action would purge: 409 confirm-purge, nothing done.
//   200 adds outcome { site, contentKept, otherSiteLive }.
import { purchaseLive } from '../ios/lapse.js';
import { safeTakeOfflineOn } from '../ios/removeSite.js';
import { keyMode } from '../webApp/stripeCore.js';
import { sbRest } from '../webApp/webAppServer.js';
import type { AccountKind } from './kind.js';

const enc = encodeURIComponent;

/**
 * Is a Apple subscription of this user still live at Apple (so the app must tell them to cancel it)? Production purchases always count. Sandbox purchases count only in a Sandbox
 * (test-key) deployment: the delete request carries no purchase, so the deployment's own environment stands in for "the request's purchase environment".
 * THROWS on a failed read (the caller answers 503 with nothing done).
 */
export async function appleSubscriptionActive(uid: string, now = Date.now()): Promise<boolean> {
  const sandboxDeployment = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY) === 'test';
  const rows: any[] = (await sbRest(`ios_purchases?user_id=eq.${enc(uid)}&select=original_transaction_id,product_id,environment,expires_at,revoked_at,taken_down_at&limit=50`)) ?? [];
  return rows.some((p) => (p.environment === 'Production' || (sandboxDeployment && p.environment === 'Sandbox')) && purchaseLive(p, now));
}

/** Does the account still have a live site on the OTHER side (read BEFORE the action; THROWS on a failed read: nothing has been done yet)? */
export async function otherSiteLive(uid: string, tookDown: 'web' | 'apple'): Promise<boolean> {
  if (tookDown === 'web') {
    const rows: any[] = (await sbRest(`ios_purchases?user_id=eq.${enc(uid)}&site_slug=not.is.null&published_at=not.is.null&removed_at=is.null&taken_down_at=is.null&select=original_transaction_id&limit=1`)) ?? [];
    return rows.length > 0;
  }
  const rows: any[] = (await sbRest(`web_app_sites?user_id=eq.${enc(uid)}&published_at=not.is.null&removed_at=is.null&taken_down_at=is.null&select=slug&limit=1`)) ?? [];
  return rows.length > 0;
}

export type Expect = 'keep' | 'purge' | undefined;
/** The `expect` field of a take-offline body: 'keep' | 'purge' | absent. Anything else is invalid (null). */
export function expectOf(body: unknown): { ok: true; value: Expect } | { ok: false } {
  const v = body && typeof body === 'object' ? (body as { expect?: unknown }).expect : undefined;
  if (v === undefined || v === null) return { ok: true, value: undefined };
  return v === 'keep' || v === 'purge' ? { ok: true, value: v } : { ok: false };
}
export const hasTransaction = (body: unknown): boolean => { const t = body && typeof body === 'object' ? (body as { transactionId?: unknown }).transactionId : undefined; return typeof t === 'string' && t.trim().length > 0; };

/** Which site a take-offline call takes down: web for kind web, or mixed with no transaction; apple otherwise. */
export const takeOfflineSite = (kind: AccountKind, withTransaction: boolean): 'web' | 'apple' => (kind === 'web' || (kind === 'mixed' && !withTransaction) ? 'web' : 'apple');
/** Would the Apple take offline purge the stored copy? (Today's rule: unless SAFE_TAKE_OFFLINE=1.) The web take offline never does. */
export const applePurgesContent = (): boolean => !safeTakeOfflineOn();
