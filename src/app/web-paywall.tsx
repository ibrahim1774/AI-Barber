import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { supabase } from '@/lib/supabase';

// The web app's plan screen (the iOS app shows Superwall's paywall here). Same plans and prices as iOS;
// Continue opens Stripe Checkout, and Stripe returns to /app/edit once paid.
type Tier = 'website' | 'bookings' | 'store';
type Interval = 'month' | 'year';

const PLANS: { tier: Tier; name: string; blurb: string; month: string; year: string }[] = [
  { tier: 'website', name: 'Website', blurb: 'Your site, hosted, edit anytime', month: '$19.99/month', year: '$191.99/year' },
  { tier: 'bookings', name: 'Bookings', blurb: 'Website + online booking for your clients', month: '$24.99/month', year: '$239.99/year' },
  { tier: 'store', name: 'Store', blurb: 'Bookings + sell products with payments', month: '$39.99/month', year: '$379.99/year' },
];

const BASE = process.env.EXPO_PUBLIC_API_BASE ?? 'https://www.aibarber.org';

export default function WebPaywall() {
  const insets = useSafeAreaInsets();
  // Closing the screen (Not now / back) tells the publish flow the paywall was declined.
  useEffect(() => () => { (require('expo-superwall') as { __dismissWebPaywall?: () => void }).__dismissWebPaywall?.(); }, []);
  const [tier, setTier] = useState<Tier>('website');
  const [interval, setIntervalValue] = useState<Interval>('month');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true);
    setError('');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) { router.replace('/sign-in' as never); return; }
      const r = await fetch(`${BASE}/api/web-app/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ tier, interval }) });
      const body = await r.json().catch(() => ({}));
      if (r.status === 409) {
        const p = await fetch(`${BASE}/api/web-app/portal`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
        const pb = await p.json().catch(() => ({}));
        if (pb.url) { if (Platform.OS === 'web') window.location.assign(pb.url); return; }
      }
      if (!r.ok || !body.url) throw new Error('checkout');
      if (Platform.OS === 'web') window.location.assign(body.url);
    } catch {
      setError("We couldn't open checkout. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 }]}>
      <Text style={styles.title}>Publish your website</Text>
      <Text style={styles.sub}>Pick a plan. Cancel anytime from Settings.</Text>
      <View style={styles.toggle}>
        {(['month', 'year'] as Interval[]).map((i) => (
          <Pressable key={i} accessibilityRole="button" onPress={() => setIntervalValue(i)} style={[styles.toggleBtn, interval === i && styles.toggleOn]}>
            <Text style={[styles.toggleText, interval === i && styles.toggleTextOn]}>{i === 'month' ? 'Monthly' : 'Yearly'}</Text>
          </Pressable>
        ))}
      </View>
      {PLANS.map((p) => (
        <Pressable key={p.tier} accessibilityRole="button" onPress={() => setTier(p.tier)} style={[styles.card, tier === p.tier && styles.cardOn]}>
          <Text style={styles.name}>{p.name}</Text>
          <Text style={styles.price}>{interval === 'month' ? p.month : p.year}</Text>
          <Text style={styles.blurb}>{p.blurb}</Text>
        </Pressable>
      ))}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button variant="solid" title={busy ? 'Opening checkout…' : 'Continue to checkout'} onPress={go} disabled={busy} style={styles.cta} />
      <Button variant="ghost" title="Not now" onPress={() => router.back()} style={styles.cta} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 20, maxWidth: 520, width: '100%', alignSelf: 'center' },
  title: { color: colors.heading, fontFamily: fonts.heading, fontSize: 28, textAlign: 'center' },
  sub: { color: colors.body, fontFamily: fonts.body, fontSize: 14, textAlign: 'center', marginTop: 8, marginBottom: 20 },
  toggle: { flexDirection: 'row', alignSelf: 'center', borderRadius: 999, borderWidth: 1, borderColor: colors.ghostBorder, marginBottom: 20, padding: 3 },
  toggleBtn: { paddingVertical: 8, paddingHorizontal: 20, borderRadius: 999 },
  toggleOn: { backgroundColor: colors.accent },
  toggleText: { color: colors.text, fontFamily: fonts.bodyMedium, fontSize: 14 },
  toggleTextOn: { color: colors.accentInk },
  card: { borderWidth: 1, borderColor: colors.ghostBorder, borderRadius: 16, padding: 16, marginBottom: 12, backgroundColor: colors.ghostBg },
  cardOn: { borderColor: colors.accent, borderWidth: 2 },
  name: { color: colors.heading, fontFamily: fonts.heading, fontSize: 18 },
  price: { color: colors.accent, fontFamily: fonts.bodyMedium, fontSize: 16, marginTop: 4 },
  blurb: { color: colors.body, fontFamily: fonts.body, fontSize: 13, marginTop: 4 },
  error: { color: colors.danger, fontFamily: fonts.body, fontSize: 13, textAlign: 'center', marginBottom: 8 },
  cta: { marginTop: 12 },
});
