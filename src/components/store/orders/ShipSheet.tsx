import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Input, Note } from '@/components/setup/ui';
import { colors, fonts } from '@/constants/theme';

export type Tracking = { trackingNumber?: string; trackingUrl?: string };

/** Pure: the tracking fields as the server accepts them (number ≤ 64, link https:// ≤ 500). Error text or null. */
export function trackingProblem(t: Tracking): string | null {
  if ((t.trackingNumber ?? '').trim().length > 64) return 'The tracking number can be up to 64 characters.';
  const url = (t.trackingUrl ?? '').trim();
  if (url && (!/^https:\/\//i.test(url) || url.length > 500)) return 'The tracking link must start with https:// .';
  return null;
}

/** The "Mark shipped" panel inside the order sheet. Tracking is optional. */
export function ShipSheet({
  busy, onSubmit, onBack,
}: { busy: boolean; onSubmit(t: Tracking): void; onBack(): void }) {
  const [number, setNumber] = useState('');
  const [url, setUrl] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = () => {
    const p = trackingProblem({ trackingNumber: number, trackingUrl: url });
    setProblem(p);
    if (!p) onSubmit({ trackingNumber: number.trim(), trackingUrl: url.trim() });
  };

  return (
    <View style={st.wrap}>
      <Text style={st.h}>Mark as shipped</Text>
      <Note>The customer gets a "shipped" email. Add tracking if you have it.</Note>
      <Input label="Tracking number" placeholder="Tracking number (optional)" value={number} onChangeText={setNumber} autoCapitalize="characters" autoCorrect={false} />
      <Input label="Tracking link" placeholder="https://… (optional)" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      {!!problem && <Note tone="error">{problem}</Note>}
      <Button title="Mark shipped" loading={busy} onPress={submit} />
      <Button title="Back" variant="link" disabled={busy} onPress={onBack} style={{ marginTop: 10 }} />
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { gap: 12, marginTop: 12 },
  h: { fontFamily: fonts.heading, fontSize: 18, color: colors.heading },
});
