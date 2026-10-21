import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/EditSheet';
import { Field } from '@/components/Field';
import { Chip, ChipRow } from '@/components/bookings/Chips';
import { DayChips, Label, TimeChips } from '@/components/bookings/WhenPicker';
import { blockTime, cancelBooking, friendlyBookingError, type TimeOffConflict } from '@/lib/bookings/api';
import { blockRange, formatDay, formatTime, type DateKey } from '@/lib/bookings/calendar';
import { memberName, type Member } from '@/lib/bookings/shop';

type Props = {
  visible: boolean;
  tz: string;
  today: DateKey;
  day: DateKey;
  defaultMemberId: string | null;
  members: Member[];
  onClose(): void;
  onBlocked(): Promise<void> | void;
};

/** Block time: barber, a day, all day or from/to, optional reason. */
export function BlockTimeSheet({ visible, tz, today, day: viewed, defaultMemberId, members, onClose, onBlocked }: Props) {
  const [memberId, setMemberId] = useState('');
  const [day, setDay] = useState<DateKey>(viewed);
  const [allDay, setAllDay] = useState(false);
  const [from, setFrom] = useState(12 * 60);
  const [to, setTo] = useState(13 * 60);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setMemberId(defaultMemberId ?? members[0]?.id ?? '');
    setDay(viewed);
    setAllDay(false);
    setFrom(12 * 60);
    setTo(13 * 60);
    setReason('');
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const range = blockRange(day, tz, allDay, from, to);

  const finish = async () => {
    await onBlocked();
    onClose();
  };

  /** The time off is saved; existing bookings inside it stay unless the barber says otherwise. */
  const askAboutConflicts = (conflicts: TimeOffConflict[]) => {
    const list = conflicts.map((c) => `${c.customerName?.trim() || 'Walk-in'} (${formatTime(c.start, tz)})`).join(', ');
    Alert.alert(
      `${conflicts.length} booking${conflicts.length === 1 ? '' : 's'} in this time`,
      `${list}\n\nCancel ${conflicts.length === 1 ? 'it' : 'them'}? Customers get an email and a refund if they paid by card.`,
      [
        { text: 'Keep them', style: 'cancel', onPress: () => void finish() },
        {
          text: 'Cancel them',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              for (const c of conflicts) await cancelBooking(c.id);
            } catch (e) {
              Alert.alert("Couldn't cancel them all", friendlyBookingError(e));
            } finally {
              setBusy(false);
            }
            await finish();
          },
        },
      ],
    );
  };

  const save = async () => {
    if (!range || !memberId) return;
    setBusy(true);
    try {
      const { conflicts } = await blockTime({ memberId, start: range.start, end: range.end, reason: reason.trim() || undefined });
      if (conflicts.length) askAboutConflicts(conflicts);
      else await finish();
    } catch (e) {
      Alert.alert("Couldn't block that time", friendlyBookingError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} title="Block time" onClose={onClose}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {members.length > 1 && (
          <>
            <Label>Barber</Label>
            <ChipRow<string> options={members.map((m) => ({ value: m.id, label: memberName(m) }))} value={memberId} onChange={setMemberId} />
          </>
        )}
        <Label>Day</Label>
        <DayChips today={today} value={day} onChange={setDay} />
        <Label>When</Label>
        <Chip label={`All day (${formatDay(day)})`} on={allDay} onPress={() => setAllDay((v) => !v)} />
        {!allDay && (
          <>
            <Label>From</Label>
            <TimeChips value={from} onChange={(m) => { setFrom(m); if (to <= m) setTo(Math.min(m + 60, 24 * 60)); }} />
            <Label>To</Label>
            <TimeChips value={to} onChange={setTo} from={6 * 60} to={24 * 60} />
          </>
        )}
        <View style={styles.reason}>
          <Field
            label="Reason (optional)" tone="form" value={reason} onChangeText={setReason}
            placeholder="Lunch, appointment, day off"
          />
        </View>
        <Button title="Block time" loading={busy} disabled={!range || !memberId} onPress={() => void save()} style={styles.btn} />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  reason: { marginTop: 18 },
  btn: { marginTop: 20, marginBottom: 8 },
});
