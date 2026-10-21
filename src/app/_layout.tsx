import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { router, Stack, usePathname, useRootNavigationState } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { SuperwallProvider } from 'expo-superwall';
import { PostHogProvider } from 'posthog-react-native';
import { fontAssets } from '@/constants/theme';
import { onSiteAdopted, pullSiteOnLaunch } from '@/lib/account';
import { initAttribution, POSTHOG_AUTOCAPTURE, posthog, screen } from '@/lib/analytics';
import { LaunchPrompts } from '@/lib/launchPrompts';
import {
  SubscriptionStatusSync, SubscriptionSync, SUPERWALL_KEY, SUPERWALL_OPTIONS, superwallActive, usePublishDeps,
} from '@/lib/paywall';
import { resetTo } from '@/lib/nav';
import { startRevenueCat } from '@/lib/revenuecat';
import { publishBusy, resumePendingPublish } from '@/lib/publish';
import { onReminderTap, refreshReminders, routeForReminderTap, takeLaunchReminderTap } from '@/lib/reminders';
import { loadSite } from '@/lib/siteStore';
import { recheckSubscriptionStatus } from '@/lib/subscriptionStatus';

function ScreenTracker() {
  const path = usePathname();
  useEffect(() => {
    // The pathname only: never a query or fragment (a reset link's tokens live there).
    screen(path.replace(/[?#][\s\S]*$/, ''));
  }, [path]);
  return null;
}

/**
 * Publish reminders. Refreshes the schedule at launch, on each real return
 * to the foreground and on going to the background (reminders.ts checks permission and publish state; it
 * never prompts). A tapped reminder, warm or cold start, opens the Edit tab
 * (or /start without a site) once the launch redirect is done.
 */
function Reminders() {
  const navReady = useRootNavigationState()?.key != null;
  const path = usePathname();
  const [tapped, setTapped] = useState(0);

  useEffect(() => {
    void refreshReminders();
    // Back from the background only, as in ResumePublish.
    let last = AppState.currentState;
    const sub = AppState.addEventListener('change', (state) => {
      // Also on the way out, so a state change (a purchase) is reflected even if the app isn't reopened.
      if ((state === 'active' && last === 'background') || state === 'background') void refreshReminders();
      last = state;
    });
    const unsubscribe = onReminderTap(() => setTapped((n) => n + 1));
    if (takeLaunchReminderTap()) setTapped((n) => n + 1);
    return () => {
      sub.remove();
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!tapped || !navReady) return;
    let stale = false;
    loadSite()
      .catch(() => null)
      .then((site) => {
        if (stale) return;
        const route = routeForReminderTap(site, path, publishBusy());
        if ('wait' in route) return; // the index is still redirecting: try again on the next path
        setTapped(0);
        if ('go' in route) resetTo(route.go);
      });
    return () => {
      stale = true;
    };
  }, [tapped, navReady, path]);

  return null;
}

/**
 * The account's copy of the site: loaded once at launch when a session
 * already exists (the index waits for it only without a local site). Any
 * adoption (launch or sign-in) re-checks the subscription; one that lands
 * while the importer's landing screen shows moves to the Edit tab. The
 * screens showing the site reload it themselves (onSiteAdopted).
 */
function AccountPull() {
  const path = usePathname();
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    const unsubscribe = onSiteAdopted(() => {
      recheckSubscriptionStatus(true);
      if (pathRef.current === '/start') resetTo('/edit');
    });
    void pullSiteOnLaunch();
    return unsubscribe;
  }, []);

  return null;
}

export default function RootLayout() {
  // AppsFlyer for everyone at launch, before any screen. It starts once the
  // tracking prompt (LaunchPrompts, after the font gate) is answered.
  // RevenueCat beside it, as an observer of Superwall's purchases (no prompts).
  useEffect(() => {
    initAttribution().catch(() => {});
    startRevenueCat();
  }, []);
  const [loaded, error] = useFonts(fontAssets);
  // Render nothing until Montserrat/Manrope are ready; on a font load error
  // fall back to system fonts rather than a blank app.
  if (!loaded && !error) return null;
  const screens = (
    <>
      <StatusBar style="light" />
      <ScreenTracker />
      {/* Notifications, then ATT: once, on the first screen after the splash. */}
      <LaunchPrompts />
      <Reminders />
      <AccountPull />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }}>
        <Stack.Screen name="generating" options={{ gestureEnabled: false, animation: 'fade' }} />
        {/* Home once a site exists (Edit, Settings); no swipe back into the importer. */}
        <Stack.Screen name="(tabs)" options={{ gestureEnabled: false, animation: 'fade' }} />
        {/* Over the Edit tab: clear while the paywall is up, then the publish overlay. No leaving mid-publish. */}
        <Stack.Screen
          name="publishing"
          options={{
            presentation: 'transparentModal',
            animation: 'fade',
            gestureEnabled: false,
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen name="live" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
      </Stack>
    </>
  );
  // Touches as in Crew Lens, but never on-screen text (see POSTHOG_AUTOCAPTURE).
  const app = posthog ? (
    <PostHogProvider client={posthog} autocapture={POSTHOG_AUTOCAPTURE}>
      {screens}
    </PostHogProvider>
  ) : (
    screens
  );

  if (!superwallActive) {
    return (
      <>
        <ResumePublish />
        {app}
      </>
    );
  }
  return (
    <SuperwallProvider
      apiKeys={{ ios: SUPERWALL_KEY }}
      options={SUPERWALL_OPTIONS}
      onConfigurationError={(e) => console.warn('Superwall configuration failed', e)}>
      <SubscriptionSync />
      <SubscriptionStatusSync />
      <ResumePublish />
      {app}
    </SuperwallProvider>
  );
}

/**
 * At launch and each time the app returns to the foreground: finish a publish
 * that was paid for but never confirmed (app killed, offline, 5xx, Apple lag).
 * Runs on publish.ts's queue, so it never overlaps a Publish tap. It only
 * needs Superwall for a record without a transaction id, and getCustomerInfo
 * waits for configuration itself.
 */
function ResumePublish() {
  const deps = usePublishDeps();
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const navReady = useRootNavigationState()?.key != null;

  useEffect(() => {
    if (!navReady) return;
    const resume = () => {
      resumePendingPublish(depsRef.current)
        .then((out) => {
          // A user publish queued behind this retry navigates for itself.
          if (out?.kind !== 'live' || publishBusy()) return;
          if (router.canDismiss()) router.dismissAll();
          router.replace('/live');
        })
        .catch((e) => console.warn('[publish] retry failed:', e));
    };
    resume();
    // Back from the background only: the StoreKit sheet's inactive → active blip is not a return.
    let last = AppState.currentState;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && last === 'background') resume();
      last = state;
    });
    return () => sub.remove();
  }, [navReady]);

  return null;
}
