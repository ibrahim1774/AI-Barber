import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { colors, fonts } from '@/constants/theme';
import { ArrowRight } from '@/components/Icons';

const RADIUS = 36;

/**
 * One start-screen option: a pill with a spaced caps title and a one-line subtitle.
 * `primary` is the gold gradient pill; the others are the outlined dark pill.
 */
export function StartOption({
  title, subtitle, onPress, primary, arrow,
}: {
  title: string;
  subtitle: string;
  onPress(): void;
  primary?: boolean;
  arrow?: boolean;
}) {
  const ink = primary ? colors.accentInk : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      onPress={onPress}
      style={({ pressed }) => [
        styles.box,
        primary ? styles.primary : styles.ghost,
        pressed && { transform: [{ scale: 0.985 }], opacity: 0.9 },
      ]}
    >
      {primary && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="startCta" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.accent} />
                <Stop offset="1" stopColor={colors.accentDeep} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" rx={RADIUS} ry={RADIUS} fill="url(#startCta)" />
          </Svg>
        </View>
      )}
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: ink }]}>{title}</Text>
        {arrow && <ArrowRight size={14} color={ink} />}
      </View>
      <Text style={[styles.subtitle, { color: primary ? colors.accentInk : colors.muted }]}>{subtitle}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: RADIUS,
    minHeight: 72,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  primary: {
    shadowColor: colors.accent,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 12 },
  },
  ghost: { borderWidth: 1, borderColor: colors.ghostBorder, backgroundColor: colors.ghostBg },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  title: { fontFamily: fonts.bodyBold, fontSize: 12.5, letterSpacing: 2.6, textTransform: 'uppercase', textAlign: 'center' },
  subtitle: { fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16, textAlign: 'center' },
});
