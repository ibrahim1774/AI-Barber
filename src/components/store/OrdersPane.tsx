import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { OrderChip } from '@/components/store/orders/OrderChip';
import { OrderSheet } from '@/components/store/orders/OrderSheet';
import { useOrders } from '@/components/store/orders/useOrders';
import { colors, fonts } from '@/constants/theme';
import { formatMoney } from '@/lib/bookings/calendar';
import { getOrder, type Order } from '@/lib/store/data.stub-a3b';
import { itemsSummary, orderNumber, paymentLabel } from '@/lib/store/orderActions';

type Props = {
  shopId: string;
  shopName: string;
  /** Lapsed plan: orders can be read but not changed. */
  locked: boolean;
  /** Open this order's sheet (from a push tap). */
  focusOrderId?: string;
  /** Called after any change, so the tab's badge can refresh. */
  onChanged(): void;
};

/** The Store tab's Orders list: newest first, tap for the order sheet. */
export function OrdersPane({ shopId, locked, focusOrderId, onChanged }: Props) {
  const { orders, error, more, loadingMore, refresh, loadMore } = useOrders(shopId);
  const [selected, setSelected] = useState<Order | null>(null);
  const opened = useRef<string | null>(null);

  // A push tap: open that order once, wherever it is in the list.
  useEffect(() => {
    if (!focusOrderId || opened.current === focusOrderId) return;
    opened.current = focusOrderId;
    let alive = true;
    getOrder(focusOrderId)
      .then((o) => alive && o && setSelected(o))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [focusOrderId]);

  const changed = useCallback(async () => {
    const id = selected?.id;
    await refresh();
    if (id) {
      const fresh = await getOrder(id).catch(() => null);
      if (fresh) setSelected(fresh);
    }
    onChanged();
  }, [selected?.id, refresh, onChanged]);

  if (!orders && !error) return <ActivityIndicator color={colors.accent} style={{ marginTop: 32 }} />;

  return (
    <View>
      {!!error && !orders && (
        <View style={st.center}>
          <Text style={st.empty}>{error}</Text>
          <Button title="Try again" onPress={() => void refresh()} />
        </View>
      )}
      {!!orders && !orders.length && (
        <Text style={st.empty}>No orders yet. When a customer buys from your shop, it shows up here.</Text>
      )}
      {(orders ?? []).map((o) => (
        <OrderRow key={o.id} order={o} onPress={() => setSelected(o)} />
      ))}
      {more && <Button title="Load more" variant="ghost" loading={loadingMore} onPress={() => void loadMore()} style={{ marginTop: 6 }} />}
      <OrderSheet order={selected} locked={locked} onClose={() => setSelected(null)} onChanged={changed} />
    </View>
  );
}

function OrderRow({ order: o, onPress }: { order: Order; onPress(): void }) {
  const who = o.customer.name.trim() || 'Customer';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Order ${orderNumber(o)}, ${who}, ${formatMoney(o.totalCents)}`}
      style={({ pressed }) => [st.row, pressed && { opacity: 0.8 }]}
    >
      <View style={st.top}>
        <Text style={st.num}>{orderNumber(o)} · {who}</Text>
        <OrderChip order={o} />
      </View>
      <Text style={st.items} numberOfLines={1}>{itemsSummary(o.items)}</Text>
      <View style={st.top}>
        <Text style={st.total}>{formatMoney(o.totalCents)}</Text>
        <Text style={st.pay} numberOfLines={1}>{paymentLabel(o)}</Text>
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  center: { gap: 16 },
  empty: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.body, marginTop: 8 },
  row: {
    gap: 6, paddingVertical: 14, paddingHorizontal: 14, backgroundColor: colors.sheet, borderRadius: 14,
    borderWidth: 1, borderColor: colors.hair, marginBottom: 8,
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  num: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 16, color: colors.heading },
  items: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  total: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  pay: { flexShrink: 1, fontFamily: fonts.body, fontSize: 13, color: colors.muted },
});
