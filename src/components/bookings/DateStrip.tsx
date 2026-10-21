import { useEffect, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { dayOfMonth, weekdayShort, type DateKey } from '@/lib/bookings/calendar';

const ITEM = 52;
const GAP = 8;

/** Horizontal days; Today is ringed, the selected day is gold, a dot marks days with bookings. */
export function DateStrip({
  days, selected, today, counts, onSelect,
}: {
  days: DateKey[];
  selected: DateKey;
  today: DateKey;
  counts: Record<DateKey, number>;
  onSelect(day: DateKey): void;
}) {
  const ref = useRef<FlatList<DateKey>>(null);
  const index = days.indexOf(selected);

  useEffect(() => {
    if (index >= 0) ref.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
  }, [index]);

  return (
    <FlatList
      ref={ref}
      horizontal
      data={days}
      keyExtractor={(d) => d}
      showsHorizontalScrollIndicator={false}
      getItemLayout={(_, i) => ({ length: ITEM + GAP, offset: (ITEM + GAP) * i, index: i })}
      initialScrollIndex={index >= 0 ? Math.max(0, index - 2) : undefined}
      onScrollToIndexFailed={() => {}}
      contentContainerStyle={styles.row}
      style={styles.list}
      renderItem={({ item }) => {
        const on = item === selected;
        const isToday = item === today;
        const n = counts[item] ?? 0;
        return (
          <Pressable
            onPress={() => onSelect(item)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${weekdayShort(item)} ${dayOfMonth(item)}${isToday ? ', today' : ''}${n ? `, ${n} booking${n === 1 ? '' : 's'}` : ''}`}
            style={[styles.item, isToday && styles.today, on && styles.on]}
          >
            <Text style={[styles.dow, on && styles.onText]}>{weekdayShort(item)}</Text>
            <Text style={[styles.num, on && styles.onText]}>{dayOfMonth(item)}</Text>
            <View style={[styles.dot, n > 0 && { backgroundColor: on ? colors.accentInk : colors.accent }]} />
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 0 },
  row: { paddingHorizontal: 16, gap: GAP, paddingVertical: 4 },
  item: {
    width: ITEM, height: 68, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.ghostBg, borderWidth: 1, borderColor: 'transparent',
  },
  today: { borderColor: colors.accent },
  on: { backgroundColor: colors.accent },
  dow: { fontFamily: fonts.bodySemi, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: colors.muted },
  num: { fontFamily: fonts.heading, fontSize: 19, color: colors.text, marginTop: 2 },
  onText: { color: colors.accentInk },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 4, backgroundColor: 'transparent' },
});
