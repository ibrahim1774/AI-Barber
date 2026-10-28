import React from 'react';
import { act, allText, render } from '../store/render';

jest.mock('@/constants/theme', () => require('../store/themeMock'));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/lib/linkContext', () => ({ ...jest.requireActual('@/lib/linkContext'), useLinkContext: () => null }));
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
  const o = tree.root.findAll((n: any) => n.props.accessibilityRole === 'radio' && n.props.accessibilityLabel === 'Built-in booking')[0];
  await act(async () => o.props.onPress());
  const saved = onSiteChanged.mock.calls[0][0];
  expect(saved.inputs).toMatchObject({ bookingChoice: 'aibarber', ownBookingUrl: 'https://booksy.com/fade-lab' });
  expect(saved.data.bookingUrl).toBe('/book'); // the site's own booking page
});

describe('publish-for-link line', () => {
  it('shows "Publish your changes to get your booking link" once, not as the toggle subtitle and again above Publish', async () => {
    jest.resetModules();
    jest.doMock('@/lib/customerLinks', () => ({
      ...jest.requireActual('@/lib/customerLinks'),
      useCustomerLinkState: () => ({ gate: 'publish', live: null }),
    }));
    const { SetupHub: Hub } = require('@/components/setup/SetupHub');
    const { render: r, allText: text } = require('../store/render');
    const tree = await r(<Hub shop={SHOP} site={SITE} onOpen={() => {}} onShopChanged={() => {}} onSiteChanged={() => {}} />);
    const lines: string[] = ([] as string[]).concat(text(tree));
    expect(lines.filter((l) => l.includes('Publish your changes to get your booking link'))).toHaveLength(1);
    jest.dontMock('@/lib/customerLinks');
  });
});
