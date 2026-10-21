import { getTrackingPermissionsAsync, requestTrackingPermissionsAsync } from 'expo-tracking-transparency';
import PostHog from 'posthog-react-native';
import { AppState } from 'react-native';
import AppsFlyer from 'react-native-appsflyer';

/**
 * One place for analytics (copied from Crew Lens). Every event goes to
 * PostHog (product analytics); only the few that ads optimise for go to
 * AppsFlyer (install attribution, forwarded to Meta). Keys are public client
 * keys from .env. No email or phone is ever sent: PostHog only gets the
 * Supabase user id.
 */

const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '';
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';
const APPSFLYER_KEY = process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY ?? '';
const APPLE_APP_ID = process.env.EXPO_PUBLIC_APPLE_APP_ID ?? '';

// Only a project API key (phc_…) works from a client; a personal key (phx_…) is rejected with 401 on every flush.
const posthogKeyValid = POSTHOG_KEY.startsWith('phc_');
if (POSTHOG_KEY && !posthogKeyValid) console.warn('PostHog: EXPO_PUBLIC_POSTHOG_KEY must be a project key starting with phc_; analytics disabled.');

export const posthog = posthogKeyValid
  ? new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      captureAppLifecycleEvents: true,
      // Dev builds send each event at once so it can be checked in PostHog straight away.
      ...(__DEV__ ? { flushAt: 1 } : {}),
    })
  : null;

/**
 * PostHogProvider's autocapture. Touches only, and only these props: never
 * `children` (on-screen text such as the account email or the shop's phone)
 * and never `style`. Screens come from ScreenTracker instead.
 */
export const POSTHOG_AUTOCAPTURE = {
  captureScreens: false,
  captureTouches: true,
  propsToCapture: ['testID', 'accessibilityLabel', 'ph-label'],
};

let appsFlyerStarted = false;
let startInFlight = false;
let startRetryScheduled = false;
let sessionReady = false;
let consentSettled = false;
let initStarted = false;
let initOk = false;
let markInitDone: () => void = () => {};
/** Settles when initAttribution has finished (or given up), so the UID can be read safely. */
const initDone = new Promise<void>((resolve) => {
  markInitDone = resolve;
});

/**
 * Initialises AppsFlyer at launch, for everyone. SDK 7 never auto-starts:
 * `start()` runs after the session-ready event *and* once tracking consent is
 * settled (an earlier answer, or the prompt from requestTrackingThenStart on
 * the first screen). SDK 7 dropped `timeToWaitForATTUserAuthorization`; this
 * gate is its replacement. Debug logging only in dev builds.
 */
export async function initAttribution(): Promise<void> {
  if (initStarted) return;
  initStarted = true;
  if (!APPSFLYER_KEY || !APPLE_APP_ID) {
    markInitDone();
    return;
  }
  try {
    // Order matters: the native SDK throws if the listener is registered before init.
    await AppsFlyer.init({ devKey: APPSFLYER_KEY, appId: APPLE_APP_ID });
    initOk = true;
    await AppsFlyer.registerSessionReadyListener(() => {
      sessionReady = true;
      void startAttribution();
    });
    if (__DEV__) await AppsFlyer.enableDebug({ enabled: true });
    const { status } = await getTrackingPermissionsAsync();
    // If the user already answered the tracking prompt, don't wait for it again.
    if (status !== 'undetermined') {
      consentSettled = true;
      void startAttribution();
    }
  } catch (e) {
    console.warn('AppsFlyer init failed', e);
  } finally {
    markInitDone();
  }
}

type AfEvent = { eventName: string; eventValues: Record<string, unknown> };
/** Events raised before AppsFlyer starts (before the tracking prompt is answered) wait here. */
const pending: AfEvent[] = [];
const MAX_PENDING = 50;

function sendAf(e: AfEvent) {
  if (!APPSFLYER_KEY) return;
  if (!appsFlyerStarted) {
    if (pending.length < MAX_PENDING) pending.push(e);
    return;
  }
  AppsFlyer.logEvent(e).catch(() => {});
}

async function startAttribution() {
  if (appsFlyerStarted || startInFlight || !APPSFLYER_KEY || !sessionReady || !consentSettled) return;
  startInFlight = true;
  try {
    await AppsFlyer.start();
    // Started only once start() resolves; until then sendAf keeps queueing.
    // Same tick: the queue goes out before anything raised after this point.
    appsFlyerStarted = true;
    for (const e of pending.splice(0)) AppsFlyer.logEvent(e).catch(() => {});
    if (__DEV__) console.log('[analytics] AppsFlyer started');
  } catch (e) {
    console.warn('AppsFlyer start failed', e);
    retryStartOnNextForeground();
  } finally {
    startInFlight = false;
  }
}

/** One retry per launch, when the app next comes to the foreground; the queue waits meanwhile. */
function retryStartOnNextForeground() {
  if (startRetryScheduled) return;
  startRetryScheduled = true;
  const sub = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    sub.remove();
    void startAttribution();
  });
}

/** Test hook: how many AppsFlyer events are waiting for the SDK to start. */
export function pendingAttributionEvents(): number {
  return pending.length;
}

/** Asks for App Tracking Transparency consent (once), then starts attribution either way. */
export async function requestTrackingThenStart(): Promise<void> {
  try {
    const { status } = await getTrackingPermissionsAsync();
    if (status === 'undetermined') {
      const res = await requestTrackingPermissionsAsync();
      if (__DEV__) console.log('[analytics] ATT answered:', res.status);
    } else if (__DEV__) {
      console.log('[analytics] ATT already answered:', status);
    }
  } catch {
    // Permission API unavailable: attribution still runs without the IDFA.
  }
  consentSettled = true;
  await startAttribution();
}

let trackingAsked = false;
/**
 * The first screen's call: the tracking prompt once the app is active (iOS
 * ignores the request otherwise, e.g. behind the StoreKit sign-in sheet). The
 * wait lives here, not in the screen, because that screen redirects away at
 * once and must not take the listener with it.
 */
export function requestTrackingWhenActive(): void {
  if (trackingAsked) return;
  trackingAsked = true;
  const ask = () => void requestTrackingThenStart().catch(() => {});
  if (AppState.currentState === 'active') {
    ask();
    return;
  }
  const sub = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    sub.remove();
    ask();
  });
}

/** The AppsFlyer id for Superwall's integration attributes; null when AppsFlyer is off or failed. */
export async function appsFlyerUID(): Promise<string | null> {
  await initDone;
  if (!initOk) return null;
  return AppsFlyer.getAppsFlyerUID();
}

type PostHogProps = Record<string, string | number | boolean | null>;

/**
 * The AppsFlyer event (if any) for an app event. Everything else is PostHog
 * only. A lead is an imported site, as on the web.
 */
function attributionEventFor(event: string, props?: Record<string, unknown>): AfEvent | null {
  if (event === 'site_generated') {
    const from = props?.importedFrom;
    return from === 'booking' || from === 'gbp' ? { eventName: 'af_lead', eventValues: { imported_from: from } } : null;
  }
  // A subscriber republishing is not a checkout: keep Meta's InitiateCheckout to new buyers.
  if (event === 'publish_tapped') {
    return props?.entitled === true ? null : { eventName: 'af_initiated_checkout', eventValues: {} };
  }
  return null;
}

export function track(event: string, props?: Record<string, unknown>): void {
  posthog?.capture(event, props as PostHogProps | undefined);
  const af = attributionEventFor(event, props);
  if (af) sendAf(af);
}

/**
 * Sign-up finished. Sent under AppsFlyer's standard name so Meta can optimise
 * for it as fb_mobile_complete_registration.
 */
export function trackRegistration(method: 'email'): void {
  posthog?.capture('sign_up', { method });
  sendAf({ eventName: 'af_complete_registration', eventValues: { af_registration_method: method } });
}

/**
 * Superwall's purchase milestones. A paid subscription start goes to
 * AppsFlyer as af_subscribe with its revenue; a trial is PostHog only (no
 * af_start_trial).
 */
export function trackConversion(kind: 'trial' | 'subscribe', productId: string, price: number, currency: string): void {
  posthog?.capture(kind === 'trial' ? 'trial_started' : 'subscription_started', { product: productId, price, currency });
  if (kind !== 'subscribe') return;
  sendAf({
    eventName: 'af_subscribe',
    eventValues: { af_revenue: price, af_currency: currency, af_content_id: productId },
  });
}

/** After sign-in / sign-up: the Supabase user id, nothing else. */
export function identifyUser(userId: string): void {
  posthog?.identify(userId);
}

/** On sign-out and account deletion: later events are anonymous again. */
export function resetUser(): void {
  posthog?.reset();
}

export function screen(name: string, props?: PostHogProps): void {
  posthog?.screen(name, props);
}
