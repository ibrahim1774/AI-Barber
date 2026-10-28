import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import type { PlanHint } from '@/lib/publishRequest';

const PLANS: { id: PlanHint; name: string; blurb: string }[] = [
  { id: 'website', name: 'Website', blurb: 'Your own website, published and hosted.' },
  { id: 'bookings', name: 'Bookings', blurb: 'Everything in Website, plus your booking page: clients pick a barber and time, with deposits and card payments.' },
  { id: 'store', name: 'Store', blurb: 'Everything in Bookings, plus a shop: products with photos, pickup or shipping, card, Cash App and more.' },
];

/**
 * Bookings / Store before the website is published: the three plans side by side, the tab's plan preselected. It only
 * PICKS a plan: the button hands it to the one publish path (the same as Settings > Publish), whose paywall sells it.
 * Never shows a price: the prices come from the store on that paywall.
 */
export function PublishFirstCard({ kind, onPublish }: { kind: 'bookings' | 'store'; onPublish(plan: PlanHint): void }) {
  const [plan, setPlan] = useState<PlanHint>(kind);
  const chosen = PLANS.find((p) => p.id === plan)!;
  return (
    <View style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">Choose your plan</Text>
      <Text style={styles.intro}>
        {`Pick a plan to publish your website. You'll see the price next, then create your account. ${kind === 'bookings' ? 'Bookings' : 'The Store'} opens as soon as your website is live.`}
      </Text>
      <View style={styles.plans}>
        {PLANS.map((p) => {
          const on = p.id === plan;
          return (
            <Pressable
              key={p.id}
              onPress={() => setPlan(p.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${p.name} plan`}
              style={[styles.plan, on && styles.planOn]}
            >
              <View style={styles.planHead}>
                <View style={[styles.dot, on && styles.dotOn]} />
                <Text style={styles.planName}>{p.name}</Text>
              </View>
              <Text style={styles.planBlurb}>{p.blurb}</Text>
            </Pressable>
          );
        })}
      </View>
      <Button title={`Continue with ${chosen.name}`} onPress={() => onPublish(plan)} style={styles.btn} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch', maxWidth: 460, alignItems: 'center', backgroundColor: colors.sheet, borderRadius: 18,
    borderWidth: 1, borderColor: colors.hair, paddingHorizontal: 18, paddingVertical: 28,
  },
  title: { fontFamily: fonts.heading, fontSize: 22, lineHeight: 28, color: colors.heading, textAlign: 'center', marginBottom: 12 },
  intro: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.heading, textAlign: 'center', marginBottom: 18 },
  plans: { alignSelf: 'stretch', gap: 10, marginBottom: 22 },
  plan: { borderRadius: 14, borderWidth: 1, borderColor: colors.hair, paddingHorizontal: 14, paddingVertical: 12 },
  planOn: { borderColor: colors.accent, borderWidth: 2, paddingHorizontal: 13, paddingVertical: 11 },
  planHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.muted },
  dotOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  planName: { fontFamily: fonts.heading, fontSize: 17, color: colors.heading },
  planBlurb: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },
  btn: { alignSelf: 'stretch' },
});
