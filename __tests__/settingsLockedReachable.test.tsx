import React from 'react';
import { allText, render } from './store/render';

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
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('@/components/Page', () => {
  const R = require('react');
  return { Page: ({ children }: any) => R.createElement(R.Fragment, null, children) };
});
jest.mock('@/components/Icons', () => ({ ChevronRightIcon: () => null, ExternalLinkIcon: () => null }));
jest.mock('@/components/ShareSheet', () => ({ ShareSheet: () => null }));
jest.mock('@/lib/account', () => ({ deleteAccountAndData: jest.fn(), deleteLocalData: jest.fn(), onSiteAdopted: () => () => {} }));
jest.mock('@/lib/auth', () => ({
  signOut: jest.fn(async () => {}),
  useSession: () => ({ session: { user: { email: 'b@example.com', id: 'u1' } }, ready: true }),
}));
jest.mock('@/lib/nav', () => ({ goBackOrHome: jest.fn(), resetTo: jest.fn() }));
jest.mock('@/lib/restoreFlow', () => ({ useRestoreFlow: () => ({ restore: jest.fn(), busy: false }) }));
jest.mock('@/lib/siteStore', () => ({ loadSite: async () => ({ deployedUrl: 'https://fade-lab.aibarber.org', draftId: 'd', inputs: { shopName: 'Jack', area: '', phone: '' }, data: { shopName: 'Jack' } }) }));
jest.mock('@/lib/paymentLock', () => ({
  ...jest.requireActual('@/lib/paymentLock'),
  usePaymentLock: () => 'failed',
}));
jest.mock('@/lib/useLinkActions', () => ({ useLinkActions: () => ({ open: jest.fn(), copy: jest.fn(), copied: false }) }));
jest.mock('@/lib/paywall', () => ({ usePaywall: () => jest.fn(), useLatestTransactionId: () => async () => null }));

import Settings from '@/app/(tabs)/settings';

describe('Settings while the payment is locked', () => {
  it('Sign out, Delete account, Restore purchases and Manage subscription stay reachable and pressable', async () => {
    const t = await render(<Settings />);
    await new Promise((r) => setTimeout(r, 0));
    const text = allText(t);
    expect(text).toEqual(expect.arrayContaining(['Update payment method']));
    for (const label of ['Sign out', 'Delete account', 'Restore purchases', 'Manage subscription']) {
      const rows = t.root.findAll((n: any) => typeof n.props?.onPress === 'function' && allText({ root: n }).includes(label));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].props.disabled).not.toBe(true);
    }
  });
});
