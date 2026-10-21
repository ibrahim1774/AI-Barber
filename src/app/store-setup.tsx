import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { UpgradeCard } from '@/components/UpgradeCard';
import { Page } from '@/components/Page';
import { StoreSettingsForm } from '@/components/store/setup/StoreSettingsForm';
import { track } from '@/lib/analytics';
import { syncIfSignedIn } from '@/lib/account';
import { useSession } from '@/lib/auth';
import { goBackOrHome } from '@/lib/nav';
import { useTierAccess, useUpgrade } from '@/lib/tierAccess';
import { useLatestTransactionId } from '@/lib/paywall';
import { setPostAuthReturn } from '@/lib/setup/gate';
import { buildSetupBody, shopSetup } from '@/lib/setup/ownerApi';
import { registerPushForShop, relinkShopPurchase } from '@/lib/setup/relink';
import { loadMyShop, type Shop } from '@/lib/shop';
import { loadSite } from '@/lib/siteStore';

type Phase =
  | { kind: 'loading' }
  | { kind: 'gate' }
  | { kind: 'nosite' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; shop: Shop };

/**
 * Store setup. Account gate first (the store needs a free account), then the shop row via
 * POST /api/shop/setup with no services (the bookings setup seeds those later), then the settings.
 */
export default function StoreSetup() {
  const { session, ready } = useSession();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const signedIn = !!session;
  const latestTransactionId = useLatestTransactionId();
  const tier = useTierAccess('store');
  const upgrade = useUpgrade('store_upgrade');
  // Without the plan there is nothing to set up (and no shop is created); wait until that is known.
  const blocked = tier.status === 'ready' && !tier.entitled;
  const waiting = tier.status === 'loading';

  const load = useCallback(async () => {
    try {
      const site = await loadSite();
      if (!site) return setPhase({ kind: 'nosite' });
      let shop = await loadMyShop();
      if (!shop) {
        // The account needs the site row first (the server picks the slug from it).
        await syncIfSignedIn(site);
        await shopSetup({ ...buildSetupBody(site), services: [] });
        track('store_shop_created');
        void registerPushForShop();
        shop = await loadMyShop();
      }
      if (!shop) return setPhase({ kind: 'error', message: "We couldn't create your shop. Try again." });
      setPhase({ kind: 'ready', shop });
      // A shop made before the subscription was linked stays paused: link it now, quietly.
      if (!shop.purchaseLinked) {
        void relinkShopPurchase({ latestTransactionId }).then(async (linked) => {
          if (!linked) return;
          const fresh = await loadMyShop().catch(() => null);
          if (fresh) setPhase((p) => (p.kind === 'ready' ? { kind: 'ready', shop: fresh } : p));
        });
      }
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong. Try again.' });
    }
  }, [latestTransactionId]);

  useEffect(() => {
    if (!ready || blocked) return;
    if (!signedIn) {
      setPhase({ kind: 'gate' });
      return;
    }
    setPostAuthReturn(null);
    setPhase({ kind: 'loading' });
    if (!blocked && !waiting) void load();
  }, [ready, signedIn, load, blocked, waiting]);

  // Leaving the gate without signing in must not send a later sign-in back here.
  useEffect(() => () => setPostAuthReturn(null), []);

  const goGate = (to: '/sign-up' | '/sign-in') => {
    setPostAuthReturn('/store-setup');
    router.push(to);
  };

  return (
    <Page title="Store setup" onBack={goBackOrHome}>
      {blocked && <UpgradeCard kind="store" onUpgrade={() => void upgrade.run()} busy={upgrade.busy} />}
      {!blocked && phase.kind === 'loading' && <ActivityIndicator color={colors.accent} style={{ marginTop: 48 }} />}
      {!blocked && phase.kind === 'gate' && (
        <View style={st.center}>
          <Text style={st.h}>Create a free account to sell online</Text>
          <Text style={st.p}>
            Your account keeps your products, orders and payments safe, and gets them back on a new phone. Your website
            stays as it is.
          </Text>
          <Button title="Create account" onPress={() => goGate('/sign-up')} />
          <Button variant="ghost" title="I already have an account" onPress={() => goGate('/sign-in')} />
        </View>
      )}
      {!blocked && phase.kind === 'nosite' && (
        <View style={st.center}>
          <Text style={st.h}>Build your website first</Text>
          <Text style={st.p}>Your shop uses your shop's name and look.</Text>
          <Button title="Build my website" onPress={() => router.replace('/start')} />
        </View>
      )}
      {!blocked && phase.kind === 'error' && (
        <View style={st.center}>
          <Text style={st.p}>{phase.message}</Text>
          <Button title="Try again" onPress={() => { setPhase({ kind: 'loading' }); void load(); }} />
        </View>
      )}
      {!blocked && phase.kind === 'ready' && <StoreSettingsForm shop={phase.shop} />}
    </Page>
  );
}

const st = StyleSheet.create({
  center: { gap: 16 },
  h: { fontFamily: fonts.heading, fontSize: 24, color: colors.heading },
  p: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.body },
});
