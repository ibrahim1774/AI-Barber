import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '@/constants/theme';

export type Step = { pct: number; label: string };

// Copied from GbpImportPage.tsx.
export const LISTING_STEPS: Step[] = [
  { pct: 9, label: 'Opening your listing…' },
  { pct: 24, label: 'Reading your name, phone & address…' },
  { pct: 40, label: 'Importing your photos…' },
  { pct: 56, label: 'Collecting reviews & star rating…' },
  { pct: 70, label: 'Reading your business hours…' },
  { pct: 84, label: 'Styling your barbershop site…' },
  { pct: 95, label: 'Assembling your website…' },
];

export const LINK_STEPS: Step[] = [
  { pct: 9, label: 'Opening your booking page…' },
  { pct: 24, label: 'Reading your name, phone & address…' },
  { pct: 40, label: 'Importing your service menu & prices…' },
  { pct: 56, label: 'Importing your photos…' },
  { pct: 70, label: 'Collecting reviews & hours…' },
  { pct: 84, label: 'Styling your barbershop site…' },
  { pct: 95, label: 'Assembling your website…' },
];

/** Full-screen import progress (GbpImportPage's `busy` overlay). */
export function ImportProgress({ steps, progress, slowHint }: { steps: Step[]; progress: number; slowHint: boolean }) {
  const insets = useSafeAreaInsets();
  // Labels follow the real progress, never a clock.
  let stepIdx = 0;
  steps.forEach((s, i) => { if (progress >= s.pct - 4) stepIdx = i; });
  if (progress >= 100) stepIdx = steps.length - 1;

  return (
    <View accessibilityViewIsModal style={[StyleSheet.absoluteFill, styles.root, { paddingTop: insets.top }]}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${progress}%` }]} />
      </View>
      <View style={styles.body}>
        <View style={styles.pctRow}>
          <Text style={styles.pct}>{Math.round(progress)}</Text>
          <Text style={styles.pctSign}>%</Text>
        </View>
        <FadeIn key={stepIdx}>
          <Text style={styles.stepLabel}>{steps[stepIdx].label}</Text>
        </FadeIn>
        {slowHint && (
          <Text style={styles.slow}>
            Still pulling your photos — this sometimes takes up to a minute. Hang tight, we haven&apos;t lost you.
          </Text>
        )}

        <View style={styles.list}>
          {steps.map((step, i) => {
            const done = i < stepIdx || progress >= 100;
            const label = step.label.replace(/…$/, '');
            if (i > stepIdx && !done) {
              return (
                <View key={step.label} style={styles.item}>
                  <View style={styles.todoDot} />
                  <Text style={[styles.itemText, { color: 'rgba(237,239,244,0.16)' }]}>{label}</Text>
                </View>
              );
            }
            return (
              <FadeIn key={step.label} style={styles.item}>
                {done ? (
                  <View style={styles.check}>
                    <Text style={styles.checkText}>✓</Text>
                  </View>
                ) : (
                  <PulseDot />
                )}
                <Text style={[styles.itemText, { color: done ? colors.muted : colors.text }]}>{label}</Text>
              </FadeIn>
            );
          })}
        </View>

        <EtaPulse>
          <Text style={styles.eta}>
            Hang tight — your website takes about <Text style={{ color: colors.accent }}>60 seconds</Text> to generate
          </Text>
        </EtaPulse>
      </View>
    </View>
  );
}

function FadeIn({ children, style }: { children: React.ReactNode; style?: object }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 420, useNativeDriver: true }).start();
  }, [v]);
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [6, 0] });
  return <Animated.View style={[style, { opacity: v, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

// bkEtaPulse: opacity .55 ↔ 1 over 2.6 s.
function EtaPulse({ children }: { children: React.ReactNode }) {
  const v = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 1300, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.55, duration: 1300, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={{ opacity: v }}>{children}</Animated.View>;
}

function PulseDot() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 550, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 550, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] });
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.72] });
  return <Animated.View style={[styles.activeDot, { opacity, transform: [{ scale }] }]} />;
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.panel, zIndex: 50 },
  track: { height: 3, backgroundColor: colors.hair },
  fill: {
    height: '100%', backgroundColor: colors.accent,
    shadowColor: colors.accent, shadowOpacity: 0.55, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
  },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  pctRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  // clamp(4.2rem, 12vw, 7rem) → 67 px
  pct: {
    fontFamily: fonts.heading, fontSize: 67, lineHeight: 64, letterSpacing: -2.7, color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  pctSign: { fontFamily: fonts.subhead, fontSize: 26, color: colors.accent, paddingBottom: 6 },
  stepLabel: { fontFamily: fonts.serifish, fontSize: 21.6, lineHeight: 28, letterSpacing: -0.2, color: colors.text, marginTop: 20 },
  slow: { fontFamily: fonts.body, fontSize: 13, lineHeight: 20, color: colors.muted, marginTop: 12 },
  list: { marginTop: 32, gap: 12 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemText: {
    flexShrink: 1, fontFamily: fonts.bodySemi, fontSize: 11, letterSpacing: 2.2, textTransform: 'uppercase',
  },
  todoDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(237,239,244,0.12)', marginHorizontal: 4 },
  activeDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginHorizontal: 3,
    shadowColor: colors.accent, shadowOpacity: 1, shadowRadius: 5, shadowOffset: { width: 0, height: 0 },
  },
  check: {
    width: 14, height: 14, borderRadius: 7, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  checkText: { fontSize: 9, fontWeight: '900', color: colors.accentInk, lineHeight: 11 },
  eta: { fontFamily: fonts.serifish, fontSize: 18.4, lineHeight: 26, letterSpacing: -0.2, color: colors.text, marginTop: 40 },
});
