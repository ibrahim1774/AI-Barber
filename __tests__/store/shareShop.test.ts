import React from 'react';
import { shareLabel, shareMessage } from '@/lib/share';

const { act, create } = require('react-test-renderer');

let mockStoreEnabled = false;
jest.mock('@/lib/shop', () => ({
  bookingUrl: (s: { slug: string }) => `https://www.aibarber.org/book/${s.slug}`,
  loadMyShop: async () => ({ id: 's1', slug: 'fade-lab', bookingsEnabled: false }),
}));
jest.mock('@/lib/store/data', () => ({
  loadStoreSettings: async () => ({ storeEnabled: mockStoreEnabled }),
  shopUrl: (s: { slug: string }) => `https://www.aibarber.org/shop/${s.slug}`,
}));
jest.mock('@/constants/theme', () => require('./themeMock'));
jest.mock('@/components/EditSheet', () => {
  const R = require('react');
  return { Sheet: ({ visible, children }: any) => (visible ? R.createElement(R.Fragment, null, children) : null) };
});
jest.mock('@/components/QrScreen', () => ({ QrScreen: () => null }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/components/Icons', () => ({ ChevronRightIcon: () => null }));

import { ShareSheet } from '@/components/ShareSheet';

describe('shop share kind', () => {
  it('the message holds the URL once', () => {
    const url = 'https://www.aibarber.org/shop/fade-lab';
    expect(shareMessage('shop', 'Fade Lab', url)).toBe(`Fade Lab now sells online: ${url}`);
    expect(shareMessage('shop', 'Fade Lab', url).split(url)).toHaveLength(2);
    expect(shareMessage('shop', '  ', url)).toBe(`Shop online: ${url}`);
    expect(shareMessage('shop', '', url).split(url)).toHaveLength(2);
    expect(shareLabel('shop')).toBe('Shop link');
  });
});

async function labels(): Promise<string[]> {
  let tree: any;
  await act(async () => {
    tree = create(
      React.createElement(ShareSheet, {
        visible: true, shopName: 'Fade Lab', source: 'live', onClose: () => {},
        links: [{ kind: 'website', url: 'https://fade.vercel.app' }],
      }),
    );
  });
  return tree.root.findAll((n: any) => n.props.accessibilityLabel?.startsWith?.('Share ')).map((n: any) => n.props.accessibilityLabel);
}

describe('ShareSheet', () => {
  it('lists the Shop row only when the store is open', async () => {
    mockStoreEnabled = false;
    expect(await labels()).not.toContain('Share Shop link');
    mockStoreEnabled = true;
    const l = await labels();
    expect(l).toContain('Share Shop link');
    expect(l).toContain('Share Website link');
  });
});
