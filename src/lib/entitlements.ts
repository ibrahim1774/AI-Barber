import { useSyncExternalStore } from 'react';
import { getSharedPlan, setSharedPlan, subscribePlan, type Plan } from '@/lib/plan';

/**
 * What the subscription grants. `known` is false until Superwall has reported a status, and while Bookings / Store
 * are claimed but the server has not yet said the purchase is this account's (fail closed).
 * `account` (only when Bookings or Store are claimed): 'self' = the server says this account owns the purchase;
 * 'other' = another account on the same Apple ID does (or no purchase of this account's own); 'unknown' = not decided.
 */
export type Entitlements = {
  known: boolean; hosting: boolean; bookings: boolean; store: boolean;
  account?: 'self' | 'other' | 'unknown'; hint?: string | null;
};
export type EntitlementId = 'hosting' | 'bookings' | 'store';

/** The shape of expo-superwall's `subscriptionStatus` that is used here. */
export type StatusLike = { status: string; entitlements?: { id: string }[] } | null | undefined;

/** Which entitlement each upgrade placement sells. */
export const PLAN_ENTITLEMENT: Record<'bookings_upgrade' | 'store_upgrade', 'bookings' | 'store'> = {
  bookings_upgrade: 'bookings',
  store_upgrade: 'store',
};

const UNKNOWN: Entitlements = { known: false, hosting: false, bookings: false, store: false };

/** Pure: Superwall's subscription status to the entitlements it grants. */
export function entitlementsFrom(status: StatusLike): Entitlements {
  if (status?.status === 'ACTIVE') {
    const ids = new Set((status.entitlements ?? []).map((e) => e.id));
    return { known: true, hosting: ids.has('hosting'), bookings: ids.has('bookings'), store: ids.has('store') };
  }
  if (status?.status === 'INACTIVE') return { known: true, hosting: false, bookings: false, store: false };
  return UNKNOWN;
}

// Superwall's latest status. It belongs to the Apple ID (the payment), not to the signed-in account, and it does
// not change on sign-out, so clearEntitlements() refills the mirror from it.
let lastStatus: StatusLike = null;
let mirror: Entitlements = UNKNOWN;
let current: Entitlements = UNKNOWN;
const listeners = new Set<() => void>();

const same = (a: Entitlements, b: Entitlements) =>
  a.known === b.known && a.hosting === b.hosting && a.bookings === b.bookings && a.store === b.store &&
  a.account === b.account && (a.hint ?? null) === (b.hint ?? null);

/**
 * Pure: the Superwall mirror and the server's plan. Superwall's status belongs to the Apple ID, so a second account
 * on the same Apple ID would see Bookings / Store as paid. They unlock only when the server says this account owns the
 * purchase and it is active (`purchaseAccount === 'self' && active`); that answer also grants the plan's own tiers when
 * this iPhone's Superwall says nothing (another Apple ID, a renewal it has not seen). Hosting is not gated by Superwall
 * alone (a site can be published without an account). Signed out, or the plan not loaded yet, is `known: false`
 * whenever Superwall claims Bookings / Store: locked, never unlocked on a guess.
 */
export function effectiveEntitlements(
  raw: Entitlements,
  plan: (Pick<Plan, 'purchaseAccount' | 'purchaseHint' | 'active'> & { entitlements?: Plan['entitlements'] }) | null,
): Entitlements {
  // The server says this account's own Apple purchase is active: its tiers are granted even when this device's
  // StoreKit / Superwall says otherwise (another Apple ID on this iPhone, a renewal Superwall has not seen yet, a lapse
  // between Sandbox renewals). The server's own gates (publish, the booking page, the store) use this same answer, and
  // normalizePlan already zeroes a revoked or taken-down plan. Superwall's word is kept on top (an upgrade bought a
  // moment ago that the server has not read yet).
  if (plan?.purchaseAccount === 'self' && plan.active && plan.entitlements) {
    const e = plan.entitlements;
    return {
      known: true, hosting: raw.hosting || e.hosting, bookings: raw.bookings || e.bookings, store: raw.store || e.store, account: 'self',
    };
  }
  if (!raw.known) return raw;
  if (!raw.bookings && !raw.store) return raw; // nothing to gate: a Website plan or no plan
  if (!plan) return { ...UNKNOWN, account: 'unknown' };
  if (plan.purchaseAccount === 'self') {
    return plan.active ? { ...raw, account: 'self' } : { ...raw, bookings: false, store: false, account: 'self' };
  }
  return { ...raw, bookings: false, store: false, account: 'other', hint: plan.purchaseHint };
}

function recompute(): void {
  const next = effectiveEntitlements(mirror, getSharedPlan());
  if (same(current, next)) return;
  current = next;
  listeners.forEach((l) => l());
}
subscribePlan(recompute);

/** The entitlements the screens use: Superwall AND the server's plan (see effectiveEntitlements). SubscriptionSync feeds the mirror. */
export function getEntitlements(): Entitlements {
  return current;
}

/** Superwall's own answer for this Apple ID, before the account check. Only the upgrade paywall's "did it go through" reads it. */
export function getSuperwallEntitlements(): Entitlements {
  return mirror;
}

const swListeners = new Set<() => void>();

/** Feeds the mirror from Superwall's status. Notifies only on a real change. */
export function setEntitlementsFromStatus(status: StatusLike): void {
  lastStatus = status;
  const next = entitlementsFrom(status);
  const changed = !same(mirror, next);
  // This device just saw the plan stop or shrink (a lapse, a refund, a downgrade): a server plan cached before is no
  // longer trusted until it is read again (PlanSync and the tabs re-read it at once). Nothing is granted on the old answer.
  const stopped = mirror.known && next.known &&
    ((mirror.hosting && !next.hosting) || (mirror.bookings && !next.bookings) || (mirror.store && !next.store));
  mirror = next;
  if (stopped && getSharedPlan()) setSharedPlan(null); // recomputes through subscribePlan
  else recompute();
  if (changed) swListeners.forEach((l) => l());
}

/**
 * Superwall's own answer for this Apple ID, as a hook. It never unlocks anything by itself: the screens use it only to
 * re-read the server's plan when the device says the plan stopped (a lapse, a refund), since a server plan cached as
 * active would otherwise keep the tiers granted.
 */
export function useSuperwallEntitlements(): Entitlements {
  return useSyncExternalStore(
    (l) => {
      swListeners.add(l);
      return () => {
        swListeners.delete(l);
      };
    },
    getSuperwallEntitlements,
    getSuperwallEntitlements,
  );
}

export function subscribeEntitlements(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Sign-out / account switch: the old account's tiers are not known for the next one (Superwall feeds them again). */
export function clearEntitlements(): void {
  // Reset, then re-apply what Superwall currently says for this Apple ID. Server-plan state is cleared separately
  // (resetSharedPlan), so nothing of the old account's server plan survives.
  setEntitlementsFromStatus(lastStatus);
}

/** Test only. */
export function resetEntitlementsForTests(): void {
  current = UNKNOWN;
  mirror = UNKNOWN;
  lastStatus = null;
  listeners.clear();
  swListeners.clear();
}

export function useEntitlements(): Entitlements {
  return useSyncExternalStore(subscribeEntitlements, getEntitlements, getEntitlements);
}

/** The strongest plan the entitlements grant: store > bookings > hosting; null when none. */
export function tierFromEntitlements(e: Pick<Entitlements, 'hosting' | 'bookings' | 'store'>): 'website' | 'bookings' | 'store' | null {
  if (e.store) return 'store';
  if (e.bookings) return 'bookings';
  if (e.hosting) return 'website';
  return null;
}
