import { StyleSheet, Text, View } from 'react-native';
import { fonts } from '@/constants/theme';
import type { Order } from '@/lib/store/data.stub-a3b';
import { statusLabel, statusTone, type OrderTone } from '@/lib/store/orderActions';

const TONES: Record<OrderTone, { bg: string; fg: string }> = {
  neutral: { bg: 'rgba(237,239,244,0.10)', fg: '#D6D9E0' },
  good: { bg: 'rgba(34,197,94,0.16)', fg: '#4ade80' },
  warn: { bg: 'rgba(244,161,0,0.16)', fg: '#f4a100' },
  bad: { bg: 'rgba(239,68,68,0.16)', fg: '#f87171' },
};

/** The order's status as a small coloured chip. */
export function OrderChip({ order }: { order: Pick<Order, 'status'> }) {
  const t = TONES[statusTone(order.status)];
  return (
    <View style={[st.chip, { backgroundColor: t.bg }]}>
      <Text style={[st.text, { color: t.fg }]}>{statusLabel(order.status)}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  text: { fontFamily: fonts.bodyBold, fontSize: 12 },
});
