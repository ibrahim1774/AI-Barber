import React from 'react';
import { ActionSheetIOS, Linking } from 'react-native';
import { allText, pressRow, render, act } from '../store/render';

jest.mock('expo-router', () => {
  const R = require('react');
  return {
    router: { push: jest.fn(), navigate: jest.fn() },
    useFocusEffect: (cb: () => void) => R.useEffect(cb, []),
    useNavigation: () => ({ setOptions: () => {} }),
  };
});
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1' }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('@/constants/theme', () => require('../store/themeMock'));
jest.mock('@/components/Page', () => {
  const R = require('react');
  return { Page: ({ children }: any) => R.createElement(R.Fragment, null, children) };
});
jest.mock('@/components/Icons', () => ({ ChevronRightIcon: () => null, ExternalLinkIcon: () => null }));
jest.mock('@/components/ShareSheet', () => ({ ShareSheet: () => null }));
jest.mock('@/lib/account', () => ({ deleteAccountAndData: jest.fn(), deleteLocalData: jest.fn(), onSiteAdopted: () => () => {} }));
jest.mock('@/lib/auth', () => ({ signOut: jest.fn(), currentUserId: () => null, useSession: () => ({ session: null, ready: true }) }));
jest.mock('@/lib/restoreFlow', () => ({ useRestoreFlow: () => ({ restore: jest.fn(), busy: false }) }));
jest.mock('@/lib/siteStore', () => ({ loadSite: async () => null }));
jest.mock('@/lib/subscriptionStatus', () => ({ useSubscriptionStatus: () => 'active', isLocked: () => false }));
jest.mock('@/lib/useLinkActions', () => ({ useLinkActions: () => ({ open: jest.fn(), copy: jest.fn(), copied: false }) }));
const mockPaywall = jest.fn(async (_p: string) => 'declined');
jest.mock('@/lib/paywall', () => ({ usePaywall: () => mockPaywall, useLatestTransactionId: () => async () => null }));

import Settings from '@/app/(tabs)/settings';
import { resetEntitlementsForTests, setEntitlementsFromStatus } from '@/lib/entitlements';
import { setSharedPlan } from '@/lib/plan';
import { OWN_PLAN, OWNERSHIP_ONLY_PLAN } from '../../test/ownPlan';

const ents = (...ids: string[]) => act(() => setEntitlementsFromStatus({ status: 'ACTIVE', entitlements: ids.map((id) => ({ id })) }));
let sheet: jest.SpyInstance;

beforeEach(() => {
  resetEntitlementsForTests();
  setSharedPlan({ ...OWNERSHIP_ONLY_PLAN }); // this account owns the purchase; the tier comes from Superwall here
  mockPaywall.mockClear();
  sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('Settings Plan row', () => {
  it('shows "Bookings" for [hosting, bookings]', async () => {
    ents('hosting', 'bookings');
    const tree = await render(<Settings />);
    expect(allText(tree)).toContain('Plan');
    expect(allText(tree)).toContain('Bookings');
  });

  it('the action sheet offers only Upgrade to Store and Manage subscription', async () => {
    ents('hosting', 'bookings');
    const tree = await render(<Settings />);
    await pressRow(tree, 'Plan');
    const [config, onPick] = sheet.mock.calls[0];
    expect(config.options).toEqual(['Upgrade to Store', 'Manage subscription', 'Cancel']);
    expect(config.cancelButtonIndex).toBe(2);
    onPick(0);
    expect(mockPaywall).toHaveBeenCalledWith('store_upgrade');
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    onPick(1);
    expect(open).toHaveBeenCalledWith('itms-apps://apps.apple.com/account/subscriptions');
  });

  it('a Website plan can upgrade to either; a Store plan only manages', async () => {
    ents('hosting');
    let tree = await render(<Settings />);
    await pressRow(tree, 'Plan');
    expect(sheet.mock.calls[0][0].options).toEqual(['Upgrade to Bookings', 'Upgrade to Store', 'Manage subscription', 'Cancel']);
    ents('hosting', 'bookings', 'store');
    tree = await render(<Settings />);
    expect(allText(tree)).toContain('Store');
    await pressRow(tree, 'Plan');
    expect(sheet.mock.calls[1][0].options).toEqual(['Manage subscription', 'Cancel']);
  });
});

it("a second account on the same Apple ID: the Plan row shows the Website plan only, never Bookings or Store", async () => {
  ents('hosting', 'bookings', 'store');
  setSharedPlan({ ...OWN_PLAN, purchaseAccount: 'other', purchaseHint: 'a***@gmail.com' });
  const tree = await render(<Settings />);
  expect(allText(tree)).toContain('Website');
  expect(allText(tree)).not.toContain('Store');
});

it('no Plan row (and no "…") until entitlements are known; Restore purchases and Manage subscription stay', async () => {
  setSharedPlan(null); // neither Superwall nor the server has answered
  const tree = await render(<Settings />);
  expect(allText(tree)).not.toContain('…');
  await expect(pressRow(tree, 'Plan')).rejects.toThrow();
  expect(allText(tree)).toContain('Restore purchases');
  expect(allText(tree)).toContain('Manage subscription');
  expect(allText(tree)).not.toContain('Create account');
  expect(sheet).not.toHaveBeenCalled();
});

it('known but no plan (never subscribed): no Plan row, no "None", Restore purchases still there', async () => {
  ents(); // entitlements known, none granted
  const tree = await render(<Settings />);
  await expect(pressRow(tree, 'Plan')).rejects.toThrow();
  expect(allText(tree)).not.toContain('None');
  expect(allText(tree)).toContain('Subscription');
  expect(allText(tree)).toContain('Restore purchases');
  expect(allText(tree)).toContain('Manage subscription');
});
