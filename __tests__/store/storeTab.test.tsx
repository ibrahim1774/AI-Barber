import React from 'react';
// No @types for react-test-renderer here; require keeps it untyped.
const { act, create } = require('react-test-renderer');

const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => {
  const R = require('react');
  return {
    router: { push: (...a: unknown[]) => mockPush(...a) },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb: () => void) => R.useEffect(cb, []),
  };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/constants/theme', () => ({
  colors: new Proxy({}, { get: () => '#000' }),
  fonts: new Proxy({}, { get: () => 'System' }),
}));
jest.mock('@/components/ShareSheet', () => ({ ShareSheet: () => null }));
jest.mock('@/components/store/products/ProductsPane', () => ({
  ProductsPane: (p: { locked: boolean }) => {
    const { Text } = require('react-native');
    return <Text>{p.locked ? 'products-locked' : 'products'}</Text>;
  },
}));
const mockOrdersPane = jest.fn((_p: Record<string, unknown>) => null);
jest.mock('@/components/store/OrdersPane', () => ({ OrdersPane: (p: Record<string, unknown>) => mockOrdersPane(p) }));

let mockShop: any = null;
jest.mock('@/lib/shop', () => ({ loadMyShop: async () => mockShop }));
let mockSite: any = null;
jest.mock('@/lib/siteStore', () => ({ loadSite: async () => mockSite }));
jest.mock('@/components/PaymentLock', () => {
  const { Text } = require('react-native');
  return { PaymentBlock: () => <Text>payment-block</Text>, PaymentBanner: () => <Text>payment-banner</Text> };
});
let mockStatus = 'active';
jest.mock('@/lib/subscriptionStatus', () => ({
  useSubscriptionStatus: () => mockStatus,
  isLocked: (site: any, status: string) => !!site?.deployedUrl && status === 'lapsed',
}));
let mockSettings: any = { storeEnabled: true };
let mockCount = 0;
let mockAnyOrders = false;
jest.mock('@/lib/store/data', () => ({
  loadStoreSettings: async () => mockSettings,
  countNewOrders: async () => mockCount,
  hasAnyOrders: async () => mockAnyOrders,
}));
let mockAccess = 'active';
jest.mock('@/lib/store/gate', () => ({
  useStoreAccess: () => ({ status: mockAccess, expired: false, hosting: true, retry: () => {} }),
  useOpenStoreUpgrade: () => ({ open: jest.fn(), busy: false }),
}));

import Store from '@/app/(tabs)/store';

const texts = (r: any) => r.root.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => [].concat(n.props.children).join(''));
const byLabel = (r: any, label: string) =>
  r.root.findAll((n: any) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');

async function render() {
  let r: any;
  await act(async () => {
    r = create(React.createElement(Store));
  });
  return r;
}

beforeEach(() => {
  mockPush.mockClear();
  mockOrdersPane.mockClear();
  mockParams = {};
  mockShop = { id: 's1', name: 'Fade Lab', slug: 'fade-lab' };
  mockSite = null;
  mockStatus = 'active';
  mockSettings = { storeEnabled: true };
  mockCount = 0;
  mockAnyOrders = false;
  mockAccess = 'active';
});

describe('Store tab', () => {
  it('without a shop shows the setup card and routes to /store-setup', async () => {
    mockShop = null;
    const r = await render();
    expect(texts(r)).toContain('Open your shop');
    await act(async () => r.root.findByProps({ title: 'Set up your shop' }).props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/store-setup');
  });

  it('with storeEnabled false shows the same card', async () => {
    mockSettings = { storeEnabled: false };
    const r = await render();
    expect(texts(r)).toContain('Open your shop');
    expect(texts(r)).not.toContain('products');
  });

  it('when ready shows Products by default', async () => {
    const r = await render();
    expect(texts(r)).toContain('products');
    expect(texts(r)).toContain('Store');
    expect(texts(r)).not.toContain('Fade Lab');
    expect(mockOrdersPane).not.toHaveBeenCalled();
  });

  it('?tab=orders shows OrdersPane with focusOrderId', async () => {
    mockParams = { tab: 'orders', orderId: 'o7', n: '42' };
    await render();
    expect(mockOrdersPane).toHaveBeenCalledWith(expect.objectContaining({ shopId: 's1', shopName: 'Fade Lab', locked: false, focusOrderId: 'o7', focusNonce: '42' }));
  });

  it('switching to Orders shows the pane', async () => {
    const r = await render();
    await act(async () => {
      r.root.findAll((n: any) => n.props.accessibilityRole === 'tab' && /^Orders/.test(n.props.accessibilityLabel))[0].props.onPress();
    });
    expect(mockOrdersPane).toHaveBeenCalled();
  });

  it('a lapsed published site: the payment block replaces the whole tab (no gear, no products)', async () => {
    mockSite = { deployedUrl: 'https://x.vercel.app' };
    mockStatus = 'lapsed';
    const r = await render();
    expect(texts(r)).toContain('payment-block');
    expect(byLabel(r, 'Store setup')).toHaveLength(0);
    expect(texts(r)).not.toContain('products-locked');
  });

  it('unlocked shows the gear and it opens /store-setup', async () => {
    const r = await render();
    await act(async () => byLabel(r, 'Store setup')[0].props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/store-setup');
  });

  it('shows the new-orders count on the Orders segment', async () => {
    mockCount = 3;
    const r = await render();
    expect(texts(r)).toContain('3');
    expect(r.root.findAll((n: any) => n.props.accessibilityLabel === 'Orders, 3 new').length).toBeGreaterThan(0);
  });

  it('an inactive store tier shows the upgrade card', async () => {
    mockAccess = 'inactive';
    const r = await render();
    expect(texts(r)).toContain('Sell from your website');
    expect(texts(r)).not.toContain('products');
  });

  it('a closed shop with an order still shows Orders (and a push opens that order), with a closed banner', async () => {
    mockSettings = { storeEnabled: false };
    mockAnyOrders = true;
    mockParams = { tab: 'orders', orderId: 'o7', n: '1' };
    const r = await render();
    expect(texts(r)).not.toContain('Open your shop');
    expect(texts(r)).toContain('Your shop is closed to customers. Open it in Store setup.');
    expect(mockOrdersPane).toHaveBeenCalledWith(expect.objectContaining({ shopId: 's1', locked: false, focusOrderId: 'o7' }));
  });

  it('an inactive store tier with an order keeps Orders usable and shows See plans', async () => {
    mockAccess = 'inactive';
    mockAnyOrders = true;
    mockParams = { tab: 'orders', orderId: 'o7', n: '1' };
    const r = await render();
    expect(texts(r)).not.toContain('Sell from your website');
    expect(texts(r)).toContain('See plans');
    expect(mockOrdersPane).toHaveBeenCalledWith(expect.objectContaining({ locked: false, focusOrderId: 'o7' }));
  });
});
