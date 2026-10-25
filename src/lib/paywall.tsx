import { usePlacement, useSuperwall, useSuperwallEvents, useUser } from 'expo-superwall';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';

import { relinkShopPurchase } from '@/lib/setup/relink';
import { syncNow } from '@/lib/adminSync';
import { restore, syncIfSignedIn, type Restored } from '@/lib/account';
import { appsFlyerUID, track, trackConversion } from '@/lib/analytics';
import { api, ApiError } from '@/lib/api';
import { currentUserId } from '@/lib/auth';
import { accessToken } from '@/lib/accessToken';
import { PaywallSettle, type PaywallResult } from '@/lib/paywallSettle';
import { loadLinkContext } from '@/lib/linkContext';
import { refreshTeamBeforePublish } from '@/lib/team';
import { PLAN_ENTITLEMENT, getEntitlements, setEntitlementsFromStatus } from '@/lib/entitlements';
import { refreshPlan, refreshPlanQuietly, setSharedPlan } from '@/lib/plan';
import { boundMatches } from '@/lib/website';
import { findTransactionId, pickLatestTransactionId, type PublishDeps } from '@/lib/publish';
import { pickDomainTransactionId } from '@/lib/domains/model';
import { syncRevenueCatPurchases } from '@/lib/revenuecat';
import * as siteStore from '@/lib/siteStore';
import {
  checkSubscriptionStatus, lastStatusCheckAt, registerStatusRunner, setSubscriptionStatus, shouldCheck,
  statusGeneration,
} from '@/lib/subscriptionStatus';

/** Placements configured in the Superwall dashboard (AI Barber campaign). */
export type Placement = 'publish' | 'bookings_upgrade' | 'store_upgrade' | 'custom_domain';
export type { PaywallResult };

const PLAN_ENTITLEMENTS = ['hosting', 'bookings', 'store'];

export const SUPERWALL_KEY = process.env.EXPO_PUBLIC_SUPERWALL_API_KEY ?? '';
/** The provider is mounted only when a key exists. */
export const superwallActive = SUPERWALL_KEY.length > 0;

let entitled = false;
export function hasEntitlement(): boolean {
  return entitled;
}

let integrationAttributesSent = false;
/** Test only: forget that this "launch" already sent the integration attributes. */
export function resetIntegrationAttributesForTests(): void {
  integrationAttributesSent = false;
}

/**
 * Mirrors Superwall's subscription status for hasEntitlement() and tracks the
 * paywall's conversions. Render once under the provider. Superwall is not
 * identified with the Supabase account: the site is bound to the Apple
 * transaction, and a signed-in account only gets a copy (account.ts).
 */
export function SubscriptionSync() {
  const { subscriptionStatus, setIntegrationAttributes } = useUser();
  const configured = useSuperwall((s) => s.isConfigured);

  // Once per launch, after Superwall configures: tell it the AppsFlyer id so
  // its purchase events can be joined to the install. (Its own wait for
  // configuration gives up after 10 s, which a slow first launch exceeds.)
  // appsFlyerUID waits for AppsFlyer's init. A failure is only logged.
  useEffect(() => {
    if (!configured || integrationAttributesSent) return;
    integrationAttributesSent = true;
    (async () => {
      const appsflyerId = await appsFlyerUID();
      if (!appsflyerId) {
        console.warn('[paywall] no AppsFlyer id for Superwall integration attributes');
        return;
      }
      await setIntegrationAttributes({ appsflyerId });
      if (__DEV__) console.log('[paywall] Superwall integration attributes set (appsflyerId)');
    })().catch((e) => console.warn('[paywall] Superwall integration attributes failed:', e));
  }, [configured, setIntegrationAttributes]);

  useEffect(() => {
    if (subscriptionStatus?.status === 'ACTIVE') {
      // Any plan includes hosting; the others are accepted too in case a mapping lags.
      entitled = subscriptionStatus.entitlements.some((e) => PLAN_ENTITLEMENTS.includes(e.id));
    }
    if (subscriptionStatus?.status === 'INACTIVE') entitled = false;
    setEntitlementsFromStatus(subscriptionStatus);
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

/**
 * Superwall's status as the plan's lapse check needs it: ACTIVE only when a plan entitlement is active. A
 * custom-domain subscription alone also reads ACTIVE, and must not hide a lapsed plan.
 */
export function planSuperwallStatus(
  s: { status: string; entitlements?: { id: string }[] } | null | undefined,
): 'ACTIVE' | 'INACTIVE' | 'UNKNOWN' {
  if (s?.status === 'ACTIVE') return (s.entitlements ?? []).some((e) => PLAN_ENTITLEMENTS.includes(e.id)) ? 'ACTIVE' : 'INACTIVE';
  if (s?.status === 'INACTIVE') return 'INACTIVE';
  return 'UNKNOWN';
}

/** How long an upgrade placement waits for the target entitlement to turn on after a purchase. */
const UPGRADE_PATIENCE_MS = 10_000;
const UPGRADE_POLL_MS = 500;

const isUpgrade = (p: Placement): p is 'bookings_upgrade' | 'store_upgrade' => p === 'bookings_upgrade' || p === 'store_upgrade';

/** The target entitlement is active now; when patient, keeps re-reading for up to 10 s. */
async function entitlementActive(target: 'bookings' | 'store', patient: boolean): Promise<boolean> {
  const end = Date.now() + UPGRADE_PATIENCE_MS;
  for (;;) {
    if (getEntitlements()[target]) return true;
    if (!patient || Date.now() >= end) return false;
    await new Promise((r) => setTimeout(r, UPGRADE_POLL_MS));
  }
}

/** As long as Superwall's own awaitConfigured waits. */
const SETTLE_TIMEOUT_MS = 10_000;

/**
 * Keeps subscriptionStatus.ts current for a published site: once Superwall
 * has settled, on each return from the background (both at most every 5
 * minutes), and whenever Superwall's own status changes (a purchase, a
 * restore, an expiry), plus whenever recheckSubscriptionStatus() asks.
 * Render once under the provider. Never prompts.
 */
export function SubscriptionStatusSync() {
  const { subscriptionStatus, getCustomerInfo } = useUser();
  const settled = useSuperwallSettled();
  const latest = useRef({ subscriptionStatus, getCustomerInfo });
  latest.current = { subscriptionStatus, getCustomerInfo };
  const inFlight = useRef(false);
  const again = useRef(false);

  const run = useCallback((force: boolean) => {
    if (inFlight.current) {
      if (force) again.current = true;
      return;
    }
    if (!shouldCheck(Date.now(), lastStatusCheckAt(), force)) return;
    inFlight.current = true;
    // A status set meanwhile (a live publish's 'active') outranks this check's result.
    const gen = statusGeneration();
    (async () => {
      const [site, pending] = await Promise.all([
        siteStore.loadSite().catch(() => null),
        siteStore.loadPendingPublish().catch(() => null),
      ]);
      const sw = latest.current;
      const result = await checkSubscriptionStatus({
        site,
        pendingPublish: pending != null,
        superwallStatus: planSuperwallStatus(sw.subscriptionStatus),
        customerInfo: () => sw.getCustomerInfo(),
        iosSite: api.iosSite,
      });
      setSubscriptionStatus(result, Date.now(), gen);
    })()
      .catch((e) => console.warn('[subscription] status check failed:', e))
      .finally(() => {
        inFlight.current = false;
        if (again.current) {
          again.current = false;
          run(true);
        }
      });
  }, []);

  useEffect(() => {
    if (!settled) return;
    registerStatusRunner(run);
    run(false);
    let last = AppState.currentState;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && last === 'background') run(false);
      last = state;
    });
    return () => {
      sub.remove();
      registerStatusRunner(null);
    };
  }, [settled, run]);

  // Superwall's status moving (purchase, restore, expiry) is worth a fresh look.
  const swStatus = subscriptionStatus?.status;
  const seen = useRef(swStatus);
  useEffect(() => {
    const changed = seen.current !== swStatus;
    seen.current = swStatus;
    // Before settling the first check covers it.
    if (settled && changed) run(true);
  }, [settled, swStatus, run]);

  return null;
}

/**
 * True once Superwall has configured, failed to, or had 10 s to try (offline).
 * The tracking prompt waits for it: SuperwallKit's debug build traps if the app
 * resigns active (as a system prompt makes it) before configure finishes. The
 * timeout keeps an offline first launch from never asking, which would leave
 * AppsFlyer unstarted. Without a key there is no Superwall to wait for.
 */
export function useSuperwallSettled(): boolean {
  // superwallActive is fixed for the life of the process, so the hook choice never changes between renders.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return superwallActive ? useSuperwallSettledWithKey() : true;
}

function useSuperwallSettledWithKey(): boolean {
  const configured = useSuperwall((s) => s.isConfigured);
  const failed = useSuperwall((s) => s.configurationError != null);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), SETTLE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);
  return configured || failed || timedOut;
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
  const latestDomainTransactionId = useLatestDomainTransactionId();
  const session = useRef<PaywallSettle | null>(null);

  const { registerPlacement } = usePlacement({
    onPresent: () => session.current?.present(),
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
        // An upgrade is paid when its target entitlement is active (a transaction always exists for a
        // subscriber); the publish paywall is paid when any of the plan's transactions exists.
        // The domain placement is paid only by an active domain subscription (never a plan's).
        const lookup = placement === 'custom_domain' ? latestDomainTransactionId : latestTransactionId;
        const verify = isUpgrade(placement)
          ? (patient: boolean) => entitlementActive(PLAN_ENTITLEMENT[placement], patient)
          : async (patient: boolean) => (patient ? await findTransactionId(lookup) : await lookup()) != null;
        const s = new PaywallSettle(
          verify,
          (result, { presented }) => {
            if (session.current === s) session.current = null;
            // Bought or restored on the paywall: RevenueCat (observer) syncs in the background.
            if (result !== 'declined') syncRevenueCatPurchases();
            if (isUpgrade(placement)) {
              track('upgrade_result', { placement, result });
              if (result !== 'declined') afterUpgrade(latestTransactionId);
            }
            // No paywall ever showed (skip, holdout, error, timeout): say why nothing happened.
            if (result === 'declined' && !presented) {
              Alert.alert(isUpgrade(placement) ? 'Upgrade' : placement === 'custom_domain' ? 'Custom domain' : 'Publish', PAYWALL_ERROR);
            }
            resolve(result);
          },
          isUpgrade(placement) ? UPGRADE_PATIENCE_MS + 1000 : undefined,
          // An upgrade is paid only when its entitlement is active, whatever the dismiss says (a Restore on it proves nothing).
          isUpgrade(placement),
        );
        session.current = s;
        track('placement_registered', { placement });
        registerPlacement({ placement, feature: () => s.feature() }).catch((e) => {
          console.warn('Superwall register failed', e);
          s.error();
        });
      }),
    [latestTransactionId, latestDomainTransactionId, registerPlacement],
  );
}

/** After an upgrade purchase: link the shop to it (quietly), then have the server read the new plan. */
function afterUpgrade(latestTransactionId: () => Promise<string | null>): void {
  void relinkShopPurchase({ latestTransactionId });
  (async () => {
    const id = await latestTransactionId();
    if (id) setSharedPlan(await refreshPlan(id));
  })().catch((e) => console.warn('[paywall] plan refresh failed:', e));
}

export function useLatestTransactionId() {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return superwallActive ? useSuperwallLatestTransactionId() : noTransactionId;
}

const noTransactionId = async () => null;

/** The newest active custom-domain subscription's transaction id (the domain "slot"). */
export function useLatestDomainTransactionId() {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return superwallActive ? useSuperwallLatestDomainTransactionId() : noTransactionId;
}

function useSuperwallLatestDomainTransactionId() {
  const { getCustomerInfo } = useUser();
  return useCallback(
    async () => pickDomainTransactionId((await getCustomerInfo()).subscriptions ?? []),
    [getCustomerInfo],
  );
}

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
      syncFromServer: syncNow,
      boundElsewhere: async (transactionId, site) => {
        let bound;
        try {
          bound = await api.iosSite(transactionId);
        } catch (e) {
          // A fresh subscription has no site yet: not bound, go ahead. Anything else throws (fail closed).
          if (e instanceof ApiError && (e.status === 404 || e.code === 'no-site')) return 'none';
          throw e;
        }
        if (!bound.siteId) return 'none';
        return !boundMatches(site, bound);
      },
      linkContext: loadLinkContext,
      refreshTeam: refreshTeamBeforePublish,
      store: siteStore,
      // The site is bound to the Apple transaction; a signed-in user is linked to it too.
      userId: currentUserId,
      // The server links the purchase to the account only from a verified bearer.
      accessToken,
      // Live proves the subscription is active (the editor unlocks), and
      // keeps the account's `sites` row (deployed_url, status) current.
      onLive: (site) => {
        setSubscriptionStatus('active');
        // A booking page made before this subscription: tie it to the purchase. Quiet, not awaited.
        void relinkShopPurchase({ latestTransactionId, transactionId: site.transactionId });
        // A shop already linked to an older, lapsed purchase: the server relinks it to this active one.
        void refreshPlanQuietly(site.transactionId);
        return syncIfSignedIn(site);
      },
    }),
    [paywall, latestTransactionId],
  );
}

export const NO_KEY_MESSAGE = 'Subscriptions are not set up in this build.';

/**
 * Superwall shows this alert itself whenever a restore ends without an active
 * subscription (none found, or StoreKit failed). It can only be reworded, not
 * turned off, so it is the app's one "nothing to restore" message.
 */
export const SUPERWALL_OPTIONS = {
  paywalls: {
    restoreFailed: {
      title: 'No subscription found',
      message:
        'We couldn’t find an active Prime Barber subscription for this Apple ID. Make sure this phone is signed in to the App Store with the Apple ID you subscribed with.',
      closeButtonTitle: 'OK',
    },
  },
};

/**
 * Restore Purchases (App Review 3.1.2): syncs StoreKit, then loads the site
 * bound to this Apple ID's subscription (account.restore). Resolves the
 * restored site (with whether the subscription is active), or null when there is no subscription — Superwall has then
 * already shown its restoreFailed alert (SUPERWALL_OPTIONS). Throws the
 * /api/ios/site ApiError, or NO_KEY_MESSAGE without a Superwall key.
 */
export function useRestorePurchases(): () => Promise<Restored | null> {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return superwallActive ? useSuperwallRestore() : noKeyRestore;
}

async function noKeyRestore(): Promise<Restored | null> {
  track('restore_tapped', { paywall: 'off' });
  throw new Error(NO_KEY_MESSAGE);
}

function useSuperwallRestore() {
  const restorePurchases = useSuperwall((s) => s.restorePurchases);
  const latestTransactionId = useLatestTransactionId();
  return useCallback(
    () =>
      restore({
        restorePurchases: async () => {
          // A failed StoreKit sync may still leave a cached subscription to find.
          try {
            const result = await restorePurchases();
            track('restore_tapped', { result: result?.result ?? 'unknown' });
            if (result?.result === 'restored') syncRevenueCatPurchases();
          } catch {
            track('restore_tapped', { result: 'error' });
          }
        },
        latestTransactionId,
        iosSite: api.iosSite,
        store: siteStore,
      }),
    [restorePurchases, latestTransactionId],
  );
}
