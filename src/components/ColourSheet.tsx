import { Pressable, StyleSheet, View } from 'react-native';
import { BRAND_SWATCHES } from '@/web/lib/brandSwatches';
import { colors, swatchLabel } from '@/constants/theme';
import { Sheet, SheetAction } from '@/components/EditSheet';

/**
 * The web's EditorColorPicker / BrandSwatchGrid: the six brand swatches as
 * tappable circles, gold ring on the active one. A pick applies straight away
 * (the preview re-themes behind the sheet); Done closes.
 */
export function ColourSheet({
  visible, current, onPick, onClose,
}: {
  visible: boolean;
  current?: string;
  onPick(hex: string): void;
  onClose(): void;
}) {
  const active = (current || '').toLowerCase();
  return (
    <Sheet visible={visible} title="Theme" onClose={onClose} right={<SheetAction title="Done" onPress={onClose} />}>
      <View style={styles.row}>
        {BRAND_SWATCHES.map((c) => {
          const on = active === c.toLowerCase();
          return (
            <Pressable
              key={c}
              accessibilityRole="button"
              accessibilityLabel={swatchLabel(c)}
              accessibilityState={{ selected: on }}
              onPress={() => onPick(c)}
              hitSlop={6}
              style={[styles.ring, on && styles.ringOn]}
            >
              <View style={[styles.swatch, { backgroundColor: c }]} />
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 4 },
  // box-shadow: 0 0 0 2px #0e0c08, 0 0 0 4px #e8c074 (active) / inset hairline
  ring: { width: 44, height: 44, borderRadius: 22, padding: 4, borderWidth: 2, borderColor: 'transparent' },
  ringOn: { borderColor: colors.overlayGold },
  swatch: { flex: 1, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
});
