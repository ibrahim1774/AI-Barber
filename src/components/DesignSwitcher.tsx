import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';

// The web's BooksyDesignSwitcher: a small vertical panel (dark glass card, gold hairline) on the preview's left
// edge with a DESIGN caption over two stacked buttons, "Design 1" and "Design 2"; the active one is solid gold.
// Any non-prime template counts as Design 1. Positioned by its parent (edit.tsx stacks it above the Colour panel).

const OPTIONS: { key: 'luxe' | 'prime'; label: string }[] = [
  { key: 'luxe', label: 'Design 1' },
  { key: 'prime', label: 'Design 2' },
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
    <View style={[styles.card, off && { opacity: 0.6 }]} accessibilityRole="radiogroup" accessibilityLabel="Switch site design">
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
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            onPress={() => !active && onSelect(o.key)}
            style={[styles.btn, active && styles.btnOn]}
          >
            <Text style={[styles.btnText, { color: active ? '#0a0a0a' : '#fff' }]} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // web: rounded-2xl p-3 gap-2, rgba(14,12,8,.94), 1px gold border, deep shadow
  card: {
    gap: 5, padding: 8, borderRadius: 12, backgroundColor: colors.overlayCard, borderWidth: 1, borderColor: colors.overlayGold,
    shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 25, shadowOffset: { width: 0, height: 18 },
  },
  caption: { fontFamily: fonts.bodyBold, fontSize: 7, letterSpacing: 1.8, textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', textAlign: 'center', marginBottom: 1 },
  btn: {
    minHeight: 31, minWidth: 31, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 5,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
  },
  btnOn: { backgroundColor: colors.overlayGold, borderColor: colors.overlayGold },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 8, letterSpacing: 0.9, textTransform: 'uppercase' },
});
