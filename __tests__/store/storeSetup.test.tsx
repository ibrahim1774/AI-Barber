import React from 'react';
import { Alert } from 'react-native';
import { allText, hasButton, press, pressRow, render, toggle, type as typeInto } from './render';

jest.mock('@/constants/theme', () => require('./themeMock'));
jest.mock('@/components/Page', () => {
  const R = require('react');
  return { Page: ({ children }: any) => R.createElement(R.Fragment, null, children) };
});
jest.mock('@/components/ShareSheet', () => ({ ShareSheet: () => null }));

let mockSession: object | null = null;
jest.mock('@/lib/auth', () => ({ useSession: () => ({ session: mockSession, ready: true }) }));
const mockLatest = async () => null;
jest.mock('@/lib/paywall', () => ({ useLatestTransactionId: () => mockLatest }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn() } }));
jest.mock('@/lib/nav', () => ({ goBackOrHome: jest.fn() }));
jest.mock('@/lib/account', () => ({ syncIfSignedIn: jest.fn(async () => {}) }));
jest.mock('@/lib/setup/relink', () => ({ registerPushForShop: jest.fn(async () => {}), relinkShopPurchase: jest.fn(async () => false) }));

const mockLoadSite = jest.fn();
jest.mock('@/lib/siteStore', () => ({ loadSite: () => mockLoadSite() }));
const mockLoadMyShop = jest.fn();
jest.mock('@/lib/shop', () => ({ loadMyShop: () => mockLoadMyShop() }));
const mockShopSetup = jest.fn();
jest.mock('@/lib/setup/ownerApi', () => ({
  ...jest.requireActual('@/lib/setup/ownerApi'),
  shopSetup: (b: unknown) => mockShopSetup(b),
}));
const mockUpdateSite = jest.fn();
jest.mock('@/lib/setup/siteSync', () => ({ updateSiteData: (...a: unknown[]) => mockUpdateSite(...a) }));
const mockLoadSettings = jest.fn();
const mockUpdateSettings = jest.fn();
jest.mock('@/lib/store/data.stub-a3b', () => ({
  loadStoreSettings: (id: string) => mockLoadSettings(id),
  updateStoreSettings: (...a: unknown[]) => mockUpdateSettings(...a),
  shopUrl: (s: { slug: string }) => `https://www.aibarber.org/shop/${s.slug}`,
}));

import StoreSetup from '@/app/store-setup';
import { takePostAuthReturn } from '@/lib/setup/gate';

const SITE = {
  draftId: 'draft-1', inputs: { shopName: 'Fade Lab' }, updatedAt: 1, slug: null, deployedUrl: null, transactionId: null,
  data: { shopName: 'Fade Lab', services: [] },
};
const SHOP = {
  id: 's1', slug: 'fade-lab', name: 'Fade Lab', purchaseLinked: true, payInShop: true, manualHandles: {}, stripeChargesEnabled: false,
};
const SETTINGS = { storeEnabled: false, pickup: true, pickupNote: '', shipping: false, shippingFlatCents: null, shipsWithinDays: null };

beforeEach(() => {
  mockSession = { user: { id: 'u1' } };
  mockPush.mockReset();
  mockLoadSite.mockReset().mockResolvedValue(SITE);
  mockLoadMyShop.mockReset().mockResolvedValue(SHOP);
  mockShopSetup.mockReset().mockResolvedValue({ shop: { id: 's1', slug: 'fade-lab' } });
  mockUpdateSite.mockReset().mockResolvedValue(SITE);
  mockLoadSettings.mockReset().mockResolvedValue({ ...SETTINGS });
  mockUpdateSettings.mockReset().mockResolvedValue(undefined);
  takePostAuthReturn();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('store setup', () => {
  it('signed out: shows the account gate and returns to /store-setup after sign-in', async () => {
    mockSession = null;
    const tree = await render(<StoreSetup />);
    expect(allText(tree).join(' ')).toContain('Create a free account to sell online');
    await press(tree, 'Create account');
    expect(mockPush).toHaveBeenCalledWith('/sign-up');
    expect(takePostAuthReturn()).toBe('/store-setup');
    await press(tree, 'I already have an account');
    expect(mockPush).toHaveBeenLastCalledWith('/sign-in');
    expect(mockShopSetup).not.toHaveBeenCalled();
  });

  it('no shop: calls shopSetup with services [] and the draft id as siteId', async () => {
    mockLoadMyShop.mockResolvedValueOnce(null).mockResolvedValue(SHOP);
    await render(<StoreSetup />);
    expect(mockShopSetup).toHaveBeenCalledTimes(1);
    const body = mockShopSetup.mock.calls[0][0];
    expect(body.services).toEqual([]);
    expect(body.siteId).toBe('draft-1');
    expect(body.name).toBe('Fade Lab');
  });

  it('an existing shop is not set up again', async () => {
    await render(<StoreSetup />);
    expect(mockShopSetup).not.toHaveBeenCalled();
  });

  it('Open my shop writes storeEnabled and puts shopUrl on the site', async () => {
    const tree = await render(<StoreSetup />);
    await press(tree, 'Open my shop');
    expect(mockUpdateSettings).toHaveBeenCalledWith('s1', { storeEnabled: true });
    const change = mockUpdateSite.mock.calls[0][0];
    expect(change({ shopName: 'Fade Lab' }, {})).toEqual({ shopName: 'Fade Lab', shopUrl: 'https://www.aibarber.org/shop/fade-lab' });
    expect(hasButton(tree, 'Close my shop')).toBe(true);
    expect(Alert.alert).toHaveBeenCalledWith('Your shop is open', 'Publish to add a Shop link to your website.');
  });

  it('Close my shop clears shopUrl', async () => {
    mockLoadSettings.mockResolvedValue({ ...SETTINGS, storeEnabled: true });
    const tree = await render(<StoreSetup />);
    await press(tree, 'Close my shop');
    expect(mockUpdateSettings).toHaveBeenCalledWith('s1', { storeEnabled: false });
    const change = mockUpdateSite.mock.calls[0][0];
    const out = change({ shopName: 'Fade Lab', shopUrl: 'https://www.aibarber.org/shop/fade-lab' }, {});
    expect(out).toEqual({ shopName: 'Fade Lab' });
    expect('shopUrl' in out).toBe(false);
    expect(hasButton(tree, 'Open my shop')).toBe(true);
  });

  it('will not open with neither pickup nor shipping', async () => {
    const tree = await render(<StoreSetup />);
    await toggle(tree, 'Pickup', false);
    await press(tree, 'Open my shop');
    expect(mockUpdateSettings).not.toHaveBeenCalled();
    expect(allText(tree).join(' ')).toContain('Turn on pickup, shipping, or both');
  });

  it('saves edited shipping settings in cents', async () => {
    const tree = await render(<StoreSetup />);
    await toggle(tree, 'Shipping', true);
    await typeInto(tree, 'Flat shipping rate', '$7.50');
    await typeInto(tree, 'Ships within days', '3');
    await press(tree, 'Save');
    expect(mockUpdateSettings).toHaveBeenCalledWith('s1', {
      pickup: true, pickupNote: '', shipping: true, shippingFlatCents: 750, shipsWithinDays: 3,
    });
  });

  it('Get paid opens /get-paid', async () => {
    const tree = await render(<StoreSetup />);
    await pressRow(tree, 'Get paid');
    expect(mockPush).toHaveBeenCalledWith('/get-paid');
  });
});
