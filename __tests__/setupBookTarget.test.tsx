import React from 'react';
import { allText, pressRow, render } from './store/render';

jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/lib/shop', () => ({ ...jest.requireActual('@/lib/shop'), listMembers: async () => [], updateShopSettings: jest.fn() }));
const mockUpdate = jest.fn();
jest.mock('@/lib/setup/siteSync', () => ({ updateSiteRecord: (fn: any) => mockUpdate(fn) }));
jest.mock('@/lib/linkContext', () => ({ ...jest.requireActual('@/lib/linkContext'), useLinkContext: () => null, loadLinkContext: async () => null }));

import { SetupHub } from '@/components/setup/SetupHub';
import { setupPrompt, BOOKINGS_OFF_OWN, BOOKINGS_OFF_HIDDEN } from '@/lib/setupPrompt';

const SHOP: any = { id: 's1', slug: 'fade-lab', bookingsEnabled: true, purchaseLinked: true };
const SITE: any = {
  draftId: 'd', inputs: { shopName: 'F', area: '', phone: '' }, data: { shopName: 'F', phone: '1', bookingUrl: 'https://booksy.com/fade-lab' },
  updatedAt: 1, slug: null, deployedUrl: null, transactionId: null,
};
const ON = { known: true, hosting: true };
const L = (b: string | null) => ({ bookingUrl: b, shopUrl: null });

test('bookings-off prompt names the reason, with and without an own link', () => {
  expect(setupPrompt({ published: true, ents: ON, live: L('/book'), next: L('https://booksy.com/x') }))
    .toEqual({ title: 'Point your Book button back to your own booking link?', message: BOOKINGS_OFF_OWN });
  expect(setupPrompt({ published: true, ents: ON, live: L('/book'), next: L(null) }))
    .toEqual({ title: 'Remove the Book button from your website?', message: BOOKINGS_OFF_HIDDEN });
});

test('Setup picker has Edit link, which opens the shared Book sheet', async () => {
  const tree = await render(<SetupHub shop={SHOP} site={SITE} onOpen={() => {}} onShopChanged={() => {}} onSiteChanged={() => {}} />);
  expect(allText(tree)).toContain('Edit link');
  expect(allText(tree)).not.toContain('Where Book buttons go');
  await pressRow(tree, 'Edit link');
  expect(allText(tree)).toContain('Where Book buttons go');
});
