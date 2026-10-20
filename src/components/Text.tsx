import { Text as RNText, StyleSheet, type TextProps } from 'react-native';
import { colors, fonts } from '@/constants/theme';

type Variant = 'h1' | 'body' | 'caps' | 'label' | 'small';

export interface AppTextProps extends TextProps {
  variant?: Variant;
}

/** RN Text with the app's type scale (sizes are the web's at 390 px). */
export function Text({ variant = 'body', style, ...rest }: AppTextProps) {
  // Importer headlines are single rows on the web (bk-hrow: nowrap); shrink
  // to fit instead of wrapping.
  const row = variant === 'h1' ? { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.6 } : null;
  return <RNText {...row} {...rest} style={[styles[variant], style]} />;
}

/** Italic accent word inside a heading ("booking link", "website"). */
export function Em({ color = colors.accent, ...rest }: TextProps & { color?: string }) {
  return <RNText {...rest} style={[{ fontFamily: fonts.headingItalic, color }, rest.style]} />;
}

const styles = StyleSheet.create({
  // GbpImportPage h1: clamp(1.68rem, 6.7vw, …) → 27px at 390 px.
  h1: {
    fontFamily: fonts.heading,
    fontSize: 27,
    lineHeight: 32,
    letterSpacing: -0.4,
    color: colors.heading,
    textAlign: 'center',
  },
  // text-[15px] leading-relaxed
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 24, color: colors.body, textAlign: 'center' },
  // text-[11px] font-semibold uppercase tracking-[0.2em]
  caps: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: colors.faint,
    textAlign: 'center',
  },
  // text-[13px] font-extrabold uppercase tracking-[0.22em] (on the white card)
  label: {
    fontFamily: fonts.bodyExtra,
    fontSize: 13,
    letterSpacing: 2.9,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 21, color: colors.muted },
});
