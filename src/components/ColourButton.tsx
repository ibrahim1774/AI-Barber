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
    alignItems: 'center', paddingHorizontal: 10, paddingVertical: 2, borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.8)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 15, shadowOffset: { width: 0, height: 10 },
  },
  head: { minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' },
  caption: { fontFamily: fonts.bodyBold, fontSize: 8, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 88, paddingBottom: 6 },
  cell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 32, height: 32, borderRadius: 16, padding: 4, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  ringOn: { borderColor: colors.overlayGold },
  swatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
});
