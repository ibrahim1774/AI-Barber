import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { ChevronLeftIcon } from '@/components/Icons';

/** Height of the bar the Back button sits in (below the status bar). */
export const BACK_BAR_HEIGHT = 52;

/**
 * The start flow's Back control: chevron + the word "Back", at least 44 pt tall with a wider hit area,
 * light text on the dark canvas. Screen pins it top-left under the safe area.
 */
export function BackButton({ onPress, label = 'Back' }: { onPress(): void; label?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={{ top: 8, bottom: 8, left: 12, right: 24 }}
      onPress={onPress}
      style={styles.btn}
    >
      <ChevronLeftIcon size={24} color={colors.text} />
      <Text style={styles.text} maxFontSizeMultiplier={1.3}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { minHeight: 44, minWidth: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: 12 },
  text: { fontFamily: fonts.bodySemi, fontSize: 17, color: colors.text },
});
