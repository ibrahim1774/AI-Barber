import { useSyncExternalStore } from 'react';
import type { api } from '@/lib/api';
import { PRODUCT_IDS, pickLatestTransactionId } from '@/lib/publish';
import type { SiteRecord } from '@/lib/siteStore';
import { boundMatches } from '@/lib/website';
import { LOOKUP_TIMEOUT_MS, withTimeout } from '@/lib/timeout';

/**
 * Whether a published site's subscription is still paid for. Owner's rule
 * (2026-10-21): once it ends, the site goes offline (server side) and the
 * app stops editing until the barber resubscribes.
 *
 * - 'active': /api/ios/site says this site's subscription is active.
 * - 'lapsed': confirmed ended (by the server, for this site), at least an
 *   hour ago. Only this locks the editor.
 * - 'unknown': anything uncertain (offline, an SDK or server error, a paid
 *   publish still pending, a site not bound to this Apple ID). Never locks.
 */
export type SubscriptionStatus = 'active' | 'lapsed' | 'unknown';

/** Superwall's own subscription status; null without a Superwall key. */
export type SuperwallStatus = 'ACTIVE' | 'INACTIVE' | 'UNKNOWN' | null;

/** One entry of Superwall's CustomerInfo.subscriptions (the fields used here). */
export interface SubscriptionEntry {
  transactionId: string;
  productId: string;
  purchaseDate: string;
  isActive: boolean;
  isRevoked?: boolean;
  /** ISO-8601; null for a non-renewing product. */
  expirationDate?: string | null;
}

export interface StatusInput {
  site: SiteRecord | null;
  /** A paid publish is waiting to be sent (Apple / Superwall lag). */
  pendingPublish: boolean;
  superwallStatus: SuperwallStatus;
  /** Superwall getCustomerInfo(). Never rejects natively; it can hang until configured. */
  customerInfo(): Promise<{ subscriptions?: SubscriptionEntry[] }>;
  iosSite: typeof api.iosSite;
  timeoutMs?: number;
  now?: number;
}

/**
 * The server takes a site down about an hour after its subscription ends
 * (Apple's status decides: billing grace still counts as active, billing
 * retry as ended). Until then the app says nothing, so "Your website is
 * offline" is never shown for a site that is still up.
 */
export const LAPSE_AFTER_MS = 60 * 60 * 1000;

/** Only a site that was live can lapse; a never-published draft is never locked. */
export function isPublished(site: SiteRecord | null | undefined): boolean {
  return !!site?.deployedUrl;
}

/** The editor and Settings lock only on a confirmed lapse of a published site. */
export function isLocked(site: SiteRecord | null | undefined, status: SubscriptionStatus): boolean {
  return isPublished(site) && status === 'lapsed';
}

const isOurs = (s: SubscriptionEntry) => (PRODUCT_IDS as readonly string[]).includes(s.productId);
const time = (iso: string | null | undefined) => {
  const t = Date.parse(iso ?? '');
  return Number.isNaN(t) ? null : t;
};

/** This Apple ID's newest AI Barber subscription, active or not. */
function newestOurs(subs: SubscriptionEntry[]): SubscriptionEntry | null {
  let best: SubscriptionEntry | null = null;
  let bestAt = -Infinity;
  for (const s of subs) {
    if (!isOurs(s)) continue;
    const at = time(s.purchaseDate) ?? time(s.expirationDate) ?? 0;
    if (!best || at > bestAt) {
      best = s;
      bestAt = at;
    }
  }
  return best;
}

/**
 * The decision itself. Never throws: every failure is 'unknown'.
 *
 * The transaction to ask about is the newest active AI Barber one, or, with
 * none active, the newest ended one, but only once it is revoked or expired
 * at least LAPSE_AFTER_MS ago. /api/ios/site then says which site that
 * subscription is bound to: anything but this site is 'unknown', so another
 * shop's subscription (or one on another Apple ID) never locks this one.
 */
export async function checkSubscriptionStatus(input: StatusInput): Promise<SubscriptionStatus> {
  const { site } = input;
  if (!site || !isPublished(site)) return 'unknown';
  // Just paid: the launch retry is still sending it. Not a lapse.
  if (input.pendingPublish) return 'unknown';
  // No key, or Superwall hasn't worked out the status yet: customer info isn't trustworthy.
  if (input.superwallStatus == null || input.superwallStatus === 'UNKNOWN') return 'unknown';

  let subs: SubscriptionEntry[];
  try {
    const info = await withTimeout(input.customerInfo(), input.timeoutMs ?? LOOKUP_TIMEOUT_MS);
    subs = info?.subscriptions ?? [];
  } catch {
    return 'unknown';
  }

  let transactionId = pickLatestTransactionId(subs);
  if (!transactionId) {
    // Superwall says subscribed, but the transaction isn't readable yet.
    if (input.superwallStatus === 'ACTIVE') return 'unknown';
    // Never subscribed on this Apple ID: maybe paid on another one. Proves nothing.
    const ended = newestOurs(subs);
    if (!ended) return 'unknown';
    if (!ended.isRevoked) {
      const expired = time(ended.expirationDate);
      // Not ended long enough for the takedown (or no expiry at all): not yet.
      if (expired == null || (input.now ?? Date.now()) - expired < LAPSE_AFTER_MS) return 'unknown';
    }
    transactionId = ended.transactionId;
  }

  try {
    const bound = await input.iosSite(transactionId);
    // The subscription found is bound to a different site: says nothing about this one.
    if (!boundMatches(site, bound)) return 'unknown';
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
/** Bumped by every direct set, so a check started before it can't overwrite it. */
let generation = 0;

export function getSubscriptionStatus(): SubscriptionStatus {
  return status;
}

/** Taken when a check starts; pass it back to setSubscriptionStatus with the result. */
export function statusGeneration(): number {
  return generation;
}

/**
 * Records a status. Only a definitive one ('active' / 'lapsed') starts the
 * throttle, so an offline or not-yet-configured check is retried next time.
 * A check's result (with the `gen` it started with) is dropped if the status
 * was set directly since (a live publish's 'active'); a direct set has no `gen`.
 */
export function setSubscriptionStatus(next: SubscriptionStatus, now = Date.now(), gen?: number): void {
  if (gen === undefined) generation++;
  else if (gen !== generation) return;
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
  generation = 0;
  listeners.clear();
  runner = null;
}
