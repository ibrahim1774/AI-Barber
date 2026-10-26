import React from 'react';
import { allText, pressRow, render, act } from './store/render';

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const R = require('react');
  return {
    router: { push: (...a: any[]) => mockPush(...a), navigate: jest.fn() },
    useFocusEffect: (cb: () => void) => R.useEffect(cb, []),
    useNavigation: () => ({ setOptions: () => {} }),
  };
});
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1' }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('@/components/Page', () => {
  const R = require('react');
  return { Page: ({ children }: any) => R.createElement(R.Fragment, null, children) };
});
jest.mock('@/components/Icons', () => ({ ChevronRightIcon: () => null, ExternalLinkIcon: () => null }));
jest.mock('@/components/QrScreen', () => ({ QrScreen: () => null }));
let mockOnDismiss: (() => void) | undefined;
jest.mock('@/components/EditSheet', () => {
  const R = require('react');
  return {
    Sheet: ({ visible, children, onDismiss }: any) => {
      mockOnDismiss = onDismiss;
      return visible ? R.createElement(R.Fragment, null, children) : null;
    },
  };
});
jest.mock('@/lib/account', () => ({ deleteAccountAndData: jest.fn(), deleteLocalData: jest.fn(), onSiteAdopted: () => () => {} }));
jest.mock('@/lib/auth', () => ({ signOut: jest.fn(), useSession: () => ({ session: null, ready: true }) }));
jest.mock('@/lib/restoreFlow', () => ({ useRestoreFlow: () => ({ restore: jest.fn(), busy: false }) }));
jest.mock('@/lib/siteStore', () => ({
  loadSite: async () => ({ data: { shopName: 'Fade Lab' }, inputs: {}, url: 'https://fade.vercel.app', transactionId: 'site-tx' }),
}));
jest.mock('@/lib/subscriptionStatus', () => ({ useSubscriptionStatus: () => 'active', isLocked: () => false, siteOffline: () => false }));
jest.mock('@/lib/useLinkActions', () => ({ useLinkActions: () => ({ open: jest.fn(), copy: jest.fn(), copied: false }) }));
jest.mock('@/lib/shop', () => ({ loadMyShop: async () => null, bookingUrl: () => '' }));
jest.mock('@/lib/store/data', () => ({ loadStoreSettings: async () => ({ storeEnabled: false }), shopUrl: () => '' }));
let mockDomainTx: string | null = null;
const mockLatest = async () => mockDomainTx;
const mockPaywall = jest.fn();
jest.mock('@/lib/paywall', () => ({ usePaywall: () => mockPaywall, useLatestDomainTransactionId: () => mockLatest, useLatestTransactionId: () => async () => null }));
let mockClaim: any = null;
let mockStatus: any = null;
jest.mock('@/lib/domains/api', () => ({
  loadDomainClaim: async () => mockClaim,
  domainStatus: async () => {
    if (mockStatus === 'fail') throw new Error('x');
    return mockStatus;
  },
}));
jest.mock('@/lib/website', () => ({
  websiteView: () => ({ name: 'Fade Lab', live: true, offline: false, status: 'Live', host: 'fade.vercel.app', url: 'https://fade.vercel.app' }),
}));

import Settings from '@/app/(tabs)/settings';
import { ShareSheet } from '@/components/ShareSheet';
import { DOMAIN_PRICE_LINE } from '@/lib/domains/model';

const press = async (tree: any, label: string) => {
  const n = tree.root.findAll((x: any) => x.props?.accessibilityLabel === label && typeof x.props.onPress === 'function');
  await act(async () => {
    n[0].props.onPress();
  });
};
const sheet = (onClose = () => {}) =>
  render(<ShareSheet visible shopName="Fade Lab" links={[{ kind: 'website', url: 'https://fade.vercel.app' }]} source="live" onClose={onClose} />);

beforeEach(() => {
  mockPush.mockClear();
  mockDomainTx = null;
  mockClaim = null;
  mockStatus = null;
  jest.useRealTimers();
});

describe('Settings custom-domain card', () => {
  it('shows the offer under Your website with a button to the domain screen', async () => {
    const tree = await render(<Settings />);
    const t = allText(tree);
    expect(t).toContain('Example: jacksbarbershop.com');
    expect(t.indexOf('Your website')).toBeLessThan(t.indexOf('Custom Domain'));
    expect(t.indexOf('Custom Domain')).toBeLessThan(t.indexOf('Share your site'));
    await pressRow(tree, 'Get yours');
    expect(mockPush).toHaveBeenCalledWith('/domain');
  });

  it('shows the domain status instead of the offer once there is a domain', async () => {
    mockClaim = { transactionId: 't1', domain: 'freshcuts.com' };
    mockStatus = { domain: 'freshcuts.com', state: 'live' };
    const tree = await render(<Settings />);
    const t = allText(tree);
    expect(t).toContain('freshcuts.com · Live');
    expect(t).not.toContain(DOMAIN_PRICE_LINE);
    await pressRow(tree, 'Manage');
    expect(mockPush).toHaveBeenCalledWith('/domain');
  });
});

describe('Share sheet domain row', () => {
  it('shows only without a domain, and opens the domain screen after the sheet has closed', async () => {
    const onClose = jest.fn();
    const tree = await sheet(onClose);
    expect(allText(tree)).toContain('Use your own domain, like freshcuts.com');
    await press(tree, 'Get your own domain');
    expect(onClose).toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled(); // waits for the sheet to finish dismissing
    await act(async () => {
      mockOnDismiss?.();
    });
    expect(mockPush).toHaveBeenCalledWith('/domain');
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('falls back to a timer if the sheet never reports it dismissed, and does not push twice', async () => {
    const tree = await sheet();
    jest.useFakeTimers();
    await press(tree, 'Get your own domain');
    await act(async () => {
      jest.advanceTimersByTime(800);
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    await act(async () => {
      mockOnDismiss?.();
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('is hidden once a custom domain exists', async () => {
    mockClaim = { transactionId: 't1', domain: 'freshcuts.com' };
    mockStatus = { domain: 'freshcuts.com', state: 'linking' };
    const tree = await sheet();
    expect(allText(tree).join(' ')).not.toContain('Use your own domain');
  });

  it('is hidden when a remembered domain cannot be read from the server', async () => {
    mockClaim = { transactionId: 't1', domain: 'freshcuts.com' };
    mockStatus = 'fail';
    const tree = await sheet();
    expect(allText(tree).join(' ')).not.toContain('Use your own domain');
  });
});
