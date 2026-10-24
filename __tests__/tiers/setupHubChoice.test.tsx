import React from 'react';
import { act, allText, render } from '../store/render';

jest.mock('@/constants/theme', () => require('../store/themeMock'));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/lib/shop', () => ({
  ...jest.requireActual('@/lib/shop'),
  listMembers: async () => [],
  updateShopSettings: jest.fn(),
}));
const mockUpdate = jest.fn();
jest.mock('@/lib/setup/siteSync', () => ({ updateSiteRecord: (fn: any) => mockUpdate(fn) }));

import { SetupHub } from '@/components/setup/SetupHub';

const SHOP: any = { id: 's1', slug: 'fade-lab', bookingsEnabled: true, purchaseLinked: true };
const SITE: any = {
  draftId: 'd', inputs: { shopName: 'F', area: '', phone: '' }, data: { shopName: 'F', phone: '1', bookingUrl: 'https://booksy.com/fade-lab' },
  updatedAt: 1, slug: null, deployedUrl: null, transactionId: null,
};

it('shows Your Book button with the own link, and choosing AI Barber saves the choice', async () => {
  const onSiteChanged = jest.fn();
  mockUpdate.mockImplementation(async (fn: any) => fn(SITE));
  const tree = await render(<SetupHub shop={SHOP} site={SITE} onOpen={() => {}} onShopChanged={() => {}} onSiteChanged={onSiteChanged} />);
  expect(allText(tree)).toContain('Your Book button');
  expect(allText(tree)).toContain('booksy.com/fade-lab');
  const o = tree.root.findAll((n: any) => n.props.accessibilityRole === 'radio' && n.props.accessibilityLabel === 'Use Prime Barber booking')[0];
  await act(async () => o.props.onPress());
  const saved = onSiteChanged.mock.calls[0][0];
  expect(saved.inputs).toMatchObject({ bookingChoice: 'aibarber', ownBookingUrl: 'https://booksy.com/fade-lab' });
  expect(saved.data.bookingUrl).toBe('/book'); // the site's own booking page
});
