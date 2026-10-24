import type { ReactNode, RefObject } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, type NativeScrollEvent, type NativeSyntheticEvent, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { ChevronLeftIcon } from '@/components/Icons';
import { useSession } from '@/lib/auth';

/**
 * The importer page shell from GbpImportPage.tsx: #070709 canvas with the gold
 * top glow, "P · Prime Barber" header with the Sign in pill (Account once signed
 * in), centred content, and the hairline footer. `overlay` renders above everything (import progress).
 */
export function Screen({
  children, overlay, scrollRef, onScroll, onBack,
}: {
  children: ReactNode;
  /** The flow screens after Start: a back chevron instead of the brand header, content from the top, no footer. */
  onBack?(): void;
  overlay?: ReactNode;
  /** For screens that scroll a card into view above the keyboard (see useRevealAboveKeyboard). */
  scrollRef?: RefObject<ScrollView | null>;
  onScroll?(e: NativeSyntheticEvent<NativeScrollEvent>): void;
}) {
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  return (
    <View style={styles.root}>
      <Glow />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top }]}
        >
          {onBack ? (
            <View style={styles.flowHeader}>
              <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} onPress={onBack} style={styles.backBtn}>
                <ChevronLeftIcon size={22} color={colors.text} />
              </Pressable>
            </View>
          ) : (
          <View style={styles.header}>
            <View style={styles.brand}>
              <View style={styles.mark}>
                <Text style={styles.markText}>P</Text>
              </View>
              <Text style={styles.brandText}>
                Prime <Text style={{ color: colors.accent }}>Barber</Text>
              </Text>
            </View>
            {session?.user ? (
              <Button variant="pill" title="Account" onPress={() => router.push('/settings')} />
            ) : (
              <Button variant="pill" title="Sign in" onPress={() => router.push('/sign-in')} />
            )}
          </View>
          )}
          <View style={onBack ? styles.flowMain : styles.main}>{children}</View>
          {onBack ? <View style={{ height: 24 + insets.bottom }} /> : (
          <View style={[styles.footer, { paddingBottom: 20 + insets.bottom }]}>
            <Text style={styles.footerText}>
              Photos, services & reviews imported
              <Text style={styles.dot}>{'  ·  '}</Text>
              Live in about a minute
              <Text style={styles.dot}>{'  ·  '}</Text>
              Edit anything after
            </Text>
          </View>
          )}
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
    flexWrap: 'wrap', rowGap: 12, // wraps the Sign in pill under the brand at huge text sizes
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
  flowHeader: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  flowMain: { flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 36 },
  main: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24, paddingTop: 40, paddingBottom: 64,
  },
  footer: { borderTopWidth: 1, borderTopColor: colors.hair, paddingHorizontal: 24, paddingTop: 20 },
  footerText: { fontFamily: fonts.body, fontSize: 10.5, lineHeight: 17, color: colors.faint },
  dot: { color: 'rgba(237,239,244,0.18)' },
});
