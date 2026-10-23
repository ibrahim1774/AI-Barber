import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/Icons';
import type { CalendarView } from '@/lib/bookings/calendar';

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

/** Day | Week | Month. */
export function ViewSwitch({ value, onChange }: { value: CalendarView; onChange(v: CalendarView): void }) {
  return (
    <View style={styles.seg} accessibilityRole="tablist">
      {VIEWS.map((v) => {
        const on = v.value === value;
        return (
          <Pressable
            key={v.value}
            onPress={() => onChange(v.value)}
            accessibilityRole="tab"
            accessibilityLabel={`${v.label} view`}
            accessibilityState={{ selected: on }}
            style={[styles.item, on && styles.itemOn]}
          >
            <Text style={[styles.text, on && styles.textOn]}>{v.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Arrows around a range label, plus the Today pill. */
export function RangeNav({
  label, onPrev, onNext, onToday, atToday, unit,
}: {
  label: string;
  onPrev(): void;
  onNext(): void;
  onToday(): void;
  atToday: boolean;
  unit: 'week' | 'month';
}) {
  return (
    <View style={styles.nav}>
      <Pressable onPress={onPrev} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Previous ${unit}`} style={styles.arrow}>
        <ChevronLeftIcon size={20} color={colors.text} />
      </Pressable>
      <Text style={styles.label} numberOfLines={1} accessibilityRole="header">{label}</Text>
      <Pressable onPress={onNext} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Next ${unit}`} style={styles.arrow}>
        <ChevronRightIcon size={20} color={colors.text} />
      </Pressable>
      <Pressable
        onPress={onToday}
        disabled={atToday}
        accessibilityRole="button"
        accessibilityLabel="Go to today"
        style={[styles.today, atToday && { opacity: 0.4 }]}
      >
        <Text style={styles.todayText}>Today</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  seg: {
    flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, padding: 3, borderRadius: 12, backgroundColor: colors.ghostBg,
    borderWidth: 1, borderColor: colors.hair,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 9 },
  itemOn: { backgroundColor: colors.accent },
  text: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.muted },
  textOn: { color: colors.accentInk },
  nav: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, gap: 6 },
  arrow: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontFamily: fonts.heading, fontSize: 17, color: colors.heading, textAlign: 'center' },
  today: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.accent,
  },
  todayText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.accent },
});
