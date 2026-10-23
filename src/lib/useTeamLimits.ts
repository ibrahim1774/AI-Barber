import { useCallback, useSyncExternalStore } from 'react';
import { Alert } from 'react-native';
import { getSharedPlan, subscribePlan } from '@/lib/plan';
import { useUpgrade } from '@/lib/tierAccess';
import {
  NEED_BOOKINGS_MESSAGE, atCapMessage, limitBeforeAdd, limitOutcome, type LimitOutcome,
} from '@/lib/team';

/**
 * What "Add a barber" does at a limit. Bookings shop at 2: the store_upgrade paywall (no price text of our own,
 * so no yearly price is ever shown as a monthly one). Store shop at 5: "You're at 5 barbers". No Bookings plan:
 * an explanation. Existing members are never hidden or removed; only adding is gated.
 */
export function useTeamLimits() {
  const store = useUpgrade('store_upgrade');
  const bookings = useUpgrade('bookings_upgrade');
  const plan = useSyncExternalStore(subscribePlan, getSharedPlan, getSharedPlan);

  const show = useCallback((o: LimitOutcome) => {
    switch (o.kind) {
      case 'upgrade':
        void store.run();
        return;
      case 'at-cap': {
        const m = atCapMessage(o.limit);
        Alert.alert(m.title, m.body);
        return;
      }
      case 'need-bookings':
        Alert.alert(NEED_BOOKINGS_MESSAGE.title, NEED_BOOKINGS_MESSAGE.body, [
          { text: 'Not now', style: 'cancel' },
          { text: 'See the Bookings plan', onPress: () => void bookings.run() },
        ]);
        return;
      case 'unavailable':
        Alert.alert("Adding barbers isn't available yet", 'Try again in a little while. Your current team is unchanged.');
        return;
    }
  }, [store, bookings]);

  /** Before the sheet opens: false (and the paywall / notice shown) when the plan is already at its limit. */
  const canAdd = useCallback((activeMembers: number): boolean => {
    const o = limitBeforeAdd(plan?.tier, activeMembers);
    if (!o) return true;
    show(o);
    return false;
  }, [plan, show]);

  /** A failed add: true when it was a limit / plan error and has been shown. */
  const handleAddError = useCallback((e: unknown): boolean => {
    const o = limitOutcome(e);
    if (!o) return false;
    show(o);
    return true;
  }, [show]);

  return { canAdd, handleAddError, busy: store.busy || bookings.busy };
}
