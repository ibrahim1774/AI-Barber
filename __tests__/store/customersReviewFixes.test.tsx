// Stream D review fixes: owed money, account switch on a mounted screen, header on 375pt, >1000 order items.
import React from 'react';
import { act, render } from './render';
import { order } from './fixtures';

jest.mock('expo-router', () => ({ useFocusEffect: (cb: () => void) => { const R = require('react'); R.useEffect(cb, [cb]); } }));
const mockLoadMyShop = jest.fn();
const mockListAll = jest.fn();
jest.mock('@/lib/shop', () => ({ loadMyShop: (...a: any[]) => mockLoadMyShop(...a) }));
jest.mock('@/lib/store/data', () => ({ listAllOrders: (...a: any[]) => mockListAll(...a) }));
let mockWidth = 390;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 800, scale: 2, fontScale: 1 }),
}));
jest.mock('@/constants/theme', () => ({
  colors: new Proxy({}, { get: () => '#000' }),
  fonts: new Proxy({}, { get: () => 'System' }),
}));

import { groupStoreCustomers } from '@/lib/store/customers';
import { clearStoreCustomersCache } from '@/lib/store/customersCache';
import { useStoreCustomers, type StoreCustomersData } from '@/components/store/customers/useStoreCustomers';
import { HeaderButton } from '@/components/HeaderButtons';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const o = (n: number, p: Parameters<typeof order>[0] = {}) =>
  order({ id: U(n), number: 1000 + n, createdAt: `2026-10-0${n}T15:00:00Z`, customer: { name: 'Sam', phone: '5550102030', email: '' }, ...p });

describe('owed money', () => {
  it('a fully refunded shipped order plus an unpaid pickup order owes only the unpaid one', () => {
    const [c] = groupStoreCustomers([
      o(1, { totalCents: 5000, paymentStatus: 'refunded', paymentMethod: 'card', amountPaidCents: 5000, amountRefundedCents: 5000, status: 'shipped' as any }),
      o(2, { totalCents: 2000, paymentStatus: 'unpaid' as any, paymentMethod: 'pickup' as any, amountPaidCents: 0, amountRefundedCents: 0 }),
    ]);
    expect(c.owedCents).toBe(2000);
    expect(c.unpaidOrders).toBe(1);
  });
  it('a partly refunded paid order owes nothing', () => {
    const [c] = groupStoreCustomers([
      o(1, { totalCents: 5000, paymentStatus: 'partially_refunded', paymentMethod: 'card', amountPaidCents: 5000, amountRefundedCents: 2000 }),
    ]);
    expect(c.owedCents).toBe(0);
  });
});

describe('useStoreCustomers on a mounted screen', () => {
  let seen: StoreCustomersData[] = [];
  function Probe() { seen.push(useStoreCustomers()); return null; }
  beforeEach(() => { seen = []; mockLoadMyShop.mockReset(); mockListAll.mockReset(); clearStoreCustomersCache(); });

  it("account B's reload failing leaves none of account A's buyers on screen", async () => {
    mockLoadMyShop.mockResolvedValue({ id: 'shopA' });
    mockListAll.mockResolvedValue([o(1)]);
    await render(<Probe />);
    expect(seen[seen.length - 1].customers).toHaveLength(1);

    mockLoadMyShop.mockResolvedValue({ id: 'shopB' });
    mockListAll.mockRejectedValue(new Error('offline'));
    clearStoreCustomersCache();
    await act(async () => { await seen[seen.length - 1].refresh(); });
    const end = seen[seen.length - 1];
    expect(end.customers).toEqual([]);
    expect(end.orders).toEqual([]);
    expect(end.phase).toBe('error');
  });

  it('the same shop failing a refresh keeps its list', async () => {
    mockLoadMyShop.mockResolvedValue({ id: 'shopA' });
    mockListAll.mockResolvedValue([o(1)]);
    await render(<Probe />);
    mockListAll.mockRejectedValue(new Error('offline'));
    await act(async () => { await seen[seen.length - 1].refresh(); });
    expect(seen[seen.length - 1].customers).toHaveLength(1);
    expect(seen[seen.length - 1].phase).toBe('ready');
  });
});

describe('HeaderButton on a 375 pt phone', () => {
  const textNode = (t: any) => t.root.findAll((n: any) => n.type === 'Text')[0];
  it('caps Dynamic Type and drops the icon when narrow', async () => {
    mockWidth = 375;
    const t = await render(<HeaderButton title="Settings" icon="gear" onPress={() => {}} />);
    expect(textNode(t).props.maxFontSizeMultiplier).toBe(1.4);
    expect(t.root.findAll((n: any) => n.props?.size === 16)).toHaveLength(0);
    mockWidth = 430;
    const wide = await render(<HeaderButton title="Settings" icon="gear" onPress={() => {}} />);
    expect(wide.root.findAll((n: any) => n.props?.size === 16).length).toBeGreaterThan(0);
  });
});
