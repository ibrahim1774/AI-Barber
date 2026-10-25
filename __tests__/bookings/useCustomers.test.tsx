import React from 'react';
import { act, render } from '../store/render';

jest.mock('expo-router', () => ({ useFocusEffect: (cb: () => void) => { const R = require('react'); R.useEffect(cb, [cb]); } }));
const mockLoadMyShop = jest.fn();
const mockList = jest.fn();
jest.mock('@/lib/bookings/shop', () => ({ loadMyShop: (...a: any[]) => mockLoadMyShop(...a) }));
jest.mock('@/lib/bookings/api', () => ({ listCustomerAppointments: (...a: any[]) => mockList(...a) }));

import { clearCustomersCache, useCustomers, type CustomersData } from '@/components/bookings/useCustomers';

const appt = (id: string, name: string) => ({
  id, start: '2026-10-01T15:00:00.000Z', end: '2026-10-01T15:30:00.000Z', serviceName: 'Cut', priceCents: 3000, memberId: 'm',
  name, phone: null, email: `${name.toLowerCase()}@x.com`, status: 'done', cancelledBy: null, paymentStatus: 'none',
  paymentMethod: null, amountPaidCents: 0, amountRefundedCents: 0, source: 'online', createdAt: '2026-09-30T10:00:00.000Z',
});

let seen: CustomersData[] = [];
function Probe() { seen.push(useCustomers()); return null; }
const last = () => seen[seen.length - 1];

beforeEach(() => { seen = []; mockLoadMyShop.mockReset(); mockList.mockReset(); clearCustomersCache(); });

async function openAs(shopId: string, rows: any[]) {
  mockLoadMyShop.mockResolvedValue({ id: shopId });
  mockList.mockResolvedValue(rows);
  const t = await render(<Probe />);
  t.unmount();
}

describe('useCustomers cache', () => {
  it('never shows another account\'s customers, even when the new load fails', async () => {
    await openAs('shopA', [appt('1', 'Alice')]);
    seen = [];
    mockLoadMyShop.mockResolvedValue({ id: 'shopB' });
    mockList.mockRejectedValue(new Error('offline'));
    await render(<Probe />);
    expect(seen[0].phase).toBe('loading');
    expect(seen.every((d) => d.customers.length === 0)).toBe(true);
    expect(last().phase).toBe('error');
  });

  it('starts loading, then reuses the cache only for the same shop', async () => {
    await openAs('shopA', [appt('1', 'Alice')]);
    seen = [];
    mockLoadMyShop.mockResolvedValue({ id: 'shopA' });
    mockList.mockRejectedValue(new Error('offline'));
    await render(<Probe />);
    expect(seen[0].phase).toBe('loading');
    expect(last().phase).toBe('ready');
    expect(last().customers[0].name).toBe('Alice');
  });

  it('clearCustomersCache forgets everything', async () => {
    await openAs('shopA', [appt('1', 'Alice')]);
    clearCustomersCache();
    seen = [];
    mockLoadMyShop.mockResolvedValue({ id: 'shopA' });
    mockList.mockRejectedValue(new Error('offline'));
    await render(<Probe />);
    expect(last().phase).toBe('error');
    expect(last().customers).toEqual([]);
  });
});
