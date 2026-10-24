import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { useTutorialTarget } from '@/components/tutorial/registry';

/**
 * A small floating Colour control on the preview's left edge, under the design switcher (or centred when the
 * switcher is hidden on a published site). Opens the colour sheet. 44pt tall, dark translucent like the switcher.
 */
export function ColourButton({ onPress, disabled, belowSwitcher }: { onPress(): void; disabled?: boolean; belowSwitcher?: boolean }) {
  const ref = useTutorialTarget('edit.colour');
  return (
    <Pressable
      ref={ref}
      collapsable={false}
      accessibilityRole="button"
      accessibilityLabel="Colour"
      accessibilityHint="Change the colour of your site"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.btn, { transform: [{ translateY: belowSwitcher ? 70 : -22 }] }, (pressed || disabled) && { opacity: 0.6 }]}
    >
      <View style={styles.dot} />
      <Text style={styles.text}>Colour</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    position: 'absolute', left: 12, top: '50%', minHeight: 44, minWidth: 44,
    flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, borderRadius: 22,
    backgroundColor: colors.overlayCard, borderWidth: 1, borderColor: colors.overlayGold,
    shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 25, shadowOffset: { width: 0, height: 18 },
  },
  dot: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.accent, borderWidth: 2, borderColor: '#fff' },
  text: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase', color: '#fff' },
});
