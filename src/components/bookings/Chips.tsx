import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, fonts } from '@/constants/theme';

export interface ChipOption<T> { value: T; label: string }

/** One selectable pill. */
export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress(): void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[styles.chip, on && styles.chipOn]}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/** A single-choice row of chips (scrolls sideways when long). */
export function ChipRow<T extends string | number | null>({
  options, value, onChange, style,
}: {
  options: ChipOption<T>[];
  value: T;
  onChange(v: T): void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.scroll, style]} contentContainerStyle={styles.row}>
      {options.map((o) => (
        <Chip key={String(o.value)} label={o.label} on={o.value === value} onPress={() => onChange(o.value)} />
      ))}
    </ScrollView>
  );
}

/** "All · Mike · Jay": only shown when the shop has more than one barber. */
export function BarberChips({
  members, value, onChange,
}: {
  members: { id: string; name: string }[];
  value: string | null;
  onChange(id: string | null): void;
}) {
  if (members.length < 2) return null;
  return (
    <View>
      <ChipRow<string | null>
        options={[{ value: null, label: 'All' }, ...members.map((m) => ({ value: m.id as string | null, label: m.name }))]}
        value={value}
        onChange={onChange}
        style={styles.barberRow}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { gap: 8, paddingHorizontal: 2 },
  barberRow: { marginHorizontal: 16 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
    borderColor: colors.ghostBorder, backgroundColor: colors.ghostBg,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.chipText },
  chipTextOn: { color: colors.accentInk },
});
