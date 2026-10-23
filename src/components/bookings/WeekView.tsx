import { useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import {
  dayLayout, dayOfMonth, formatMinutes, timeOffSpans, weekdayShort, type Appointment, type DateKey, type TimeOff,
} from '@/lib/bookings/calendar';

export const HOUR_H = 56;
const GUTTER = 40;
const MIN_TEXT_H = 40;

export interface LegendItem { id: string; name: string; color: string }

/**
 * Seven day columns by hour rows. Blocks are coloured by barber; a block shorter than 40px has no text.
 * Tap a block to open it, long-press an empty spot to add a booking there, tap a day name to open that day.
 */
export function WeekView({
  days, today, tz, byDay, timeOff, barber, startHour, endHour, colorOf, legend, closed, onOpen, onDay, onAddAt,
}: {
  days: DateKey[];
  today: DateKey;
  tz: string;
  byDay: Record<DateKey, Appointment[]>;
  /** Time off, drawn greyed; it cannot be tapped to book. */
  timeOff: TimeOff[];
  /** The barber picked in the header filter (null = everyone). */
  barber: string | null;
  startHour: number;
  endHour: number;
  colorOf(memberId: string): string;
  legend: LegendItem[];
  /** Monday-based weekdays nobody works. */
  closed: number[];
  onOpen(a: Appointment): void;
  onDay(d: DateKey): void;
  onAddAt(d: DateKey, minutes: number): void;
}) {
  const scroll = useRef<ScrollView>(null);
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const height = hours.length * HOUR_H;
  const scrolled = useRef(false);

  return (
    <View style={styles.flex}>
      {legend.length > 0 && (
        <View style={styles.legend} accessibilityLabel="Colour key">
          {legend.map((l) => (
            <View key={l.id} style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: l.color }]} />
              <Text style={styles.legendText} numberOfLines={1}>{l.name}</Text>
            </View>
          ))}
        </View>
      )}
      <View style={styles.headRow}>
        <View style={{ width: GUTTER }} />
        {days.map((d, i) => {
          const isToday = d === today;
          return (
            <Pressable
              key={d}
              onPress={() => onDay(d)}
              style={styles.headCell}
              accessibilityRole="button"
              accessibilityLabel={`Open ${weekdayShort(d)} ${dayOfMonth(d)}${isToday ? ', today' : ''}`}
            >
              <Text style={[styles.dow, closed.includes(i) && styles.muted]}>{weekdayShort(d)}</Text>
              <View style={[styles.numWrap, isToday && styles.numToday]}>
                <Text style={[styles.num, isToday && styles.numTodayText, closed.includes(i) && !isToday && styles.muted]}>
                  {dayOfMonth(d)}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <ScrollView
        ref={scroll}
        style={styles.flex}
        contentContainerStyle={{ paddingBottom: 120 }}
        onContentSizeChange={() => {
          if (scrolled.current) return;
          scrolled.current = true;
          // Open on the morning rather than the empty hours before it.
          scroll.current?.scrollTo({ y: 0, animated: false });
        }}
      >
        <View style={[styles.body, { height }]}>
          <View style={{ width: GUTTER, height }}>
            {hours.map((h, i) => (
              <Text key={h} style={[styles.hour, { top: i * HOUR_H - 6 }]}>
                {i === 0 ? '' : formatMinutes(h * 60).replace(':00 ', ' ')}
              </Text>
            ))}
          </View>
          {days.map((d, col) => (
            <Pressable
              key={d}
              style={[styles.col, closed.includes(col) && styles.colClosed, d === today && styles.colToday, { height }]}
              onLongPress={(e) => {
                const y = e.nativeEvent.locationY;
                const mins = Math.max(0, Math.min(23 * 60 + 45, Math.floor((startHour * 60 + (y / HOUR_H) * 60) / 15) * 15));
                onAddAt(d, mins);
              }}
              delayLongPress={350}
              accessibilityLabel={`${weekdayShort(d)} ${dayOfMonth(d)}, press and hold an empty spot to add a booking`}
            >
              {hours.map((h, i) => (
                <View key={h} pointerEvents="none" style={[styles.line, { top: i * HOUR_H }]} />
              ))}
              {timeOffSpans(timeOff, d, tz, barber).map((t) => (
                <View
                  key={t.id}
                  pointerEvents="none"
                  accessibilityLabel={`Time off ${formatMinutes(t.startMin)} to ${formatMinutes(t.endMin)}`}
                  style={[
                    styles.off,
                    {
                      top: Math.max(0, ((t.startMin - startHour * 60) / 60) * HOUR_H),
                      height: Math.max(4, ((t.endMin - Math.max(t.startMin, startHour * 60)) / 60) * HOUR_H),
                    },
                  ]}
                />
              ))}
              {dayLayout(byDay[d] ?? [], d, tz).map((p) => {
                const top = ((p.startMin - startHour * 60) / 60) * HOUR_H;
                const h = Math.max(14, ((p.endMin - p.startMin) / 60) * HOUR_H - 1);
                const w = 100 / p.lanes;
                const a = p.appt;
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => onOpen(a)}
                    accessibilityRole="button"
                    accessibilityLabel={`${formatMinutes(p.startMin)}, ${a.customerName?.trim() || 'Walk-in'}, ${a.serviceName}`}
                    style={[
                      styles.block,
                      { top, height: h, left: `${p.lane * w}%`, width: `${w}%`, backgroundColor: colorOf(a.memberId) },
                      a.status === 'done' && { opacity: 0.55 },
                    ]}
                  >
                    {h >= MIN_TEXT_H && p.lanes === 1 && (
                      <Text style={styles.blockText} numberOfLines={Math.floor((h - 6) / 11)}>
                        {(a.customerName?.trim() || 'Walk-in').split(' ')[0]}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 140 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  legendText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.muted, flexShrink: 1 },
  headRow: { flexDirection: 'row', paddingHorizontal: 8, paddingBottom: 6 },
  headCell: { flex: 1, alignItems: 'center', gap: 2 },
  dow: { fontFamily: fonts.bodySemi, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.muted },
  numWrap: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  numToday: { backgroundColor: colors.accent },
  num: { fontFamily: fonts.heading, fontSize: 15, color: colors.text },
  numTodayText: { color: colors.accentInk },
  muted: { opacity: 0.4 },
  body: { flexDirection: 'row', paddingHorizontal: 8 },
  hour: { position: 'absolute', right: 6, fontFamily: fonts.body, fontSize: 10, color: colors.faint },
  col: { flex: 1, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.hair },
  colClosed: { backgroundColor: 'rgba(237,239,244,0.035)' },
  colToday: { backgroundColor: 'rgba(244,161,0,0.06)' },
  line: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.hair },
  off: { position: 'absolute', left: 0, right: 0, backgroundColor: 'rgba(120,124,135,0.28)', borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(120,124,135,0.45)' },
  block: { position: 'absolute', borderRadius: 5, paddingHorizontal: 3, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(0,0,0,0.25)' },
  blockText: { fontFamily: fonts.bodyBold, fontSize: 9, lineHeight: 11, color: colors.accentInk },
});
