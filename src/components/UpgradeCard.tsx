import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { useEntitlements } from '@/lib/entitlements';
import { MoveSubscriptionButton } from '@/components/MoveSubscriptionButton';
import { otherAccountPlanMessage } from '@/lib/claimCopy';

const COPY = {
  bookings: {
    title: 'Take bookings online',
    bullets: ['Your own booking page', 'Clients pick a barber and time', 'Deposits and card payments'],
    button: 'See the Bookings plan',
  },
  store: {
    title: 'Sell from your website',
    bullets: ['Products with photos', 'Pickup or shipping', 'Card, Cash App and more'],
    button: 'See the Store plan',
  },
} as const;

/** What a plan adds, with the button that opens its paywall. Never shows a price: the paywall does. */
export function UpgradeCard({ kind, onUpgrade, busy }: { kind: 'bookings' | 'store'; onUpgrade(): void; busy?: boolean }) {
  const c = COPY[kind];
  const ents = useEntitlements();
  // Paid on this Apple ID, but by another account: buying again here would not help, so say whose it is.
  if (ents.account === 'other') {
    return (
      <View style={styles.card}>
        <Text style={styles.title} accessibilityRole="header">{c.title}</Text>
        <Text style={styles.bullet}>{otherAccountPlanMessage(ents.hint)}</Text>
        <MoveSubscriptionButton style={styles.move} />
      </View>
    );
  }
  return (
    <View style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">{c.title}</Text>
      <View style={styles.bullets}>
        {c.bullets.map((b) => (
          <Text key={b} style={styles.bullet}>{`•  ${b}`}</Text>
        ))}
      </View>
      <Button title={c.button} onPress={onUpgrade} loading={busy} style={styles.btn} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch', maxWidth: 460, alignItems: 'center', backgroundColor: colors.sheet, borderRadius: 18,
    borderWidth: 1, borderColor: colors.hair, paddingHorizontal: 22, paddingVertical: 32,
  },
  title: { fontFamily: fonts.heading, fontSize: 22, lineHeight: 28, color: colors.heading, textAlign: 'center', marginBottom: 14 },
  bullets: { alignSelf: 'stretch', gap: 8, marginBottom: 24 },
  bullet: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.muted },
  btn: { alignSelf: 'stretch' },
  move: { marginTop: 18 },
});
