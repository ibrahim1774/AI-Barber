import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Page } from '@/components/Page';
import { useAfterSignIn } from '@/lib/afterSignIn';
import { requestPasswordReset, resetPasswordWithCode } from '@/lib/auth';
import { goBackOrHome, resetTo } from '@/lib/nav';
import { CODE_MAX, cooldownLeft, sanitizeCode, takePrefillEmail } from '@/lib/recovery';

/**
 * "Forgot password?" in two steps on one screen: the email, then the code
 * Supabase emails (6–10 digits) with the new password. No link into the app,
 * so no session token ever travels in a URL. The confirmation is the same
 * whether or not the account exists; Resend waits 60 s between emails.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState(takePrefillEmail);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // The address the last email went to, and when (for the cooldown). Memory only.
  const [sent, setSent] = useState<{ to: string; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const left = cooldownLeft(sent?.at ?? null, now);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  // A code works once: after it verified, a retry (password rejected) only sets the password.
  const verified = useRef(false);
  const [isVerified, setIsVerified] = useState(false);
  const markVerified = (v: boolean) => {
    verified.current = v;
    setIsVerified(v);
  };
  const passwordInput = useRef<TextInput>(null);
  const confirmInput = useRef<TextInput>(null);
  const afterSignIn = useAfterSignIn(() => resetTo('/start'));

  useEffect(() => {
    if (error) AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

  // Ticks only while the cooldown runs.
  useEffect(() => {
    if (!sent || left <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sent, left]);

  const run = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const send = (to: string) =>
    run(async () => {
      await requestPasswordReset(to);
      const at = Date.now();
      // A new code for a different address starts over.
      if (sent && sent.to !== to.trim()) markVerified(false);
      setSent({ to: to.trim(), at });
      setNow(at);
    });

  const reset = () =>
    run(async () => {
      if (!sent) return;
      await resetPasswordWithCode(sent.to, code, password, confirm, {
        alreadyVerified: verified.current,
        onVerified: () => markVerified(true),
      });
      setDone(true);
      AccessibilityInfo.announceForAccessibility('Password updated');
      await afterSignIn({ title: 'Password updated', message: "You're signed in with your new password." });
    });

  if (done) {
    return (
      <Page title="Reset password">
        <Text style={styles.heading} accessibilityRole="header">
          Password updated
        </Text>
      </Page>
    );
  }

  return (
    <Page title="Reset password" onBack={goBackOrHome}>
      {sent ? (
        <View style={styles.form}>
          <Text style={styles.body} accessibilityLiveRegion="polite">
            If an account exists for {sent.to}, we&apos;ve emailed a 6-digit code. Enter it below.
          </Text>
          {!isVerified && (
            <Field
              tone="form"
              label="Code"
              value={code}
              onChangeText={(t) => setCode(sanitizeCode(t))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={CODE_MAX}
              returnKeyType="next"
              onSubmitEditing={() => passwordInput.current?.focus()}
            />
          )}
          <Field
            ref={passwordInput}
            tone="form"
            label="New password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            onSubmitEditing={() => confirmInput.current?.focus()}
          />
          <Field
            ref={confirmInput}
            tone="form"
            label="Confirm new password"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="done"
            onSubmitEditing={() => void reset()}
          />
          {!!error && (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}
          <Button variant="solid" title={busy ? 'Resetting...' : 'Reset password'} onPress={() => void reset()} loading={busy} />
          {!isVerified && (
            <Button
              variant="ghost"
              title={left > 0 ? `Resend code in ${left}s` : 'Resend code'}
              onPress={() => void send(sent.to)}
              disabled={left > 0 || busy}
            />
          )}
          <Button
            variant="link"
            title="Use a different email"
            onPress={() => {
              setSent(null);
              setError('');
              setCode('');
              markVerified(false);
            }}
          />
        </View>
      ) : (
        <View style={styles.form}>
          <Text style={styles.body}>Enter the email you signed up with and we&apos;ll email you a code to choose a new password.</Text>
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
          <Button variant="solid" title={busy ? 'Sending...' : 'Send code'} onPress={() => void send(email)} loading={busy} />
        </View>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  form: { gap: 24 },
  heading: { fontFamily: fonts.heading, fontSize: 20, color: colors.heading },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.text },
  error: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: '#f87171' },
});
