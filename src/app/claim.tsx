import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, AppState, BackHandler, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { SupportLink } from '@/components/SupportLink';
import { MoveSubscriptionButton } from '@/components/MoveSubscriptionButton';
import { ChevronLeftIcon, InfoIcon } from '@/components/Icons';
import { Page } from '@/components/Page';
import { accessToken } from '@/lib/accessToken';
import { api } from '@/lib/api';
import { signIn, signOut } from '@/lib/auth';
import { createClaimRunner, type ClaimResult } from '@/lib/claim';
import { conflictMessage } from '@/lib/claimCopy';
import { pauseClaim, reopenClaim, resumeAfterMove } from '@/lib/claimGuard';
import { firstErrorField, type ClaimErrors, type ClaimField, type ClaimMode, type ClaimValues } from '@/lib/claimValidation';
import { homeRoute, resetTo } from '@/lib/nav';
import { usePaywall, usePublishDeps } from '@/lib/paywall';
import { track } from '@/lib/analytics';
import { getEntitlements } from '@/lib/entitlements';
import { upgradeAfterPublish } from '@/lib/publishRequest';
import { resumePendingPublish } from '@/lib/publish';
import { setPrefillEmail } from '@/lib/recovery';
import { useRestoreFlow } from '@/lib/restoreFlow';
import { loadPendingPublish, loadSite, savePendingPublish } from '@/lib/siteStore';
import { supabase } from '@/lib/supabase';

type Banner = { tone: 'error' | 'waiting'; message: string } | null;
const EMPTY: ClaimValues = { name: '', email: '', phone: '', password: '' };

/**
 * The account step after payment (pay -> account -> live). REQUIRED and locked: no back chevron, no swipe back
 * (gestureEnabled false in _layout), the Android back button is swallowed, and it sits outside the tabs. A kill or a
 * relaunch while the purchase is paid-but-unclaimed comes straight back here (_layout's guard).
 *
 * Four required fields, all empty (nothing is prefilled): name, email, phone, password (one field). No email
 * verification: the server creates the account confirmed and the app signs in with the same email + password.
 * "Already have an account? Sign in" swaps the form inside this same screen. With a session already (a relaunch, a
 * password reset) the pending publish is simply sent. Failures stay on the form, in words.
 */
export default function Claim() {
  // Why the password hint is plain 'password' (never 'newPassword'): on iOS a secure field marked newPassword next to a
  // username field turns on Automatic Strong Password, which swaps the keyboard (letters -> numbers -> back to letters
  // after one digit) and re-lays-out the form each time. Keychain still offers saved logins from 'password'.
  const deps = usePublishDeps();
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const paywall = usePaywall();
  const paywallRef = useRef(paywall);
  paywallRef.current = paywall;
  const setSignedInRef = useRef<(v: boolean) => void>(() => {});
  const runner = useMemo(
    () =>
      createClaimRunner({
        signup: api.signup,
        // The verified purchase the pending publish holds (looked up when the record was saved before it was known).
        transactionId: async () => (await loadPendingPublish())?.transactionId ?? (await depsRef.current.latestTransactionId()),
        signIn,
        finish: () => resumePendingPublish(depsRef.current),
        parkInactive: () => savePendingPublish(null),
        // The account exists and is signed in: from here the form never comes back, only "Publishing your site".
        onSession: () => setSignedInRef.current(true),
        dropSession: async () => {
          await supabase.auth.signOut({ scope: 'local' });
        },
      }),
    [],
  );

  const { restore, busy: restoring } = useRestoreFlow({ stay: true });
  const [mode, setMode] = useState<ClaimMode>('signup');
  const [values, setValues] = useState<ClaimValues>(EMPTY);
  const [errors, setErrors] = useState<ClaimErrors>({});
  const [banner, setBanner] = useState<Banner>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [movable, setMovable] = useState(false);
  const [inactive, setInactive] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  setSignedInRef.current = setSignedIn;
  const refs: Record<ClaimField, React.RefObject<TextInput | null>> = {
    name: useRef<TextInput>(null), email: useRef<TextInput>(null), phone: useRef<TextInput>(null),
    password: useRef<TextInput>(null),
  };

  // Leaving the screen ends the wait between retries.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runner.stop();
    };
  }, [runner]);

  // Locked: the hardware back button does nothing here.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const set = (k: keyof ClaimValues) => (t: string) => {
    setValues((v) => ({ ...v, [k]: t }));
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
    if (k === 'email') setExisting(null);
  };

  const apply = useCallback((r: ClaimResult) => {
    // A result that arrives after the screen went away (the app was backgrounded and routed on) must not navigate.
    if (!mountedRef.current) return;
    switch (r.kind) {
      case 'live': {
        // Asked for Bookings / Store before paying, then quit at this step: offer that upgrade now (never after a paywall).
        const upgrade = upgradeAfterPublish(r.planHint, getEntitlements(), false);
        if (upgrade) {
          track('publish_plan_upgrade_offered', { placement: upgrade });
          void Promise.resolve(paywallRef.current(upgrade)).catch(() => 'declined').finally(() => resetTo('/live'));
          return;
        }
        resetTo('/live');
        return;
      }
      case 'moved-on':
        void loadSite().then((s) => resetTo(homeRoute(s))).catch(() => resetTo('/start'));
        return;
      case 'invalid':
        setErrors(r.errors);
        refs[firstErrorField(r.errors) ?? 'name'].current?.focus();
        return;
      case 'field':
        setErrors({ [r.field]: r.message });
        refs[r.field].current?.focus();
        return;
      case 'email-exists':
        setExisting(r.email);
        setErrors({ email: 'An account with this email already exists.' });
        return;
      case 'waiting':
        setBanner({ tone: 'waiting', message: r.message });
        return;
      case 'blocked':
        setBlocked(r.message);
        setMovable(r.movable === true);
        return;
      case 'inactive':
        setInactive(r.message);
        return;
      default:
        setBanner({ tone: 'error', message: r.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = useCallback(
    async (fn: () => Promise<ClaimResult | null>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setBanner(null);
      setErrors({});
      try {
        const r = await fn();
        if (!mountedRef.current) return;
        if (r) apply(r);
        // A session the server refused was signed out: the form is the way back in. Otherwise the session stays.
        if (!r || (r.kind !== 'live' && r.kind !== 'moved-on')) setSignedIn(!!(await accessToken().catch(() => null)));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [apply],
  );

  // On arrival: nothing to claim goes home; a refusal already on record shows it; a session sends the publish.
  useEffect(() => {
    let alive = true;
    (async () => {
      const pending = await loadPendingPublish().catch(() => null);
      if (!alive) return;
      if (!pending) {
        const s = await loadSite().catch(() => null);
        resetTo(homeRoute(s));
        return;
      }
      if (pending.state === 'conflict' && pending.conflict) {
        setBlocked(conflictMessage(pending.conflict));
        setMovable(pending.conflict.code === 'purchase-other-account');
        setReady(true);
        return;
      }
      const token = await accessToken();
      if (!alive) return;
      setSignedIn(!!token);
      setReady(true);
      if (token) void run(runner.finish);
    })().catch(() => setReady(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back from the background while waiting for a connection: try again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && signedIn && !busyRef.current && !blocked && !inactive) void run(runner.finish);
    });
    return () => sub.remove();
  }, [signedIn, blocked, inactive, run, runner]);

  useEffect(() => {
    const message = banner?.message ?? blocked ?? Object.values(errors).find(Boolean);
    if (message) AccessibilityInfo.announceForAccessibility(message);
  }, [banner, blocked, errors]);

  const submit = () => {
    void run(async () => {
      return runner.submit(mode, values);
    });
  };
  const retry = () => (signedIn ? void run(runner.finish) : submit());

  const switchMode = (next: ClaimMode, keepEmail = true) => {
    setMode(next);
    setErrors({});
    setBanner(null);
    setExisting(null);
    setValues((v) => ({ ...EMPTY, email: keepEmail ? v.email : '' }));
    setTimeout(() => (next === 'signin' ? refs.password : refs.name).current?.focus(), 50);
  };

  const useDifferentAccount = () => {
    void run(async () => {
      await signOut().catch(() => {});
      await reopenClaim().catch(() => {});
      setBlocked(null);
      setMovable(false);
      setSignedIn(false);
      switchMode('signin', false);
      return null;
    });
  };

  // The subscription now belongs to this account: clear the refusal and send the pending publish again.
  const afterMove = useCallback(async () => {
    await resumeAfterMove().catch(() => {});
    setBlocked(null);
    setMovable(false);
    setSignedIn(true);
    await run(runner.finish);
  }, [run, runner]);

  const forgot = () => {
    if (busyRef.current) return;
    setPrefillEmail(values.email);
    router.push('/forgot-password');
  };

  // Back to the editor without an account: the payment is kept (paused), Publish there returns to this step.
  const backToEditor = () => {
    if (busyRef.current) return;
    void (async () => {
      await pauseClaim().catch(() => {});
      const s = await loadSite().catch(() => null);
      resetTo(homeRoute(s));
    })();
  };

  if (!ready) return <View style={styles.blank} />;

  if (inactive) {
    return (
      <Page title="Subscription inactive">
        <Text style={styles.title}>Not published</Text>
        <Text style={styles.body}>{inactive}</Text>
        <Button variant="solid" title="Back to the editor" onPress={() => void savePendingPublish(null).catch(() => {}).then(() => loadSite()).then((s) => resetTo(homeRoute(s)))} style={styles.gap} />
        <SupportLink />
      </Page>
    );
  }

  if (blocked) {
    return (
      <Page title="Choose an account">
        <Text style={styles.title}>This account can’t publish it</Text>
        <Text style={styles.body}>{blocked}</Text>
        {movable && (
          <MoveSubscriptionButton
            transactionId={async () => (await loadPendingPublish())?.transactionId ?? null}
            onMoved={afterMove}
            style={styles.gap}
          />
        )}
        <Button variant={movable ? 'ghost' : 'solid'} title="Use a different account" onPress={useDifferentAccount} loading={busy} style={movable ? styles.gapSmall : styles.gap} />
        <SupportLink />
      </Page>
    );
  }

  // An account is signed in and its publish is pending: never the form. Spinner while it runs, one calm Try again after.
  if (signedIn) {
    const note = banner?.message;
    return (
      <Page title="Publishing your site">
        <View style={styles.hold}>
          {!note && <ActivityIndicator color={colors.accent} size="large" />}
          <Text style={styles.title}>{note ? 'Almost there' : 'Publishing your site…'}</Text>
          <Text style={styles.body} accessibilityLiveRegion="polite">
            {note ?? 'Your payment went through and your account is ready. We’re putting your website online. This can take a minute or two.'}
          </Text>
          {!!note && <Button variant="solid" title="Try again" onPress={retry} loading={busy} style={styles.gap} />}
          {!!note && <SupportLink />}
        </View>
      </Page>
    );
  }

  const signup = mode === 'signup';
  return (
    <Page title={signup ? 'Create your account' : 'Sign in'}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={{ top: 8, bottom: 8, left: 12, right: 24 }}
        onPress={backToEditor}
        style={styles.pill}
      >
        <ChevronLeftIcon size={20} color="#FFFFFF" />
        <Text style={styles.pillText} maxFontSizeMultiplier={1.3}>Back</Text>
      </Pressable>
      <View style={styles.notice}>
        <InfoIcon size={16} color={colors.accent} />
        <Text style={styles.noticeText}>
          Your payment went through. {signup ? 'Create a free account' : 'Sign in'} to finish publishing your website — you’ll use it to sign back in anytime.
        </Text>
      </View>

      <View style={styles.form}>
        {signup && (
          <Field
            ref={refs.name} tone="form" label="Full Name" value={values.name} onChangeText={set('name')}
            autoComplete="name" textContentType="name" returnKeyType="next" onSubmitEditing={() => refs.email.current?.focus()}
            editable={!busy}
          />
        )}
        {signup && !!errors.name && <FieldError text={errors.name} />}
        <Field
          ref={refs.email} tone="form" label="Email" value={values.email} onChangeText={set('email')}
          autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" textContentType="username"
          returnKeyType="next" onSubmitEditing={() => (signup ? refs.phone : refs.password).current?.focus()} editable={!busy}
        />
        {!!errors.email && <FieldError text={errors.email} />}
        {existing != null && (
          <Pressable onPress={() => switchMode('signin')} accessibilityRole="button" hitSlop={8}>
            <Text style={[styles.switch, styles.switchLink]}>Sign in instead</Text>
          </Pressable>
        )}
        {signup && (
          <Field
            ref={refs.phone} tone="form" label="Phone Number" value={values.phone} onChangeText={set('phone')}
            keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber"
            returnKeyType="next" onSubmitEditing={() => refs.password.current?.focus()} editable={!busy}
          />
        )}
        {signup && !!errors.phone && <FieldError text={errors.phone} />}
        <Field
          ref={refs.password} tone="form" label={signup ? 'Password (min 8 characters)' : 'Password'} value={values.password}
          onChangeText={set('password')} secureTextEntry autoComplete={signup ? 'password' : 'current-password'}
          textContentType="password" returnKeyType="go" editable={!busy}
          onSubmitEditing={submit}
        />
        {!!errors.password && <FieldError text={errors.password} />}
        {!signup && (
          <Pressable onPress={forgot} hitSlop={8} accessibilityRole="link" style={styles.forgotRow}>
            <Text style={styles.forgot}>Forgot password?</Text>
          </Pressable>
        )}
        {!!banner && (
          <Text style={[styles.error, banner.tone === 'waiting' && styles.waiting]} accessibilityLiveRegion="polite">
            {banner.message}
          </Text>
        )}
        {banner?.tone === 'waiting' ? (
          <Button variant="solid" title="Try again" onPress={retry} loading={busy} />
        ) : (
          <Button
            variant="solid"
            title={busy ? (signup ? 'Creating Account...' : 'Signing In...') : signup ? 'Create Account & Publish' : 'Sign In & Publish'}
            onPress={submit}
            loading={busy}
          />
        )}
        <SupportLink />
        <Pressable onPress={() => void restore()} disabled={restoring || busy} accessibilityRole="link" hitSlop={8} style={styles.restoreRow}>
          <Text style={styles.forgot}>Restore purchases</Text>
        </Pressable>
      </View>

      <View style={styles.switchRow}>
        <Text style={styles.switch}>{signup ? 'Already have an account?' : 'New here?'}</Text>
        <Pressable onPress={() => !busyRef.current && switchMode(signup ? 'signin' : 'signup')} accessibilityRole="link" hitSlop={8}>
          <Text style={[styles.switch, styles.switchLink]}>{signup ? 'Sign in' : 'Create an account'}</Text>
        </Pressable>
      </View>
    </Page>
  );
}

function FieldError({ text }: { text: string }) {
  return (
    <Text style={styles.error} accessibilityLiveRegion="polite">
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: colors.bg },
  pill: {
    minHeight: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 12,
    paddingLeft: 8, paddingRight: 16, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.65)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  pillText: { fontFamily: fonts.bodySemi, fontSize: 16, color: '#FFFFFF' },
  restoreRow: { alignSelf: 'center', marginTop: 4 },
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.hair,
    backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 12, paddingVertical: 10, marginBottom: 24,
  },
  noticeText: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 12, lineHeight: 17, color: colors.text },
  form: { gap: 16 },
  error: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: '#f87171' },
  waiting: { color: colors.accent },
  forgotRow: { alignSelf: 'flex-end' },
  forgot: { fontFamily: fonts.body, fontSize: 13, color: colors.grey, textDecorationLine: 'underline' },
  switchRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4, marginTop: 28 },
  switch: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  switchLink: { color: colors.accent, fontFamily: fonts.bodySemi },
  title: { fontFamily: fonts.heading, fontSize: 22, color: colors.heading, textAlign: 'center', marginTop: 24 },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.body, textAlign: 'center', marginTop: 12 },
  hold: { alignItems: 'center', gap: 4, paddingTop: 40 },
  gap: { marginTop: 28 },
  gapSmall: { marginTop: 14 },
});
