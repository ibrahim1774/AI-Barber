import React from 'react';
import { allText, hasButton, press, render } from './store/render';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@/constants/theme', () => ({
  colors: new Proxy({ accent: '#f4a100' }, { get: (t: any, k: string) => t[k] ?? '#000' }),
  fonts: new Proxy({}, { get: () => 'System' }),
}));
jest.mock('@/components/Icons', () => {
  const N = () => null;
  return { CheckCircleIcon: N, CheckIcon: N, CloseIcon: N, CopyIcon: N, ChevronRightIcon: N, ArrowRight: N };
});
jest.mock('@/components/ShareSheet', () => ({ ShareSheet: () => null }));
jest.mock('@/lib/auth', () => ({ useSession: () => ({ session: { user: {} }, ready: true }) }));
jest.mock('@/lib/entitlements', () => ({ useEntitlements: () => ({ bookings: false }) }));
const mockLeave = jest.fn();
jest.mock('@/lib/nav', () => ({
  homeRoute: () => '/edit', resetTo: jest.fn(), takeReturnAfterLive: () => false, leaveLive: (...a: unknown[]) => mockLeave(...a),
}));
jest.mock('@/lib/shop', () => ({ loadMyShop: async () => null }));
jest.mock('@/lib/siteStore', () => ({
  loadSite: async () => ({ data: { shopName: 'Jack' }, inputs: {}, deployedUrl: 'https://jack.aibarber.org' }),
}));
jest.mock('@/lib/useLinkActions', () => ({ useLinkActions: () => ({ open: jest.fn(), copy: jest.fn(), copied: false }) }));
let mockHasDomain = false;
let mockKnown = true;
jest.mock('@/lib/domains/useDomainOffer', () => ({
  useDomainOffer: () => ({ known: mockKnown, hasDomain: mockHasDomain, detail: '' }),
}));
jest.mock('react-native-svg', () => ({ __esModule: true, default: () => null, Defs: () => null, LinearGradient: () => null, Rect: () => null, Stop: () => null }));

import Live from '@/app/live';

beforeEach(() => {
  mockPush.mockClear();
  mockLeave.mockClear();
  mockHasDomain = false;
  mockKnown = true;
});

const flat = (n: any): string => (n.children ?? []).map((c: any) => (typeof c === 'string' ? c : flat(c))).join('');

it('shows the compact domain box under the link and opens the domain screen', async () => {
  const tree = await render(<Live />);
  const texts = allText(tree);
  expect(texts).toContain('Buy a custom domain, $39/year');
  const example = tree.root.findAll((n: any) => n.type === 'Text' && flat(n) === 'jacksbarbershop.com')[0];
  expect(example).toBeTruthy();
  const style = [].concat(example.props.style).flat(3).reduce((a: any, s: any) => ({ ...a, ...s }), {});
  expect(style.color).toBe('#f4a100');
  const box = tree.root.find((n: any) => n.props?.accessibilityLabel === 'Buy a custom domain');
  const { act } = require('react-test-renderer');
  await act(async () => box.props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/domain');
});

it('has no box once the site has a domain', async () => {
  mockHasDomain = true;
  const tree = await render(<Live />);
  expect(allText(tree)).not.toContain('Buy a custom domain, $39/year');
});

it('Done is still there and leaves the live screen', async () => {
  const tree = await render(<Live />);
  expect(hasButton(tree, 'Done')).toBe(true);
  await press(tree, 'Done');
  expect(mockLeave).toHaveBeenCalled();
});

it('has no box while the domain status is not known (never push a second $39 domain)', async () => {
  mockKnown = false;
  const tree = await render(<Live />);
  expect(allText(tree)).not.toContain('Buy a custom domain, $39/year');
});
