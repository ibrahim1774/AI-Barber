import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';

// Floating Design control on the preview's left edge, stacked just above the Colour pill: a dark translucent
// pill with a "Design" caption and two segments (1 | 2).
// Any non-prime template counts as Design 1.

const OPTIONS: { key: 'luxe' | 'prime'; label: string; short: string }[] = [
  { key: 'luxe', label: 'Design 1', short: '1' },
  { key: 'prime', label: 'Design 2', short: '2' },
];

export function DesignSwitcher({
  current, onSelect, busy, disabled,
}: {
  current: string | undefined;
  onSelect(t: 'luxe' | 'prime'): void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const activeKey = current === 'prime' ? 'prime' : 'luxe';
  const off = !!busy || !!disabled;
  return (
    <View style={[styles.pill, { transform: [{ translateY: -48 }] }, off && { opacity: 0.6 }]} accessibilityRole="radiogroup" accessibilityLabel="Switch site design">
      <Text style={styles.caption}>Design</Text>
      {OPTIONS.map((o) => {
        const active = activeKey === o.key;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: active, disabled: off, busy: !!busy }}
            disabled={off}
            onPress={() => !active && onSelect(o.key)}
            style={[styles.seg, active && styles.segOn]}
          >
            <Text style={[styles.segText, { color: active ? colors.buttonInk : '#fff' }]}>{o.short}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute', left: 12, top: '50%', height: 44, borderRadius: 22, overflow: 'hidden',
    flexDirection: 'row', alignItems: 'center', paddingLeft: 12,
    backgroundColor: colors.overlayCard, borderWidth: 1, borderColor: colors.overlayGold,
    shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 25, shadowOffset: { width: 0, height: 18 },
  },
  caption: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase', color: '#fff', marginRight: 6 },
  seg: { width: 40, height: 42, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.accent },
  segText: { fontFamily: fonts.bodyBold, fontSize: 14 },
});
