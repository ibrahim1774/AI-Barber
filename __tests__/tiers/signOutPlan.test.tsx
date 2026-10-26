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
jest.mock('@/lib/setup/ownerApi', () => {
  const actual = jest.requireActual('@/lib/setup/ownerApi');
  return { ...actual, call: jest.fn() };
});

import Store from '@/app/(tabs)/store';
import { OwnerApiError, call } from '@/lib/setup/ownerApi';
import { getSharedPlan, resetSharedPlan, setSharedPlan } from '@/lib/plan';
import { clearEntitlements, getEntitlements, resetEntitlementsForTests, setEntitlementsFromStatus } from '@/lib/entitlements';

const mockCall = call as jest.Mock;
const hasText = (tree: any, re: RegExp) => allText(tree).some((t) => re.test(t));
const status = (...ids: string[]) => ({ status: 'ACTIVE', entitlements: ids.map((id) => ({ id })) });
const noShop = () => mockCall.mockRejectedValue(new OwnerApiError(404, 'no-shop', 'x'));
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const signOut = () => act(() => { resetSharedPlan(); clearEntitlements(); });

beforeEach(() => {
  resetEntitlementsForTests();
  setSharedPlan(null);
  mockCall.mockReset();
  mockPaywall.mockClear();
});

describe('sign-out and account switch', () => {
  it('sign-out refills the entitlements from Superwall (Apple ID) so the tab is not stuck unknown', async () => {
    act(() => setEntitlementsFromStatus(status('hosting', 'bookings', 'store')));
    await signOut();
    expect(getEntitlements()).toMatchObject({ known: true, hosting: true, store: true });
    const tree = await render(<Store />);
    expect(hasText(tree, /Couldn't load your plan/)).toBe(false);
    expect(hasText(tree, /^products$/)).toBe(true);
  });

  it('an unentitled Apple ID with no shop sees the upgrade card, not the error', async () => {
    act(() => setEntitlementsFromStatus({ status: 'INACTIVE' }));
    await signOut();
    noShop();
    const tree = await render(<Store />);
    await flush();
    expect(hasText(tree, /Couldn't load your plan/)).toBe(false);
    expect(hasText(tree, /Sell from your website/)).toBe(true);
  });

  it('a 5xx still shows the retry card', async () => {
    mockCall.mockRejectedValue(new OwnerApiError(500, 'server', 'x'));
    const tree = await render(<Store />);
    expect(hasText(tree, /Couldn't load your plan/)).toBe(true);
  });

  it('A to B does not carry A\'s server plan; entitlements come only from the current Apple ID status', async () => {
    act(() => setEntitlementsFromStatus({ status: 'INACTIVE' }));
    setSharedPlan({
      linked: true, tier: 'store', entitlements: { hosting: true, bookings: true, store: true }, active: true,
      expiresAt: null, takenDownAt: null, revoked: false, capabilities: { memberProfile: false },
    });
    await signOut();
    expect(getSharedPlan()).toBeNull();
    expect(getEntitlements()).toMatchObject({ known: true, hosting: false, bookings: false, store: false });
    noShop();
    const tree = await render(<Store />);
    await flush();
    expect(hasText(tree, /Sell from your website/)).toBe(true);
    expect(hasText(tree, /^products$/)).toBe(false);
  });
});
