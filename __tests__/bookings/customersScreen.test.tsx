import React from 'react';
import { allText, pressRow, render, type as typeInto } from '../store/render';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: any[]) => mockPush(...a), back: jest.fn() },
  useFocusEffect: () => {},
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/constants/theme', () => require('../store/themeMock'));
jest.mock('@/components/Icons', () => ({ ChevronLeftIcon: () => null, ChevronRightIcon: () => null }));
jest.mock('@/lib/nav', () => ({ goBackOrHome: jest.fn() }));

let mockData: any;
jest.mock('@/components/bookings/useCustomers', () => ({ useCustomers: () => mockData }));

import CustomersScreen from '@/app/customers/index';
import type { Customer } from '@/lib/bookings/customers';

const cust = (o: Partial<Customer> = {}): Customer => ({
  id: 'appt-1', name: 'Jane Doe', otherNames: [], emails: ['jane@x.com'], phones: ['5125550142'], bookings: 3,
  firstAt: '2026-08-01T15:00:00.000Z', lastAt: '2026-10-20T15:00:00.000Z', nextAt: null, paidCents: 0, cancelled: 0, noShows: 0, history: [], ...o,
});
const set = (customers: Customer[], phase = 'ready') => {
  mockData = { phase, shop: { id: 's', timezone: 'America/New_York' }, customers, refresh: jest.fn() };
};
beforeEach(() => mockPush.mockClear());

describe('Customers screen', () => {
  it('shows the empty state', async () => {
    set([]);
    const t = allText(await render(<CustomersScreen />)).join('\n');
    expect(t).toContain('No customers yet');
    expect(t).toContain('People who book on your site show up here.');
  });

  it('shows a row with only the facts that exist', async () => {
    set([cust()]);
    const t = allText(await render(<CustomersScreen />)).join('\n');
    expect(t).toContain('Jane Doe');
    expect(t).toContain('(512) 555-0142');
    expect(t).toContain('jane@x.com');
    expect(t).toContain('3 bookings');
    expect(t).toContain('Last: Tue, Oct 20, 2026');
    expect(t).not.toContain('Next:');
    expect(t).not.toMatch(/Paid|cancelled|no-show/);
  });

  it('shows singular booking, next, paid, cancelled and no-show when present', async () => {
    set([cust({ bookings: 1, nextAt: '2026-11-02T15:00:00.000Z', paidCents: 5000, cancelled: 2, noShows: 1 })]);
    const t = allText(await render(<CustomersScreen />)).join('\n');
    expect(t).toContain('1 booking');
    expect(t).not.toContain('1 bookings');
    expect(t).toContain('Next: Mon, Nov 2, 2026');
    expect(t).toContain('Paid $50');
    expect(t).toContain('2 cancelled');
    expect(t).toContain('1 no-show');
  });

  it('filters with the search field', async () => {
    set([cust(), cust({ id: 'appt-2', name: 'Zed Smith', emails: ['zed@x.com'], phones: [] })]);
    const tree = await render(<CustomersScreen />);
    const input = tree.root.findAll((n: any) => n.props?.placeholder === 'Search name, phone or email')[0];
    expect(input).toBeTruthy();
    await typeInto(tree, 'Search customers', 'jane');
    const t = allText(tree).join('\n');
    expect(t).toContain('Jane Doe');
    expect(t).not.toContain('Zed Smith');
  });

  it('opens the detail by appointment id only', async () => {
    set([cust()]);
    const tree = await render(<CustomersScreen />);
    await pressRow(tree, 'Jane Doe');
    expect(mockPush).toHaveBeenCalledWith('/customers/appt-1');
    const path = String(mockPush.mock.calls[0][0]);
    expect(path).not.toContain('@');
    expect(path).not.toMatch(/5125550142|555/);
  });

  it('shows the error copy', async () => {
    set([], 'error');
    expect(allText(await render(<CustomersScreen />)).join('\n')).toContain("Couldn't load customers. Pull down to try again.");
  });
});
