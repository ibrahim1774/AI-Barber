import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { colors, fonts } from '@/constants/theme';
import { ArrowRight } from '@/components/Icons';

type Variant =
  | 'primary' // gold gradient CTA (GbpImportPage bk-monocta)
  | 'ghost' // hairline outline on the dark canvas
  | 'link' // bare caps text link ("← Back", escape hatches)
  | 'pill' // small rounded-full outline ("Sign in", "Find my business")
  | 'solid'; // classic form's flat gold button (GeneratorForm)

export interface ButtonProps {
  title: string;
  onPress(): void;
  variant?: Variant;
  /** primary only: 'sm' is the card's "Build my website" size. 'lg' (ghost): taller, larger bold label. */
  size?: 'md' | 'sm' | 'lg';
  /** pill only: 'light' sits on the white import card. */
  tone?: 'dark' | 'light';
  arrow?: boolean;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  title, onPress, variant = 'primary', size = 'md', tone = 'dark', arrow, loading, disabled, style,
}: ButtonProps) {
  const v = VARIANTS[variant];
  const textColor = variant === 'pill' && tone === 'light' ? colors.ink : v.text.color;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      onPress={onPress}
      disabled={disabled || loading}
      hitSlop={variant === 'link' ? 8 : undefined}
      style={({ pressed }) => [
        v.box,
        variant === 'primary' && size === 'sm' && styles.primarySm,
        variant === 'pill' && tone === 'light' && styles.pillLight,
        variant === 'ghost' && size === 'lg' && styles.ghostLg,
        (disabled || loading) && variant !== 'link' && { opacity: variant === 'primary' ? 0.5 : 0.6 },
        pressed && { transform: [{ scale: 0.985 }], opacity: 0.9 },
        style,
      ]}
    >
      {variant === 'primary' && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="cta" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.accent} />
                <Stop offset="1" stopColor={colors.accentDeep} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" rx={14} ry={14} fill="url(#cta)" />
          </Svg>
        </View>
      )}
      <View style={styles.row}>
        {loading && <ActivityIndicator size="small" color={textColor} />}
        <Text
          style={[
            v.text,
            variant === 'primary' && size === 'sm' && styles.primarySmText,
            variant === 'pill' && tone === 'light' && styles.pillLightText,
            variant === 'ghost' && size === 'lg' && styles.ghostLgText,
            { color: textColor },
          ]}
          numberOfLines={variant === 'link' ? undefined : 1}
        >
          {title}
        </Text>
        {arrow && !loading && <ArrowRight size={variant === 'pill' ? 13 : 14} color={textColor} />}
      </View>
    </Pressable>
  );
}

const caps = { textTransform: 'uppercase' as const };

const VARIANTS = {
  primary: StyleSheet.create({
    box: {
      borderRadius: 14,
      paddingVertical: 16,
      paddingHorizontal: 28,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'visible',
      shadowColor: colors.accent,
      shadowOpacity: 0.4,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 12 },
    },
    text: { ...caps, fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 2.6, color: colors.accentInk },
  }),
  ghost: StyleSheet.create({
    box: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.ghostBorder,
      backgroundColor: colors.ghostBg,
      paddingVertical: 16,
      paddingHorizontal: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    text: { ...caps, fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 2.6, color: colors.text },
  }),
  link: StyleSheet.create({
    box: { alignSelf: 'center', paddingVertical: 4 },
    text: {
      ...caps, fontFamily: fonts.bodySemi, fontSize: 11, lineHeight: 18, letterSpacing: 2.2,
      color: colors.faint, textAlign: 'center',
    },
  }),
  pill: StyleSheet.create({
    box: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.ghostBorder,
      backgroundColor: colors.ghostBg,
      paddingVertical: 6,
      paddingHorizontal: 16,
      alignSelf: 'flex-start',
    },
    text: { ...caps, fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 2, color: colors.muted },
  }),
  solid: StyleSheet.create({
    box: {
      backgroundColor: colors.accent,
      paddingVertical: 16,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: colors.accent,
      shadowOpacity: 0.15,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 0 },
    },
    text: { ...caps, fontFamily: fonts.headingBlack, fontSize: 12, letterSpacing: 1.5, color: colors.buttonInk },
  }),
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  primarySm: { paddingVertical: 14, paddingHorizontal: 30 },
  primarySmText: { fontSize: 12, letterSpacing: 2.6 },
  pillLight: {
    borderColor: 'rgba(11,14,20,0.28)', backgroundColor: 'transparent',
    paddingVertical: 10, paddingHorizontal: 24,
  },
  ghostLg: { minHeight: 52, paddingVertical: 14 },
  ghostLgText: { fontFamily: fonts.bodyBold, fontSize: 17, letterSpacing: 2 },
  pillLightText: { fontSize: 11, letterSpacing: 2.2 },
});
