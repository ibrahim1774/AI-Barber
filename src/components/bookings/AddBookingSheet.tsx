import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/EditSheet';
import { Field } from '@/components/Field';
import { ChipRow } from '@/components/bookings/Chips';
import { Label, WhenPicker } from '@/components/bookings/WhenPicker';
import { addBooking, alternativesOf, friendlyBookingError } from '@/lib/bookings/api';
import { formatMoney, formatTime, nextQuarter, startIso, type DateKey } from '@/lib/bookings/calendar';
import { memberName, serviceMinutes, serviceName, servicePrice, type Member, type Service } from '@/lib/bookings/shop';

type Props = {
  visible: boolean;
  tz: string;
  today: DateKey;
  /** The day being viewed, and the barber filter, are the starting choices. */
  day: DateKey;
  defaultMemberId: string | null;
  members: Member[];
  services: Service[];
  onClose(): void;
  onAdded(day: DateKey): Promise<void> | void;
};

/** Walk-in / owner booking: barber, service, time, name, optional phone. */
export function AddBookingSheet({
  visible, tz, today, day: viewed, defaultMemberId, members, services, onClose, onAdded,
}: Props) {
  const [memberId, setMemberId] = useState<string>('');
  const [serviceId, setServiceId] = useState<string>('');
  const [day, setDay] = useState<DateKey>(viewed);
  const [minutes, setMinutes] = useState(9 * 60);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  // Fresh form on each open.
  useEffect(() => {
    if (!visible) return;
    setMemberId(defaultMemberId ?? members[0]?.id ?? '');
    setServiceId(services[0]?.id ?? '');
    setDay(viewed);
    setMinutes(viewed === today ? nextQuarter(Date.now(), tz) : 9 * 60);
    setName('');
    setPhone('');
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const ready = !!memberId && !!serviceId && name.trim().length > 0;

  const save = async () => {
    setBusy(true);
    try {
      await addBooking({
        memberId, serviceId, start: startIso(day, minutes, tz),
        customer: { name: name.trim(), phone: phone.trim() || undefined },
      });
      await onAdded(day);
      onClose();
    } catch (e) {
      const alts = alternativesOf(e);
      const extra = alts.length ? `\n\nNext free: ${alts.map((s) => formatTime(s.start, tz)).join(', ')}` : '';
      Alert.alert("Couldn't add the booking", `${friendlyBookingError(e)}${extra}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} title="Add booking" onClose={onClose}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {members.length > 1 && (
          <>
            <Label>Barber</Label>
            <ChipRow<string> options={members.map((m) => ({ value: m.id, label: memberName(m) }))} value={memberId} onChange={setMemberId} />
          </>
        )}
        <Label>Service</Label>
        {services.length === 0 ? (
          <Text style={styles.empty}>Add a service in Setup first.</Text>
        ) : (
          <ChipRow<string>
            options={services.map((s) => ({
              value: s.id,
              label: `${serviceName(s)} · ${formatMoney(servicePrice(s))} · ${serviceMinutes(s)} min`,
            }))}
            value={serviceId}
            onChange={setServiceId}
          />
        )}
        <WhenPicker today={today} day={day} minutes={minutes} onDay={setDay} onMinutes={setMinutes} />
        <View style={styles.fields}>
          <Field label="Name" tone="form" value={name} onChangeText={setName} autoCapitalize="words" autoComplete="name" returnKeyType="next" />
          <View style={{ height: 14 }} />
          <Field
            label="Phone (optional)" tone="form" value={phone} onChangeText={setPhone}
            keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber"
          />
        </View>
        <Button title="Add booking" loading={busy} disabled={!ready} onPress={() => void save()} style={styles.btn} />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  fields: { marginTop: 18 },
  btn: { marginTop: 20, marginBottom: 8 },
});
