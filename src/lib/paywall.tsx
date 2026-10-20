import { usePlacement, useSuperwall, useSuperwallEvents, useUser } from 'expo-superwall';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Alert } from 'react-native';

import { track, trackConversion } from '@/lib/analytics';
import { api } from '@/lib/api';
import { PaywallSettle, type PaywallResult } from '@/lib/paywallSettle';
import { findTransactionId, pickLatestTransactionId, type PublishDeps } from '@/lib/publish';
import * as siteStore from '@/lib/siteStore';

/** Placements configured in the Superwall dashboard (AI Barber campaign). */
export type Placement = 'publish';
export type { PaywallResult };

const ENTITLEMENT = 'hosting';

export const SUPERWALL_KEY = process.env.EXPO_PUBLIC_SUPERWALL_API_KEY ?? '';
/** The provider is mounted only when a key exists. */
export const superwallActive = SUPERWALL_KEY.length > 0;

let entitled = false;
export function hasEntitlement(): boolean {
  return entitled;
}

/**
 * Mirrors Superwall's subscription status for hasEntitlement() and tracks the
 * paywall's conversions. Render once under the provider. There is no account
 * to identify: a site is bound to the Apple transaction, not to a user.
 */
export function SubscriptionSync() {
  const { subscriptionStatus } = useUser();

  useEffect(() => {
    if (subscriptionStatus?.status === 'ACTIVE') {
      entitled = subscriptionStatus.entitlements.some((e) => e.id === ENTITLEMENT);
    }
    if (subscriptionStatus?.status === 'INACTIVE') entitled = false;
  }, [subscriptionStatus]);

  useSuperwallEvents({
    onPaywallPresent: (info) => track('paywall_shown', { paywall: info.name ?? null }),
    onPaywallDismiss: (info, result) => track('paywall_closed', { paywall: info.name ?? null, result: result.type }),
    onSubscriptionStatusChange: (status) => track('subscription_status', { status: status.status }),
    onSuperwallEvent: ({ event }) => {
      if (event.event !== 'freeTrialStart' && event.event !== 'subscriptionStart') return;
      const product = event.product;
      trackConversion(event.event === 'freeTrialStart' ? 'trial' : 'subscribe', product.productIdentifier, product.price, product.currencyCode ?? 'USD');
    },
  });

  return null;
}

const PAYWALL_ERROR = "We couldn't open the subscription screen. Check your connection and try again.";

/** Shows the paywall for a placement and settles with how it ended. */
export function usePaywall() {
  // superwallActive is fixed for the life of the process, so the hook choice never changes between renders.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return superwallActive ? useSuperwallPaywall() : useNoKeyPaywall();
}

/** Without a key there is no provider and nothing to buy, so nothing can be published. */
function useNoKeyPaywall() {
  return useCallback(async (placement: Placement): Promise<PaywallResult> => {
    track('placement_registered', { placement, paywall: 'off' });
    Alert.alert('Publishing unavailable', 'Subscriptions are not set up in this build.');
    return 'declined';
  }, []);
}

function useSuperwallPaywall() {
  // Native only resolves registerPlacement through the feature closure, and
  // never on a declined gated paywall or an error, so the result comes from
  // whichever signal settles a PaywallSettle first. Only a found transaction
  // (or a purchased / restored dismiss) counts as paid.
  const latestTransactionId = useLatestTransactionId();
  const session = useRef<PaywallSettle | null>(null);

  const { registerPlacement } = usePlacement({
    onDismiss: (info, result) => session.current?.dismiss(result.type, info.closeReason),
    onSkip: (reason) => {
      console.warn('Superwall paywall skipped', reason.type);
      session.current?.skip();
    },
    onError: (error) => {
      console.warn('Superwall placement error', error);
      session.current?.error();
    },
  });

  return useCallback(
    (placement: Placement) =>
      new Promise<PaywallResult>((resolve) => {
        session.current?.supersede();
        const verify = async (patient: boolean) =>
          (patient ? await findTransactionId(latestTransactionId) : await latestTransactionId()) != null;
        const s = new PaywallSettle(verify, (result, cause) => {
          if (session.current === s) session.current = null;
          // A paywall that never showed (skip / error) shouldn't fail silently.
          if (result === 'declined' && (cause === 'skip' || cause === 'error')) Alert.alert('Publish', PAYWALL_ERROR);
          resolve(result);
        });
        session.current = s;
        track('placement_registered', { placement });
        registerPlacement({ placement, feature: () => s.feature() }).catch((e) => {
          console.warn('Superwall register failed', e);
          s.error();
        });
      }),
    [latestTransactionId, registerPlacement],
  );
}

function useLatestTransactionId() {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return superwallActive ? useSuperwallLatestTransactionId() : noTransactionId;
}

const noTransactionId = async () => null;

function useSuperwallLatestTransactionId() {
  const { getCustomerInfo } = useUser();
  return useCallback(
    async () => pickLatestTransactionId((await getCustomerInfo()).subscriptions ?? []),
    [getCustomerInfo],
  );
}

/** Everything publishFlow / resumePendingPublish need, wired to Superwall and the API. */
export function usePublishDeps(): PublishDeps {
  const paywall = usePaywall();
  const latestTransactionId = useLatestTransactionId();
  return useMemo(
    () => ({
      hasEntitlement: async () => entitled,
      showPaywall: () => paywall('publish'),
      latestTransactionId,
      iosPublish: api.iosPublish,
      store: siteStore,
      // No accounts yet: the site is bound to the Apple transaction.
      userId: () => null,
    }),
    [paywall, latestTransactionId],
  );
}

/** Restore Purchases (App Review 3.1.2). */
export function useRestorePurchases() {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return superwallActive ? useSuperwallRestore() : noKeyRestore;
}

async function noKeyRestore() {
  track('restore_tapped', { paywall: 'off' });
  Alert.alert('Restore purchases', 'Subscriptions are not set up in this build.');
}

function useSuperwallRestore() {
  const restorePurchases = useSuperwall((s) => s.restorePurchases);
  return async () => {
    try {
      const result = await restorePurchases();
      track('restore_tapped', { result: JSON.stringify(result).slice(0, 80) });
      Alert.alert('Restore purchases', 'If this Apple ID has an active AI Barber subscription, it has been restored.');
    } catch {
      Alert.alert('Restore purchases', 'We could not reach the App Store. Try again in a moment.');
    }
  };
}
