import { LearnEntry } from '@/components/LearnEntry';
import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import * as Application from 'expo-application';
import * as WebBrowser from 'expo-web-browser';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { ChevronRightIcon, ExternalLinkIcon } from '@/components/Icons';
import { Page } from '@/components/Page';
import { ShareSheet } from '@/components/ShareSheet';
import { deleteAccountAndData, deleteLocalData, onSiteAdopted } from '@/lib/account';
import { track } from '@/lib/analytics';
import { ApiError } from '@/lib/api';
import { signOut, useSession } from '@/lib/auth';
import { tierFromEntitlements, useEntitlements } from '@/lib/entitlements';
import { goBackOrHome, resetTo } from '@/lib/nav';
import { usePaywall } from '@/lib/paywall';
import { DOMAIN_EXAMPLES_LABEL, DOMAIN_EXAMPLES_LINE, DOMAIN_ROW_EXAMPLE, DOMAIN_ROW_TITLE } from '@/lib/domains/model';
import { useDomainOffer } from '@/lib/domains/useDomainOffer';
import { planLabel } from '@/lib/plan';
import { requestPublish } from '@/lib/publishRequest';
import { useRestoreFlow } from '@/lib/restoreFlow';
import { loadSite, type SiteRecord } from '@/lib/siteStore';
import { siteOffline, useSubscriptionStatus } from '@/lib/subscriptionStatus';
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
  const { restore, busy: restoring } = useRestoreFlow({ stay: true });
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

  // A site loaded from the account while this tab is up.
  useEffect(() => onSiteAdopted((s) => setSite(s)), []);

  const standalone = site === null;
  // Hidden until the site is known, so Edit can't be tapped with no site.
  const tabBarHidden = site == null;
  useLayoutEffect(() => {
    navigation.setOptions({ tabBarStyle: tabBarStyle(tabBarHidden) });
  }, [navigation, tabBarHidden]);

  const ents = useEntitlements();
  const paywall = usePaywall();
  const planDetail = ents.known ? planLabel(tierFromEntitlements(ents)) : '…';

  // Upgrades open their paywall; downgrades and cancelling happen in Apple's Manage subscription.
  const openPlan = () => {
    track('plan_row_tapped');
    const choices: { label: string; run(): void }[] = [];
    if (!ents.bookings) choices.push({ label: 'Upgrade to Bookings', run: () => void paywall('bookings_upgrade') });
    if (!ents.store) choices.push({ label: 'Upgrade to Store', run: () => void paywall('store_upgrade') });
    choices.push({ label: 'Manage subscription', run: manageSubscription });
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Your plan', options: [...choices.map((c) => c.label), 'Cancel'], cancelButtonIndex: choices.length },
      (i) => choices[i]?.run(),
    );
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
      // Sign-out takes this account's site off the phone: with none left, back to the start.
      const left = await loadSite().catch(() => null);
      setSite(left);
      if (!left) resetTo('/start');
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
        `This permanently deletes your Prime Barber account and the site records saved to it, and removes your website from this phone. ${SITE_STAYS_LIVE}\n\n${SUBSCRIPTION_SEPARATE}`,
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
      Alert.alert('Account deleted', `Your Prime Barber account has been deleted. ${SITE_STAYS_LIVE}`);
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
      <LearnEntry onPress={() => { track('learn_opened'); router.push('/settings/learn' as never); }} />
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
            <View style={styles.signInBox}>
              <Button variant="solid" title="Sign in" onPress={() => router.push('/sign-in')} />
              <Text style={styles.signInNote}>Use the email and password of your Prime Barber account.</Text>
            </View>
            <Row label="Create account" onPress={() => router.push('/sign-up')} chevron />
          </>
        )}
      </Section>

      <Section title="Subscription">
        <Row label="Plan" detail={planDetail} onPress={ents.known ? openPlan : undefined} chevron={ents.known} />
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

      <Text style={styles.version}>Prime Barber {version}</Text>
    </Page>
  );
}

/**
 * Shop name, the live link with /live's Open / Copy / Share, "Offline" with
 * Resubscribe once the subscription has lapsed, or "Not published yet" with
 * Publish.
 */
function YourWebsite({ site }: { site: SiteRecord }) {
  const ents = useEntitlements();
  const lapsed = siteOffline(site, useSubscriptionStatus(), ents);
  const view = websiteView(site, lapsed);
  const { open, copy, copied } = useLinkActions(view.url, 'settings');
  const [shareOpen, setShareOpen] = useState(false);
  const shareSite = () => {
    if (view.url) setShareOpen(true);
  };

  useEffect(() => {
    if (lapsed) track('subscription_lapsed_shown', { screen: 'settings' });
  }, [lapsed]);

  // The one publish path: the Edit tab's handlePublish (paywall, then /publishing).
  const publish = () => {
    track('settings_publish_tapped');
    requestPublish();
    router.navigate('/edit');
  };

  // Same path: the paywall, then the republish brings the site back on its link.
  const resubscribe = () => {
    track('resubscribe_tapped', { screen: 'settings' });
    requestPublish();
    router.navigate('/edit');
  };

  return (
    <>
    <Section title="Your website">
      <View style={styles.site}>
        <Text style={styles.siteName} numberOfLines={2}>
          {view.name}
        </Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: view.live ? GREEN : view.offline ? colors.danger : colors.faint }]} />
          <Text style={[styles.status, view.live && { color: GREEN }, view.offline && { color: colors.danger }]}>
            {view.status}
          </Text>
        </View>
        {view.offline ? (
          <>
            {/* The same link comes back on resubscribe; not tappable while it shows the offline page. */}
            <Text style={styles.offlineUrl} numberOfLines={1}>
              {view.host}
            </Text>
            <Button variant="solid" title="Renew to put your site back" onPress={resubscribe} style={styles.publish} />
          </>
        ) : view.live ? (
          <>
            <Pressable onPress={open} accessibilityRole="link" accessibilityLabel={`Open ${view.host}`} hitSlop={6}>
              <Text style={styles.url} numberOfLines={1}>
                {view.host}
              </Text>
            </Pressable>
            <View style={styles.actions}>
              <Button variant="ghost" title="Open" onPress={open} style={styles.action} />
              <Button variant="ghost" title={copied ? 'Copied' : 'Copy'} onPress={copy} style={styles.action} />
              <Button variant="ghost" title="Share" onPress={shareSite} style={styles.action} />
            </View>
          </>
        ) : (
          <Button variant="solid" title="Publish" onPress={publish} style={styles.publish} />
        )}
      </View>
    </Section>
    {view.live && view.url && (
      <>
        <DomainCard />
        <Section>
          <Row label="Share your site" detail="Message, QR code, Instagram bio" onPress={shareSite} chevron />
          <Row label="Your team" detail="Barbers, photos, services, hours" onPress={() => router.push('/team')} chevron />
          <Row label="Bookings setup" detail="Services, barbers, hours" onPress={() => router.push('/bookings-setup')} chevron />
          <Row label="Get paid" detail="Cash App, Venmo, Zelle, PayPal, cards" onPress={() => router.push('/get-paid')} chevron />
        </Section>
        <ShareSheet
          visible={shareOpen}
          shopName={view.name}
          links={[{ kind: 'website', url: view.url }]}
          source="settings"
          onClose={() => setShareOpen(false)}
        />
      </>
    )}
    </>
  );
}

function deleteError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return e.message;
    if (e.status === 401) return 'Your sign-in has expired. Sign out, sign in again, then delete your account.';
  }
  return `We couldn’t delete your account right now. Try again, or email ${SUPPORT_EMAIL}.`;
}

/**
 * Settings → right under "Your website": a compact custom-domain card. The offer ("Custom Domain", Example: jacksbarbershop.com)
 * with a button into the domain screen, or, once the site has a domain, that domain and its status.
 */
function DomainCard() {
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const { known, hasDomain, detail } = useDomainOffer(focused);
  const open = () => {
    track('domain_card_tapped', { screen: 'settings', has_domain: hasDomain });
    router.push('/domain');
  };
  return (
    <View style={styles.domainCard}>
      <View style={styles.domainTop}>
        <View style={styles.domainText}>
          <Text style={styles.rowLabel}>{DOMAIN_ROW_TITLE}</Text>
          {known && hasDomain ? (
            <Text style={styles.rowDetail} numberOfLines={2}>{detail}</Text>
          ) : (
            <Text style={styles.rowDetail} numberOfLines={2}>
              <Text style={{ color: colors.grey }}>Example: </Text>
              <Text style={{ color: colors.accent, fontFamily: fonts.bodySemi }}>{DOMAIN_ROW_EXAMPLE}</Text>
            </Text>
          )}
        </View>
        <Button variant="ghost" title={hasDomain ? 'Manage' : 'Get yours'} onPress={open} style={styles.domainButton} />
      </View>
      <Text style={styles.domainNote}>{DOMAIN_EXAMPLES_LABEL}: {DOMAIN_EXAMPLES_LINE}</Text>
    </View>
  );
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
  domainCard: { marginBottom: 28, marginTop: -12, backgroundColor: colors.sheet, borderRadius: 14, borderWidth: 1, borderColor: colors.hair, paddingTop: 12 },
  domainTop: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  domainText: { flex: 1 },
  signInBox: { padding: 16, gap: 10 },
  signInNote: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.muted, textAlign: 'center' },
  domainButton: { paddingHorizontal: 14, minHeight: 40 },
  domainNote: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.faint, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.muted },
  url: { fontFamily: fonts.mono, fontSize: 13, color: colors.accent, marginTop: 12, textDecorationLine: 'underline' },
  offlineUrl: { fontFamily: fonts.mono, fontSize: 13, color: colors.faint, marginTop: 12 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  action: { flex: 1, paddingHorizontal: 8 },
  publish: { alignSelf: 'stretch', marginTop: 16 },
});
