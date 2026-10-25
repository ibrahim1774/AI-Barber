import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { Page } from '@/components/Page';
import { orderDate, ordersText } from '@/components/store/customers/StoreCustomerRow';
import { useStoreCustomers } from '@/components/store/customers/useStoreCustomers';
import { formatMoney, telUrl } from '@/lib/bookings/calendar';
import { goBackOrHome } from '@/lib/nav';
import { formatPhone } from '@/lib/phone';
import { itemsSummary, paymentLabel } from '@/lib/store/orderActions';

/** One customer's contact details and orders. Read-only: orders are handled from the Orders tab. */
export default function StoreCustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { phase, customers, orders } = useStoreCustomers();
  const c = customers.find((x) => x.id === id);

  if (!c) {
    return (
      <Page title="Customer" onBack={goBackOrHome}>
        {phase === 'loading' ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 48 }} />
        ) : (
          <View style={st.center}>
            <Text style={st.p}>Customer not found</Text>
            <Button title="Back" variant="ghost" onPress={goBackOrHome} />
          </View>
        )}
      </Page>
    );
  }

  const stat = (label: string, value: string) => (
    <View style={st.stat} key={label}>
      <Text style={st.statLabel}>{label}</Text>
      <Text style={st.statValue}>{value}</Text>
    </View>
  );
  const mine = orders.filter((o) => c.orderIds.includes(o.id));

  return (
    <Page title="Customer" onBack={goBackOrHome}>
      <Text style={st.name} accessibilityRole="header">{c.names[0]}</Text>
      {c.names.length > 1 && <Text style={st.also}>{`Also ordered as ${c.names.slice(1).join(', ')}`}</Text>}

      <View style={st.card}>
        {c.phones.map((p) => (
          <Pressable key={p} onPress={() => void Linking.openURL(telUrl(p))} accessibilityRole="link" accessibilityLabel={`Call ${formatPhone(p)}`}>
            <Text style={st.link}>{formatPhone(p)}</Text>
          </Pressable>
        ))}
        {c.emails.map((e) => (
          <Pressable key={e} onPress={() => void Linking.openURL(`mailto:${e}`)} accessibilityRole="link" accessibilityLabel={`Email ${e}`}>
            <Text style={st.link}>{e}</Text>
          </Pressable>
        ))}
      </View>

      <View style={st.card}>
        {stat('First order', orderDate(c.firstAt))}
        {stat('Last order', orderDate(c.lastAt))}
        {stat('Orders', String(c.orders))}
        {stat('Order total', formatMoney(c.totalCents))}
        {stat('Paid', formatMoney(c.paidCents))}
        {c.unpaidOrders > 0 && stat('Unpaid orders', String(c.unpaidOrders))}
      </View>

      <Text style={st.section}>{`Orders · ${ordersText(mine.length)}`}</Text>
      {mine.map((o) => (
        <Pressable
          key={o.id}
          style={st.hist}
          onPress={() => router.push({ pathname: '/store', params: { tab: 'orders', orderId: o.id, n: String(Date.now()) } } as never)}
          accessibilityRole="button"
          accessibilityLabel={`Order ${o.number}`}
        >
          <View style={st.histTop}>
            <Text style={st.histWhen}>{`#${o.number} · ${orderDate(o.createdAt)}`}</Text>
            <Text style={st.status}>{formatMoney(o.totalCents)}</Text>
          </View>
          <Text style={st.histSub}>{itemsSummary(o.items)}</Text>
          <Text style={st.histSub}>{paymentLabel(o)}</Text>
        </Pressable>
      ))}
    </Page>
  );
}

const st = StyleSheet.create({
  center: { alignItems: 'center', gap: 16, marginTop: 32 },
  p: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.body, textAlign: 'center' },
  name: { fontFamily: fonts.heading, fontSize: 26, color: colors.heading },
  also: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 4 },
  card: {
    backgroundColor: colors.sheet, borderRadius: 14, borderWidth: 1, borderColor: colors.hair, paddingHorizontal: 14,
    paddingVertical: 10, marginTop: 16, gap: 8,
  },
  link: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.accent, paddingVertical: 2 },
  stat: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  statLabel: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  statValue: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.text },
  section: {
    fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: colors.muted, marginTop: 24, marginBottom: 10,
  },
  hist: {
    backgroundColor: colors.sheet, borderRadius: 12, borderWidth: 1, borderColor: colors.hair, paddingHorizontal: 14,
    paddingVertical: 10, marginBottom: 8, gap: 2,
  },
  histTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  histWhen: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.heading, flexShrink: 1 },
  status: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.chipText },
  histSub: { fontFamily: fonts.body, fontSize: 13, color: colors.body },
});
