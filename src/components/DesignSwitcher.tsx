import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';

// Compact two-segment pill (1 | 2) that sits at the bottom-left of the page-tabs row.
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
    <View style={[styles.pill, off && { opacity: 0.6 }]} accessibilityRole="radiogroup" accessibilityLabel="Switch site design">
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
    flexDirection: 'row', height: 44, borderRadius: 22, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(255,255,255,0.06)',
  },
  seg: { width: 38, height: 42, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.accent },
  segText: { fontFamily: fonts.bodyBold, fontSize: 14 },
});
