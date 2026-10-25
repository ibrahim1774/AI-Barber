import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { ChevronRightIcon } from '@/components/Icons';
import { formatPhone } from '@/lib/phone';
import { formatMoney } from '@/lib/bookings/calendar';
import type { StoreCustomer } from '@/lib/store/customers';

export const ordersText = (n: number) => `${n} ${n === 1 ? 'order' : 'orders'}`;

/** 'Oct 21, 2026' */
export function orderDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "2 × Beard oil, Pomade" for the first few items, then "+N more". */
export function boughtText(items: StoreCustomer['items'], max = 3): string {
  const shown = items.slice(0, max).map((i) => (i.quantity > 1 ? `${i.quantity} × ${i.name}` : i.name));
  const more = items.length - max;
  return more > 0 ? `${shown.join(', ')} +${more} more` : shown.join(', ');
}

/** One buyer: contact lines, what they bought, then the money facts. */
export function StoreCustomerRow({ customer: c, onPress }: { customer: StoreCustomer; onPress(): void }) {
  const facts = [ordersText(c.orders), `Spent ${formatMoney(c.paidCents)}`, `Last: ${orderDate(c.lastAt)}`];
  if (c.unpaidOrders > 0 && c.owedCents > 0) facts.push(`Owes ${formatMoney(c.owedCents)}`);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${c.names[0]}, ${ordersText(c.orders)}`}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
    >
      <View style={styles.mid}>
        <Text style={styles.name} numberOfLines={1}>{c.names[0]}</Text>
        {!!c.phones[0] && <Text style={styles.sub} numberOfLines={1}>{formatPhone(c.phones[0])}</Text>}
        {!!c.emails[0] && <Text style={styles.sub} numberOfLines={1}>{c.emails[0]}</Text>}
        {c.items.length > 0 && <Text style={styles.sub} numberOfLines={2}>{boughtText(c.items)}</Text>}
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
