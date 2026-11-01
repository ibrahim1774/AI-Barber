import { useWebPlanActive } from '@/lib/webPlan';
import { fonts } from '@/constants/theme';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { clearResume, paidParam, readResume, stripPaidParam } from '@/lib/webResume';
import { webPublishStatus, adoptWebPublishedBinding } from '@/lib/webAccount.web';
import { supabase } from '@/lib/supabase';
import type { PlanHint } from '@/lib/publishRequest';

/** Server jobs survive this component, redirects, closed tabs, and a different device. */
export function WebPublishRecovery({ onResume }: { onResume(hint?: PlanHint): void }) {
  const active = useWebPlanActive();
  const resume = useRef(onResume); resume.current = onResume;
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fallbackStarted = false;
    let requestRetry = retry > 0;
    const returning = paidParam(window.location.search);
    stripPaidParam();
    if (returning === 'cancelled') { clearResume(); setMessage('Checkout cancelled. Your saved draft is ready whenever you are.'); }
    if (returning === 'paid') setMessage('Confirming payment and publishing your saved website…');
    const check = async () => {
      try {
        const uid = (await supabase.auth.getSession()).data.session?.user.id;
        if (!alive || !uid) return;
        const { intent } = await webPublishStatus(requestRetry);
        requestRetry = false;
        if (!alive) return;
        const pending = readResume(uid);
        if (active && pending?.draftRevision && (!intent || intent.revision < pending.draftRevision) && intent?.status !== 'running') {
          if (!fallbackStarted) { fallbackStarted = true; resume.current(pending.planHint); }
          if (alive) timer = setTimeout(check, 5000);
          return;
        }
        if (intent?.status === 'live') {
          const hadResume = !!readResume(uid);
          clearResume(); setFailed(false);
          // Update before adoption: learning the live binding can remount the editor and remove the return URL.
          setMessage(previous => previous || returning === 'paid' || hadResume
            ? 'Your website is live. Further edits stay in your draft until you publish them.' : '');
          await adoptWebPublishedBinding(uid);
          return;
        }
        if (intent && ['awaiting_payment', 'queued', 'running', 'failed'].includes(intent.status)) {
          setFailed(intent.status === 'failed');
          setMessage(intent.status === 'failed'
            ? 'Your draft is saved. Publishing will retry automatically. You can keep editing and publish your latest changes.'
            : intent.status === 'awaiting_payment' ? 'Your draft is saved. Waiting for payment confirmation…' : 'Publishing your saved website… You can keep editing.');
        } else if (returning === 'paid' && !fallbackStarted) {
          // An existing paid subscriber can land here without a checkout job. Reuse the ordinary publish path.
          fallbackStarted = true;
          const hint = readResume(uid);
          if (hint) resume.current(hint.planHint);
          else setMessage('Your website is saved. Press Publish to put your latest changes online.');
        } else return;
      } catch {
        if (alive) setMessage('Your saved draft is kept. Checking publishing status again…');
      }
      if (alive) timer = setTimeout(check, 5000);
    };
    void check();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [retry, active]);
  if (!message) return null;
  return <View accessibilityLiveRegion="polite" style={{ padding: 12, backgroundColor: '#332911', flexDirection: 'row', gap: 12 }}>
    <Text style={{ color: '#fff', flex: 1, fontFamily: fonts.body, fontSize: 13 }}>{message}</Text>
    {failed && <Pressable accessibilityRole="button" onPress={() => { setFailed(false); setRetry(n => n + 1); }}><Text style={{ color: '#f4a100' }}>Retry publish</Text></Pressable>}
    <Pressable accessibilityRole="button" accessibilityLabel="Dismiss publishing status" onPress={() => setMessage('')}><Text style={{ color: '#fff' }}>×</Text></Pressable>
  </View>;
}
