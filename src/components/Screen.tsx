import type { ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';

/**
 * The importer page shell from GbpImportPage.tsx: #070709 canvas with the gold
 * top glow, "A · AI Barber" header with the Sign in pill, centred content, and
 * the hairline footer. `overlay` renders above everything (import progress).
 */
export function Screen({ children, overlay }: { children: ReactNode; overlay?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <Glow />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top }]}
        >
          <View style={styles.header}>
            <View style={styles.brand}>
              <View style={styles.mark}>
                <Text style={styles.markText}>A</Text>
              </View>
              <Text style={styles.brandText}>
                AI<Text style={{ color: colors.accent }}>Barber</Text>
              </Text>
            </View>
            <Button variant="pill" title="Sign in" onPress={() => router.push('/sign-in')} />
          </View>
          <View style={styles.main}>{children}</View>
          <View style={[styles.footer, { paddingBottom: 20 + insets.bottom }]}>
            <Text style={styles.footerText}>
              Photos, services & reviews imported
              <Text style={styles.dot}>{'  ·  '}</Text>
              Live in about a minute
              <Text style={styles.dot}>{'  ·  '}</Text>
              Edit anything after
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {overlay}
    </View>
  );
}

// radial-gradient(52% 38% at 50% 0%, #f4a1001c, transparent 70%) plus the
// faint porcelain wash at the top.
function Glow() {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient id="gold" cx="50%" cy="0%" rx="52%" ry="38%" fx="50%" fy="0%">
          <Stop offset="0" stopColor={colors.accent} stopOpacity={0.11} />
          <Stop offset="0.7" stopColor={colors.accent} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="wash" cx="50%" cy="6%" rx="50%" ry="36%" fx="50%" fy="6%">
          <Stop offset="0" stopColor={colors.text} stopOpacity={0.055} />
          <Stop offset="0.7" stopColor={colors.text} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#gold)" />
      <Rect width="100%" height="100%" fill="url(#wash)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.importerBg },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingVertical: 20,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: colors.text,
    alignItems: 'center', justifyContent: 'center',
  },
  markText: { fontFamily: fonts.headingItalic, fontSize: 11, color: colors.panel },
  brandText: {
    fontFamily: fonts.bodySemi, fontSize: 11, letterSpacing: 2.9, textTransform: 'uppercase', color: colors.text,
  },
  main: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24, paddingTop: 40, paddingBottom: 64,
  },
  footer: { borderTopWidth: 1, borderTopColor: colors.hair, paddingHorizontal: 24, paddingTop: 20 },
  footerText: { fontFamily: fonts.body, fontSize: 10.5, lineHeight: 17, color: colors.faint },
  dot: { color: 'rgba(237,239,244,0.18)' },
});
