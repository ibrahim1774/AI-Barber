import { forwardRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
  const ink = solid ? colors.accentInk : colors.text;
  return (
    <Pressable
      ref={ref}
      collapsable={false}
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => [styles.pill, solid ? styles.solid : styles.outline, pressed && { opacity: 0.8 }]}
    >
      {icon === 'share' && <ShareIcon size={16} color={ink} />}
      {icon === 'gear' && <GearIcon size={16} color={ink} />}
      <Text style={[styles.text, { color: ink }]} numberOfLines={1}>{title}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  pill: { height: 32, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 16 },
  solid: { backgroundColor: colors.accent },
  outline: { borderWidth: 1, borderColor: colors.hair, backgroundColor: colors.ghostBg },
  text: { fontFamily: fonts.bodySemi, fontSize: 13 },
});
