import { forwardRef } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { GearIcon } from '@/components/Icons';
import { ShareIcon } from '@/components/bookings/icons';

export interface HeaderButtonProps {
  title: 'Share' | 'Settings' | 'Customers';
  icon?: 'share' | 'gear';
  /** solid = filled accent pill (Share); outline = hairline pill (Settings, Customers). */
  tone?: 'solid' | 'outline';
  onPress(): void;
  accessibilityLabel?: string;
}

/** A visible, labelled pill for the Store and Bookings headers. 32 pt tall. */
export const HeaderButton = forwardRef<View, HeaderButtonProps>(function HeaderButton(
  { title, icon, tone = 'outline', onPress, accessibilityLabel }, ref,
) {
  const solid = tone === 'solid';
  // On a 375 pt phone three pills leave the shop name about 40 pt: drop the icons there.
  const narrow = useWindowDimensions().width <= NARROW_WIDTH;
  const ink = solid ? colors.accentInk : colors.text;
  return (
    <Pressable
      ref={ref}
      collapsable={false}
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => [styles.pill, narrow && styles.pillNarrow, solid ? styles.solid : styles.outline, pressed && { opacity: 0.8 }]}
    >
      {!narrow && icon === 'share' && <ShareIcon size={16} color={ink} />}
      {!narrow && icon === 'gear' && <GearIcon size={16} color={ink} />}
      <Text style={[styles.text, { color: ink }]} numberOfLines={1} maxFontSizeMultiplier={1.4}>{title}</Text>
    </Pressable>
  );
});

/** Phones this wide or narrower (SE, 13 mini) get the compact pills. */
export const NARROW_WIDTH = 380;

const styles = StyleSheet.create({
  pillNarrow: { paddingHorizontal: 9 },
  pill: { height: 32, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 16 },
  solid: { backgroundColor: colors.accent },
  outline: { borderWidth: 1, borderColor: colors.hair, backgroundColor: colors.ghostBg },
  text: { fontFamily: fonts.bodySemi, fontSize: 13 },
});
