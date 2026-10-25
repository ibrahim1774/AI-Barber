import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { Page } from '@/components/Page';
import { bookingsText, shortDate } from '@/components/bookings/CustomerRow';
import { useCustomers } from '@/components/bookings/useCustomers';
import { formatMoney, formatTime, telUrl } from '@/lib/bookings/calendar';
import type { CustomerAppt } from '@/lib/bookings/customers';
import { goBackOrHome } from '@/lib/nav';
import { formatPhone } from '@/lib/phone';
import { listMembers, memberName } from '@/lib/bookings/shop';

const STATUS: Record<CustomerAppt['status'], string> = { booked: 'Booked', done: 'Done', no_show: 'No-show', cancelled: 'Cancelled' };

/** One customer's contact details, booking facts and history. Read-only: bookings are changed from the calendar. */
export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { phase, shop, customers } = useCustomers();
  const [barbers, setBarbers] = useState<Record<string, string>>({});
  const c = customers.find((x) => x.id === id);
  const shopId = shop?.id;

  useEffect(() => {
    if (!shopId) return;
    let live = true;
    listMembers(shopId)
      .then((m) => { if (live) setBarbers(Object.fromEntries(m.map((x) => [x.id, memberName(x)]))); })
      .catch(() => {});
    return () => { live = false; };
  }, [shopId]);

  const tz = shop?.timezone ?? 'America/New_York';

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

  return (
    <Page title="Customer" onBack={goBackOrHome}>
      <Text style={st.name} accessibilityRole="header">{c.name}</Text>
      {c.otherNames.length > 0 && <Text style={st.also}>{`Also booked as ${c.otherNames.join(', ')}`}</Text>}

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
        {c.firstAt && stat('First booking', shortDate(c.firstAt, tz))}
        {c.lastAt && stat('Last booking', shortDate(c.lastAt, tz))}
        {c.nextAt && stat('Next booking', shortDate(c.nextAt, tz))}
        {stat('Bookings', String(c.bookings))}
        {c.paidCents > 0 && stat('Paid', formatMoney(c.paidCents))}
        {c.cancelled > 0 && stat('Cancelled', String(c.cancelled))}
        {c.noShows > 0 && stat('No-shows', String(c.noShows))}
      </View>

      <Text style={st.section}>{`History · ${bookingsText(c.history.length)}`}</Text>
      {c.history.map((h) => {
        const paid = Math.max(0, h.amountPaidCents - h.amountRefundedCents);
        return (
          <View key={h.id} style={st.hist}>
            <View style={st.histTop}>
              <Text style={st.histWhen}>{`${shortDate(h.start, tz)} · ${formatTime(h.start, tz)}`}</Text>
              <Text style={[st.status, h.status === 'cancelled' || h.status === 'no_show' ? st.statusBad : null]}>{STATUS[h.status]}</Text>
            </View>
            <Text style={st.histSub}>{`${h.serviceName} · ${barbers[h.memberId] ?? 'Barber'}${paid > 0 ? ` · Paid ${formatMoney(paid)}` : ''}`}</Text>
          </View>
        );
      })}
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
  status: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.chipText },
  statusBad: { color: '#f87171' },
  histSub: { fontFamily: fonts.body, fontSize: 13, color: colors.body },
});
