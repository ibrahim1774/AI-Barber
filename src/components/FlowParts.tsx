import type { ReactNode, Ref } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text as RNText, TextInput, View, type TextInputProps } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { colors, fonts } from '@/constants/theme';
import { ArrowRight } from '@/components/Icons';
import { Text } from '@/components/Text';
import { useDoneBar } from '@/components/KeyboardDoneBar';
import { straightenQuotes } from '@/lib/sections/text';

// The pieces of the screens after Start (booking link, Google, review): the same dark canvas, amber accent and
// letter-spaced caps pills as the start screen.

const RADIUS = 36;

/** Two-line headline, the second line in amber. */
export function FlowTitle({ first, second, inline }: { first: string; second: string; inline?: boolean }) {
  return (
    <Text variant="h1" style={styles.title} accessibilityRole="header">
      {`${first}${inline ? ' ' : '\n'}`}
      <Text variant="h1" style={styles.gold}>{second}</Text>
    </Text>
  );
}

/** A full-width pill: `primary` is the amber gradient, `ghost` the outlined dark pill. */
export function PillButton({
  title, onPress, primary, arrow, loading, disabled, style,
}: {
  title: string;
  onPress(): void;
  primary?: boolean;
  arrow?: boolean;
  loading?: boolean;
  disabled?: boolean;
  style?: object;
}) {
  const ink = primary ? colors.accentInk : colors.text;
  const off = !!(disabled || loading);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        primary ? styles.pillPrimary : styles.pillGhost,
        off && { opacity: 0.55 },
        pressed && { transform: [{ scale: 0.985 }], opacity: 0.9 },
        style,
      ]}
    >
      {primary && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="flowCta" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.accent} />
                <Stop offset="1" stopColor={colors.accentDeep} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" rx={RADIUS} ry={RADIUS} fill="url(#flowCta)" />
          </Svg>
        </View>
      )}
      <View style={styles.pillRow}>
        {loading && <ActivityIndicator size="small" color={ink} />}
        <RNText maxFontSizeMultiplier={1.4} numberOfLines={1} style={[styles.pillText, { color: ink }]}>{title}</RNText>
        {arrow && !loading && <ArrowRight size={14} color={ink} />}
      </View>
    </Pressable>
  );
}

/** The dark rounded input with a caps label above it and an optional trailing control (paste). */
export function FlowInput({
  label, trailing, onChangeText, ...input
}: { label: string; trailing?: ReactNode; ref?: Ref<TextInput> } & Omit<TextInputProps, 'style'>) {
  // Number pads have no Return key: a Done bar above them dismisses the keyboard.
  const done = useDoneBar(input.keyboardType);
  return (
    <View style={styles.inputWrap}>
      <RNText maxFontSizeMultiplier={1.4} style={styles.label}>{label}</RNText>
      <View style={styles.inputBox}>
        <TextInput
          accessibilityLabel={input.accessibilityLabel ?? label}
          placeholderTextColor="rgba(237,239,244,0.38)"
          selectionColor={colors.accent}
          inputAccessoryViewID={done.id}
          {...input}
          onChangeText={onChangeText ? (t) => onChangeText(straightenQuotes(t)) : undefined}
          style={styles.input}
        />
        {done.bar}
        {trailing}
      </View>
    </View>
  );
}

/** The error line on the dark canvas. */
export function FlowError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View accessibilityRole="alert" style={styles.error}>
      <RNText style={styles.errorText}>{message}</RNText>
    </View>
  );
}

/** The small helper line under an input or card. */
export function FlowHelper({ children }: { children: ReactNode }) {
  return <RNText style={styles.helper}>{children}</RNText>;
}

const styles = StyleSheet.create({
  title: { marginTop: 8, fontSize: 30, lineHeight: 36 },
  gold: { color: colors.accent },
  pill: { alignSelf: 'stretch', borderRadius: RADIUS, minHeight: 58, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  pillPrimary: { shadowColor: colors.accent, shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 12 } },
  pillGhost: { borderWidth: 1, borderColor: colors.ghostBorder, backgroundColor: colors.ghostBg },
  pillRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 12.5, letterSpacing: 2.6, textTransform: 'uppercase', textAlign: 'center' },
  inputWrap: { alignSelf: 'stretch' },
  label: { fontFamily: fonts.bodySemi, fontSize: 10.5, letterSpacing: 2.4, textTransform: 'uppercase', color: colors.muted, marginBottom: 10, marginLeft: 4 },
  inputBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 58, paddingLeft: 20, paddingRight: 10,
    borderRadius: 22, borderWidth: 1, borderColor: colors.ghostBorder, backgroundColor: colors.ghostBg,
  },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.text, paddingVertical: 14 },
  error: { alignSelf: 'stretch', marginTop: 16, borderLeftWidth: 2, borderLeftColor: colors.errorRule, paddingLeft: 14 },
  errorText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 20, color: '#f87171' },
  helper: { marginTop: 14, fontFamily: fonts.body, fontSize: 13, lineHeight: 20, color: colors.muted, textAlign: 'center' },
});
