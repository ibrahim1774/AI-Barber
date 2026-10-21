import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { PausedBanner } from '@/components/PausedBanner';
import { UpgradeCard } from '@/components/UpgradeCard';
import { ShareSheet } from '@/components/ShareSheet';
import { OrdersPane } from '@/components/store/OrdersPane';
import { Segmented } from '@/components/store/Segmented';
import { StoreHeader } from '@/components/store/StoreHeader';
import { ProductsPane } from '@/components/store/products/ProductsPane';
import { loadMyShop, type Shop } from '@/lib/shop';
import { loadSite, type SiteRecord } from '@/lib/siteStore';
import { isLocked, useSubscriptionStatus } from '@/lib/subscriptionStatus';
import { useOpenStoreUpgrade, useStoreAccess } from '@/lib/store/gate';
import { countNewOrders, listOrders, loadStoreSettings } from '@/lib/store/data';

type Phase = 'loading' | 'error' | 'no-store' | 'ready';
type Tab = 'products' | 'orders';

/**
 * The Store tab: Products and Orders for the shop. Opens on Orders when a push
 * routes here with ?tab=orders&orderId=. Read-only once the hosting has lapsed.
 * Tier gating comes through useStoreAccess. Order actions are never locked: orders already placed
 * stay fulfillable and refundable after a lapse or a downgrade.
 */
export default function Store() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tab?: string; orderId?: string; n?: string }>();
  const status = useSubscriptionStatus();
  const access = useStoreAccess();
  const upgrade = useOpenStoreUpgrade();
  // Without the Store plan: whether any orders exist (they stay visible and actionable).
  const [hasOrders, setHasOrders] = useState<boolean | null>(null);
  const [site, setSite] = useState<SiteRecord | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [shop, setShop] = useState<Shop | null>(null);
  const [newOrders, setNewOrders] = useState(0);
  const [tab, setTab] = useState<Tab>(params.tab === 'orders' ? 'orders' : 'products');
  const [sharing, setSharing] = useState(false);
  const seq = useRef(0);

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
      if (mine !== seq.current) return;
      setShop(s);
      if (!settings.storeEnabled) {
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
  useEffect(() => {
    if (!noPlan || !shop) return;
    let alive = true;
    listOrders(shop.id, { limit: 1 })
      .then((o) => alive && setHasOrders(o.length > 0))
      .catch(() => alive && setHasOrders(false));
    return () => {
      alive = false;
    };
  }, [noPlan, shop]);

  const lapsed = isLocked(site, status);
  // Products are view-only without the Store plan or after a lapse. Orders never are.
  const locked = lapsed || noPlan;
  const shell = [styles.root, { paddingTop: insets.top }];

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

  // The Store plan lapsed (Website or Bookings plan) and there are no orders to keep serving.
  if (noPlan && hasOrders === false) {
    return (
      <View style={[...shell, styles.center]}>
        <UpgradeCard kind="store" onUpgrade={upgrade.open} busy={upgrade.busy} />
      </View>
    );
  }
  if (noPlan && hasOrders === null) {
    return (
      <View style={[...shell, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={shell}>
      <StoreHeader title={shop.name} locked={locked} onShare={() => setSharing(true)} onSetup={() => router.push('/store-setup' as never)} />
      {lapsed && (
        <Text style={styles.locked}>Your subscription has ended. Your store is read-only until you resubscribe.</Text>
      )}
      {noPlan && !lapsed && <PausedBanner kind="store" onUpgrade={upgrade.open} />}
      <Segmented<Tab>
        options={[
          { key: 'products', label: 'Products' },
          { key: 'orders', label: 'Orders', badge: newOrders },
        ]}
        value={tab}
        onChange={setTab}
      />
      <View style={styles.flex}>
        {tab === 'products' ? (
          <ProductsPane shopId={shop.id} locked={locked} lockReason={lapsed ? 'lapsed' : 'plan'} onUpgrade={upgrade.open} />
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
