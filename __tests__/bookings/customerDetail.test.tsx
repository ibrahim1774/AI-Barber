import React from 'react';
import { Linking } from 'react-native';
import { act, allText, press, render } from '../store/render';

const mockBack = jest.fn();
let mockParams: any = { id: 'appt-1' };
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useFocusEffect: () => {}, router: { push: jest.fn() } }));
jest.mock('@/constants/theme', () => require('../store/themeMock'));
jest.mock('@/components/Page', () => {
  const R = require('react');
  return { Page: ({ children }: any) => R.createElement(R.Fragment, null, children) };
});
jest.mock('@/components/Button', () => {
  const R = require('react');
  return { Button: ({ title, onPress }: any) => R.createElement('Pressable', { accessibilityRole: 'button', onPress }, R.createElement('Text', null, title)) };
});
jest.mock('@/lib/nav', () => ({ goBackOrHome: () => mockBack() }));
jest.mock('@/lib/bookings/shop', () => ({
  listMembers: async () => [{ id: 'm1', name: 'Marco' }],
  memberName: (m: any) => m.name,
}));
let mockData: any;
jest.mock('@/components/bookings/useCustomers', () => ({ useCustomers: () => mockData }));

import CustomerDetail from '@/app/customers/[id]';
import type { Customer, CustomerAppt } from '@/lib/bookings/customers';

const appt = (o: Partial<CustomerAppt>): CustomerAppt => ({
  id: 'x', start: '2026-10-20T15:00:00.000Z', end: '2026-10-20T15:30:00.000Z', serviceName: 'Fade', priceCents: 3000, memberId: 'm1',
  name: 'Jane Doe', phone: null, email: null, status: 'done', cancelledBy: null, paymentStatus: 'paid', paymentMethod: 'cash',
  amountPaidCents: 3000, amountRefundedCents: 0, source: 'online', createdAt: '2026-10-01T00:00:00.000Z', ...o,
});
const customer = (o: Partial<Customer> = {}): Customer => ({
  id: 'appt-1', name: 'Jane Doe', otherNames: ['Janie'], emails: ['jane@x.com'], phones: ['5125550142', '5125550199'], bookings: 2,
  firstAt: '2026-08-01T15:00:00.000Z', lastAt: '2026-10-20T15:00:00.000Z', nextAt: '2026-11-02T15:00:00.000Z', paidCents: 3000,
  cancelled: 1, noShows: 1,
  history: [
    appt({ id: 'h1', start: '2026-10-20T15:00:00.000Z' }),
    appt({ id: 'h2', start: '2026-08-01T15:00:00.000Z', status: 'cancelled', amountPaidCents: 0, memberId: 'gone', serviceName: 'Beard' }),
  ],
  ...o,
});
const set = (customers: Customer[], phase = 'ready') => {
  mockData = { phase, shop: { id: 's', timezone: 'America/New_York' }, customers, refresh: jest.fn() };
};

beforeEach(() => { mockParams = { id: 'appt-1' }; mockBack.mockClear(); });

describe('Customer detail', () => {
  it('shows contact and stats, and opens tel / mailto links', async () => {
    set([customer()]);
    const spy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    const tree = await render(<CustomerDetail />);
    const t = allText(tree).join('\n');
    expect(t).toContain('Jane Doe');
    expect(t).toContain('Also booked as Janie');
    expect(t).toContain('(512) 555-0142');
    expect(t).toContain('(512) 555-0199');
    for (const l of ['First booking', 'Last booking', 'Next booking', 'Bookings', 'Paid', 'Cancelled', 'No-shows']) expect(t).toContain(l);
    const link = (label: string) => tree.root.findAll((n: any) => n.props?.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
    await act(async () => { link('Call (512) 555-0142').props.onPress(); });
    await act(async () => { link('Email jane@x.com').props.onPress(); });
    expect(spy).toHaveBeenCalledWith('tel:5125550142');
    expect(spy).toHaveBeenCalledWith('mailto:jane@x.com');
  });

  it('hides facts that do not exist', async () => {
    set([customer({ otherNames: [], nextAt: null, paidCents: 0, cancelled: 0, noShows: 0, history: [] })]);
    const t = allText(await render(<CustomerDetail />)).join('\n');
    expect(t).not.toContain('Next booking');
    expect(t).not.toContain('Also booked as');
    expect(t).not.toMatch(/Paid|Cancelled|No-shows/);
  });

  it('lists history with date, time, service, barber, status and paid amount', async () => {
    set([customer()]);
    const t = allText(await render(<CustomerDetail />)).join('\n');
    expect(t).toContain('Tue, Oct 20, 2026 · 11:00');
    expect(t).toContain('Fade · Marco · Paid $30');
    expect(t).toContain('Beard · Barber');
    expect(t).toContain('Done');
    expect(t).toContain('Cancelled');
  });

  it('shows Customer not found with a Back button for an unknown id', async () => {
    mockParams = { id: 'nope' };
    set([customer()]);
    const tree = await render(<CustomerDetail />);
    expect(allText(tree).join('\n')).toContain('Customer not found');
    await press(tree, 'Back');
    expect(mockBack).toHaveBeenCalled();
  });
});
