import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { supabase } from '@/lib/supabase';
import { flushWebAutosave } from '@/lib/webAutosave';
import { setResume } from '@/lib/webResume';
import { appStoreNotice, isStripeUrl, checkoutFailure, CHECKOUT_RETRY_MESSAGE, PROCESSING_MESSAGE } from '@/lib/webBilling';

// The web app's plan screen (the iOS app shows Superwall's paywall here). Same plans and prices as iOS;
// Continue opens Stripe Checkout, and Stripe returns to /app/edit once paid.
type Tier = 'website' | 'bookings' | 'store';
type Interval = 'month' | 'year';

const PLANS: { tier: Tier; name: string; month: string; year: string; bullets: string[] }[] = [
  { tier: 'website', name: 'Website', month: '$19.99', year: '$191.99', bullets: ['Your own custom website, hosted for you', 'Edit your services, text and photos anytime', 'Live in about a minute, no coding'] },
  { tier: 'bookings', name: 'Bookings', month: '$24.99', year: '$239.99', bullets: ['Everything in Website', 'Your own booking scheduler built in', 'Clients book online, you manage every appointment'] },
  { tier: 'store', name: 'Store', month: '$39.99', year: '$379.99', bullets: ['Everything in Bookings', 'Add and sell your own products', 'Your own online store with payments built in'] },
];

const BASE = process.env.EXPO_PUBLIC_API_BASE ?? 'https://www.aibarber.org';

// The plan screen is for the browser only. As a route it also exists in the phone app (aibarber://web-paywall): there it
// shows nothing, never lists Stripe prices and never calls checkout.
export default function WebPaywallRoute() {
  if (Platform.OS !== 'web') return <Redirect href="/" />;
  return <WebPaywall />;
}

function WebPaywall() {
  const insets = useSafeAreaInsets();
  // Closing the screen (Not now / back) tells the publish flow the paywall was declined.
  useEffect(() => () => { (require('expo-superwall') as { __dismissWebPaywall?: () => void }).__dismissWebPaywall?.(); }, []);
  // Opened from a locked Bookings or Store tab: start on that plan.
  const [tier, setTier] = useState<Tier>(() => {
    const placement = (typeof window !== 'undefined' ? (window as unknown as { __webPaywall?: { placement?: string } }).__webPaywall?.placement : '') ?? '';
    return placement === 'store_upgrade' ? 'store' : placement === 'bookings_upgrade' ? 'bookings' : 'website';
  });
  const [interval, setIntervalValue] = useState<Interval>('month');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Set when the server says a payment is still settling: shows "Check again" (re-reads /me, never the portal).
  const [processing, setProcessing] = useState(false);
  // Set when the account already pays through the App Store: replaces the pay buttons.
  const [appStore, setAppStore] = useState('');

  async function readMe(): Promise<{ entitled?: boolean; appStore?: unknown } | null> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const r = await fetch(`${BASE}/api/web-app/me`, { headers: { Authorization: `Bearer ${token}` } });
    return r.ok ? await r.json().catch(() => null) : null;
  }

  useEffect(() => {
    let alive = true;
    readMe().then((me) => { const n = me ? appStoreNotice(me.appStore) : null; if (alive && n) setAppStore(n); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  async function checkAgain() {
    setBusy(true);
    setError('');
    try {
      const me = await readMe();
      if (!me) { setError("Couldn't check your account right now. Try again in a moment."); return; }
      const n = appStoreNotice(me.appStore);
      if (n) { setAppStore(n); setProcessing(false); return; }
      if (me.entitled) { if (Platform.OS === 'web') window.location.assign('/app/edit?paid=1'); return; }
      // Not paid yet: say so, and bring "Continue to checkout" back (an abandoned session must not be a dead end).
      setProcessing(false);
      setError(PROCESSING_MESSAGE);
    } catch {
      setError("Couldn't check your account right now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function go() {
    setBusy(true);
    setError('');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) { router.replace('/sign-in' as never); return; }
      const r = await fetch(`${BASE}/api/web-app/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ tier, interval }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        const f = checkoutFailure(r.status, body?.error);
        if (f.kind === 'portal') {
          const p = await fetch(`${BASE}/api/web-app/portal`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
          const pb = await p.json().catch(() => ({}));
          if (isStripeUrl(pb.url)) { await flushWebAutosave(); window.location.assign(pb.url); return; }
          setError(CHECKOUT_RETRY_MESSAGE);
        } else if (f.kind === 'app-store') setAppStore(f.message);
        else { setProcessing(f.kind === 'processing'); setError(f.message); }
        return;
      }
      if (!r.ok || !isStripeUrl(body.url)) throw new Error('checkout');
      // The page is about to unload: put the latest draft on the account first, and remember that a publish was under
      // way so the editor can finish it when Stripe sends the customer back.
      await flushWebAutosave();
      setResume(tier);
      window.location.assign(body.url);
    } catch {
      setError(CHECKOUT_RETRY_MESSAGE);
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
          <Text style={styles.price}>{interval === 'month' ? p.month : p.year}  <Text style={styles.cycle}>{interval === 'month' ? 'Monthly plan' : 'Yearly plan'}</Text></Text>
          {p.bullets.map((b) => (
            <View key={b} style={styles.bulletRow}>
              <Text style={styles.check}>✓</Text>
              <Text style={styles.bullet}>{b}</Text>
            </View>
          ))}
        </Pressable>
      ))}
      {appStore ? <Text accessibilityRole="alert" style={styles.notice}>{appStore}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {appStore ? null : processing ? (
        <Button variant="solid" title={busy ? 'Checking…' : 'Check again'} onPress={checkAgain} disabled={busy} style={styles.cta} />
      ) : (
        <Button variant="solid" title={busy ? 'Opening checkout…' : 'Continue to checkout'} onPress={go} disabled={busy} style={styles.cta} />
      )}
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
  cycle: { color: colors.body, fontFamily: fonts.body, fontSize: 12 },
  bulletRow: { flexDirection: 'row', marginTop: 6, paddingRight: 8 },
  check: { color: colors.accent, fontFamily: fonts.bodyMedium, fontSize: 13, width: 18 },
  bullet: { color: colors.text, fontFamily: fonts.body, fontSize: 13, flex: 1, lineHeight: 18 },
  error: { color: colors.danger, fontFamily: fonts.body, fontSize: 13, textAlign: 'center', marginBottom: 8 },
  notice: { color: colors.heading, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 12, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.ghostBorder, backgroundColor: colors.ghostBg },
  cta: { marginTop: 12 },
});
