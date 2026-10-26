import React from 'react';
import { allText, hasButton, press, pressRow, render } from './store/render';

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const R = require('react');
  return {
    router: { push: (...a: unknown[]) => mockPush(...a), navigate: jest.fn() },
    useFocusEffect: (cb: () => void) => R.useEffect(cb, []),
    useNavigation: () => ({ setOptions: () => {} }),
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
const mockSignOut = jest.fn(async () => {});
let mockSession: any = null;
jest.mock('@/lib/auth', () => ({
  signOut: () => mockSignOut(),
  useSession: () => ({ session: mockSession, ready: true }),
}));
const mockResetTo = jest.fn();
jest.mock('@/lib/nav', () => ({ goBackOrHome: jest.fn(), resetTo: (...a: unknown[]) => mockResetTo(...a) }));
jest.mock('@/lib/restoreFlow', () => ({ useRestoreFlow: () => ({ restore: jest.fn(), busy: false }) }));
jest.mock('@/lib/siteStore', () => ({ loadSite: async () => null }));
jest.mock('@/lib/subscriptionStatus', () => ({ useSubscriptionStatus: () => 'active', isLocked: () => false }));
jest.mock('@/lib/useLinkActions', () => ({ useLinkActions: () => ({ open: jest.fn(), copy: jest.fn(), copied: false }) }));
jest.mock('@/lib/paywall', () => ({ usePaywall: () => jest.fn(), useLatestTransactionId: () => async () => null }));

import Settings from '@/app/(tabs)/settings';

beforeEach(() => {
  mockPush.mockClear();
  mockResetTo.mockClear();
  mockSignOut.mockClear();
  mockSession = null;
});

describe('Settings account section', () => {
  it('signed out: a clear Sign in button opens the email and password screen', async () => {
    const tree = await render(<Settings />);
    expect(hasButton(tree, 'Sign in')).toBe(true);
    expect(allText(tree).join(' ')).toMatch(/email and password/i);
    await press(tree, 'Sign in');
    expect(mockPush).toHaveBeenCalledWith('/sign-in');
  });

  it('signed in: no Sign in button; signing out with no site left goes to the start', async () => {
    mockSession = { user: { email: 'b@example.com' } };
    const tree = await render(<Settings />);
    expect(hasButton(tree, 'Sign in')).toBe(false);
    const row = tree.root.findAll((n: any) => typeof n.props?.onPress === 'function' && allText({ root: n, }).includes('Sign out'));
    expect(row.length).toBeGreaterThan(0);
    const { act } = require('react-test-renderer');
    await act(async () => {
      await row[0].props.onPress();
    });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockResetTo).toHaveBeenCalledWith('/start');
  });

  it('Learn how it works is the first thing on Settings, even with no site, and appears once', async () => {
    const t = await render(<Settings />);
    const text = allText(t);
    expect(text[0]).toBe('Learn how it works');
    expect(text.filter((x) => x === 'Learn how it works')).toHaveLength(1);
    await pressRow(t, 'Learn how it works');
    expect(mockPush).toHaveBeenCalledWith('/settings/learn');
  });
});
