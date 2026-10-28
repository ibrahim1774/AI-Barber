import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSession } from '@/lib/auth';
import { useEntitlements, useSuperwallEntitlements } from '@/lib/entitlements';
import { getPlan, getPlanEpoch, getSharedPlan, setSharedPlan, subscribePlan } from '@/lib/plan';

const RETRY_MS = 15_000;

/**
 * Loads the server's plan for a signed-in account: right after every sign-in (the plan is cleared on sign-out), and
 * whenever Superwall claims Bookings or Store but the account check is not decided yet (entitlements.account ===
 * 'unknown'). The account's own active purchase is what restores its tiers after a sign-in, even when this device's
 * Superwall status says nothing (another Apple ID, a renewal not seen yet). Until it lands nothing is unlocked on a
 * guess; a failed fetch is retried, never treated as unlocked. Render once under the providers.
 */
export function PlanSync() {
  const ents = useEntitlements();
  const { session } = useSession();
  const uid = session?.user?.id ?? null;
  const plan = useSyncExternalStore(subscribePlan, getSharedPlan, getSharedPlan);
  const [tries, setTries] = useState(0);
  // 'other' is re-checked once too: a plan cached before a subscription move would otherwise lock the tabs for good.
  const sw = useSuperwallEntitlements();
  // Superwall saying the plan stopped (a lapse, a refund) re-reads it too: a plan cached as active must not outlive it
  // (a smaller plan drops the cached one in entitlements.ts, so plan == null covers a downgrade).
  const need = !!uid && (plan == null || ents.account === 'unknown' || ents.account === 'other' || (sw.known && !sw.hosting));
  useEffect(() => {
    if (!need) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const epoch = getPlanEpoch();
    getPlan()
      .then((p) => alive && epoch === getPlanEpoch() && setSharedPlan(p))
      .catch(() => {
        if (alive) timer = setTimeout(() => setTries((n) => n + 1), RETRY_MS);
      });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [need, uid, tries]);
  return null;
}
