import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Application from 'expo-application';
import * as WebBrowser from 'expo-web-browser';
import { colors, fonts } from '@/constants/theme';
import { ChevronRightIcon, ExternalLinkIcon } from '@/components/Icons';
import { Page } from '@/components/Page';
import { deleteAccountAndData, deleteLocalData, syncIfSignedIn } from '@/lib/account';
import { track } from '@/lib/analytics';
import { ApiError } from '@/lib/api';
import { signOut, useSession } from '@/lib/auth';
import { goBackOrHome, resetTo } from '@/lib/nav';
import { hasEntitlement, useRestorePurchases } from '@/lib/paywall';

const SUPPORT_EMAIL = 'support@davoxa.com';
const PRIVACY_URL = 'https://www.aibarber.org/privacy';
const TERMS_URL = 'https://www.aibarber.org/terms';
const SUBSCRIPTIONS_URL = 'itms-apps://apps.apple.com/account/subscriptions';

// As the privacy page says: deleting never takes a published site offline.
const SITE_STAYS_LIVE = `Your published website stays online until you email ${SUPPORT_EMAIL} and ask us to take it down.`;
const SUBSCRIPTION_SEPARATE = 'Deleting doesn’t cancel your subscription — do that in Manage subscription.';

type Busy = 'restore' | 'delete' | 'signout' | null;

/** "Settings" (named on aibarber.org/support): account, Restore purchases, Delete account. */
export default function Settings() {
  const { session, ready } = useSession();
  const restorePurchases = useRestorePurchases();
  const [busy, setBusy] = useState<Busy>(null);
  const signedIn = !!session?.user;

  useEffect(() => track('settings_opened'), []);

  const onRestore = async () => {
    if (busy) return;
    setBusy('restore');
    try {
      const site = await restorePurchases();
      if (site) {
        void syncIfSignedIn(site);
        resetTo('/dashboard');
        Alert.alert('Restore purchases', 'Your subscription and your website have been restored.');
      } else if (hasEntitlement()) {
        // Superwall says subscribed (so it showed no alert), but the transaction isn't readable yet.
        Alert.alert(
          'Restore purchases',
          `Your subscription is active, but we couldn’t load your website yet. Try again in a moment, or email ${SUPPORT_EMAIL}.`,
        );
      }
      // Otherwise null means no subscription: Superwall has already shown its restoreFailed alert.
    } catch (e) {
      Alert.alert('Restore purchases', restoreError(e));
    } finally {
      setBusy(null);
    }
  };

  const manageSubscription = () => {
    track('manage_subscription_tapped');
    Linking.openURL(SUBSCRIPTIONS_URL).catch(() =>
      Alert.alert('Manage subscription', 'Open Settings → your name → Subscriptions on this iPhone.'),
    );
  };

  const emailSupport = () => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => Alert.alert('Support', `Email us at ${SUPPORT_EMAIL}.`));
  };

  const onSignOut = async () => {
    if (busy) return;
    setBusy('signout');
    try {
      await signOut();
    } catch {
      Alert.alert('Sign out', 'We couldn’t sign you out. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = () => {
    if (busy) return;
    if (signedIn) {
      Alert.alert(
        'Delete account?',
        `This permanently deletes your AI Barber account and the site records saved to it, and removes your website from this phone. ${SITE_STAYS_LIVE}\n\n${SUBSCRIPTION_SEPARATE}`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete account', style: 'destructive', onPress: () => void runDelete() },
        ],
      );
    } else {
      Alert.alert(
        'Delete data on this phone?',
        `You’re not signed in, so there’s no account to delete here — to delete an account, sign in first.\n\nThis removes your website and settings from this phone. ${SITE_STAYS_LIVE}\n\n${SUBSCRIPTION_SEPARATE}`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete data on this phone', style: 'destructive', onPress: () => void runLocalDelete() },
        ],
      );
    }
  };

  const runDelete = async () => {
    setBusy('delete');
    try {
      await deleteAccountAndData();
      resetTo('/start');
      Alert.alert('Account deleted', `Your AI Barber account has been deleted. ${SITE_STAYS_LIVE}`);
    } catch (e) {
      Alert.alert('Delete account', deleteError(e));
    } finally {
      setBusy(null);
    }
  };

  const runLocalDelete = async () => {
    setBusy('delete');
    try {
      await deleteLocalData();
      track('local_data_deleted');
      resetTo('/start');
    } catch {
      Alert.alert('Delete data on this phone', 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const version = `${Application.nativeApplicationVersion ?? '1.0.0'} (${Application.nativeBuildVersion ?? '1'})`;

  return (
    <Page title="Settings" onBack={goBackOrHome}>
      <Section title="Account">
        {!ready ? (
          <Row label=" " />
        ) : signedIn ? (
          <>
            <Row label="Signed in as" detail={session!.user.email ?? ''} />
            <Row label="Sign out" onPress={onSignOut} busy={busy === 'signout'} />
          </>
        ) : (
          <>
            <Row label="Sign in" onPress={() => router.push('/sign-in')} chevron />
            <Row label="Create account" onPress={() => router.push('/sign-up')} chevron />
          </>
        )}
      </Section>

      <Section title="Subscription">
        <Row label="Restore purchases" onPress={onRestore} busy={busy === 'restore'} />
        <Row label="Manage subscription" onPress={manageSubscription} external />
      </Section>

      <Section title="Help">
        <Row label="Support" detail={SUPPORT_EMAIL} onPress={emailSupport} />
        <Row label="Privacy Policy" onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_URL)} external />
        <Row label="Terms of Service" onPress={() => void WebBrowser.openBrowserAsync(TERMS_URL)} external />
      </Section>

      <Section>
        <Row label="Delete account" onPress={confirmDelete} busy={busy === 'delete'} danger />
      </Section>

      <Text style={styles.version}>AI Barber {version}</Text>
    </Page>
  );
}

function restoreError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'no-site') {
      return hasEntitlement()
        ? 'Your subscription is active, but no website has been published with it yet. Build your website and tap Publish — it’s included.'
        : 'Your subscription was found, but no website has been published with it yet. Build your website and tap Publish.';
    }
    if (e.status === 0) return e.message; // offline / timed out
    return `We couldn’t load your website right now. Try again in a moment, or email ${SUPPORT_EMAIL}.`;
  }
  return e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.';
}

function deleteError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return e.message;
    if (e.status === 401) return 'Your sign-in has expired. Sign out, sign in again, then delete your account.';
  }
  return `We couldn’t delete your account right now. Try again, or email ${SUPPORT_EMAIL}.`;
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      {title && <Text style={styles.sectionTitle}>{title}</Text>}
      <View style={styles.group}>{children}</View>
    </View>
  );
}

function Row({
  label, detail, onPress, busy, chevron, external, danger,
}: {
  label: string;
  detail?: string;
  onPress?: () => void;
  busy?: boolean;
  chevron?: boolean;
  external?: boolean;
  danger?: boolean;
}) {
  const body = (
    <>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, danger && { color: colors.danger }]}>{label}</Text>
        {!!detail && (
          <Text style={styles.rowDetail} numberOfLines={1}>
            {detail}
          </Text>
        )}
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={danger ? colors.danger : colors.accent} />
      ) : external ? (
        <ExternalLinkIcon size={16} color={colors.faint} />
      ) : chevron ? (
        <ChevronRightIcon size={16} color={colors.faint} />
      ) : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: !!busy }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 28 },
  sectionTitle: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: colors.muted,
    marginBottom: 8, marginLeft: 4,
  },
  group: { backgroundColor: colors.sheet, borderRadius: 14, borderWidth: 1, borderColor: colors.hair, overflow: 'hidden' },
  row: {
    minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hair,
  },
  pressed: { backgroundColor: 'rgba(255,255,255,0.04)' },
  rowText: { flex: 1 },
  rowLabel: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text },
  rowDetail: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 2 },
  version: { fontFamily: fonts.body, fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: 4 },
});
