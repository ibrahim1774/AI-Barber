import React from 'react';
import { render } from './store/render';

const mockSetOptions = jest.fn();
jest.mock('expo-router', () => {
  const R = require('react');
  return {
    router: { push: jest.fn(), navigate: jest.fn() },
    useFocusEffect: (cb: () => void) => R.useEffect(cb, []),
    useNavigation: () => ({ setOptions: (...a: unknown[]) => mockSetOptions(...a) }),
  };
});
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1' }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('@/components/Page', () => {
  const R = require('react');
  return { Page: ({ children }: any) => R.createElement(R.Fragment, null, children) };
});
jest.mock('@/components/Icons', () => ({ ChevronRightIcon: () => null, ExternalLinkIcon: () => null }));
jest.mock('@/components/ShareSheet', () => ({ ShareSheet: () => null }));
jest.mock('@/lib/account', () => ({ deleteAccountAndData: jest.fn(), deleteLocalData: jest.fn(), onSiteAdopted: () => () => {} }));
jest.mock('@/lib/auth', () => ({ signOut: jest.fn(), useSession: () => ({ session: null, ready: true }) }));
jest.mock('@/lib/nav', () => ({ goBackOrHome: jest.fn(), resetTo: jest.fn() }));
jest.mock('@/lib/restoreFlow', () => ({ useRestoreFlow: () => ({ restore: jest.fn(), busy: false }) }));
let mockLoad: () => Promise<unknown> = () => new Promise(() => {});
jest.mock('@/lib/siteStore', () => ({ loadSite: () => mockLoad() }));
jest.mock('@/lib/subscriptionStatus', () => ({ useSubscriptionStatus: () => 'active', isLocked: () => false }));
jest.mock('@/lib/useLinkActions', () => ({ useLinkActions: () => ({ open: jest.fn(), copy: jest.fn(), copied: false }) }));
jest.mock('@/lib/paywall', () => ({ usePaywall: () => jest.fn(), useLatestTransactionId: () => async () => null }));

import Settings from '@/app/(tabs)/settings';

const hidden = () => mockSetOptions.mock.calls.map((c) => c[0].tabBarStyle).filter((s) => s?.display === 'none');

describe('Settings tab bar', () => {
  beforeEach(() => mockSetOptions.mockClear());

  test('while the site is still loading the bar is never hidden (no vanish-and-return on the first switch)', async () => {
    mockLoad = () => new Promise(() => {});
    await render(<Settings />);
    expect(mockSetOptions).toHaveBeenCalled();
    expect(hidden()).toHaveLength(0);
  });

  test('once it is known there is no site the bar is hidden', async () => {
    mockLoad = async () => null;
    await render(<Settings />);
    expect(hidden().length).toBeGreaterThan(0);
  });
});
