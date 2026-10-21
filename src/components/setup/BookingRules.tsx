import { useState } from 'react';
import { Alert } from 'react-native';
import { updateShopSettings, type Shop, type ShopSettings } from '@/lib/shop';
import { Button } from '@/components/Button';
import { Card, Chip, Chips, Input, Label, Note, ToggleRow } from '@/components/setup/ui';

export const LEAD_DAYS = [7, 14, 30, 60, 90];
export const NOTICE_MIN = [0, 30, 60, 120, 240, 1440];
export const BUFFER_MIN = [0, 5, 10, 15, 30];
export const CUTOFF_MIN = [0, 60, 120, 240, 1440];
export const STEP_CHOICES: (number | null)[] = [null, 15, 30, 60];

export function minutesText(min: number): string {
  if (min === 0) return 'None';
  if (min % 1440 === 0) return `${min / 1440} day${min === 1440 ? '' : 's'}`;
  if (min % 60 === 0) return `${min / 60} hr`;
  return `${min} min`;
}

/** Advanced: the shop's booking rules (columns the app may write on ab_shops). */
export function BookingRules({ shop, onSaved }: { shop: Shop; onSaved(): void }) {
  const [lead, setLead] = useState(shop.leadDays);
  const [notice, setNotice] = useState(shop.minNoticeMin);
  const [buffer, setBuffer] = useState(shop.bufferMin);
  const [cutoff, setCutoff] = useState(shop.cancelCutoffMin);
  const [step, setStep] = useState<number | null>(shop.slotStepMin);
  const [daily, setDaily] = useState(shop.dailySummary);
  const [address, setAddress] = useState(shop.address);
  const [phone, setPhone] = useState(shop.phone);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const patch: ShopSettings = {
      leadDays: lead, minNoticeMin: notice, bufferMin: buffer, cancelCutoffMin: cutoff, slotStepMin: step,
      dailySummary: daily, address: address.trim(), phone: phone.trim(),
    };
    setBusy(true);
    try {
      await updateShopSettings(shop.id, patch);
      onSaved();
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card title="How far ahead">
        <Label>Customers can book up to</Label>
        <Chips>{LEAD_DAYS.map((d) => <Chip key={d} label={`${d} days`} selected={lead === d} onPress={() => setLead(d)} />)}</Chips>
        <Label>Shortest notice</Label>
        <Chips>{NOTICE_MIN.map((m) => <Chip key={m} label={minutesText(m)} selected={notice === m} onPress={() => setNotice(m)} />)}</Chips>
      </Card>
      <Card title="Slots">
        <Label>Gap between appointments</Label>
        <Chips>{BUFFER_MIN.map((m) => <Chip key={m} label={minutesText(m)} selected={buffer === m} onPress={() => setBuffer(m)} />)}</Chips>
        <Label>Start times every</Label>
        <Chips>
          {STEP_CHOICES.map((m) => (
            <Chip key={String(m)} label={m == null ? 'Service length' : `${m} min`} selected={step === m} onPress={() => setStep(m)} />
          ))}
        </Chips>
      </Card>
      <Card title="Cancelling">
        <Label>Customers can cancel up to</Label>
        <Chips>{CUTOFF_MIN.map((m) => <Chip key={m} label={m === 0 ? 'Any time' : `${minutesText(m)} before`} selected={cutoff === m} onPress={() => setCutoff(m)} />)}</Chips>
        <Note>Before the cutoff, card payments are refunded in full. After it, you keep any deposit.</Note>
      </Card>
      <Card title="Shop details on your booking page">
        <Input label="Address" value={address} onChangeText={setAddress} placeholder="Street, city" />
        <Input label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="Phone" />
      </Card>
      <Card>
        <ToggleRow label="Morning summary" detail="A notification at 8:00 with the day's bookings" value={daily} onValueChange={setDaily} />
      </Card>
      <Button title="Save" onPress={() => void save()} loading={busy} />
    </>
  );
}
