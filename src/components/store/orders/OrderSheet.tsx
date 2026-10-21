import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/EditSheet';
import { Note, TextAction } from '@/components/setup/ui';
import { OrderChip } from '@/components/store/orders/OrderChip';
import { RefundSheet } from '@/components/store/orders/RefundSheet';
import { ShipSheet, type Tracking } from '@/components/store/orders/ShipSheet';
import { colors, fonts } from '@/constants/theme';
import { smsUrl, telUrl, formatMoney } from '@/lib/bookings/calendar';
import { friendlyOrderError, markOrder, refundOrder, OrderApiError, type MarkAction } from '@/lib/store/api';
import type { Order } from '@/lib/store/data';
import {
  addressLines, availableActions, orderNumber, paymentLabel, refundableCents, saidPaidNote, statusLabel,
} from '@/lib/store/orderActions';

type Props = {
  order: Order | null;
  /** Kept for the Store tab's API; a lapsed plan never hides order actions. */
  locked?: boolean;
  onClose(): void;
  /** Reload the list (and this order) after a change. */
  onChanged(): Promise<void> | void;
};

type Mode = 'detail' | 'ship' | 'refund';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function OrderSheet({ order, onClose, onChanged }: Props) {
  const last = useRef<Order | null>(null);
  if (order) last.current = order;
  const o = order ?? last.current;
  const [mode, setMode] = useState<Mode>('detail');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const id = order?.id;
  useEffect(() => {
    setMode('detail');
    setBusy(false);
    setNotice(null);
  }, [id]);

  const close = () => {
    setMode('detail');
    setNotice(null);
    onClose();
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      Alert.alert("Couldn't do that", friendlyOrderError(e));
      // The order moved under us (409): show what it is now.
      if (e instanceof OrderApiError && e.status === 409) await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const mark = (action: MarkAction, tracking?: Tracking) =>
    run(async () => {
      if (!o) return;
      await markOrder(o.id, action, tracking);
      setMode('detail');
      await onChanged();
    });

  const refund = (amountCents: number | undefined) =>
    run(async () => {
      if (!o) return;
      const r = await refundOrder(o.id, amountCents);
      setMode('detail');
      setNotice(r.pending ? "Refund is processing. We'll keep trying." : 'Refund sent.');
      await onChanged();
    });

  const confirmCancel = () => {
    if (!o) return;
    Alert.alert('Cancel this order?', `${o.customer.name.trim() || 'The customer'} gets an email that it was cancelled.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel order', style: 'destructive', onPress: () => void mark('cancel') },
    ]);
  };

  const open = (url: string) => Linking.openURL(url).catch(() => Alert.alert("Couldn't open that."));
  const copyAddress = async (lines: string[]) => {
    await Clipboard.setStringAsync(lines.join('\n'));
    setNotice('Address copied.');
  };

  if (!o) return <Sheet visible={false} title="" onClose={onClose}>{null}</Sheet>;
  const can = availableActions(o); // never hidden by a lapsed plan: owners must always be able to fulfil and refund
  const has = (a: (typeof can)[number]) => can.includes(a);
  const phone = o.customer.phone.trim();
  const email = o.customer.email.trim();
  const address = addressLines(o.shippingAddress);
  const said = saidPaidNote(o);
  const title = mode === 'ship' ? 'Ship order' : mode === 'refund' ? 'Refund order' : `Order ${orderNumber(o)}`;

  return (
    <Sheet visible={!!order} title={title} onClose={close}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {mode === 'ship' && <ShipSheet busy={busy} onSubmit={(t) => void mark('shipped', t)} onBack={() => setMode('detail')} />}
        {mode === 'refund' && (
          <RefundSheet refundableCents={refundableCents(o)} busy={busy} onSubmit={(c) => void refund(c)} onBack={() => setMode('detail')} />
        )}
        {mode === 'detail' && (
          <View>
            <View style={st.head}>
              <Text style={st.name} numberOfLines={2}>{o.customer.name.trim() || 'Customer'}</Text>
              <OrderChip order={o} />
            </View>
            <Text style={st.when}>{when(o.createdAt)} · {o.fulfilment === 'pickup' ? 'Pickup' : 'Shipping'}</Text>
            {!!notice && <Note>{notice}</Note>}
            {o.refundPending && <Note tone="warn">A refund is processing. We'll keep trying.</Note>}

            <View style={st.pair}>
              {!!phone && <Button title="Call" variant="pill" onPress={() => open(telUrl(phone))} style={st.third} />}
              {!!phone && <Button title="Text" variant="pill" onPress={() => open(smsUrl(phone))} style={st.third} />}
              {!!email && <Button title="Email" variant="pill" onPress={() => open(`mailto:${email}`)} style={st.third} />}
            </View>

            <Text style={st.label}>Items</Text>
            {o.items.map((i, n) => (
              <View key={`${i.productId ?? 'x'}-${n}`} style={st.line}>
                <Text style={st.k}>{i.quantity} × {i.name}</Text>
                <Text style={st.v}>{formatMoney(i.unitPriceCents * i.quantity)}</Text>
              </View>
            ))}
            {o.shippingCents > 0 && <Line k="Shipping" v={formatMoney(o.shippingCents)} />}
            <Line k="Total" v={formatMoney(o.totalCents)} strong />
            <Line k="Payment" v={paymentLabel(o)} />
            <Line k="Status" v={statusLabel(o.status)} />
            {!!said && <Note tone="warn">{said}</Note>}
            {!!o.note && <Line k="Note" v={o.note} />}
            {!!o.trackingNumber && <Line k="Tracking" v={o.trackingNumber} />}
            {!!o.trackingUrl && <TextAction title="Open tracking link" onPress={() => open(o.trackingUrl!)} />}

            {!!address.length && (
              <View>
                <Text style={st.label}>Ship to</Text>
                {address.map((l, n) => <Text key={n} style={st.addr}>{l}</Text>)}
                <TextAction title="Copy address" onPress={() => void copyAddress(address)} />
              </View>
            )}

            {(
              <View style={st.actions}>
                {has('paid') && <Button title="Mark paid" variant="ghost" loading={busy} onPress={() => void mark('paid')} style={st.gap} />}
                {has('ready') && <Button title="Mark ready" loading={busy} onPress={() => void mark('ready')} style={st.gap} />}
                {has('shipped') && <Button title="Mark shipped" loading={busy} onPress={() => setMode('ship')} style={st.gap} />}
                {has('done') && <Button title="Mark done" variant="ghost" disabled={busy} onPress={() => void mark('done')} style={st.gap} />}
                {has('refund') && <Button title="Refund" variant="ghost" disabled={busy} onPress={() => setMode('refund')} style={st.gap} />}
                {has('cancel') && <Button title="Cancel order" variant="link" disabled={busy} onPress={confirmCancel} style={st.gap} />}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </Sheet>
  );
}

function Line({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <View style={st.line}>
      <Text style={st.k}>{k}</Text>
      <Text style={[st.v, strong && { fontFamily: fonts.bodyBold }]}>{v}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  name: { flex: 1, fontFamily: fonts.heading, fontSize: 22, color: colors.heading },
  when: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.accent, marginTop: 6 },
  pair: { flexDirection: 'row', gap: 10, marginTop: 16 },
  third: { flex: 1 },
  label: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase',
    color: colors.muted, marginTop: 18, marginBottom: 2,
  },
  line: {
    flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hair,
  },
  k: { flexShrink: 1, fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  v: { flexShrink: 1, fontFamily: fonts.bodySemi, fontSize: 14, color: colors.text, textAlign: 'right' },
  addr: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.text },
  actions: { marginTop: 20, marginBottom: 8 },
  gap: { marginTop: 10 },
});
