import React from 'react';
import { render } from './store/render';

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
jest.mock('@/constants/theme', () => ({
  colors: new Proxy({ accent: '#f4a100', grey: '#8a8a8a' }, { get: (t: any, k: string) => t[k] ?? '#000' }),
  fonts: new Proxy({}, { get: () => 'System' }),
}));
jest.mock('@/components/Page', () => {
  const R = require('react');
  return { Page: ({ children }: any) => R.createElement(R.Fragment, null, children) };
});
jest.mock('@/components/Icons', () => ({ ChevronRightIcon: () => null, ExternalLinkIcon: () => null }));
jest.mock('@/components/ShareSheet', () => ({ ShareSheet: () => null }));
jest.mock('@/lib/account', () => ({ deleteAccountAndData: jest.fn(), deleteLocalData: jest.fn(), onSiteAdopted: () => () => {} }));
jest.mock('@/lib/auth', () => ({ signOut: jest.fn(), useSession: () => ({ session: null, ready: true }) }));
jest.mock('@/lib/restoreFlow', () => ({ useRestoreFlow: () => ({ restore: jest.fn(), busy: false }) }));
jest.mock('@/lib/siteStore', () => ({
  loadSite: async () => ({
    draftId: 'd', inputs: { shopName: 'Jack', area: '', phone: '' }, data: { shopName: 'Jack' },
    updatedAt: 1, slug: 'jack', deployedUrl: 'https://jack.aibarber.org', transactionId: 't',
  }),
}));
jest.mock('@/lib/subscriptionStatus', () => ({ useSubscriptionStatus: () => 'active', siteOffline: () => false }));
jest.mock('@/lib/useLinkActions', () => ({ useLinkActions: () => ({ open: jest.fn(), copy: jest.fn(), copied: false }) }));
jest.mock('@/lib/paywall', () => ({ usePaywall: () => jest.fn() }));
jest.mock('@/lib/domains/useDomainOffer', () => ({
  useDomainOffer: () => ({ known: true, hasDomain: false, detail: 'Get your own .com — $39/year' }),
}));

import Settings from '@/app/(tabs)/settings';

const textNodes = (tree: any) => tree.root.findAll((n: any) => n.type === 'Text');
const flat = (n: any): string => (n.children ?? []).map((c: any) => (typeof c === 'string' ? c : flat(c))).join('');

it('the domain card says Custom Domain with the example highlighted amber', async () => {
  const tree = await render(<Settings />);
  const texts = textNodes(tree).map(flat);
  expect(texts).toContain('Custom Domain');
  expect(texts.join('|')).not.toContain('Get your own .com');
  const example = textNodes(tree).find((n: any) => flat(n) === 'jacksbarbershop.com');
  expect(example).toBeTruthy();
  const style = [].concat(example.props.style).flat(3).reduce((a: any, s: any) => ({ ...a, ...s }), {});
  expect(style.color).toBe('#f4a100');
  expect(texts.some((t: string) => t.startsWith('Example: '))).toBe(true);
});
