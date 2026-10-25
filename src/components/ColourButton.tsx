import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BRAND_SWATCHES } from '@/web/lib/brandSwatches';
import { colors, fonts, swatchLabel } from '@/constants/theme';
import { useTutorialTarget } from '@/components/tutorial/registry';

/**
 * The web's EditorColorPicker ("Theme" panel, black/80 card under the Design switcher) with its BrandSwatchGrid:
 * six brand swatches in two columns, a gold ring on the active one. The web shows the grid open; here the panel
 * rests as a 44pt "Theme" header with the current swatch, and a tap opens the same two-column grid in place (so it
 * does not cover the page while you are not choosing). A pick applies straight away; the header closes it.
 */
export function ColourButton({
  current, onPick, disabled,
}: {
  current?: string;
  onPick(hex: string): void;
  disabled?: boolean;
}) {
  const ref = useTutorialTarget('edit.colour');
  const [open, setOpen] = useState(false);
  const active = (current || '').toLowerCase();
  return (
    <View style={[styles.card, disabled && { opacity: 0.6 }]}>
      <Pressable
        ref={ref}
        collapsable={false}
        accessibilityRole="button"
        accessibilityLabel="Colour"
        accessibilityHint="Change the colour of your site"
        accessibilityState={{ disabled: !!disabled, expanded: open }}
        disabled={disabled}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => [styles.head, pressed && { opacity: 0.6 }]}
      >
        <Text style={styles.caption}>Theme</Text>
        <View style={[styles.dot, { backgroundColor: active || colors.accent }]} />
      </Pressable>
      {open && (
        <View style={styles.grid}>
          {BRAND_SWATCHES.map((c) => {
            const on = active === c.toLowerCase();
            return (
              <Pressable
                key={c}
                accessibilityRole="button"
                accessibilityLabel={swatchLabel(c)}
                accessibilityState={{ selected: on, disabled: !!disabled }}
                disabled={disabled}
                onPress={() => onPick(c)}
                style={styles.cell}
              >
                {/* web: 24px circle; ring = 2px dark gap + 2px gold; else a faint inset hairline */}
                <View style={[styles.ring, on && styles.ringOn]}>
                  <View style={[styles.swatch, { backgroundColor: c }]} />
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center', paddingHorizontal: 7, paddingVertical: 1, borderRadius: 12,
    backgroundColor: colors.overlayCard, borderWidth: 1, borderColor: colors.overlayGold,
    shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 25, shadowOffset: { width: 0, height: 18 },
  },
  head: { minHeight: 31, minWidth: 31, flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  caption: { fontFamily: fonts.bodyBold, fontSize: 8, letterSpacing: 0.9, textTransform: 'uppercase', color: '#fff' },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#fff' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 62, paddingBottom: 4 },
  cell: { width: 31, height: 31, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 23, height: 23, borderRadius: 12, padding: 3, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  ringOn: { borderColor: colors.overlayGold },
  swatch: { width: 17, height: 17, borderRadius: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
});
