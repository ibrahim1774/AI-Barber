import React from 'react';
import { allText, hasButton, render } from '../store/render';

jest.mock('@/constants/theme', () => require('../store/themeMock'));
jest.mock('@/components/EditSheet', () => {
  const R = require('react');
  return { Sheet: ({ visible, children }: any) => (visible ? R.createElement(R.Fragment, null, children) : null) };
});
jest.mock('@/components/bookings/WhenPicker', () => ({ Label: () => null, WhenPicker: () => null }));
jest.mock('@/components/bookings/AppointmentRow', () => ({ StatusChip: () => null }));

import { AppointmentSheet } from '@/components/bookings/AppointmentSheet';

const APPT: any = {
  id: 'a1', shopId: 's', memberId: 'm', serviceId: null, start: '2026-11-02T15:00:00Z', end: '2026-11-02T15:30:00Z',
  serviceName: 'Cut', priceCents: 3000, durationMin: 30, customerName: 'Sam', customerPhone: null, customerEmail: null,
  note: null, status: 'booked', paymentStatus: 'none', paymentMethod: null, amountPaidCents: 0, customerSaysPaidAt: null, source: 'online',
};
const mount = (rescheduleLocked: boolean) =>
  render(
    <AppointmentSheet appt={APPT} tz="America/New_York" today="2026-11-02" bookingLink="" rescheduleLocked={rescheduleLocked}
      onClose={() => {}} onChanged={async () => {}} />,
  );

it('rescheduleLocked keeps Cancel, Done, Mark paid, No-show and drops only Reschedule', async () => {
  const tree = await mount(true);
  for (const t of ['Cancel booking', 'Done', 'Mark paid', 'No-show']) expect(hasButton(tree, t)).toBe(true);
  expect(hasButton(tree, 'Reschedule')).toBe(false);
  expect(allText(tree)).toContain('Upgrade to Bookings to reschedule or add bookings.');
});

it('unlocked offers Reschedule and no upgrade note', async () => {
  const tree = await mount(false);
  expect(hasButton(tree, 'Reschedule')).toBe(true);
  expect(allText(tree)).not.toContain('Upgrade to Bookings to reschedule or add bookings.');
});
