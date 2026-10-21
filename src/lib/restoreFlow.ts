import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { syncIfSignedIn, type Restored } from '@/lib/account';
import { ApiError } from '@/lib/api';
import { resetTo } from '@/lib/nav';
import { hasEntitlement, useLatestTransactionId, useRestorePurchases } from '@/lib/paywall';
import { relinkShopPurchase } from '@/lib/setup/relink';
import { recheckSubscriptionStatus } from '@/lib/subscriptionStatus';

const SUPPORT_EMAIL = 'support@davoxa.com';
const TITLE = 'Restore purchases';

/**
 * What to tell the user after Restore purchases: the restore's result, or
 * the error it threw. null = say nothing (no subscription: Superwall has
 * already shown its own reworded restoreFailed alert).
 */
export function restoreMessage(
  outcome: Restored | null | unknown,
  entitled: boolean,
): { title: string; message: string } | null {
  const say = (message: string) => ({ title: TITLE, message });
  if (outcome instanceof Error) {
    if (outcome instanceof ApiError) {
      if (outcome.code === 'no-site') {
        return say(
          entitled
            ? 'Your subscription is active, but no website has been published with it yet. Build your website and tap Publish — it’s included.'
            : 'Your subscription was found, but no website has been published with it yet. Build your website and tap Publish.',
        );
      }
      if (outcome.status === 0) return say(outcome.message); // offline / timed out
      return say(`We couldn’t load your website right now. Try again in a moment, or email ${SUPPORT_EMAIL}.`);
    }
    return say(outcome.message || 'Something went wrong. Please try again.');
  }
  if (outcome && typeof outcome === 'object' && 'site' in outcome) {
    return say(
      (outcome as Restored).active
        ? 'Your subscription and your website have been restored.'
        : 'We restored your website, but this subscription isn’t active — subscribe again to publish changes.',
    );
  }
  // Superwall says subscribed (so it showed no alert), but the transaction isn't readable yet.
  if (entitled) {
    return say(`Your subscription is active, but we couldn’t load your website yet. Try again in a moment, or email ${SUPPORT_EMAIL}.`);
  }
  return null;
}

/**
 * Restore purchases as Settings, /start and the lapsed Edit tab run it:
 * restore, push the site to a signed-in account, go to the Edit tab, re-check
 * the subscription, then say what happened.
 */
export function useRestoreFlow(): { restore: () => Promise<void>; busy: boolean } {
  const restorePurchases = useRestorePurchases();
  const latestTransactionId = useLatestTransactionId();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const restore = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    let outcome: Restored | null | unknown;
    try {
      const res = await restorePurchases();
      if (res) {
        void syncIfSignedIn(res.site);
        if (res.active) void relinkShopPurchase({ latestTransactionId, transactionId: res.site.transactionId });
        resetTo('/edit');
      }
      outcome = res;
    } catch (e) {
      outcome = e;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
    // Whatever happened, the subscription may have changed (locks / unlocks the editor).
    recheckSubscriptionStatus(true);
    const msg = restoreMessage(outcome, hasEntitlement());
    if (msg) Alert.alert(msg.title, msg.message);
  }, [restorePurchases, latestTransactionId]);

  return { restore, busy };
}
