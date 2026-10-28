import { Alert } from 'react-native';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PLAN_ENTITLEMENT, useEntitlements, useSuperwallEntitlements, type EntitlementId } from '@/lib/entitlements';
import { usePaywall, usePublishDeps, useSuperwallSettled } from '@/lib/paywall';
import { publishFlow } from '@/lib/publish';
import { loadSite } from '@/lib/siteStore';
import { resetTo } from '@/lib/nav';
import { currentUserId, useSession } from '@/lib/auth';
import { withTimeout } from '@/lib/timeout';
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
 * Whether the plan covers `need`, as useEntitlements combines it: the server's plan for this account
 * (`purchaseAccount === 'self' && active` grants its tiers, whatever this iPhone's Superwall says), with Superwall's
 * word added only for a purchase the server says is this account's. Signed out or the plan not loaded
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
  // A 401 while signed out locks the tab; the sign-in that follows must ask again (the other deps don't change).
  const uid = useSession().session?.user?.id ?? null;
  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!signedOut || !uid || askedFor.current === uid) return; // once per signed-in account, never a loop
    askedFor.current = uid;
    setTries((n) => n + 1);
  }, [signedOut, uid]);

  // 'other' refetches on mount: the cached plan may predate a move that made this account the owner.
  // Superwall saying the plan stopped re-reads the server too: its answer decides (a lapse locks, the account's own
  // active purchase on another Apple ID or a renewal Superwall missed keeps the tiers).
  const sw = useSuperwallEntitlements();
  const needPlan = (!ents.known && settled) || (ents.known && !ents.hosting) || ents.account === 'other' || (sw.known && !sw.hosting);
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
    // Only a plan whose hosting has ended can be "expired"; hostingReadOnlyOpen is false for an active one too.
    const expired = !ents.hosting && plan != null && !plan.entitlements.hosting && !hostingReadOnlyOpen(plan);
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

/**
 * True when the signed-in account's own, active purchase (the server's plan) already includes the placement's tier:
 * the fresh plan is published to the tabs and no paywall is needed. Never throws; signed out or any failure is false.
 */
const PLAN_CHECK_MS = 4_000;

async function alreadyCovered(placement: 'bookings_upgrade' | 'store_upgrade', d: { accessToken(): Promise<string | null> }): Promise<boolean> {
  try {
    if (!(await d.accessToken().catch(() => null))) return false;
    const epoch = getPlanEpoch();
    // Short: a slow network falls through to the paywall instead of holding the button.
    const p = await withTimeout(getPlan(), PLAN_CHECK_MS);
    if (epoch !== getPlanEpoch()) return false;
    setSharedPlan(p);
    return p.purchaseAccount === 'self' && p.active && p.entitlements[PLAN_ENTITLEMENT[placement]];
  } catch {
    return false;
  }
}

const PAID_NOT_FINISHED = 'Your payment went through. Open Settings > Publish to finish.';

/**
 * Opens an upgrade paywall; `busy` while it is up. The entitlements update the tab when it succeeds.
 * A purchase made with nobody signed in (a site made from scratch) has no account to belong to: it takes the same
 * path as Publish with an existing subscription (pending publish saved as 'unclaimed' with the latest transaction
 * id, then the account step), so the site publishes and the tab unlocks once the account exists.
 */
export function useUpgrade(placement: 'bookings_upgrade' | 'store_upgrade') {
  const paywall = usePaywall();
  const deps = usePublishDeps();
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const [busy, setBusy] = useState(false);
  // A ref, not the state: a second press before the re-render must not open a second paywall.
  const busyRef = useRef(false);
  const run = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      // Signed in: this account may already own a purchase that covers it (the tab was showing a stale or
      // device-only answer). Then its link is restored from the server instead of selling the plan again.
      if (await alreadyCovered(placement, depsRef.current)) return;
      const result = await paywall(placement);
      if (result !== 'declined') {
        const d = depsRef.current;
        // A failed token refresh of a signed-in user is unknown, not signed out: leave that user alone.
        if (!(await d.accessToken().catch(() => null)) && !currentUserId()) {
          const site = await loadSite().catch(() => null);
          if (site) {
            // Just bought: publishFlow saves the paid record first, so a failing claim-start never loses it.
            const out = await publishFlow(site, { ...d, purchasedNow: true });
            if (out.kind === 'claim-required') resetTo('/claim');
            else Alert.alert('Payment received', PAID_NOT_FINISHED);
          } else {
            Alert.alert('Payment received', PAID_NOT_FINISHED);
          }
        }
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [paywall, placement]);
  return { run, busy };
}
