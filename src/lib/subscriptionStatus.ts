import { useSyncExternalStore } from 'react';
import type { api } from '@/lib/api';
import { PRODUCT_IDS, pickLatestTransactionId } from '@/lib/publish';
import type { SiteRecord } from '@/lib/siteStore';
import { LOOKUP_TIMEOUT_MS, withTimeout } from '@/lib/timeout';

/**
 * Whether a published site's subscription is still paid for. Owner's rule
 * (2026-10-21): once it ends, the site goes offline (server side) and the
 * app stops editing until the barber resubscribes.
 *
 * - 'active': a transaction on this Apple ID and /api/ios/site says active.
 * - 'lapsed': confirmed ended. Only this locks the editor.
 * - 'unknown': anything uncertain (offline, an SDK or server error, a paid
 *   publish still pending, a site not bound to this Apple ID). Never locks.
 */
export type SubscriptionStatus = 'active' | 'lapsed' | 'unknown';

/** Superwall's own subscription status; null without a Superwall key. */
export type SuperwallStatus = 'ACTIVE' | 'INACTIVE' | 'UNKNOWN' | null;

export interface StatusInput {
  site: SiteRecord | null;
  /** A paid publish is waiting to be sent (Apple / Superwall lag). */
  pendingPublish: boolean;
  superwallStatus: SuperwallStatus;
  /** Superwall getCustomerInfo(). Never rejects natively; it can hang until configured. */
  customerInfo(): Promise<{ subscriptions?: Parameters<typeof pickLatestTransactionId>[0] }>;
  iosSite: typeof api.iosSite;
  timeoutMs?: number;
}

/** Only a site that was live can lapse; a never-published draft is never locked. */
export function isPublished(site: SiteRecord | null | undefined): boolean {
  return !!site?.deployedUrl;
}

/** The editor and Settings lock only on a confirmed lapse of a published site. */
export function isLocked(site: SiteRecord | null | undefined, status: SubscriptionStatus): boolean {
  return isPublished(site) && status === 'lapsed';
}

/** The decision itself. Never throws: every failure is 'unknown'. */
export async function checkSubscriptionStatus(input: StatusInput): Promise<SubscriptionStatus> {
  const { site } = input;
  if (!site || !isPublished(site)) return 'unknown';
  // Just paid: the launch retry is still sending it. Not a lapse.
  if (input.pendingPublish) return 'unknown';
  // No key, or Superwall hasn't worked out the status yet: customer info isn't trustworthy.
  if (input.superwallStatus == null || input.superwallStatus === 'UNKNOWN') return 'unknown';

  let transactionId: string | null;
  let everSubscribed: boolean;
  try {
    const info = await withTimeout(input.customerInfo(), input.timeoutMs ?? LOOKUP_TIMEOUT_MS);
    const subs = info?.subscriptions ?? [];
    transactionId = pickLatestTransactionId(subs);
    // Any AI Barber subscription on this Apple ID, expired or revoked included.
    everSubscribed = subs.some((s) => (PRODUCT_IDS as readonly string[]).includes(s.productId));
  } catch {
    return 'unknown';
  }

  if (!transactionId) {
    // Superwall says subscribed, but the transaction isn't readable yet.
    if (input.superwallStatus === 'ACTIVE') return 'unknown';
    // A site not bound on this phone (loaded from the account) lapses only if
    // this Apple ID did subscribe once; otherwise it may have been paid on
    // another Apple ID, and "ended" (and a second purchase) would be wrong.
    if (site.transactionId == null && !everSubscribed) return 'unknown';
    return 'lapsed';
  }

  try {
    const bound = await input.iosSite(transactionId);
    // The subscription found is bound to a different site: says nothing about this one.
    if (site.slug != null && bound.siteId !== site.slug) return 'unknown';
    return bound.active === false ? 'lapsed' : 'active';
  } catch {
    return 'unknown';
  }
}

/** About one check per 5 minutes on launch / foreground; forced checks skip it. */
export const RECHECK_MS = 5 * 60 * 1000;

export function shouldCheck(now: number, lastDefinitiveAt: number | null, force: boolean): boolean {
  return force || lastDefinitiveAt == null || now - lastDefinitiveAt >= RECHECK_MS;
}

// ---- The one shared status (Edit and Settings read it; _layout's runner writes it). ----

let status: SubscriptionStatus = 'unknown';
let lastDefinitiveAt: number | null = null;
const listeners = new Set<() => void>();
let runner: ((force: boolean) => void) | null = null;

export function getSubscriptionStatus(): SubscriptionStatus {
  return status;
}

/**
 * Records a result. Only a definitive one ('active' / 'lapsed') starts the
 * throttle, so an offline or not-yet-configured check is retried next time.
 */
export function setSubscriptionStatus(next: SubscriptionStatus, now = Date.now()): void {
  if (next !== 'unknown') lastDefinitiveAt = now;
  if (next === status) return;
  status = next;
  listeners.forEach((l) => l());
}

export function lastStatusCheckAt(): number | null {
  return lastDefinitiveAt;
}

export function subscribeSubscriptionStatus(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useSubscriptionStatus(): SubscriptionStatus {
  return useSyncExternalStore(subscribeSubscriptionStatus, getSubscriptionStatus, getSubscriptionStatus);
}

/** The runner mounted in _layout registers itself here. */
export function registerStatusRunner(run: ((force: boolean) => void) | null): void {
  runner = run;
}

/** Asks the runner for a check now (after a restore, an adoption, back on a locked Edit tab). */
export function recheckSubscriptionStatus(force = true): void {
  runner?.(force);
}

/** Test only. */
export function resetSubscriptionStatusForTests(): void {
  status = 'unknown';
  lastDefinitiveAt = null;
  listeners.clear();
  runner = null;
}
