import { useEffect } from 'react';
import { router, Stack, useRootNavigationState } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { SuperwallProvider, useSuperwall } from 'expo-superwall';
import { fontAssets } from '@/constants/theme';
import { SubscriptionSync, SUPERWALL_KEY, superwallActive, usePublishDeps } from '@/lib/paywall';
import { resumePendingPublish } from '@/lib/publish';

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
        {/* The editor is the stack's root once a site exists: no swipe back to the importer. */}
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
        <Stack.Screen name="live" options={{ animation: 'fade' }} />
      </Stack>
    </>
  );

  if (!superwallActive) {
    return (
      <>
        <ResumePublish configured />
        {app}
      </>
    );
  }
  return (
    <SuperwallProvider
      apiKeys={{ ios: SUPERWALL_KEY }}
      onConfigurationError={(e) => console.warn('Superwall configuration failed', e)}>
      <SubscriptionSync />
      <SuperwallResumePublish />
      {app}
    </SuperwallProvider>
  );
}

function SuperwallResumePublish() {
  const { isConfigured, configurationError } = useSuperwall((s) => ({
    isConfigured: s.isConfigured,
    configurationError: s.configurationError,
  }));
  return <ResumePublish configured={isConfigured || configurationError != null} />;
}

let resumed = false;

/** Once per launch: finish a publish that was paid for but never confirmed (app killed, offline, 5xx). */
function ResumePublish({ configured }: { configured: boolean }) {
  const deps = usePublishDeps();
  const navReady = useRootNavigationState()?.key != null;

  useEffect(() => {
    if (!configured || !navReady || resumed) return;
    resumed = true;
    resumePendingPublish(deps)
      .then((out) => {
        if (out?.kind !== 'live') return;
        if (router.canDismiss()) router.dismissAll();
        router.replace('/live');
      })
      .catch((e) => console.warn('[publish] launch retry failed:', e));
  }, [configured, navReady, deps]);

  return null;
}
