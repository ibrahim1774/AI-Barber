import React from 'react';
import { act, render } from '../store/render';

let focusCb: (() => void) | null = null;
jest.mock('expo-router', () => {
  const R = require('react');
  return { useFocusEffect: (cb: () => void) => { R.useEffect(() => { focusCb = cb; return cb(); }, [cb]); } };
});
const mockShop = jest.fn();
jest.mock('@/lib/shop', () => ({ ...jest.requireActual('@/lib/shop'), loadMyShop: () => mockShop() }));
jest.mock('@/lib/store/data', () => ({ ...jest.requireActual('@/lib/store/data'), loadStoreSettings: async () => ({ storeEnabled: true }) }));

import { useLinkContext } from '@/lib/linkContext';
import { resolveLinks } from '@/lib/bookingChoice';
import { resetEntitlementsForTests, setEntitlementsFromStatus } from '@/lib/entitlements';

let latest: any;
function Probe({ k }: { k: number }) {
  latest = useLinkContext(k);
  return null;
}
import { sb } from '../../test/mocks/supabase';
import { loadLinkContext } from '@/lib/linkContext';

beforeEach(() => {
  sb.setSession({ access_token: 't', user: { id: 'u' } });
  resetEntitlementsForTests();
  setEntitlementsFromStatus({ status: 'ACTIVE', entitlements: [{ id: 'hosting' }, { id: 'bookings' }] });
  mockShop.mockReset();
});

it('reloads when the site record changes, and the preview equals what publish would send', async () => {
  mockShop.mockResolvedValue({ id: 's', slug: 'fade', purchaseLinked: true, bookingsEnabled: true });
  const tree = await render(<Probe k={1} />);
  const mounted = mockShop.mock.calls.length;
  expect(mounted).toBeGreaterThan(0);
  const data: any = { shopName: 'F', phone: '1' };
  const inputs = { ownBookingUrl: 'https://booksy.com/x', bookingChoice: 'aibarber' as const };
  expect(resolveLinks(data, inputs, latest).bookingUrl).toBe('/book');
  // Bookings switched off in setup: the site record changes, the preview follows (publish reloads too).
  mockShop.mockResolvedValue({ id: 's', slug: 'fade', purchaseLinked: true, bookingsEnabled: false });
  await act(async () => tree.update(<Probe k={2} />));
  expect(mockShop.mock.calls.length).toBeGreaterThan(mounted);
  expect(resolveLinks(data, inputs, latest).bookingUrl).toBe('https://booksy.com/x');
});

it('a failed lookup leaves no context (the preview then only strips what the plan lacks)', async () => {
  mockShop.mockRejectedValue(new Error('offline'));
  await render(<Probe k={1} />);
  expect(latest).toBeNull();
});

it('signed out is unknown (null), not "no shop", so a signed-out publish keeps the site links', async () => {
  mockShop.mockResolvedValue({ id: 's', slug: 'fade', purchaseLinked: true, bookingsEnabled: true });
  sb.setSession(null);
  await expect(loadLinkContext()).resolves.toBeNull();
  expect(mockShop).not.toHaveBeenCalled();
});
