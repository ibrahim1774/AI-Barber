import { webDraftsEnabled } from '@/lib/webReliability';
import { WebPublishRecovery } from './WebPublishRecovery.web';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import type { PlanHint } from '@/lib/publishRequest';
import { supabase } from '@/lib/supabase';
import { useWebPlanActive } from '@/lib/webPlan';
import { clearResume, paidParam, readResume, stripPaidParam, takeResume } from '@/lib/webResume';

export const RETURN_COPY = {
  waiting: 'Payment received. Finishing your publish…',
  slow: "Your payment is still being confirmed. Tap Publish in a minute, you won't be charged twice.",
  cancelled: "Checkout cancelled, your site is saved. Tap Publish whenever you're ready.",
  received: 'Payment received. Tap Publish to put your site online.',
} as const;
type Kind = keyof typeof RETURN_COPY;
const WAIT_MS = 60_000;

// The return from Stripe is handled once per page load, however often the editor remounts.
let handled = false;
let paidReturn = false;
let cancelledReturn = false;

/**
 * Non-blocking note at the top of the editor after Stripe Checkout. Paid: wait (up to 60 s) for the plan to turn on, then
 * run the publish that was under way (the normal publish path, which skips the paywall now that the plan is active).
 * Cancelled: say the site is saved. The draft is never touched here.
 */
export function StripeReturn(props: { onResume(hint?: PlanHint): void }) {
  return webDraftsEnabled() ? <WebPublishRecovery {...props} /> : <LegacyStripeReturn {...props} />;
}

function LegacyStripeReturn({ onResume }: { onResume(hint?: PlanHint): void }) {
  const active = useWebPlanActive();
  const [kind, setKind] = useState<Kind | null>(null);
  const resume = useRef(onResume);
  resume.current = onResume;

  useEffect(() => {
    if (handled) return;
    handled = true;
    const p = paidParam(window.location.search);
    if (p === 'cancelled') { clearResume(); cancelledReturn = true; setKind('cancelled'); }
    else if (p === 'paid') { paidReturn = true; setKind('waiting'); }
    stripPaidParam();
  }, []);

  // Not entitled yet after a paid return: give the webhook up to a minute.
  useEffect(() => {
    if (!paidReturn || active) return;
    const t = setTimeout(() => setKind((k) => (k === 'waiting' ? 'slow' : k)), WAIT_MS);
    return () => clearTimeout(t);
  }, [active]);

  // The plan is on: finish the publish (one-shot), or just say the payment arrived.
  useEffect(() => {
    if (!active || cancelledReturn) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    void supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      const uid = data.session?.user?.id;
      if (!paidReturn && !readResume(uid)) return;
      const r = takeResume(uid); // another account's flag is ignored and cleared here
      const wasPaidReturn = paidReturn;
      paidReturn = false; // handled: a later Editor mount in this page load must not show it again
      if (!r) { if (wasPaidReturn) setKind('received'); return; }
      setKind('waiting');
      t = setTimeout(() => resume.current(r.planHint), 400);
    });
    return () => { alive = false; if (t) clearTimeout(t); };
  }, [active]);

  // Messages that need no action fade away.
  useEffect(() => {
    if (kind !== 'cancelled' && kind !== 'received' && !(kind === 'waiting' && active)) return;
    const t = setTimeout(() => setKind(null), kind === 'waiting' ? 8000 : 12000);
    return () => clearTimeout(t);
  }, [kind, active]);

  if (!kind) return null;
  return (
    <View style={st.bar} accessibilityRole="alert">
      <Text style={st.text}>{RETURN_COPY[kind]}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8} onPress={() => setKind(null)}>
        <Text style={st.x}>×</Text>
      </Pressable>
    </View>
  );
}

/** Test hook. */
export function __resetStripeReturn(): void { handled = false; paidReturn = false; cancelledReturn = false; }

const st = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: 'rgba(244,161,0,0.16)', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(244,161,0,0.4)' },
  text: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 18, color: colors.text },
  x: { fontFamily: fonts.body, fontSize: 18, lineHeight: 18, color: colors.text },
});
