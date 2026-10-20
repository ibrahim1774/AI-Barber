import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { router, Stack, useRootNavigationState } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { SuperwallProvider } from 'expo-superwall';
import { fontAssets } from '@/constants/theme';
import { SubscriptionSync, SUPERWALL_KEY, SUPERWALL_OPTIONS, superwallActive, usePublishDeps } from '@/lib/paywall';
import { publishBusy, resumePendingPublish } from '@/lib/publish';

export default function RootLayout() {
  const [loaded, error] = useFonts(fontAssets);
  // Render nothing until Montserrat/Manrope are ready; on a font load error
  // fall back to system fonts rather than a blank app.
  if (!loaded && !error) return null;
  const app = (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }}>
        <Stack.Screen name="generating" options={{ gestureEnabled: false, animation: 'fade' }} />
        {/* Home once a site exists; nothing underneath to swipe back to. */}
        <Stack.Screen name="dashboard" options={{ gestureEnabled: false, animation: 'fade' }} />
        {/* Left by its Dashboard button only: no swipe back into the importer. */}
        <Stack.Screen name="editor" options={{ gestureEnabled: false, animation: 'fade' }} />
        {/* Over the editor: clear while the paywall is up, then the publish overlay. No leaving mid-publish. */}
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
        <Stack.Screen name="settings" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
      </Stack>
    </>
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
