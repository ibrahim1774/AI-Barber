import React from 'react';
import { ActionSheetIOS } from 'react-native';
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
jest.mock('@/lib/auth', () => ({ signOut: jest.fn(), useSession: () => ({ session: null, ready: true }) }));
jest.mock('@/lib/restoreFlow', () => ({ useRestoreFlow: () => ({ restore: jest.fn(), busy: false }) }));
jest.mock('@/lib/siteStore', () => ({ loadSite: async () => null }));
jest.mock('@/lib/subscriptionStatus', () => ({ useSubscriptionStatus: () => 'active', isLocked: () => false }));
jest.mock('@/lib/useLinkActions', () => ({ useLinkActions: () => ({ open: jest.fn(), copy: jest.fn(), copied: false }) }));
const mockPaywall = jest.fn(async (_p: string) => 'declined');
jest.mock('@/lib/paywall', () => ({ usePaywall: () => mockPaywall }));

import Settings from '@/app/(tabs)/settings';
import { resetEntitlementsForTests, setEntitlementsFromStatus } from '@/lib/entitlements';

const ents = (...ids: string[]) => act(() => setEntitlementsFromStatus({ status: 'ACTIVE', entitlements: ids.map((id) => ({ id })) }));
let sheet: jest.SpyInstance;

beforeEach(() => {
  resetEntitlementsForTests();
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
