import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import {
  addDays, formatDay, formatMinutes, timeChoices, type DateKey,
} from '@/lib/bookings/calendar';
import { ChipRow } from '@/components/bookings/Chips';

const DAY_COUNT = 30;

export function Label({ children }: { children: string }) {
  return <Text style={styles.label}>{children}</Text>;
}

/** Day chips (today through 30 days out) in the shop's calendar. */
export function DayChips({
  today, value, onChange,
}: { today: DateKey; value: DateKey; onChange(d: DateKey): void }) {
  const days = Array.from({ length: DAY_COUNT }, (_, i) => addDays(today, i));
  const options = days.map((d) => ({ value: d, label: d === today ? 'Today' : formatDay(d) }));
  // A date outside the window (a past day being viewed) is still selectable.
  if (!days.includes(value)) options.unshift({ value, label: formatDay(value) });
  return <ChipRow<string> options={options} value={value} onChange={onChange} />;
}

/** Quarter-hour time chips. */
export function TimeChips({
  value, onChange, from, to,
}: { value: number; onChange(m: number): void; from?: number; to?: number }) {
  const choices = timeChoices(from, to);
  const options = choices.map((m) => ({ value: m, label: formatMinutes(m) }));
  // A current time that isn't on the grid is kept so it stays selectable.
  if (!choices.includes(value)) options.unshift({ value, label: formatMinutes(value) });
  return <ChipRow<number> options={options} value={value} onChange={onChange} />;
}

/** Day + time, for Add booking and Reschedule. */
export function WhenPicker({
  today, day, minutes, onDay, onMinutes,
}: {
  today: DateKey; day: DateKey; minutes: number; onDay(d: DateKey): void; onMinutes(m: number): void;
}) {
  return (
    <View>
      <Label>Day</Label>
      <DayChips today={today} value={day} onChange={onDay} />
      <Label>Time</Label>
      <TimeChips value={minutes} onChange={onMinutes} />
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase',
    color: colors.muted, marginTop: 16, marginBottom: 8,
  },
});
