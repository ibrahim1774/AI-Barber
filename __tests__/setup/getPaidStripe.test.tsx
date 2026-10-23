import React from 'react';
import { allText, press, render } from '../store/render';

jest.mock('@/constants/theme', () => require('../store/themeMock'));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn(async () => ({ type: 'cancel' })) }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
let mockStatus: any;
jest.mock('@/lib/setup/ownerApi', () => ({
  stripeOnboard: async () => ({ url: 'https://stripe.test/x' }),
  stripeStatus: async () => mockStatus,
}));
jest.mock('@/lib/shop', () => ({ ...jest.requireActual('@/lib/shop'), updateShopSettings: jest.fn() }));

import { CARDS_NOT_SET_UP, GetPaid } from '@/components/setup/GetPaid';

const shop: any = {
  id: 's1', payInShop: true, manualHandles: {}, stripeConnected: false, stripeChargesEnabled: false, platformFeeBps: 200,
};

it('closing the Stripe sheet unconnected says cards are not set up yet', async () => {
  mockStatus = { connected: false, chargesEnabled: false, detailsSubmitted: false };
  const tree = await render(<GetPaid shop={shop} onChanged={() => {}} />);
  expect(allText(tree)).not.toContain(CARDS_NOT_SET_UP);
  await press(tree, 'Connect cards with Stripe');
  expect(allText(tree)).toContain(CARDS_NOT_SET_UP);
});

it('connected after the sheet shows no such message', async () => {
  mockStatus = { connected: true, chargesEnabled: true, detailsSubmitted: true };
  const tree = await render(<GetPaid shop={shop} onChanged={() => {}} />);
  await press(tree, 'Connect cards with Stripe');
  expect(allText(tree)).not.toContain(CARDS_NOT_SET_UP);
});
