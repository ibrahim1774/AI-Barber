import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { ChevronRightIcon } from '@/components/Icons';
import { dayKey, formatDay, formatMoney, parseKey } from '@/lib/bookings/calendar';
import type { Customer } from '@/lib/bookings/customers';
import { formatPhone } from '@/lib/phone';

/** 'Tue, Oct 20, 2026' in the shop's timezone. */
export function shortDate(iso: string, tz: string): string {
  const key = dayKey(iso, tz);
  return `${formatDay(key)}, ${parseKey(key)!.y}`;
}

export const bookingsText = (n: number) => `${n} ${n === 1 ? 'booking' : 'bookings'}`;

/** One customer: contact lines, then only the facts that exist. */
export function CustomerRow({ customer: c, tz, onPress }: { customer: Customer; tz: string; onPress(): void }) {
  const facts = [bookingsText(c.bookings)];
  if (c.lastAt) facts.push(`Last: ${shortDate(c.lastAt, tz)}`);
  if (c.nextAt) facts.push(`Next: ${shortDate(c.nextAt, tz)}`);
  if (c.paidCents > 0) facts.push(`Paid ${formatMoney(c.paidCents)}`);
  if (c.cancelled > 0) facts.push(`${c.cancelled} cancelled`);
  if (c.noShows > 0) facts.push(`${c.noShows} no-${c.noShows === 1 ? 'show' : 'shows'}`);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${c.name}, ${bookingsText(c.bookings)}`}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
    >
      <View style={styles.mid}>
        <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
        {!!c.phones[0] && <Text style={styles.sub} numberOfLines={1}>{formatPhone(c.phones[0])}</Text>}
        {!!c.emails[0] && <Text style={styles.sub} numberOfLines={1}>{c.emails[0]}</Text>}
        <Text style={styles.facts}>{facts.join(' · ')}</Text>
      </View>
      <ChevronRightIcon size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.sheet, borderRadius: 14,
    borderWidth: 1, borderColor: colors.hair, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10,
  },
  mid: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.heading },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.body },
  facts: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18, color: colors.muted, marginTop: 4 },
});
