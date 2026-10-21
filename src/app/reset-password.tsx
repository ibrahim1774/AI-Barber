import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Page } from '@/components/Page';
import { track } from '@/lib/analytics';
import { useAfterSignIn } from '@/lib/afterSignIn';
import { newPasswordProblem, setNewPassword, startRecoverySession } from '@/lib/auth';
import { goBackOrHome, resetTo } from '@/lib/nav';
import { parseRecoveryUrl } from '@/lib/recovery';

type Status = 'checking' | 'form' | 'expired' | 'done';

const EXPIRED = 'This reset link has expired or was already used.';

/**
 * Opened by the recovery email's link (aibarber://reset-password#access_token=…).
 * expo-router drops the fragment, so the full URL comes from expo-linking,
 * cold start or warm. The URL holds live tokens: it is never logged or sent
 * anywhere, and each one is used once.
 */
export default function ResetPassword() {
  const linkingUrl = Linking.useLinkingURL();
  const [url, setUrl] = useState<string | null>(linkingUrl);
  const [status, setStatus] = useState<Status>('checking');
  const statusRef = useRef<Status>('checking');
  statusRef.current = status;
  const handled = useRef(new Set<string>());
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const confirmInput = useRef<TextInput>(null);
  const afterSignIn = useAfterSignIn(useCallback(() => resetTo('/start'), []));

  useEffect(() => {
    if (linkingUrl) setUrl(linkingUrl);
  }, [linkingUrl]);

  // Cold start fallback: the launch URL, in case the hook hasn't seen it.
  useEffect(() => {
    let alive = true;
    if (!linkingUrl) {
      Linking.getInitialURL()
        .then((u) => {
          if (alive && u) setUrl((cur) => cur ?? u);
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (error) AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

  useEffect(() => {
    const link = parseRecoveryUrl(url);
    if (link.kind === 'none') {
      // No usable link (yet): give a warm-start URL event a moment, then say so.
      if (statusRef.current !== 'checking') return;
      const t = setTimeout(() => {
        if (statusRef.current === 'checking') setStatus('expired');
      }, 1500);
      return () => clearTimeout(t);
    }
    if (!url || handled.current.has(url)) return;
    handled.current.add(url);
    // Drop the cached launch URL (it holds the tokens) so nothing reads it later.
    Linking.clearInitialURL();
    if (link.kind === 'error') {
      track('password_reset_link_opened', { ok: false });
      if (statusRef.current !== 'form') setStatus('expired');
      return;
    }
    let alive = true;
    setStatus('checking');
    startRecoverySession(link.accessToken, link.refreshToken)
      .then(() => {
        track('password_reset_link_opened', { ok: true });
        if (alive) setStatus('form');
      })
      .catch(() => {
        track('password_reset_link_opened', { ok: false });
        if (alive) setStatus('expired');
      });
    return () => {
      alive = false;
    };
  }, [url]);

  const save = async () => {
    if (busyRef.current) return;
    const problem = newPasswordProblem(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await setNewPassword(password);
      setStatus('done');
      AccessibilityInfo.announceForAccessibility('Password updated');
      await afterSignIn({ title: 'Password updated', message: "You're signed in with your new password." });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Page title="Reset password" onBack={goBackOrHome}>
      {status === 'checking' && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}

      {status === 'expired' && (
        <View style={styles.form}>
          <Text style={styles.body} accessibilityLiveRegion="polite">
            {EXPIRED}
          </Text>
          <Button variant="solid" title="Send a new link" onPress={() => router.replace('/forgot-password')} />
        </View>
      )}

      {status === 'form' && (
        <View style={styles.form}>
          <Text style={styles.heading} accessibilityRole="header">
            Choose a new password
          </Text>
          <Field
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
            onSubmitEditing={save}
          />
          {!!error && (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}
          <Button variant="solid" title={busy ? 'Saving...' : 'Save'} onPress={save} loading={busy} />
        </View>
      )}

      {status === 'done' && (
        <View style={styles.form}>
          <Text style={styles.heading} accessibilityRole="header">
            Password updated
          </Text>
        </View>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  center: { paddingTop: 48, alignItems: 'center' },
  form: { gap: 24 },
  heading: { fontFamily: fonts.heading, fontSize: 20, color: colors.heading },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.text },
  error: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: '#f87171' },
});
