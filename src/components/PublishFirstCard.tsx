import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';

const COPY = {
  bookings: {
    title: 'Publish your website to unlock Bookings',
    intro: 'Your Bookings tab opens as soon as your website is live. Publish, pick your plan, then set up your booking page.',
    bullets: ['Your own booking page', 'Clients pick a barber and time', 'Deposits and card payments'],
  },
  store: {
    title: 'Publish your website to unlock the Store',
    intro: 'Your Store tab opens as soon as your website is live. Publish, pick your plan, then open your shop.',
    bullets: ['Products with photos', 'Pickup or shipping', 'Card, Cash App and more'],
  },
} as const;

/**
 * Bookings / Store before the website is published: the plan is chosen on the one publish paywall, so this card only
 * leads there (the same path as Settings > Publish). Never shows a price: the paywall does.
 */
export function PublishFirstCard({ kind, onPublish }: { kind: 'bookings' | 'store'; onPublish(): void }) {
  const c = COPY[kind];
  return (
    <View style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">{c.title}</Text>
      <Text style={styles.intro}>{c.intro}</Text>
      <View style={styles.bullets}>
        {c.bullets.map((b) => (
          <Text key={b} style={styles.bullet}>{`•  ${b}`}</Text>
        ))}
      </View>
      <Button title="Publish" onPress={onPublish} style={styles.btn} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch', maxWidth: 460, alignItems: 'center', backgroundColor: colors.sheet, borderRadius: 18,
    borderWidth: 1, borderColor: colors.hair, paddingHorizontal: 22, paddingVertical: 32,
  },
  title: { fontFamily: fonts.heading, fontSize: 22, lineHeight: 28, color: colors.heading, textAlign: 'center', marginBottom: 14 },
  intro: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.heading, textAlign: 'center', marginBottom: 16 },
  bullets: { alignSelf: 'stretch', gap: 8, marginBottom: 24 },
  bullet: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.muted },
  btn: { alignSelf: 'stretch' },
});
