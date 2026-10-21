import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Page } from '@/components/Page';
import { useAfterSignIn } from '@/lib/afterSignIn';
import { signIn } from '@/lib/auth';
import { goBackOrHome } from '@/lib/nav';

/** Email + password sign-in; "Forgot password?" opens /forgot-password with the email typed so far. */
export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const passwordInput = useRef<TextInput>(null);
  // Signed in with a site: the Edit tab. With no site: offer (never run) Restore purchases.
  const afterSignIn = useAfterSignIn();

  useEffect(() => {
    if (error) AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

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
      await afterSignIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const forgot = () => {
    if (busyRef.current) return;
    const typed = email.trim();
    router.push(typed ? { pathname: '/forgot-password', params: { email: typed } } : '/forgot-password');
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
        <Pressable onPress={forgot} hitSlop={8} accessibilityRole="link" style={styles.forgotRow}>
          <Text style={styles.forgot}>Forgot password?</Text>
        </Pressable>
        {!!error && (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}
        <Button variant="solid" title={busy ? 'Signing In...' : 'Sign In'} onPress={submit} loading={busy} />
      </View>

      <View style={styles.footer}>
        <View style={styles.switchRow}>
          <Text style={styles.switch}>Don’t have an account?</Text>
          <Pressable onPress={() => router.replace('/sign-up')} accessibilityRole="link" hitSlop={8}>
            <Text style={[styles.switch, styles.switchLink]}>Sign Up</Text>
          </Pressable>
        </View>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  form: { gap: 24 },
  error: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: '#f87171' },
  footer: { alignItems: 'center', gap: 16, marginTop: 28 },
  forgotRow: { alignSelf: 'flex-end', marginTop: -12 },
  forgot: { fontFamily: fonts.body, fontSize: 13, color: colors.grey, textDecorationLine: 'underline' },
  switch: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  switchLink: { color: colors.accent, fontFamily: fonts.bodySemi },
});
