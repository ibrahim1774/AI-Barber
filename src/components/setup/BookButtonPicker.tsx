import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Card, Note, Row } from '@/components/setup/ui';
import { shortLink, type BookingChoice } from '@/lib/bookingChoice';

const BRAND = Platform.OS === 'web' ? '' : 'Prime Barber ';
export const AIBARBER_DETAIL = `Your ${BRAND}booking page with deposits and reminders.`;
export const DOUBLE_BOOKING_NOTE = "Turn off your old booking app so clients don't double-book.";
export const NO_OWN_NOTE = Platform.OS === 'web' ? 'Your Book button will open your booking page after you publish.' : 'Your Book button will use Prime Barber booking after you publish.';
export const PUBLISH_NOTE = 'Publish your site to update your Book button.';

/**
 * "Your Book button": keep the barber's own booking link or use the built-in scheduler. A choice is shown
 * only when they have their own link; otherwise one line. Switching is one tap and reversible (the
 * own link is never lost).
 */
export function BookButtonPicker({
  own, choice, onChange, onEditLink,
}: {
  own: string | null;
  choice: BookingChoice;
  onChange(c: BookingChoice): void;
  /** Opens the same Book-button sheet the editor uses. */
  onEditLink?(): void;
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
      <Option label="Booking link" detail={shortLink(own)} selected={choice === 'own'} onPress={() => pick('own')} />
      <Option label="Built-in booking" detail={AIBARBER_DETAIL} selected={choice === 'aibarber'} onPress={() => pick('aibarber')} />
      {onEditLink && <Row label="Edit link" detail="Button text and booking link" onPress={onEditLink} />}
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
