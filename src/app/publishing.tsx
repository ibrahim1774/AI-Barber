import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { AlertCircleIcon, RefreshIcon } from '@/components/Icons';
import { track } from '@/lib/analytics';
import { takeNotice } from '@/lib/adminSync';
import { usePublishDeps } from '@/lib/paywall';
import { publishBusy, publishFlow, type PublishDeps } from '@/lib/publish';
import { resetTo } from '@/lib/nav';
import { loadSite } from '@/lib/siteStore';

type Phase = 'paywall' | 'publishing' | 'pending' | 'inactive' | 'error' | 'updated' | 'blocked';
type Pending = { message: string };

const FAILED_MESSAGE =
  "Something went wrong publishing your site. Please try again — if it keeps happening, email support@davoxa.com.";

/**
 * Opened over the Edit tab by Publish. Clear while the paywall is up; once the
 * user is entitled it becomes the web's PublishOverlay. Live goes to /live,
 * a closed paywall straight back to the editor.
 */
export default function Publishing() {
  const deps = usePublishDeps();
  const [phase, setPhase] = useState<Phase>('paywall');
  const [pending, setPending] = useState<Pending>({ message: '' });
  const running = useRef(false);

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/edit');
  }, []);

  const run = useCallback(
    async (forcePaywall = false) => {
      if (running.current) return;
      running.current = true;
      // Waiting behind a launch retry: show the spinner, not a clear screen.
      setPhase(publishBusy() ? 'publishing' : 'paywall');
      // Show the publish overlay only once the user has access.
      const shown: PublishDeps = {
        ...deps,
        hasEntitlement: async () => {
          const ok = !forcePaywall && (await deps.hasEntitlement());
          setPhase(ok ? 'publishing' : 'paywall');
          return ok;
        },
        showPaywall: async () => {
          const r = await deps.showPaywall();
          if (r !== 'declined') setPhase('publishing');
          return r;
        },
      };
      try {
        const site = await loadSite();
        if (!site) {
          back();
          return;
        }
        const out = await publishFlow(site, shown);
        if (out.kind === 'live') {
          router.replace('/live');
        } else if (out.kind === 'claim-required') {
          // Paid, no account yet: the locked account step finishes the publish. Nothing was published.
          resetTo('/claim');
        } else if (out.kind === 'declined') {
          track('paywall_declined');
          back();
        } else if (out.kind === 'pending') {
          setPending({ message: out.message });
          setPhase('pending');
        } else if (out.kind === 'site-updated') {
          void takeNotice(); // this screen is the notice
          setPending({ message: out.message });
          setPhase('updated');
        } else if (out.kind === 'blocked') {
          setPending({ message: out.message });
          setPhase('blocked');
        } else {
          setPhase('inactive');
        }
      } catch (e) {
        console.warn('[publish] failed:', e);
        setPhase('error');
      } finally {
        running.current = false;
      }
    },
    [deps, back],
  );

  useEffect(() => {
    void run();
    // Once per open; the editor guards the double tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase === 'publishing') AccessibilityInfo.announceForAccessibility('Publishing your site');
  }, [phase]);

  // The paywall is presented natively above this screen; keep the editor visible behind it.
  if (phase === 'paywall') return <View style={styles.clear} />;

  return (
    <View style={styles.root}>
      {phase === 'publishing' && (
        <>
          <Spin>
            <RefreshIcon size={56} color={colors.accent} />
          </Spin>
          <Text style={styles.title}>
            Publishing your <Text style={{ color: colors.accent }}>changes</Text>...
          </Text>
          <Text style={styles.body}>Uploading images and publishing your site</Text>
        </>
      )}

      {phase === 'pending' && (
        <Result
          icon={<RefreshIcon size={40} color={colors.accent} />}
          tint="rgba(244,161,0,0.2)"
          title={<>Almost <Text style={{ color: colors.accent }}>live</Text></>}
          message={pending.message}
        >
          <Button variant="ghost" title="Back to Editor" onPress={back} style={styles.wide} />
        </Result>
      )}

      {phase === 'updated' && (
        <Result
          icon={<AlertCircleIcon size={40} color={colors.accent} />}
          tint="rgba(244,161,0,0.2)"
          title={<>Site <Text style={{ color: colors.accent }}>updated</Text></>}
          message={pending.message}
        >
          <Button title="Review my site" onPress={back} style={styles.wide} />
        </Result>
      )}

      {phase === 'blocked' && (
        <Result
          icon={<AlertCircleIcon size={40} color={colors.danger} />}
          tint="rgba(239,68,68,0.2)"
          title={<>Not <Text style={{ color: colors.danger }}>published</Text></>}
          message={pending.message}
        >
          <Button title="Back to Editor" onPress={back} style={styles.wide} />
        </Result>
      )}

      {phase === 'inactive' && (
        <Result
          icon={<AlertCircleIcon size={40} color={colors.danger} />}
          tint="rgba(239,68,68,0.2)"
          title={<>Subscription <Text style={{ color: colors.danger }}>inactive</Text></>}
          message="Your website is saved, but your Prime Barber subscription isn't active, so it can't go live. Subscribe to publish it."
        >
          <Button title="Try again" onPress={() => void run(true)} style={styles.wide} />
          <Button variant="link" title="Back to Editor" onPress={back} style={styles.link} />
        </Result>
      )}

      {phase === 'error' && (
        <Result
          icon={<AlertCircleIcon size={40} color={colors.danger} />}
          tint="rgba(239,68,68,0.2)"
          title={<>Publishing <Text style={{ color: colors.danger }}>Failed</Text></>}
          message={FAILED_MESSAGE}
          messageColor="#f87171"
        >
          <Button title="Try again" onPress={() => void run()} style={styles.wide} />
          <Button variant="ghost" title="Dismiss" onPress={back} style={[styles.wide, styles.gap]} />
        </Result>
      )}
    </View>
  );
}

function Result({
  icon, tint, title, message, messageColor, children,
}: {
  icon: ReactNode;
  tint: string;
  title: ReactNode;
  message: string;
  messageColor?: string;
  children: ReactNode;
}) {
  return (
    <>
      <View style={[styles.badge, { backgroundColor: tint }]}>{icon}</View>
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
      <Text style={[styles.body, styles.message, messageColor ? { color: messageColor } : null]}>{message}</Text>
      {children}
    </>
  );
}

function Spin({ children }: { children: ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(v, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  const rotate = v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return <Animated.View style={{ marginBottom: 24, transform: [{ rotate }] }}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  clear: { flex: 1, backgroundColor: 'transparent' },
  // bg-[#0d0d0d]/95 over the editor
  root: {
    flex: 1, backgroundColor: 'rgba(13,13,13,0.95)', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24,
  },
  // text-xl font-montserrat font-black uppercase tracking-[3px]
  title: {
    fontFamily: fonts.headingBlack, fontSize: 20, lineHeight: 28, letterSpacing: 3, textTransform: 'uppercase',
    color: '#fff', textAlign: 'center', marginBottom: 12,
  },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.grey, textAlign: 'center' },
  message: { color: '#999999', marginBottom: 24, maxWidth: 420 },
  badge: {
    width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 24,
  },
  wide: { alignSelf: 'stretch' },
  link: { marginTop: 16 },
  gap: { marginTop: 12 },
});
