import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Page } from '@/components/Page';
import { resetPassword, signIn } from '@/lib/auth';
import { goBackOrHome } from '@/lib/nav';

/** Email + password sign-in with the web's "Forgot password?" (AuthModal.tsx). */
export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const busyRef = useRef(false);
  const passwordInput = useRef<TextInput>(null);

  const submit = async () => {
    if (busyRef.current) return;
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await signIn(email, password);
      goBackOrHome();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const forgot = async () => {
    if (busyRef.current) return;
    setError('');
    if (!email.trim()) {
      setError('Enter your email above first, then tap "Forgot password?" again.');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await resetPassword(email);
      setResetSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the reset email');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Page title="Sign in" onBack={goBackOrHome}>
      <View style={styles.form}>
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
          returnKeyType="next"
          onSubmitEditing={() => passwordInput.current?.focus()}
        />
        <Field
          ref={passwordInput}
          tone="form"
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        {!!error && (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}
        <Button variant="solid" title={busy ? 'Signing In...' : 'Sign In'} onPress={submit} loading={busy} />
      </View>

      <View style={styles.footer}>
        {resetSent ? (
          <Text style={styles.sent}>Reset link sent — check your email.</Text>
        ) : (
          <Pressable onPress={forgot} hitSlop={8} accessibilityRole="button">
            <Text style={styles.forgot}>Forgot password?</Text>
          </Pressable>
        )}
        <Text style={styles.switch}>
          Don’t have an account?{' '}
          <Text style={styles.switchLink} onPress={() => router.replace('/sign-up')} accessibilityRole="link">
            Sign Up
          </Text>
        </Text>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  form: { gap: 24 },
  error: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: '#f87171' },
  footer: { alignItems: 'center', gap: 16, marginTop: 28 },
  forgot: { fontFamily: fonts.body, fontSize: 13, color: colors.grey, textDecorationLine: 'underline' },
  sent: { fontFamily: fonts.body, fontSize: 13, color: '#34d399' },
  switch: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  switchLink: { color: colors.accent, fontFamily: fonts.bodySemi },
});
