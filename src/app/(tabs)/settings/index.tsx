import { LearnEntry } from '@/components/LearnEntry';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import * as Application from 'expo-application';
import * as WebBrowser from 'expo-web-browser';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { ChevronRightIcon, ExternalLinkIcon } from '@/components/Icons';
import { Page } from '@/components/Page';
import { ShareSheet } from '@/components/ShareSheet';
import { deleteAccountAndData, deleteLocalData, onSiteAdopted, takeWebsiteOffline } from '@/lib/account';
import { track } from '@/lib/analytics';
import { ApiError } from '@/lib/api';
import { MOVE_IN_PROGRESS_MESSAGE } from '@/lib/claimCopy';
import { signOut, useSession } from '@/lib/auth';
import { tierFromEntitlements, useEntitlements } from '@/lib/entitlements';
import { goBackOrHome, resetTo } from '@/lib/nav';
import { useLatestTransactionId, usePaywall } from '@/lib/paywall';
import { DOMAIN_EXAMPLES_LABEL, DOMAIN_EXAMPLES_LINE, DOMAIN_ROW_EXAMPLE, DOMAIN_ROW_TITLE } from '@/lib/domains/model';
import { useDomainOffer } from '@/lib/domains/useDomainOffer';
import { planLabel } from '@/lib/plan';
import { PRIVACY_URL, TERMS_URL } from '@/lib/policyLinks';
import { remindersEnabled, setRemindersEnabled } from '@/lib/reminders';
import { isUnpublished, requestPublish, type PlanHint } from '@/lib/publishRequest';
import { useRestoreFlow } from '@/lib/restoreFlow';
import { loadSite, type SiteRecord } from '@/lib/siteStore';
import { siteOffline, useSubscriptionStatus } from '@/lib/subscriptionStatus';
import { isBlocking, paymentCopy, SETTINGS_OFFLINE_STATUS, UPDATE_PAYMENT_BUTTON, usePaymentLock, type BlockKind } from '@/lib/paymentLock';
import { openManageSubscription } from '@/lib/manageSubscription';
import { tabBarStyle } from '@/lib/tabBar';
import {
  CANCEL_APPLE_SUBSCRIPTION,
  SHOW_CANCEL_APPLE,
  CANCEL_APPLE_SUBSCRIPTION_URL,
  DELETE_ALERT_MESSAGE,
  DELETE_ALERT_TITLE,
  DELETE_SUCCESS_MESSAGE,
  LOCAL_DELETE_MESSAGE,
  OFFLINE_ALERT_MESSAGE,
  OFFLINE_ALERT_TITLE,
  SUBSCRIPTION_CONTINUES,
} from '@/lib/deleteCopy';
import { useLinkActions } from '@/lib/useLinkActions';
import { websiteView } from '@/lib/website';

const SUPPORT_EMAIL = 'support@davoxa.com';

const GREEN = '#22c55e';

type Busy = 'delete' | 'signout' | 'offline' | null;

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

  // Publish reminders switch (App Store 4.5.4): null until read.
  const [remindersOn, setRemindersOn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    remindersEnabled().then((v) => alive && setRemindersOn(v), () => alive && setRemindersOn(true));
    return () => {
      alive = false;
    };
  }, []);
  const onRemindersToggle = async (next: boolean) => {
    setRemindersOn(next);
    track('reminders_switch', { on: next });
    const r = await setRemindersEnabled(next);
    if (r === 'error') {
      setRemindersOn(!next);
      Alert.alert('Publish reminders', 'We couldn’t change this setting. Please try again.');
    } else if (r === 'denied') {
      setRemindersOn(false);
      Alert.alert('Notifications are off', 'Allow notifications for Prime Barber in the iPhone Settings app to get publish reminders.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => void Linking.openSettings().catch(() => {}) },
      ]);
    }
  };

  const standalone = site === null;
  // Hidden only once it is KNOWN there is no site (Edit can't be tapped then). While loading (undefined) the bar stays
  // as it is: hiding it until the read finished made the tab bar vanish and return on the first switch to Settings.
  const tabBarHidden = site === null;
  useLayoutEffect(() => {
    navigation.setOptions({ tabBarStyle: tabBarStyle(tabBarHidden) });
  }, [navigation, tabBarHidden]);

  const ents = useEntitlements();
  const paywall = usePaywall();
  const latestTransactionId = useLatestTransactionId();
  // The Plan row only exists once the account has a plan; before that (signed out, never subscribed, still loading) there is nothing to show.
  const planTier = ents.known ? tierFromEntitlements(ents) : null;

  // Upgrades open their paywall; downgrades and cancelling happen in Apple's Manage subscription.
  const openPlan = () => {
    track('plan_row_tapped');
    const choices: { label: string; run(): void }[] = [];
    // Before the website is published there is nothing to upgrade: the plan is picked on the one publish paywall.
    const publishFirst = isUnpublished(site) && ents.account !== 'other';
    const publishWith = (hint: PlanHint) => () => { track('settings_publish_tapped', { plan: hint }); requestPublish(hint); router.navigate('/edit'); };
    if (!ents.bookings) choices.push({ label: 'Upgrade to Bookings', run: publishFirst ? publishWith('bookings') : () => void paywall('bookings_upgrade') });
    if (!ents.store) choices.push({ label: 'Upgrade to Store', run: publishFirst ? publishWith('store') : () => void paywall('store_upgrade') });
    choices.push({ label: 'Manage subscription', run: manageSubscription });
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Your plan', options: [...choices.map((c) => c.label), 'Cancel'], cancelButtonIndex: choices.length },
      (i) => choices[i]?.run(),
    );
  };

  const manageSubscription = () => {
    track('manage_subscription_tapped');
    void openManageSubscription();
  };

  const cancelAppleSubscription = () => {
    track('cancel_apple_subscription_tapped');
    Linking.openURL(CANCEL_APPLE_SUBSCRIPTION_URL).catch(() =>
      Alert.alert(CANCEL_APPLE_SUBSCRIPTION, 'Open Settings → your name → Subscriptions on this iPhone.'),
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

  // One destructive confirmation at a time. `busy` is only set once a button is pressed, so two fast taps on a
  // row would stack two alerts (and run the action twice); this ref closes that gap synchronously.
  const inflight = useRef(false);
  const confirmOnce = (title: string, message: string, buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[]) => {
    if (busy || inflight.current) return;
    inflight.current = true;
    const release = () => {
      inflight.current = false;
    };
    Alert.alert(
      title,
      message,
      buttons.map((b) => ({
        ...b,
        onPress: () => {
          // A destructive action keeps the guard until it finishes (runGuarded releases it); the rest release now.
          if (b.style === 'destructive') b.onPress?.();
          else {
            release();
            b.onPress?.();
          }
        },
      })),
      { cancelable: true, onDismiss: release },
    );
  };
  const runGuarded = async (fn: () => Promise<void>) => {
    inflight.current = true;
    try {
      await fn();
    } finally {
      inflight.current = false;
    }
  };

  const confirmDelete = () => {
    if (signedIn) {
      confirmOnce(DELETE_ALERT_TITLE, DELETE_ALERT_MESSAGE, [
        ...(SHOW_CANCEL_APPLE ? [{ text: CANCEL_APPLE_SUBSCRIPTION, onPress: cancelAppleSubscription }] : []),
        { text: 'Delete account', style: 'destructive', onPress: () => void runDelete() },
        { text: 'Keep my account', style: 'cancel' },
      ]);
    } else {
      confirmOnce(
        'Delete data on this phone?',
        `You’re not signed in, so there’s no account to delete here — to delete an account, sign in first.\n\n${LOCAL_DELETE_MESSAGE}`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Manage subscription', onPress: manageSubscription },
          { text: 'Delete data on this phone', style: 'destructive', onPress: () => void runLocalDelete() },
        ],
      );
    }
  };

  // Published (or lapsed) site: it can be taken offline, with or without an account.
  const hasPublishedSite = !!site && (site.slug != null || !!site.deployedUrl);

  const confirmOffline = () => {
    confirmOnce(OFFLINE_ALERT_TITLE, OFFLINE_ALERT_MESSAGE, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Manage subscription', onPress: manageSubscription },
      { text: 'Take offline', style: 'destructive', onPress: () => void runOffline() },
    ]);
  };

  const runOffline = () =>
    runGuarded(async () => {
      setBusy('offline');
      try {
        // The transaction the site was published with; else the Apple ID's newest plan. Either way the server
        // purchase must be bound to THIS site (takeWebsiteOffline checks), or nothing is removed.
        const tx = site?.transactionId ?? (await latestTransactionId().catch(() => null));
        await takeWebsiteOffline(tx, site);
        resetTo('/start');
        Alert.alert('Website offline', `Your website is offline and its photos are deleted. ${SUBSCRIPTION_CONTINUES}`, [
          { text: 'OK', style: 'cancel' },
          { text: 'Manage subscription', onPress: manageSubscription },
        ]);
      } catch (e) {
        Alert.alert('Take my website offline', offlineError(e));
      } finally {
        setBusy(null);
      }
    });

  const runDelete = () =>
    runGuarded(async () => {
      setBusy('delete');
      try {
        await deleteAccountAndData();
        resetTo('/start');
        Alert.alert('Account deleted', DELETE_SUCCESS_MESSAGE, [
          ...(SHOW_CANCEL_APPLE ? [{ text: CANCEL_APPLE_SUBSCRIPTION, onPress: cancelAppleSubscription }] : []),
          { text: 'OK', style: 'cancel' as const },
        ]);
      } catch (e) {
        Alert.alert('Delete account', deleteError(e));
      } finally {
        setBusy(null);
      }
    });

  const runLocalDelete = () =>
    runGuarded(async () => {
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
    });

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
          </>
        )}
      </Section>

      <Section title="Subscription">
        {planTier && <Row label="Plan" detail={planLabel(planTier)} onPress={openPlan} chevron />}
        <Row label="Restore purchases" onPress={() => void restore()} busy={restoring} />
        <Row label="Manage subscription" onPress={manageSubscription} external />
      </Section>

      <Section title="Notifications">
        <Row
          label="Publish reminders"
          detail="Up to 3 reminders to publish your site"
          toggle={remindersOn == null ? undefined : { value: remindersOn, onChange: (v) => void onRemindersToggle(v) }}
        />
      </Section>

      <Section title="Help">
        <Row label="Privacy Policy" onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_URL)} external />
        <Row label="Terms of Service" onPress={() => void WebBrowser.openBrowserAsync(TERMS_URL)} external />
        <Row label="Support" detail={SUPPORT_EMAIL} onPress={emailSupport} />
      </Section>

      <Section>
        {hasPublishedSite && <Row label="Take my website offline" onPress={confirmOffline} busy={busy === 'offline'} danger />}
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
  const paymentLock = usePaymentLock(site);
  // Offline = the existing pill rule, or a failed / revoked payment (the same lock the editor and tabs use).
  const lapsed = siteOffline(site, useSubscriptionStatus(), ents) || isBlocking(paymentLock);
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
            {isBlocking(paymentLock) ? SETTINGS_OFFLINE_STATUS : view.status}
          </Text>
        </View>
        {view.offline ? (
          <>
            {/* The same link comes back on resubscribe; not tappable while it shows the offline page. */}
            <Text style={styles.offlineUrl} numberOfLines={1}>
              {view.host}
            </Text>
            {/* The same words and Apple button as the blocked editor and tabs. */}
            {isBlocking(paymentLock) && (
              <Text style={styles.offlineUrl}>{`${paymentCopy(paymentLock as BlockKind).title}. ${paymentCopy(paymentLock as BlockKind).body}`}</Text>
            )}
            <Button variant="solid" title={UPDATE_PAYMENT_BUTTON} onPress={() => { track('update_payment_tapped', { screen: 'settings' }); void openManageSubscription(); }} style={styles.publish} />
            <Button variant="ghost" title="Renew to put your site back" onPress={resubscribe} style={styles.publish} />
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

export function offlineError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return e.message;
    if (e.code === 'move-in-progress') return MOVE_IN_PROGRESS_MESSAGE;
    if (e.code === 'not-owner') return 'This website belongs to a different account than the one you’re signed in to. Sign in to the right account, then try again.';
    if (e.status === 403) return 'This website belongs to an account. Sign in to that account, then try again.';
    if (e.code === 'site-mismatch') return 'This Apple ID’s subscription runs a different website than the one on this phone, so nothing was taken offline. Try Restore purchases.';
    if (e.code === 'remove-failed') return 'Your website may be only partly removed. Please try again.';
    if (e.code === 'no-site') return 'We couldn’t find a published website for this subscription. Try Restore purchases first.';
  }
  return `We couldn’t take your website offline right now. Try again, or email ${SUPPORT_EMAIL}.`;
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
  label, detail, onPress, busy, chevron, external, danger, toggle,
}: {
  label: string;
  detail?: string;
  onPress?: () => void;
  busy?: boolean;
  chevron?: boolean;
  external?: boolean;
  danger?: boolean;
  /** A switch instead of a chevron; the row itself is not pressable. */
  toggle?: { value: boolean; onChange(v: boolean): void };
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
      {toggle ? (
        <Switch
          value={toggle.value}
          onValueChange={toggle.onChange}
          accessibilityLabel={label}
          trackColor={{ true: colors.accent }}
        />
      ) : busy ? (
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
