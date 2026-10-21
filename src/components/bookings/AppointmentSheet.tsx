import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/EditSheet';
import { StatusChip } from '@/components/bookings/AppointmentRow';
import { Label, WhenPicker } from '@/components/bookings/WhenPicker';
import {
  alternativesOf, cancelBooking, friendlyBookingError, markDone, markNoShow, markPaid, rescheduleBooking,
} from '@/lib/bookings/api';
import {
  REBOOK_MESSAGE, availableActions, dayKey, formatDay, formatMoney, formatTime, minutesOfDay, smsUrl, startIso,
  telUrl, type Appointment, type DateKey,
} from '@/lib/bookings/calendar';

type Props = {
  appt: Appointment | null;
  tz: string;
  today: DateKey;
  barberName?: string;
  /** The shop's booking link, for the "Text rebook link" message. */
  bookingLink: string;
  /** Lapsed subscription: details only, no changes. */
  readOnly: boolean;
  onClose(): void;
  /** Reload the day after a change. */
  onChanged(): Promise<void> | void;
};

const PAY_LABEL: Record<string, string> = {
  none: 'Not paid', awaiting: 'Awaiting payment', deposit: 'Deposit paid', paid: 'Paid',
  refunded: 'Refunded', partially_refunded: 'Partly refunded',
};

export function AppointmentSheet({ appt, tz, today, barberName, bookingLink, readOnly, onClose, onChanged }: Props) {
  const last = useRef<Appointment | null>(null);
  if (appt) last.current = appt;
  const a = appt ?? last.current;
  const [mode, setMode] = useState<'detail' | 'reschedule'>('detail');
  const [busy, setBusy] = useState(false);
  const [day, setDay] = useState<DateKey>(today);
  const [minutes, setMinutes] = useState(9 * 60);

  const id = appt?.id;
  useEffect(() => {
    setMode('detail');
    setBusy(false);
  }, [id]);

  const startReschedule = () => {
    if (!a) return;
    setDay(dayKey(a.start, tz));
    setMinutes(minutesOfDay(a.start, tz));
    setMode('reschedule');
  };

  const close = () => {
    setMode('detail');
    onClose();
  };

  const run = async (work: () => Promise<unknown>, after?: 'close') => {
    setBusy(true);
    try {
      await work();
      await onChanged();
      if (after === 'close') close();
    } catch (e) {
      const alts = alternativesOf(e);
      const extra = alts.length ? `\n\nNext free: ${alts.map((s) => formatTime(s.start, tz)).join(', ')}` : '';
      Alert.alert("Couldn't do that", `${friendlyBookingError(e)}${extra}`);
    } finally {
      setBusy(false);
    }
  };

  const confirmCancel = () => {
    if (!a) return;
    const card = a.paymentMethod === 'card' && a.amountPaidCents > 0;
    Alert.alert(
      'Cancel this booking?',
      `${a.customerName?.trim() || 'The customer'} will get an email${card ? ' and a full refund' : ''}.`,
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Cancel booking', style: 'destructive', onPress: () => void run(() => cancelBooking(a.id), 'close') },
      ],
    );
  };

  const confirmNoShow = () => {
    if (!a) return;
    Alert.alert('Mark as no-show?', 'This does not refund anything.', [
      { text: 'Back', style: 'cancel' },
      { text: 'No-show', style: 'destructive', onPress: () => void run(() => markNoShow(a.id)) },
    ]);
  };

  const open = (url: string) => Linking.openURL(url).catch(() => Alert.alert("Couldn't open that."));

  if (!a) return <Sheet visible={false} title="" onClose={onClose}>{null}</Sheet>;
  const can = availableActions(a);
  const actions = !readOnly;
  const who = a.customerName?.trim() || 'Walk-in';

  return (
    <Sheet visible={!!appt} title={mode === 'reschedule' ? 'Reschedule' : 'Booking'} onClose={close}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.head}>
          <Text style={styles.name} numberOfLines={2}>{who}</Text>
          <StatusChip appt={a} />
        </View>
        <Text style={styles.when}>
          {formatDay(dayKey(a.start, tz))} · {formatTime(a.start, tz)} to {formatTime(a.end, tz)}
        </Text>

        {mode === 'reschedule' ? (
          <View>
            <WhenPicker today={today} day={day} minutes={minutes} onDay={setDay} onMinutes={setMinutes} />
            <Text style={styles.note}>{who} gets an email with the new time.</Text>
            <Button
              title="Move booking"
              loading={busy}
              onPress={() => void run(() => rescheduleBooking(a.id, startIso(day, minutes, tz)), 'close')}
              style={styles.gap}
            />
            <Button title="Back" variant="link" onPress={() => setMode('detail')} style={styles.gap} />
          </View>
        ) : (
          <View>
            {(can.call || can.text) && (
              <View style={styles.pair}>
                {can.call && <Button title="Call" variant="pill" onPress={() => open(telUrl(a.customerPhone!))} style={styles.half} />}
                {can.text && <Button title="Text" variant="pill" onPress={() => open(smsUrl(a.customerPhone!))} style={styles.half} />}
              </View>
            )}

            <Label>Details</Label>
            <Detail k="Service" v={a.serviceName} />
            {barberName ? <Detail k="Barber" v={barberName} /> : null}
            <Detail k="Price" v={formatMoney(a.priceCents)} />
            <Detail k="Payment" v={PAY_LABEL[a.paymentStatus] ?? a.paymentStatus} />
            {a.customerSaysPaidAt && a.paymentStatus !== 'paid' ? <Detail k="Note" v="Customer says they paid" /> : null}
            {a.customerPhone ? <Detail k="Phone" v={a.customerPhone} /> : null}
            {a.customerEmail ? <Detail k="Email" v={a.customerEmail} /> : null}
            {a.note ? <Detail k="Note" v={a.note} /> : null}

            {actions && (
              <View style={styles.actions}>
                {can.markDone && <Button title="Done" loading={busy} onPress={() => void run(() => markDone(a.id))} />}
                {can.rebind && (
                  <Button
                    title="Text rebook link"
                    onPress={() => open(smsUrl(a.customerPhone!, REBOOK_MESSAGE(bookingLink)))}
                    variant="ghost"
                    style={styles.gap}
                  />
                )}
                {can.markPaid && (
                  <Button title="Mark paid" variant="ghost" disabled={busy} onPress={() => void run(() => markPaid(a))} style={styles.gap} />
                )}
                {can.noShow && <Button title="No-show" variant="ghost" disabled={busy} onPress={confirmNoShow} style={styles.gap} />}
                {can.reschedule && <Button title="Reschedule" variant="ghost" disabled={busy} onPress={startReschedule} style={styles.gap} />}
                {can.cancel && <Button title="Cancel booking" variant="link" disabled={busy} onPress={confirmCancel} style={styles.gap} />}
              </View>
            )}
            {!actions && <Text style={styles.note}>Resubscribe to change bookings.</Text>}
          </View>
        )}
      </ScrollView>
    </Sheet>
  );
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  name: { flex: 1, fontFamily: fonts.heading, fontSize: 22, color: colors.heading },
  when: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.accent, marginTop: 6 },
  pair: { flexDirection: 'row', gap: 10, marginTop: 16 },
  half: { flex: 1 },
  detail: {
    flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hair,
  },
  k: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  v: { flexShrink: 1, fontFamily: fonts.bodySemi, fontSize: 14, color: colors.text, textAlign: 'right' },
  actions: { marginTop: 20, marginBottom: 8 },
  gap: { marginTop: 10 },
  note: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 14, textAlign: 'center' },
});
