import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { PausedBanner } from '@/components/PausedBanner';
import { UpgradeCard } from '@/components/UpgradeCard';
import { PublishFirstCard } from '@/components/PublishFirstCard';
import { ShareSheet } from '@/components/ShareSheet';
import { CustomersPane } from '@/components/store/customers/CustomersPane';
import { OrdersPane } from '@/components/store/OrdersPane';
import { Segmented } from '@/components/store/Segmented';
import { StoreHeader } from '@/components/store/StoreHeader';
import { TutorialLayer } from '@/components/tutorial/TutorialLayer';
import { useTutorialTarget } from '@/components/tutorial/registry';
import { useTour } from '@/components/tutorial/useTour';
import { ProductsPane } from '@/components/store/products/ProductsPane';
import { loadMyShop, type Shop } from '@/lib/shop';
import { loadSite, type SiteRecord } from '@/lib/siteStore';
import { PaymentBanner, PaymentBlock } from '@/components/PaymentLock';
import { isBlocking, usePaymentLock } from '@/lib/paymentLock';
import { useEntitlements } from '@/lib/entitlements';
import { isUnpublished, requestPublish } from '@/lib/publishRequest';
import { useOpenStoreUpgrade, useStoreAccess } from '@/lib/store/gate';
import { useUpdateSitePrompt } from '@/lib/setupPrompt';
import { countNewOrders, hasAnyOrders, loadStoreSettings } from '@/lib/store/data';

type Phase = 'loading' | 'error' | 'no-store' | 'ready';
type Tab = 'products' | 'orders' | 'customers';

/**
 * The Store tab: Products, Orders and Customers for the shop. Opens on Orders when a push
 * routes here with ?tab=orders&orderId=. Read-only once the hosting has lapsed.
 * Tier gating comes through useStoreAccess. Order actions are never locked: orders already placed
 * stay fulfillable and refundable after a lapse or a downgrade.
 */
export default function Store() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tab?: string; orderId?: string; n?: string }>();
  const access = useStoreAccess();
  const ents = useEntitlements();
  const upgrade = useOpenStoreUpgrade();
  // Closing the shop or losing the plan never hides orders: they stay visible and actionable.
  const [anyOrders, setAnyOrders] = useState(false);
  const [storeOpen, setStoreOpen] = useState(true);
  const [site, setSite] = useState<SiteRecord | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [shop, setShop] = useState<Shop | null>(null);
  const [newOrders, setNewOrders] = useState(0);
  const [tab, setTab] = useState<Tab>(params.tab === 'orders' ? 'orders' : 'products');
  const [sharing, setSharing] = useState(false);
  const seq = useRef(0);
  const headerRef = useTutorialTarget('store.header');
  const tabsRef = useTutorialTarget('store.tabs');
  const sitePrompt = useUpdateSitePrompt('store');

  // A push tap while the tab is mounted changes the params.
  useEffect(() => {
    if (params.tab === 'orders') setTab('orders');
  }, [params.tab, params.orderId, params.n]);

  const refreshCount = useCallback(async (shopId: string) => {
    try {
      setNewOrders(await countNewOrders(shopId));
    } catch {
      /* the badge is a nicety */
    }
  }, []);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const [s, st] = await Promise.all([loadMyShop(), loadSite().catch(() => null)]);
      if (mine !== seq.current) return;
      setSite(st);
      if (!s) {
        setShop(null);
        setPhase('no-store');
        return;
      }
      const settings = await loadStoreSettings(s.id);
      // One unfiltered limit-1 read; if it fails, show the orders view rather than hide orders.
      const orders = await hasAnyOrders(s.id).catch(() => true);
      if (mine !== seq.current) return;
      setShop(s);
      setStoreOpen(settings.storeEnabled);
      setAnyOrders(orders);
      // The setup card only for a store that was never opened and has no orders.
      if (!settings.storeEnabled && !orders) {
        setPhase('no-store');
        return;
      }
      setPhase('ready');
      void refreshCount(s.id);
    } catch (e) {
      if (mine !== seq.current) return;
      console.warn('[store] load failed', e);
      // Keep what is on screen when a refresh fails; only a first load shows the error card.
      setPhase((p) => (p === 'ready' ? p : 'error'));
    }
  }, [refreshCount]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        seq.current++;
      };
    }, [load]),
  );

  const noPlan = access.status === 'inactive';
  // Payment failed / subscription ended: the whole tab is blocked (see PaymentBlock). Apple's retry window is a banner.
  const paymentLock = usePaymentLock(site);
  const lapsed = isBlocking(paymentLock);
  const tour = useTour('store', { auto: 'store', ready: phase === 'ready' && !!shop && access.status !== 'loading' && access.status !== 'error' });
  // Products are view-only without the Store plan or after a lapse. Orders never are.
  const locked = lapsed || noPlan;
  const shell = [styles.root, { paddingTop: insets.top }];

  if (lapsed) {
    return (
      <View style={shell}>
        <PaymentBlock kind={paymentLock as 'failed' | 'revoked'} screen="store" />
      </View>
    );
  }

  if (access.status === 'error') {
    return (
      <View style={[...shell, styles.center]}>
        <Card title="Couldn't load your plan" body="Check your connection and try again." action="Try again" onAction={() => { access.retry(); void load(); }} />
      </View>
    );
  }

  if (phase === 'loading' || access.status === 'loading') {
    return (
      <View style={[...shell, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={[...shell, styles.center]}>
        <Card title="Couldn't load your store" body="Check your connection and try again." action="Try again" onAction={() => void load()} />
      </View>
    );
  }

  // Before the website is published there is nothing to upgrade: Publish opens the one publish paywall with this plan in front.
  if (noPlan && isUnpublished(site) && !shop && ents.account !== 'other') {
    return (
      <View style={[...shell, styles.center]}>
        <PublishFirstCard
          kind="store"
          onPublish={() => {
            requestPublish('store');
            router.navigate('/edit');
          }}
        />
      </View>
    );
  }

  if (noPlan && (phase === 'no-store' || !shop)) {
    return (
      <View style={[...shell, styles.center]}>
        <UpgradeCard kind="store" onUpgrade={upgrade.open} busy={upgrade.busy} />
      </View>
    );
  }

  if (phase === 'no-store' || !shop) {
    return (
      <View style={[...shell, styles.center]}>
        <Card
          title="Open your shop"
          body="Sell products from your website. Customers pay by card, Cash App and more, or pay at pickup."
          action="Set up your shop"
          onAction={() => router.push('/store-setup' as never)}
        />
      </View>
    );
  }

  // No Store plan and no orders to keep serving. Inside the 30-day window after a lapse the shop stays readable
  // (like Bookings); after it, only the upgrade card.
  if (noPlan && !anyOrders && (access.hosting || access.expired)) {
    return (
      <View style={[...shell, styles.center]}>
        <UpgradeCard kind="store" onUpgrade={upgrade.open} busy={upgrade.busy} />
      </View>
    );
  }
  return (
    <View style={shell}>
      <View ref={headerRef} collapsable={false}>
        <StoreHeader title={shop.name} locked={locked} onShare={() => setSharing(true)} onSetup={() => router.push('/store-setup' as never)} />
      </View>
      {paymentLock === 'retry' && <PaymentBanner screen="store" />}
      {noPlan && <PausedBanner kind="store" onUpgrade={upgrade.open} action="See plans" />}
      {!storeOpen && (
        <Text style={styles.locked}>Your shop is closed to customers. Open it in Store setup.</Text>
      )}
      <View ref={tabsRef} collapsable={false}>
        <Segmented<Tab>
          options={[
            { key: 'products', label: 'Products' },
            { key: 'orders', label: 'Orders', badge: newOrders },
            { key: 'customers', label: 'Customers' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>
      <View style={styles.flex}>
        {tab === 'products' ? (
          <ProductsPane shopId={shop.id} locked={locked} lockReason={lapsed ? 'lapsed' : 'plan'} onUpgrade={upgrade.open}
            // The Shop button is offered once there is something to buy.
            onFirstProduct={() => { if (storeOpen) void sitePrompt.offer().catch(() => {}); }}
          />
        ) : tab === 'customers' ? (
          <CustomersPane />
        ) : (
          <OrdersPane
            shopId={shop.id}
            shopName={shop.name}
            locked={false}
            focusOrderId={params.orderId}
            focusNonce={params.n}
            onChanged={() => void refreshCount(shop.id)}
          />
        )}
      </View>
      <TutorialLayer controller={tour} />
      <ShareSheet
        visible={sharing}
        shopName={shop.name}
        links={site?.deployedUrl ? [{ kind: 'website', url: site.deployedUrl }] : []}
        source="settings"
        onClose={() => setSharing(false)}
      />
    </View>
  );
}

function Card({ title, body, action, onAction }: { title: string; body: string; action: string; onAction(): void }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle} accessibilityRole="header">{title}</Text>
      <Text style={styles.cardBody}>{body}</Text>
      <Button title={action} onPress={onAction} style={styles.cardBtn} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  locked: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.accent, paddingHorizontal: 16, paddingBottom: 10 },
  card: {
    alignSelf: 'stretch', maxWidth: 460, alignItems: 'center', backgroundColor: colors.sheet, borderRadius: 18,
    borderWidth: 1, borderColor: colors.hair, paddingHorizontal: 22, paddingVertical: 32,
  },
  cardTitle: { fontFamily: fonts.heading, fontSize: 22, lineHeight: 28, color: colors.heading, textAlign: 'center', marginBottom: 10 },
  cardBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.muted, textAlign: 'center', marginBottom: 24 },
  cardBtn: { alignSelf: 'stretch' },
});
