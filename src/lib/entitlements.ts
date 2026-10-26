import { useSyncExternalStore } from 'react';

/** What the subscription grants. `known` is false until Superwall has reported a status. */
export type Entitlements = { known: boolean; hosting: boolean; bookings: boolean; store: boolean };
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

let current: Entitlements = UNKNOWN;
// Superwall's latest status. It belongs to the Apple ID (the payment), not to the signed-in account, and it does
// not change on sign-out, so clearEntitlements() refills the mirror from it.
let lastStatus: StatusLike = null;
const listeners = new Set<() => void>();

const same = (a: Entitlements, b: Entitlements) =>
  a.known === b.known && a.hosting === b.hosting && a.bookings === b.bookings && a.store === b.store;

/** The latest entitlements (SubscriptionSync feeds this). */
export function getEntitlements(): Entitlements {
  return current;
}

/** Feeds the mirror from Superwall's status. Notifies only on a real change. */
export function setEntitlementsFromStatus(status: StatusLike): void {
  lastStatus = status;
  const next = entitlementsFrom(status);
  if (same(current, next)) return;
  current = next;
  listeners.forEach((l) => l());
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
  lastStatus = null;
  listeners.clear();
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
