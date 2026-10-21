import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useEntitlements, type EntitlementId } from '@/lib/entitlements';
import { usePaywall, useSuperwallSettled } from '@/lib/paywall';
import { getPlan, getSharedPlan, hostingReadOnlyOpen, setSharedPlan, subscribePlan } from '@/lib/plan';

export type TierAccess = {
  /** loading: not yet decidable. error: Superwall never answered and the server didn't either. */
  status: 'loading' | 'error' | 'ready';
  /** Whether the owner's plan covers this tab's feature. */
  entitled: boolean;
  /** True when Bookings / Store should show only the upgrade card (hosting lapsed over 30 days ago). */
  expired: boolean;
  hosting: boolean;
  retry(): void;
};

/**
 * Whether the plan covers `need`. Superwall's status decides while it is known.
 * If it never settles (offline launch, no key), the server's plan is
 * authoritative; if that fails too the status is 'error', never an endless
 * spinner. The plan is also fetched when hosting is inactive, to date the lapse.
 */
export function useTierAccess(need: EntitlementId): TierAccess {
  const ents = useEntitlements();
  const settled = useSuperwallSettled();
  const plan = useSyncExternalStore(subscribePlan, getSharedPlan, getSharedPlan);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);

  const needPlan = (!ents.known && settled) || (ents.known && !ents.hosting);
  useEffect(() => {
    if (!needPlan) return;
    let alive = true;
    setFailed(false);
    getPlan()
      .then((p) => alive && setSharedPlan(p))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [needPlan, tries]);

  const retry = useCallback(() => {
    setSharedPlan(null);
    setFailed(false);
    setTries((n) => n + 1);
  }, []);

  if (ents.known) {
    // Hosting inactive: wait for the plan's date so a 30+ day lapse never flashes the read-only view.
    if (!ents.hosting && plan == null && !failed) return { status: 'loading', entitled: false, expired: false, hosting: false, retry };
    const expired = !ents.hosting && plan != null && !hostingReadOnlyOpen(plan);
    return { status: 'ready', entitled: ents[need], expired, hosting: ents.hosting, retry };
  }
  if (!settled) return { status: 'loading', entitled: false, expired: false, hosting: false, retry };
  if (plan) {
    return {
      status: 'ready', entitled: plan.entitlements[need], expired: !plan.entitlements.hosting && !hostingReadOnlyOpen(plan),
      hosting: plan.entitlements.hosting, retry,
    };
  }
  return { status: failed ? 'error' : 'loading', entitled: false, expired: false, hosting: false, retry };
}

/** Opens an upgrade paywall; `busy` while it is up. The entitlements update the tab when it succeeds. */
export function useUpgrade(placement: 'bookings_upgrade' | 'store_upgrade') {
  const paywall = usePaywall();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await paywall(placement);
    } finally {
      setBusy(false);
    }
  }, [busy, paywall, placement]);
  return { run, busy };
}
