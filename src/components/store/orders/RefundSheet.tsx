import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Chip, Chips, Input, Note } from '@/components/setup/ui';
import { colors, fonts } from '@/constants/theme';
import { formatMoney } from '@/lib/bookings/calendar';
import { parseRefundAmount } from '@/lib/store/orderActions';

/**
 * The "Refund" panel inside the order sheet: everything still refundable, or an amount.
 * `onSubmit(undefined)` means the full remaining amount.
 */
export function RefundSheet({
  refundableCents, busy, onSubmit, onBack,
}: { refundableCents: number; busy: boolean; onSubmit(amountCents: number | undefined): void; onBack(): void }) {
  const [partial, setPartial] = useState(false);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = () => {
    if (!partial) {
      setProblem(null);
      return onSubmit(undefined);
    }
    const cents = parseRefundAmount(text);
    if (cents == null || cents > refundableCents) {
      setProblem(`Enter an amount from $0.01 to ${formatMoney(refundableCents)}.`);
      return;
    }
    setProblem(null);
    onSubmit(cents);
  };

  return (
    <View style={st.wrap}>
      <Text style={st.h}>Refund to the customer's card</Text>
      <Note>Up to {formatMoney(refundableCents)} can be refunded.</Note>
      <Chips>
        <Chip label={`Full ${formatMoney(refundableCents)}`} selected={!partial} onPress={() => setPartial(false)} />
        <Chip label="Partial" selected={partial} onPress={() => setPartial(true)} />
      </Chips>
      {partial && (
        <Input label="Refund amount" placeholder="$0.00" value={text} onChangeText={setText} keyboardType="decimal-pad" autoCorrect={false} />
      )}
      {!!problem && <Note tone="error">{problem}</Note>}
      <Button title="Refund" loading={busy} onPress={submit} />
      <Button title="Back" variant="link" disabled={busy} onPress={onBack} style={{ marginTop: 10 }} />
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { gap: 12, marginTop: 12 },
  h: { fontFamily: fonts.heading, fontSize: 18, color: colors.heading },
});
