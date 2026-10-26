import { useEffect, useState } from 'react';
import { useSession } from '@/lib/auth';
import { useEntitlements } from '@/lib/entitlements';
import { getPlan, getPlanEpoch, setSharedPlan } from '@/lib/plan';

const RETRY_MS = 15_000;

/**
 * Loads the server's plan for a signed-in account whenever Superwall claims Bookings or Store but the account check
 * is not decided yet (entitlements.account === 'unknown'). Until it lands those tiers stay locked (fail closed); a
 * failed fetch is retried, never treated as unlocked. Render once under the providers.
 */
export function PlanSync() {
  const ents = useEntitlements();
  const { session } = useSession();
  const uid = session?.user?.id ?? null;
  const [tries, setTries] = useState(0);
  const need = !!uid && ents.account === 'unknown';
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
