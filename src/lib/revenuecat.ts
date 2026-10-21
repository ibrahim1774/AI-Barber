import { Platform } from 'react-native';
import Purchases, { PURCHASES_ARE_COMPLETED_BY_TYPE, STOREKIT_VERSION } from 'react-native-purchases';
import { appsFlyerUID, onTrackingSettled } from '@/lib/analytics';

/**
 * RevenueCat as an observer only. Superwall is the paywall and makes every
 * purchase; RevenueCat watches StoreKit so it can report renewals,
 * cancellations and refunds (and send them to AppsFlyer server-to-server).
 * The app's own af_subscribe is untouched.
 *
 * - Purchases are completed by the app (Superwall), with StoreKit 2: the
 *   version SuperwallKit uses here (SUPERWALL_OPTIONS sets none, and its
 *   default is StoreKit 2 on iOS 15+; the deployment target is 16.4).
 * - The user stays anonymous: never logIn with the Supabase id.
 * - Attributes: the AppsFlyer id and the device identifiers only.
 * - Never throws and never prompts. Without a key (local dev, Jest) or off
 *   iOS, every call is a no-op.
 */

let configured = false;

function warn(what: string, e: unknown) {
  console.warn(`[revenuecat] ${what} failed:`, e);
}

/** Device identifiers ($idfv, $ip, and $idfa once tracking is allowed). Safe to call more than once. */
function collectDeviceIdentifiers() {
  try {
    Purchases.collectDeviceIdentifiers().catch((e) => warn('collectDeviceIdentifiers', e));
  } catch (e) {
    warn('collectDeviceIdentifiers', e);
  }
}

/** Once AppsFlyer's id is known, so RevenueCat's events can be joined to the install. */
async function sendAppsFlyerId() {
  const id = await appsFlyerUID();
  if (!id) return;
  await Purchases.setAppsflyerID(id);
}

/**
 * Configures RevenueCat once, at launch. Returns whether it is configured.
 * Then sends the device identifiers (again once the tracking prompt is
 * answered) and the AppsFlyer id, in the background.
 */
export function startRevenueCat(): boolean {
  if (configured) return true;
  // Read literally so Expo inlines it at build time.
  const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
  if (!apiKey || Platform.OS !== 'ios') return false;
  try {
    Purchases.configure({
      apiKey,
      purchasesAreCompletedBy: {
        type: PURCHASES_ARE_COMPLETED_BY_TYPE.MY_APP,
        storeKitVersion: STOREKIT_VERSION.STOREKIT_2,
      },
    });
    configured = true;
  } catch (e) {
    warn('configure', e);
    return false;
  }
  collectDeviceIdentifiers();
  try {
    onTrackingSettled(collectDeviceIdentifiers);
  } catch (e) {
    warn('tracking listener', e);
  }
  sendAppsFlyerId().catch((e) => warn('setAppsflyerID', e));
  return true;
}

/**
 * After a Superwall purchase or restore: send StoreKit's purchases to
 * RevenueCat now (it also sees StoreKit 2 transactions by itself). Fire and
 * forget; never awaited on the user's path. No OS sign-in prompt.
 */
export function syncRevenueCatPurchases(): void {
  if (!configured) return;
  try {
    Purchases.syncPurchases().catch((e) => warn('syncPurchases', e));
  } catch (e) {
    warn('syncPurchases', e);
  }
}

/** Test only: forget the configuration. */
export function resetRevenueCatForTests(): void {
  configured = false;
}
