import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Page } from '@/components/Page';
import { requestPasswordReset } from '@/lib/auth';
import { goBackOrHome } from '@/lib/nav';
import { cooldownLeft } from '@/lib/recovery';

/**
 * "Forgot password?": one email field. The link Supabase sends opens
 * /reset-password in this app. The confirmation is the same whether or not
 * the account exists; Resend waits 60 s between emails.
 */
export default function ForgotPassword() {
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // The address the last email went to, and when (for the cooldown).
  const [sent, setSent] = useState<{ to: string; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const left = cooldownLeft(sent?.at ?? null, now);

  useEffect(() => {
    if (error) AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

  // Ticks only while the cooldown runs.
  useEffect(() => {
    if (!sent || left <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sent, left]);

  const send = async (to: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await requestPasswordReset(to);
      const at = Date.now();
      setSent({ to: to.trim(), at });
      setNow(at);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Page title="Reset password" onBack={goBackOrHome}>
      {sent ? (
        <View style={styles.form}>
          <Text style={styles.body} accessibilityLiveRegion="polite">
            If an account exists for {sent.to}, we&apos;ve sent a reset link. Open the email on this iPhone and tap the link.
          </Text>
          {!!error && (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}
          <Button
            variant="ghost"
            title={left > 0 ? `Resend in ${left}s` : busy ? 'Sending...' : 'Resend'}
            onPress={() => void send(sent.to)}
            disabled={left > 0}
            loading={busy}
          />
          <Button variant="link" title="Use a different email" onPress={() => { setSent(null); setError(''); }} />
        </View>
      ) : (
        <View style={styles.form}>
          <Text style={styles.body}>Enter the email you signed up with and we&apos;ll send you a link to choose a new password.</Text>
          <Field
            tone="form"
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            returnKeyType="send"
            onSubmitEditing={() => void send(email)}
          />
          {!!error && (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}
          <Button variant="solid" title={busy ? 'Sending...' : 'Send reset link'} onPress={() => void send(email)} loading={busy} />
        </View>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  form: { gap: 24 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.text },
  error: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: '#f87171' },
});
