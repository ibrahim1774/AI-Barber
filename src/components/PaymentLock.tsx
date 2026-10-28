import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { AlertCircleIcon } from '@/components/Icons';
import { openManageSubscription } from '@/lib/manageSubscription';
import {
  CHECK_AGAIN_BUTTON, isBlocking, PAYMENT_BANNER, PAYMENT_FAILED_BODY, PAYMENT_FAILED_TITLE, PAYMENT_REVOKED_BODY,
  PAYMENT_REVOKED_TITLE, UPDATE_PAYMENT_BUTTON, usePaymentLock, type PaymentLock,
} from '@/lib/paymentLock';
import { getPlan, getPlanEpoch, refreshPlanQuietly, setSharedPlan } from '@/lib/plan';
import { useLatestTransactionId } from '@/lib/paywall';
import { recheckSubscriptionStatus } from '@/lib/subscriptionStatus';
import { loadSite, type SiteRecord } from '@/lib/siteStore';
import { goBackOrHome } from '@/lib/nav';
import { track } from '@/lib/analytics';

/** "I've renewed": re-reads the server plan (verifying the newest purchase with Apple) and the per-site subscription check. */
export function useCheckAgain(): { check: () => Promise<void>; busy: boolean } {
  const latestTx = useLatestTransactionId();
  const [busy, setBusy] = useState(false);
  const check = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      track('payment_check_again_tapped');
      const tx = await Promise.resolve(latestTx()).catch(() => null);
      await refreshPlanQuietly(tx);
      const epoch = getPlanEpoch();
      await getPlan().then((p) => epoch === getPlanEpoch() && setSharedPlan(p)).catch(() => {});
      recheckSubscriptionStatus(true);
    } finally {
      setBusy(false);
    }
  }, [busy, latestTx]);
  return { check, busy };
}

const updatePayment = (screen: string) => () => {
  track('update_payment_tapped', { screen });
  void openManageSubscription();
};

/**
 * The screen in place of the editor / a tab once the account's own subscription could not be renewed. It is a card, not a
 * trap: Settings (Sign out, Delete account, Restore purchases, Manage subscription) stays reachable through the tab bar,
 * and a pushed screen gets a Back button.
 */
export function PaymentBlock({
  kind, screen, onRestore, restoring, onResubscribe, onBack,
}: {
  kind: 'failed' | 'revoked';
  screen: string;
  onRestore?(): void;
  restoring?: boolean;
  onResubscribe?(): void;
  onBack?(): void;
}) {
  const { check, busy } = useCheckAgain();
  useEffect(() => {
    track('subscription_lapsed_shown', { screen });
  }, [screen]);
  const revoked = kind === 'revoked';
  return (
    <View style={styles.root} testID="payment-block">
      <View style={styles.card}>
        <View style={styles.badge}>
          <AlertCircleIcon size={36} color={colors.accent} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {revoked ? PAYMENT_REVOKED_TITLE : PAYMENT_FAILED_TITLE}
        </Text>
        <Text style={styles.body}>{revoked ? PAYMENT_REVOKED_BODY : PAYMENT_FAILED_BODY}</Text>
        <Button title={UPDATE_PAYMENT_BUTTON} onPress={updatePayment(screen)} style={styles.wide} />
        <Button variant="ghost" title={CHECK_AGAIN_BUTTON} onPress={() => void check()} loading={busy} style={[styles.wide, styles.gap]} />
        {onResubscribe && <Button variant="ghost" title="Subscribe again" onPress={onResubscribe} style={[styles.wide, styles.gap]} />}
        {onRestore && <Button variant="ghost" title="Restore purchases" onPress={onRestore} loading={restoring} style={[styles.wide, styles.gap]} />}
        {onBack && <Button variant="link" title="Back" onPress={onBack} style={styles.gap} />}
      </View>
    </View>
  );
}

/** The non-blocking notice while Apple is still retrying the payment: access stays, the same Apple button. */
export function PaymentBanner({ screen }: { screen: string }) {
  useEffect(() => {
    track('payment_retry_banner_shown', { screen });
  }, [screen]);
  return (
    <View style={styles.banner} accessibilityRole="alert" testID="payment-banner">
      <Text style={styles.bannerText}>{PAYMENT_BANNER}</Text>
      <Button title={UPDATE_PAYMENT_BUTTON} onPress={updatePayment(screen)} variant="ghost" style={styles.bannerBtn} />
    </View>
  );
}

/** The lock for the phone's own site (loaded on mount) for screens that do not hold the site record. */
function useLocalLock(): PaymentLock {
  const [site, setSite] = useState<SiteRecord | null>(null);
  useEffect(() => {
    let alive = true;
    loadSite().then((s) => alive && setSite(s)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return usePaymentLock(site);
}

/** Wraps a pushed screen: the block in its place when payment failed, the banner above it during Apple's retry. */
export function PaymentGate({ screen, children }: { screen: string; children: ReactNode }) {
  const lock = useLocalLock();
  if (isBlocking(lock)) return <PaymentBlock kind={lock as 'failed' | 'revoked'} screen={screen} onBack={goBackOrHome} />;
  return (
    <>
      {lock === 'retry' && <PaymentBanner screen={screen} />}
      {children}
    </>
  );
}

/** A pushed screen behind the payment gate. */
export function withPaymentGate<P extends object>(Screen: ComponentType<P>, screen: string): ComponentType<P> {
  const Gated = (props: P) => (
    <PaymentGate screen={screen}>
      <Screen {...props} />
    </PaymentGate>
  );
  Gated.displayName = `PaymentGate(${screen})`;
  return Gated;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  card: {
    alignSelf: 'stretch', maxWidth: 460, alignItems: 'center',
    backgroundColor: colors.sheet, borderRadius: 18, borderWidth: 1, borderColor: colors.hair,
    paddingHorizontal: 22, paddingVertical: 32,
  },
  badge: {
    width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 20,
    backgroundColor: 'rgba(244,161,0,0.14)',
  },
  title: { fontFamily: fonts.heading, fontSize: 22, lineHeight: 28, color: colors.heading, textAlign: 'center', marginBottom: 12 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.muted, textAlign: 'center', marginBottom: 28 },
  wide: { alignSelf: 'stretch' },
  gap: { marginTop: 12 },
  banner: {
    marginHorizontal: 16, marginTop: 8, marginBottom: 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.hair,
    backgroundColor: colors.sheet, gap: 10,
  },
  bannerText: { fontFamily: fonts.bodySemi, fontSize: 13, lineHeight: 19, color: colors.accent },
  bannerBtn: { alignSelf: 'flex-start' },
});
