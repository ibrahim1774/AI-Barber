import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Page } from '@/components/Page';
import { afterSession, newPasswordProblem, setNewPassword } from '@/lib/auth';
import { goBackOrHome, resetTo } from '@/lib/nav';
import { LINK_EXPIRED_MESSAGE, parseRecoveryUrl } from '@/lib/recoveryLink';
import { supabase } from '@/lib/supabase';

type Phase = 'checking' | 'form' | 'expired' | 'none';

/**
 * Where the reset email's link lands in the browser. Reads the recovery session from the address (fragment tokens or
 * ?code=), removes it from the address at once, then asks for the new password. An expired or used link says so and
 * offers a new code.
 */
export function WebResetPassword() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [uid, setUid] = useState<string | undefined>();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const link = parseRecoveryUrl(window.location.hash, window.location.search);
    // The token must not stay in the address bar, history or a copied link.
    try { window.history.replaceState(window.history.state, '', window.location.pathname); } catch { /* ignore */ }
    (async () => {
      if (link.kind === 'error') return alive && setPhase('expired');
      if (link.kind === 'none') return alive && setPhase('none');
      try {
        const res = link.kind === 'tokens'
          ? await supabase.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken })
          : await supabase.auth.exchangeCodeForSession(link.code);
        const user = res.data.session?.user;
        if (res.error || !user) return alive && setPhase('expired');
        if (alive) { setUid(user.id); setPhase('form'); }
      } catch {
        if (alive) setPhase('expired');
      }
    })();
    return () => { alive = false; };
  }, []);

  const submit = async () => {
    if (busy) return;
    const problem = newPasswordProblem(password, confirm);
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      await setNewPassword(password);
      await afterSession(uid);
      resetTo('/edit');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Reset password" onBack={goBackOrHome}>
      <View style={st.form}>
        {phase === 'checking' && <Text style={st.body}>Checking your link…</Text>}
        {phase === 'expired' && (
          <>
            <Text style={st.body} accessibilityRole="alert">{LINK_EXPIRED_MESSAGE}</Text>
            <Button variant="solid" title="Request a new code" onPress={() => router.replace('/forgot-password')} />
          </>
        )}
        {phase === 'none' && (
          <>
            <Text style={st.body}>Use Forgot password to get a code, or open the link from your email.</Text>
            <Button variant="solid" title="Forgot password" onPress={() => router.replace('/forgot-password')} />
          </>
        )}
        {phase === 'form' && (
          <>
            <Text style={st.body}>Choose a new password.</Text>
            <Field tone="form" label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" returnKeyType="next" />
            <Field tone="form" label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" returnKeyType="done" onSubmitEditing={() => void submit()} />
            {!!error && <Text style={st.error} accessibilityLiveRegion="polite">{error}</Text>}
            <Button variant="solid" title={busy ? 'Saving...' : 'Save password'} onPress={() => void submit()} loading={busy} />
          </>
        )}
      </View>
    </Page>
  );
}

const st = StyleSheet.create({
  form: { gap: 24 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.text },
  error: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: '#f87171' },
});
