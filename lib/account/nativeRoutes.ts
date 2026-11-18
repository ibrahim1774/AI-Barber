// The 1.2 app's SINGLE routes (ACCOUNT_PLAN_V2=1 and X-PB-Build present): one call per action, the server does the right thing for every account kind and reports what it did.
// With ACCOUNT_PLAN_V2 off, or without the header, the handlers never come here: today's behaviour, byte for byte, no new fields.
//
// DELETE (api/ios/delete-account.ts): never refused for the kind. Any live card plan is cancelled first (whatever APP_DELETE_CANCELS_WEB and WEB_APP_ENTITLEMENTS say), every site of the
//   account goes down and is purged (web sites, and Apple sites tied to its purchases). A failed cancel: 500 delete-failed, retryable, cardCancelFailed, nothing deleted.
//   200 adds outcome { cardPlanCanceled, appleSubscriptionActive }. Optional body { transactionId }: a signed-out purchase's site that Apple confirms goes down with the account. A publish in progress: 409.
// TAKE OFFLINE (api/ios/take-offline.ts): body { transactionId?, expect? }. kind web, or mixed with no transaction: the web site goes offline, content and phone kept, live address forgotten.
//   apple / neither / mixed with a transaction (or a web account whose transaction Apple confirms is bound to a site it may remove): today's Apple flow, its own checks (400/404/403) before confirm-purge. expect 'keep' when the action would purge: 409 confirm-purge, nothing done.
//   200 adds outcome { site, contentKept, otherSiteLive, domainDetached, domainReattachesOnPublish }: the site had a custom domain which the call detached (it stays paid and the owner's);
//   a publish brings it back by itself for an Apple site always, for a web site only with SAFE_TAKE_OFFLINE=1 (else the owner adds the same name again in Settings, free).
import { safeTakeOfflineOn } from '../ios/removeSite.js';
import { sweepWatches } from '../ios/lapse.js';
import { supabaseDomains } from '../ios/domainsRepo.js';
import { sbRest } from '../webApp/webAppServer.js';
import type { AccountKind } from './kind.js';

const enc = encodeURIComponent;

/**
 * Does the account have an Apple subscription that may still be billing (so the app reminds the owner to cancel it at Apple)? True when ANY of:
 *   - a purchase linked to the account, in ANY environment, is not known to be refunded or expired (taken_down_at is ignored: taking a site offline does not stop Apple billing);
 *   - the caller's own `transactionId` was verified by Apple (`transactionVerified`): the phone has a purchase, even one published signed out;
 *   - the one-site guard recorded a purchase of this user it refused to tie to the account (blocked_purchases): Apple still bills it.
 * An expired row that the sweep still watches (a bound, published site with no takedown stamped) counts too: Apple has not confirmed the lapse, so it may be in billing retry or grace. A row that
 * the sweep no longer watches (site taken down, or never published) cannot say: its stored expiry is all we know. This flag only drives a reminder, never a decision. THROWS on a failed read of the linked purchases (the caller answers 503 with nothing done); the blocked-purchase read is best
 * effort (a missing table, migration 039, or a failed read counts as no row, logged).
 */
export async function appleSubscriptionActive(uid: string, opts: { transactionVerified?: boolean; now?: number } = {}): Promise<boolean> {
  const now = opts.now ?? Date.now();
  const rows: any[] = (await sbRest(`ios_purchases?user_id=eq.${enc(uid)}&select=original_transaction_id,product_id,environment,expires_at,revoked_at,taken_down_at,site_slug,published_at&limit=50`)) ?? [];
  // Not refunded, and either not expired, or expired but still watched by the sweep with no takedown stamped: Apple has not confirmed the lapse, so it may be in billing retry or grace.
  if (rows.some((p) => !p.revoked_at && (!(p.expires_at && Date.parse(p.expires_at) <= now) || (sweepWatches(p) && !p.taken_down_at)))) return true;
  if (opts.transactionVerified) return true;
  try {
    const blocked: any[] = (await sbRest(`blocked_purchases?user_id=eq.${enc(uid)}&select=original_transaction_id&limit=1`)) ?? [];
    return blocked.length > 0;
  } catch (e: any) {
    console.error('[ios/delete-account] blocked-purchase read failed (reminder only):', e?.status ?? e?.message ?? e);
    return false;
  }
}

/** Apple's verification of one transaction, remembered for this request (the route checks the preconditions first, then the removal checks them again). Failures are not remembered. */
export function memoVerify<T>(verify: (id: string) => Promise<T>): (id: string) => Promise<T> {
  const seen = new Map<string, T>();
  return async (id) => { if (seen.has(id)) return seen.get(id)!; const v = await verify(id); seen.set(id, v); return v; };
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

/** The slugs of the account's web sites (any state). THROWS on a failed read. */
export async function webSlugsOf(uid: string): Promise<string[]> {
  const rows: any[] = (await sbRest(`web_app_sites?user_id=eq.${enc(uid)}&select=slug`)) ?? [];
  return rows.map((r) => String(r.slug)).filter(Boolean);
}

/**
 * What a take offline does to the site's custom domain, told BEFORE the action (THROWS on a failed read: nothing is done yet).
 *  - domainDetached: the site has a custom domain row (not failed, not transferred); a take offline detaches it from the project (it stays paid and stays the owner's).
 *  - domainReattachesOnPublish: publishing again brings the domain back by itself. Apple sites: always (the publish lifts the owner-removed mark). Web sites: only with SAFE_TAKE_OFFLINE=1;
 *    otherwise the domain stays detached and the owner re-adds the same name in Settings (it is their own detached row, so no purchase is needed).
 */
export async function domainFacts(slugs: string[], site: 'web' | 'apple'): Promise<{ domainDetached: boolean; domainReattachesOnPublish: boolean }> {
  const repo = supabaseDomains();
  let has = false;
  for (const slug of slugs) if ((await repo.forSite(slug)).some((r) => r.state !== 'failed' && r.state !== 'transferred')) has = true;
  return { domainDetached: has, domainReattachesOnPublish: has && (site === 'apple' || safeTakeOfflineOn()) };
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
