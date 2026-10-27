import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useEntitlements, type EntitlementId } from '@/lib/entitlements';
import { usePaywall, useSuperwallSettled } from '@/lib/paywall';
import { currentUserId } from '@/lib/auth';
import { getPlan, getPlanEpoch, getSharedPlan, hostingReadOnlyOpen, setSharedPlan, subscribePlan } from '@/lib/plan';

export type TierAccess = {
  /** loading: not yet decidable. error: Superwall never answered and the server didn't either. */
  status: 'loading' | 'error' | 'ready';
  /** Whether the owner's plan covers this tab's feature. */
  entitled: boolean;
  /** True when Bookings / Store should show only the upgrade card (hosting lapsed over 30 days ago). */
  expired: boolean;
  hosting: boolean;
  /** Superwall says paid, but the purchase belongs to another account on this Apple ID: locked, with that copy (and the masked hint). */
  otherAccount: { hint: string | null } | null;
  retry(): void;
};

/**
 * Whether the plan covers `need`: Superwall's status AND the server's plan (the purchase must be this account's:
 * `purchaseAccount === 'self' && active`; useEntitlements already combines them). Signed out or the plan not loaded
 * is locked, never unlocked on Superwall alone. If Superwall never settles (offline launch, no key), the server's
 * plan decides; if that fails too the status is 'error' (a retry card), never an endless spinner and never unlocked.
 * The plan is also fetched when hosting is inactive, to date the lapse.
 */
export function useTierAccess(need: EntitlementId): TierAccess {
  const ents = useEntitlements();
  const settled = useSuperwallSettled();
  const plan = useSyncExternalStore(subscribePlan, getSharedPlan, getSharedPlan);
  const [failed, setFailed] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [tries, setTries] = useState(0);

  // 'other' refetches on mount: the cached plan may predate a move that made this account the owner.
  const needPlan = (!ents.known && settled) || (ents.known && !ents.hosting) || ents.account === 'other';
  useEffect(() => {
    if (!needPlan) return;
    let alive = true;
    const epoch = getPlanEpoch(); // a reply for an account that has since signed out is not for this one
    setFailed(false);
    setSignedOut(false);
    getPlan()
      .then((p) => alive && epoch === getPlanEpoch() && setSharedPlan(p))
      .catch((e) => {
        if (!alive) return;
        // 401 with nobody signed in is "not signed in" (locked). 401 while signed in is an expired/refused token: a retry, never "paused".
        if ((e as { status?: number; code?: string } | null)?.status === 401 && (e as { code?: string }).code === 'unauthorized' && !currentUserId()) setSignedOut(true);
        else setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [needPlan, tries]);

  const retry = useCallback(() => {
    setSharedPlan(null);
    setFailed(false);
    setSignedOut(false);
    setTries((n) => n + 1);
  }, []);

  const other = ents.account === 'other' ? { hint: ents.hint ?? null } : null;
  if (ents.known) {
    // Hosting inactive: wait for the plan's date so a 30+ day lapse never flashes the read-only view.
    // Signed out (nobody has paid or signed in yet, e.g. a site just made from scratch): nothing to wait for, locked.
    if (!ents.hosting && plan == null && !failed && !signedOut) return { status: 'loading', entitled: false, expired: false, hosting: false, otherAccount: null, retry };
    const expired = !ents.hosting && plan != null && !hostingReadOnlyOpen(plan);
    return { status: 'ready', entitled: ents[need], expired, hosting: ents.hosting, otherAccount: other, retry };
  }
  if (!settled) return { status: 'loading', entitled: false, expired: false, hosting: false, otherAccount: null, retry };
  if (plan) {
    // Not Superwall's word: the server's plan, and only for the account that owns the purchase.
    const own = plan.purchaseAccount === 'self' && plan.active;
    return {
      status: 'ready', entitled: own && plan.entitlements[need], expired: !plan.entitlements.hosting && !hostingReadOnlyOpen(plan),
      hosting: plan.entitlements.hosting, otherAccount: plan.purchaseAccount === 'self' ? null : { hint: plan.purchaseHint }, retry,
    };
  }
  // Signed out: nothing to unlock with (locked, no retry card). A network failure is a retry, never an unlock.
  if (signedOut) return { status: 'ready', entitled: false, expired: false, hosting: false, otherAccount: null, retry };
  return { status: failed ? 'error' : 'loading', entitled: false, expired: false, hosting: false, otherAccount: null, retry };
}

/** Opens an upgrade paywall; `busy` while it is up. The entitlements update the tab when it succeeds. */
export function useUpgrade(placement: 'bookings_upgrade' | 'store_upgrade') {
  const paywall = usePaywall();
  const [busy, setBusy] = useState(false);
  // A ref, not the state: a second press before the re-render must not open a second paywall.
  const busyRef = useRef(false);
  const run = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await paywall(placement);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [paywall, placement]);
  return { run, busy };
}
