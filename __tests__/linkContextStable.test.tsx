import React from 'react';

jest.mock('expo-router', () => {
  const R = require('react');
  return { useFocusEffect: (cb: () => void) => { R.useEffect(cb, [cb]); } };
});
const mockUid = jest.fn(() => 'u1');
jest.mock('@/lib/auth', () => ({ currentUserId: () => mockUid() }));
const mockShop = jest.fn();
jest.mock('@/lib/shop', () => ({ loadMyShop: () => mockShop() }));
jest.mock('@/lib/store/data', () => ({ loadStoreSettings: async () => ({ storeEnabled: true }) }));

import { keepIfSame, useLinkContext } from '@/lib/linkContext';

const { act, create } = require('react-test-renderer');

describe('useLinkContext keeps its identity while the facts do not change', () => {
  test('re-loading the same shop (every tab focus) yields the same object, so the preview is not rebuilt', async () => {
    mockShop.mockImplementation(async () => ({ id: 's1', slug: 'fade', purchaseLinked: true })); // a fresh row object each call
    const seen: unknown[] = [];
    let bump: () => void = () => {};
    function Probe() {
      const [n, setN] = React.useState(0);
      bump = () => setN((x) => x + 1);
      seen.push(useLinkContext(n));
      return null;
    }
    await act(async () => { create(<Probe />); });
    const first = seen[seen.length - 1];
    expect(first).not.toBeNull();
    for (let i = 0; i < 3; i++) await act(async () => { bump(); });
    expect(seen[seen.length - 1]).toBe(first);
  });

  test('keepIfSame returns the new context when something differs', () => {
    const a: any = { ents: { known: true }, shop: null, storeEnabled: false };
    expect(keepIfSame(a, { ...a })).toBe(a);
    const b = { ...a, storeEnabled: true };
    expect(keepIfSame(a, b)).toBe(b);
    expect(keepIfSame(a, null)).toBeNull();
    expect(keepIfSame(null, a)).toBe(a);
  });
});
