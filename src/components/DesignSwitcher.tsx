import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';

// BooksyDesignSwitcher.tsx: one floating vertical panel pinned left-middle.
// Any non-prime template counts as Design 1.

const OPTIONS: { key: 'luxe' | 'prime'; label: string }[] = [
  { key: 'luxe', label: 'Design 1' },
  { key: 'prime', label: 'Design 2' },
];

export function DesignSwitcher({
  current, onSelect, busy,
}: {
  current: string | undefined;
  onSelect(t: 'luxe' | 'prime'): void;
  busy?: boolean;
}) {
  const activeKey = current === 'prime' ? 'prime' : 'luxe';
  return (
    <View style={styles.card} accessibilityRole="radiogroup" accessibilityLabel="Switch site design">
      <Text style={styles.heading}>Design</Text>
      {OPTIONS.map((o) => {
        const active = activeKey === o.key;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, disabled: !!busy }}
            disabled={busy}
            onPress={() => !active && onSelect(o.key)}
            style={[styles.btn, active ? styles.btnOn : styles.btnOff, busy && { opacity: 0.6 }]}
          >
            <Text style={[styles.btnText, { color: active ? '#0a0a0a' : '#fff' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute', left: 12, top: '50%', transform: [{ translateY: -60 }],
    gap: 8, padding: 12, borderRadius: 16,
    backgroundColor: colors.overlayCard, borderWidth: 1, borderColor: colors.overlayGold,
    shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 25, shadowOffset: { width: 0, height: 18 },
  },
  heading: {
    fontFamily: fonts.bodyBold, fontSize: 9, letterSpacing: 2.5, textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.45)', textAlign: 'center', marginBottom: 2,
  },
  btn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, borderWidth: 1 },
  btnOn: { backgroundColor: colors.overlayGold, borderColor: colors.overlayGold },
  btnOff: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.22)' },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase' },
});
