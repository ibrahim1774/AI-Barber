import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BRAND_SWATCHES } from '@/web/lib/brandSwatches';
import { colors, fonts } from '@/constants/theme';

// Shared pieces of the GbpImportPage.tsx layout.

/** The "Import · Design · Publish" chips above every importer headline. */
export function StageChips() {
  return (
    <View style={styles.chips}>
      {['Import', 'Design', 'Publish'].map((c) => (
        <View key={c} style={styles.chip}>
          <Text style={styles.chipText}>{c}</Text>
        </View>
      ))}
    </View>
  );
}

/** The white glossy form card (bk-glosscard). */
export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

/** "Brand" + the six swatches; the pick becomes ShopInputs.colorTheme. */
export function SwatchRow({ value, onChange }: { value: string; onChange(c: string): void }) {
  return (
    <View style={styles.swatchRow}>
      <Text style={styles.swatchLabel}>Brand</Text>
      <View style={styles.swatches}>
        {BRAND_SWATCHES.map((c) => {
          const on = value.toLowerCase() === c.toLowerCase();
          return (
            <Pressable
              key={c}
              accessibilityRole="button"
              accessibilityLabel={`Use color ${c}`}
              accessibilityState={{ selected: on }}
              hitSlop={6}
              onPress={() => onChange(c)}
              style={[styles.swatchRing, on && styles.swatchRingOn]}
            >
              <View style={[styles.swatch, { backgroundColor: c }, !on && styles.swatchEdge]} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.error}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function WorksWith({ names }: { names: string[] }) {
  return (
    <View style={styles.works}>
      <Text style={[styles.worksText, { color: colors.muted, marginRight: 4 }]}>Works with</Text>
      {names.map((n) => (
        <View key={n} style={styles.worksChip}>
          <Text style={styles.worksText}>{n}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  chip: {
    borderRadius: 999, borderWidth: 1, borderColor: `${colors.accent}59`, backgroundColor: `${colors.accent}14`,
    paddingHorizontal: 16, paddingVertical: 6,
  },
  chipText: { fontFamily: fonts.serifish, fontSize: 13.5, letterSpacing: 0.5, color: colors.chipText },
  card: {
    alignSelf: 'stretch', marginTop: 44, padding: 24, borderRadius: 26,
    backgroundColor: '#fbfbfc', borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)',
    shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 30, shadowOffset: { width: 0, height: 24 },
  },
  swatchRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  swatchLabel: {
    fontFamily: fonts.bodyExtra, fontSize: 11, letterSpacing: 2.6, textTransform: 'uppercase', color: colors.ink,
  },
  swatches: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // 0 0 0 2px #fff, 0 0 0 3.5px #0B0E14 → a white gap then an ink ring
  swatchRing: { width: 25, height: 25, borderRadius: 12.5, alignItems: 'center', justifyContent: 'center', margin: -3.5 },
  swatchRingOn: { borderWidth: 1.5, borderColor: colors.ink },
  swatch: { width: 18, height: 18, borderRadius: 9 },
  swatchEdge: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(11,14,20,0.18)' },
  error: { marginTop: 24, borderLeftWidth: 2, borderLeftColor: colors.errorRule, paddingLeft: 16 },
  errorText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 21, color: colors.error },
  works: {
    marginTop: 40, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  worksChip: {
    borderRadius: 999, borderWidth: 1, borderColor: `${colors.accent}40`, backgroundColor: `${colors.accent}0d`,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  worksText: {
    fontFamily: fonts.bodySemi, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: colors.muted,
  },
});
