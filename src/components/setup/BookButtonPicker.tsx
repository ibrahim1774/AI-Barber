import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Card, Note } from '@/components/setup/ui';
import { shortLink, type BookingChoice } from '@/lib/bookingChoice';

export const AIBARBER_DETAIL = 'Built in: deposits, reminders, your calendar';
export const DOUBLE_BOOKING_NOTE = "Turn off your old booking app so clients don't double-book.";
export const NO_OWN_NOTE = 'Your Book button will use AI Barber booking after you publish.';
export const PUBLISH_NOTE = 'Publish your site to update your Book button.';

/**
 * "Your Book button": keep the barber's own booking link or use AI Barber booking. A choice is shown
 * only when they have their own link; otherwise one line. Switching is one tap and reversible (the
 * own link is never lost).
 */
export function BookButtonPicker({
  own, choice, onChange,
}: {
  own: string | null;
  choice: BookingChoice;
  onChange(c: BookingChoice): void;
}) {
  const [changed, setChanged] = useState(false);
  if (!own) {
    return (
      <Card title="Your Book button">
        <Note>{NO_OWN_NOTE}</Note>
      </Card>
    );
  }
  const pick = (c: BookingChoice) => {
    if (c === choice) return;
    setChanged(true);
    onChange(c);
  };
  return (
    <Card title="Your Book button">
      <Option label="Keep my link" detail={shortLink(own)} selected={choice === 'own'} onPress={() => pick('own')} />
      <Option label="Use AI Barber booking" detail={AIBARBER_DETAIL} selected={choice === 'aibarber'} onPress={() => pick('aibarber')} />
      {choice === 'aibarber' && <Note tone="warn">{DOUBLE_BOOKING_NOTE}</Note>}
      {changed && <Note>{PUBLISH_NOTE}</Note>}
    </Card>
  );
}

function Option({ label, detail, selected, onPress }: { label: string; detail: string; selected: boolean; onPress(): void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={[st.option, selected && st.on]}
    >
      <Text style={st.label}>{label}</Text>
      <Text style={st.detail}>{detail}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  option: { borderWidth: 1, borderColor: colors.hair, borderRadius: 12, padding: 12, marginBottom: 8 },
  on: { borderColor: colors.accent },
  label: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text },
  detail: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 2 },
});
