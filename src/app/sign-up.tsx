import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { WarningIcon } from '@/components/Icons';
import { Page } from '@/components/Page';
import { PASSWORD_TOO_SHORT, signUp } from '@/lib/auth';
import { goBackOrHome } from '@/lib/nav';

/**
 * The web's sign-up form (AuthModal.tsx): full name (optional), phone
 * (required), email, password (min 6). The local site is saved to the new
 * account once it has a session.
 */
export default function SignUp() {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);
  const busyRef = useRef(false);
  const phoneInput = useRef<TextInput>(null);
  const emailInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);

  useEffect(() => {
    if (error) AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

  const submit = async () => {
    if (busyRef.current) return;
    setError('');
    if (!phone.trim()) {
      setError('Please enter a phone number');
      return;
    }
    if (!email.trim()) {
      setError('Please enter your email');
      return;
    }
    if (password.length < 6) {
      setError(PASSWORD_TOO_SHORT);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const { signedIn } = await signUp(email, password, fullName.trim(), phone.trim());
      if (signedIn) goBackOrHome();
      else setConfirmSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An unexpected error occurred');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  if (confirmSent) {
    return (
      <Page title="Create account" onBack={goBackOrHome}>
        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.body}>
          We sent a confirmation link to {email.trim()}. Open it, then sign in here to save your site to your account.
        </Text>
        <Button variant="solid" title="Sign In" onPress={() => router.replace('/sign-in')} style={styles.gap} />
      </Page>
    );
  }

  return (
    <Page title="Create account" onBack={goBackOrHome}>
      <View style={styles.notice} accessibilityRole="alert">
        <WarningIcon size={16} color="#f87171" />
        <Text style={styles.noticeText}>
          Please save the email & password you use here — you&apos;ll need them to sign back in.
        </Text>
      </View>

      <View style={styles.form}>
        <Field
          tone="form"
          label="Full Name (optional)"
          value={fullName}
          onChangeText={setFullName}
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          onSubmitEditing={() => phoneInput.current?.focus()}
        />
        <Field
          ref={phoneInput}
          tone="form"
          label="Phone Number"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          returnKeyType="next"
          onSubmitEditing={() => emailInput.current?.focus()}
        />
        <Field
          ref={emailInput}
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
          label="Password (min 6 characters)"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        {!!error && (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}
        <Button
          variant="solid"
          title={busy ? 'Creating Account...' : 'Create Account'}
          onPress={submit}
          loading={busy}
        />
      </View>

      <View style={styles.switchRow}>
        <Text style={styles.switch}>Already have an account?</Text>
        <Pressable onPress={() => router.replace('/sign-in')} accessibilityRole="link" hitSlop={8}>
          <Text style={[styles.switch, styles.switchLink]}>Sign In</Text>
        </Pressable>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)',
    backgroundColor: 'rgba(239,68,68,0.1)', paddingHorizontal: 12, paddingVertical: 10, marginBottom: 24,
  },
  noticeText: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 12, lineHeight: 17, color: '#fca5a5' },
  form: { gap: 24 },
  error: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: '#f87171' },
  switchRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4, marginTop: 28 },
  switch: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  switchLink: { color: colors.accent, fontFamily: fonts.bodySemi },
  title: { fontFamily: fonts.heading, fontSize: 22, color: colors.heading, textAlign: 'center', marginTop: 24 },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.body, textAlign: 'center', marginTop: 12 },
  gap: { marginTop: 28 },
});
