import React from 'react';
import { allText, hasButton, press, render, act } from '../store/render';

jest.mock('expo-router', () => {
  const R = require('react');
  return {
    router: { push: jest.fn() },
    useLocalSearchParams: () => ({}),
    useFocusEffect: (cb: () => void) => R.useEffect(cb, []),
  };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/constants/theme', () => require('../store/themeMock'));
jest.mock('@/components/ShareSheet', () => ({ ShareSheet: () => null }));
jest.mock('@/components/store/StoreHeader', () => ({ StoreHeader: () => null }));
jest.mock('@/components/store/products/ProductsPane', () => ({
  ProductsPane: (p: { locked: boolean }) => {
    const { Text } = require('react-native');
    return <Text>{p.locked ? 'products-locked' : 'products'}</Text>;
  },
}));
jest.mock('@/lib/shop', () => ({ loadMyShop: async () => ({ id: 's1', name: 'Fade Lab', slug: 'fade-lab' }) }));
jest.mock('@/lib/siteStore', () => ({ loadSite: async () => null }));
jest.mock('@/lib/subscriptionStatus', () => ({ useSubscriptionStatus: () => 'active', isLocked: () => false }));
let mockOrders: any[] = [];
jest.mock('@/lib/store/data', () => ({
  ...jest.requireActual('@/lib/store/data'),
  loadStoreSettings: async () => ({ storeEnabled: true }),
  countNewOrders: async () => 0,
  listOrders: async () => mockOrders,
  hasAnyOrders: async () => mockOrders.length > 0,
  getOrder: async () => null,
}));
const mockPaywall = jest.fn(async (_p: string) => 'declined');
jest.mock('@/lib/paywall', () => ({ usePaywall: () => mockPaywall, useSuperwallSettled: () => true }));
jest.mock('@/lib/setup/ownerApi', () => ({ call: jest.fn(async () => { throw new Error('offline'); }) }));

import Store from '@/app/(tabs)/store';
import { setSharedPlan } from '@/lib/plan';
import { resetEntitlementsForTests, setEntitlementsFromStatus } from '@/lib/entitlements';
import { order } from '../store/fixtures';

const ents = (...ids: string[]) => act(() => setEntitlementsFromStatus({ status: 'ACTIVE', entitlements: ids.map((id) => ({ id })) }));
const hasText = (tree: any, re: RegExp) => allText(tree).some((t) => re.test(t));

beforeEach(() => {
  resetEntitlementsForTests();
  setSharedPlan(null);
  mockOrders = [];
  mockPaywall.mockClear();
});

describe('Store tab gating', () => {
  it('Bookings plan with no orders: the store UpgradeCard, opening store_upgrade', async () => {
    ents('hosting', 'bookings');
    const tree = await render(<Store />);
    expect(hasText(tree, /Sell from your website/)).toBe(true);
    await press(tree, 'See the Store plan');
    expect(mockPaywall).toHaveBeenCalledWith('store_upgrade');
  });

  it('Bookings plan with orders: orders listed with actions available, products read-only, banner shown', async () => {
    ents('hosting', 'bookings');
    mockOrders = [order()];
    const tree = await render(<Store />);
    expect(hasText(tree, /Your shop page is offline/)).toBe(true);
    expect(hasText(tree, /^products-locked$/)).toBe(true);
    expect(hasText(tree, /Sell from your website/)).toBe(false);
    // Orders tab: the real OrdersPane lists the order, unlocked, and its sheet offers Mark ready.
    await act(async () => {
      tree.root.findAll((n: any) => n.props.accessibilityRole === 'tab' && /^Orders/.test(n.props.accessibilityLabel))[0].props.onPress();
    });
    const row = tree.root.findAll((n: any) => /^Order /.test(n.props.accessibilityLabel ?? '') && typeof n.props.onPress === 'function')[0];
    await act(async () => row.props.onPress());
    expect(hasButton(tree, 'Mark ready')).toBe(true);
  });

  const lapsedPlan = (daysAgo: number) => ({
    linked: true, tier: 'store' as const, entitlements: { hosting: false, bookings: false, store: false }, active: false,
    expiresAt: new Date(Date.now() - daysAgo * 86400000).toISOString(), takenDownAt: null, revoked: false, capabilities: { memberProfile: false },
  });

  it('lapsed 5 days, no orders: products stay visible read-only with the upgrade banner on top (like Bookings)', async () => {
    ents();
    setSharedPlan(lapsedPlan(5));
    const tree = await render(<Store />);
    expect(hasText(tree, /^products-locked$/)).toBe(true);
    expect(hasText(tree, /Your shop page is offline/)).toBe(true);
    expect(hasText(tree, /Sell from your website/)).toBe(false);
  });

  it('lapsed 45 days, no orders: only the upgrade card', async () => {
    ents();
    setSharedPlan(lapsedPlan(45));
    const tree = await render(<Store />);
    expect(hasText(tree, /Sell from your website/)).toBe(true);
    expect(hasText(tree, /^products-locked$/)).toBe(false);
  });

  it('Store plan: normal', async () => {
    ents('hosting', 'bookings', 'store');
    const tree = await render(<Store />);
    expect(hasText(tree, /^products$/)).toBe(true);
    expect(hasText(tree, /offline/)).toBe(false);
  });
});
