import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { countText, type DateKey, type MonthCell } from '@/lib/bookings/calendar';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** 6 x 7 grid: a count per day (1-3 dots, then the number, "9+" past nine); closed days muted; tap opens that day. */
export function MonthView({
  cells, today, selected, counts, closed, onDay,
}: {
  cells: MonthCell[];
  today: DateKey;
  selected: DateKey;
  counts: Record<DateKey, number>;
  closed: number[];
  onDay(d: DateKey): void;
}) {
  const rows = Array.from({ length: 6 }, (_, r) => cells.slice(r * 7, r * 7 + 7));
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {DOW.map((d, i) => (
          <Text key={d} style={[styles.dow, closed.includes(i) && styles.muted]}>{d}</Text>
        ))}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={styles.row}>
          {r.map((c, ci) => {
            const n = counts[c.key] ?? 0;
            const isToday = c.key === today;
            const on = c.key === selected;
            const dim = !c.inMonth || closed.includes(ci);
            return (
              <Pressable
                key={c.key}
                onPress={() => onDay(c.key)}
                accessibilityRole="button"
                accessibilityLabel={`${c.key}${isToday ? ', today' : ''}${n ? `, ${n} booking${n === 1 ? '' : 's'}` : ''}${closed.includes(ci) ? ', closed' : ''}`}
                style={[styles.cell, isToday && styles.today, on && !isToday && styles.on]}
              >
                <Text style={[styles.num, dim && styles.muted, isToday && styles.numToday]}>{c.day}</Text>
                <View style={[styles.marks, dim && { opacity: 0.45 }]}>
                  {n > 0 && n <= 3 && Array.from({ length: n }, (_, i) => <View key={i} style={styles.dot} />)}
                  {n > 3 && <Text style={styles.count}>{countText(n)}</Text>}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 2 },
  row: { flexDirection: 'row' },
  dow: {
    flex: 1, textAlign: 'center', fontFamily: fonts.bodySemi, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase',
    color: colors.muted, paddingBottom: 8,
  },
  cell: {
    flex: 1, height: 58, margin: 1.5, borderRadius: 10, alignItems: 'center', paddingTop: 7, gap: 5,
    backgroundColor: colors.ghostBg, borderWidth: 1, borderColor: 'transparent',
  },
  today: { borderColor: colors.accent },
  on: { backgroundColor: 'rgba(244,161,0,0.14)' },
  num: { fontFamily: fonts.heading, fontSize: 15, color: colors.text },
  numToday: { color: colors.accent },
  muted: { opacity: 0.35 },
  marks: { flexDirection: 'row', gap: 3, alignItems: 'center', height: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  count: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.accent },
});
