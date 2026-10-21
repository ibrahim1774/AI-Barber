import { useCallback, useLayoutEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import * as Application from 'expo-application';
import * as WebBrowser from 'expo-web-browser';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { ChevronRightIcon, ExternalLinkIcon } from '@/components/Icons';
import { Page } from '@/components/Page';
import { deleteAccountAndData, deleteLocalData } from '@/lib/account';
import { track } from '@/lib/analytics';
import { ApiError } from '@/lib/api';
import { signOut, useSession } from '@/lib/auth';
import { goBackOrHome, resetTo } from '@/lib/nav';
import { requestPublish } from '@/lib/publishRequest';
import { useRestoreFlow } from '@/lib/restoreFlow';
import { loadSite, type SiteRecord } from '@/lib/siteStore';
import { tabBarStyle } from '@/lib/tabBar';
import { useLinkActions } from '@/lib/useLinkActions';
import { websiteView } from '@/lib/website';

const SUPPORT_EMAIL = 'support@davoxa.com';
const PRIVACY_URL = 'https://www.aibarber.org/privacy';
const TERMS_URL = 'https://www.aibarber.org/terms';
const SUBSCRIPTIONS_URL = 'itms-apps://apps.apple.com/account/subscriptions';

// As the privacy page says: deleting never takes a published site offline.
const SITE_STAYS_LIVE = `Your published website stays online until you email ${SUPPORT_EMAIL} and ask us to take it down.`;
const SUBSCRIPTION_SEPARATE = 'Deleting doesn’t cancel your subscription — do that in Manage subscription.';
const GREEN = '#22c55e';

type Busy = 'delete' | 'signout' | null;

/**
 * The Settings tab ("Settings" on aibarber.org/support): Your website (the
 * live link), account, Restore purchases, Delete account. Without a site
 * (the importer's Account pill, a deep link) it stands alone: no tab bar,
 * no "Your website", a back chevron.
 */
export default function Settings() {
  const navigation = useNavigation();
  const { session, ready } = useSession();
  const { restore, busy: restoring } = useRestoreFlow();
  const [busy, setBusy] = useState<Busy>(null);
  // undefined while loading; fresh on every visit (the editor and a publish change it).
  const [site, setSite] = useState<SiteRecord | null | undefined>(undefined);
  const signedIn = !!session?.user;

  useFocusEffect(
    useCallback(() => {
      track('settings_opened');
      let alive = true;
      loadSite()
        .then((s) => alive && setSite(s))
        .catch(() => alive && setSite(null));
      return () => {
        alive = false;
      };
    }, []),
  );

  const standalone = site === null;
  // Hidden until the site is known, so Edit can't be tapped with no site.
  const tabBarHidden = site == null;
  useLayoutEffect(() => {
    navigation.setOptions({ tabBarStyle: tabBarStyle(tabBarHidden) });
  }, [navigation, tabBarHidden]);

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
    <Page title="Settings" onBack={standalone ? goBackOrHome : undefined}>
      {site && <YourWebsite site={site} />}

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
        <Row label="Restore purchases" onPress={() => void restore()} busy={restoring} />
        <Row label="Manage subscription" onPress={manageSubscription} external />
      </Section>

      <Section title="Help">
        <Row label="Privacy Policy" onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_URL)} external />
        <Row label="Terms of Service" onPress={() => void WebBrowser.openBrowserAsync(TERMS_URL)} external />
        <Row label="Support" detail={SUPPORT_EMAIL} onPress={emailSupport} />
      </Section>

      <Section>
        <Row label="Delete account" onPress={confirmDelete} busy={busy === 'delete'} danger />
      </Section>

      <Text style={styles.version}>AI Barber {version}</Text>
    </Page>
  );
}

/** Shop name, the live link with /live's Open / Copy / Share, or "Not published yet" with Publish. */
function YourWebsite({ site }: { site: SiteRecord }) {
  const view = websiteView(site);
  const { open, copy, share, copied } = useLinkActions(view.url, 'settings');

  // The one publish path: the Edit tab's handlePublish (paywall, then /publishing).
  const publish = () => {
    track('settings_publish_tapped');
    requestPublish();
    router.navigate('/edit');
  };

  return (
    <Section title="Your website">
      <View style={styles.site}>
        <Text style={styles.siteName} numberOfLines={2}>
          {view.name}
        </Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: view.live ? GREEN : colors.faint }]} />
          <Text style={[styles.status, view.live && { color: GREEN }]}>{view.status}</Text>
        </View>
        {view.live ? (
          <>
            <Pressable onPress={open} accessibilityRole="link" accessibilityLabel={`Open ${view.host}`} hitSlop={6}>
              <Text style={styles.url} numberOfLines={1}>
                {view.host}
              </Text>
            </Pressable>
            <View style={styles.actions}>
              <Button variant="ghost" title="Open" onPress={open} style={styles.action} />
              <Button variant="ghost" title={copied ? 'Copied' : 'Copy'} onPress={copy} style={styles.action} />
              <Button variant="ghost" title="Share" onPress={share} style={styles.action} />
            </View>
          </>
        ) : (
          <Button variant="solid" title="Publish" onPress={publish} style={styles.publish} />
        )}
      </View>
    </Section>
  );
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
  site: { padding: 16 },
  siteName: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 26, color: colors.heading },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.muted },
  url: { fontFamily: fonts.mono, fontSize: 13, color: colors.accent, marginTop: 12, textDecorationLine: 'underline' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  action: { flex: 1, paddingHorizontal: 8 },
  publish: { alignSelf: 'stretch', marginTop: 16 },
});
