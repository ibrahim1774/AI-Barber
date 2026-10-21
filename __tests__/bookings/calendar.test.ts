import {
  addDays, appointmentsForDay, availableActions, blockRange, countsByDay, dateFromPushData, dayHeading, dayKey,
  dayRange, digits, formatMinutes, formatMoney, formatTime, minutesOfDay, nextQuarter, smsUrl, startIso, statusChip,
  stripDays, telUrl, timeOffForDay, zonedToUtc, type Appointment, type TimeOff,
} from '@/lib/bookings/calendar';

const NY = 'America/New_York';
const LA = 'America/Los_Angeles';

const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: 'a1', shopId: 's', memberId: 'm1', serviceId: 'sv', start: '2026-10-23T18:00:00Z', end: '2026-10-23T18:30:00Z',
  serviceName: 'Fade', priceCents: 3000, durationMin: 30, customerName: 'Sam', customerPhone: '(555) 123-4567',
  customerEmail: null, note: null, status: 'booked', paymentStatus: 'none', paymentMethod: null, amountPaidCents: 0,
  customerSaysPaidAt: null, source: 'online', ...over,
});

describe('timezone maths', () => {
  it('reads the shop-local date, not the phone date', () => {
    // 02:30 UTC on the 24th is still the 23rd in New York and Los Angeles.
    expect(dayKey('2026-10-24T02:30:00Z', NY)).toBe('2026-10-23');
    expect(dayKey('2026-10-24T02:30:00Z', 'Asia/Tokyo')).toBe('2026-10-24');
  });
  it('formats 12-hour times in the shop zone', () => {
    expect(formatTime('2026-10-23T18:00:00Z', NY)).toBe('2:00 PM');
    expect(formatTime('2026-10-23T18:00:00Z', LA)).toBe('11:00 AM');
    expect(formatTime('2026-10-23T04:00:00Z', NY)).toBe('12:00 AM');
    expect(formatMinutes(12 * 60 + 5)).toBe('12:05 PM');
  });
  it('turns a wall-clock time into the right instant', () => {
    expect(new Date(zonedToUtc('2026-10-23', 14 * 60, NY)).toISOString()).toBe('2026-10-23T18:00:00.000Z');
    expect(startIso('2026-01-15', 9 * 60, NY)).toBe('2026-01-15T14:00:00.000Z');
    expect(minutesOfDay('2026-10-23T18:00:00Z', NY)).toBe(14 * 60);
  });
  it('handles daylight saving: 23-hour spring day, 25-hour fall day', () => {
    const spring = dayRange('2026-03-08', NY);
    expect((Date.parse(spring.end) - Date.parse(spring.start)) / 3600000).toBe(23);
    const fall = dayRange('2026-11-01', NY);
    expect((Date.parse(fall.end) - Date.parse(fall.start)) / 3600000).toBe(25);
    // 2:30 AM does not exist on the spring day; it lands after the gap, never before midnight.
    expect(zonedToUtc('2026-03-08', 3 * 60, NY)).toBe(Date.parse('2026-03-08T07:00:00Z'));
  });
  it('does not depend on the process timezone', () => {
    expect(dayRange('2026-10-23', 'Asia/Tokyo').start).toBe('2026-10-22T15:00:00.000Z');
  });
  it('adds days across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('grouping', () => {
  const list = [
    appt({ id: 'late', start: '2026-10-23T20:00:00Z', end: '2026-10-23T20:30:00Z' }),
    appt({ id: 'early', start: '2026-10-23T14:00:00Z', end: '2026-10-23T14:30:00Z', memberId: 'm2' }),
    appt({ id: 'cancelled', status: 'cancelled' }),
    appt({ id: 'tomorrow', start: '2026-10-24T14:00:00Z', end: '2026-10-24T14:30:00Z' }),
    // 10:30 PM on the 23rd in New York is already the 24th in UTC
    appt({ id: 'night', start: '2026-10-24T02:30:00Z', end: '2026-10-24T03:00:00Z' }),
  ];
  it('lists a day in time order, in shop time, without cancelled', () => {
    expect(appointmentsForDay(list, '2026-10-23', NY).map((a) => a.id)).toEqual(['early', 'late', 'night']);
    expect(appointmentsForDay(list, '2026-10-24', NY).map((a) => a.id)).toEqual(['tomorrow']);
  });
  it('filters by barber', () => {
    expect(appointmentsForDay(list, '2026-10-23', NY, 'm2').map((a) => a.id)).toEqual(['early']);
  });
  it('counts per day for the strip dots', () => {
    expect(countsByDay(list, NY)).toEqual({ '2026-10-23': 3, '2026-10-24': 1 });
    expect(countsByDay(list, NY, 'm2')).toEqual({ '2026-10-23': 1 });
  });
  it('finds time off touching a day, including overnight blocks', () => {
    const off: TimeOff[] = [
      { id: 't1', memberId: 'm1', start: '2026-10-23T16:00:00Z', end: '2026-10-23T17:00:00Z', reason: 'Lunch' },
      { id: 't2', memberId: 'm1', start: '2026-10-22T20:00:00Z', end: '2026-10-23T05:00:00Z', reason: null },
      { id: 't3', memberId: 'm2', start: '2026-10-25T16:00:00Z', end: '2026-10-25T17:00:00Z', reason: null },
    ];
    expect(timeOffForDay(off, '2026-10-23', NY).map((t) => t.id)).toEqual(['t2', 't1']);
    expect(timeOffForDay(off, '2026-10-23', NY, 'm2')).toEqual([]);
  });
  it('builds the strip around today', () => {
    const days = stripDays('2026-10-21', 2, 3);
    expect(days).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
  });
  it('names days', () => {
    expect(dayHeading('2026-10-21', '2026-10-21')).toBe('Today');
    expect(dayHeading('2026-10-22', '2026-10-21')).toBe('Tomorrow');
    expect(dayHeading('2026-10-24', '2026-10-21')).toBe('Sat, Oct 24');
  });
});

describe('status chips and actions', () => {
  it('maps status and payment to the chip', () => {
    expect(statusChip({ status: 'booked', paymentStatus: 'none' }).label).toBe('Booked');
    expect(statusChip({ status: 'booked', paymentStatus: 'paid' }).label).toBe('Paid');
    expect(statusChip({ status: 'booked', paymentStatus: 'deposit' }).label).toBe('Deposit');
    expect(statusChip({ status: 'booked', paymentStatus: 'awaiting' }).label).toBe('Awaiting');
    expect(statusChip({ status: 'done', paymentStatus: 'paid' }).label).toBe('Done');
    expect(statusChip({ status: 'no_show', paymentStatus: 'none' }).label).toBe('No-show');
  });
  it('offers the right buttons', () => {
    const booked = availableActions(appt());
    expect(booked).toMatchObject({ call: true, markPaid: true, markDone: true, noShow: true, reschedule: true, cancel: true, rebind: false });
    const done = availableActions(appt({ status: 'done', paymentStatus: 'paid' }));
    expect(done).toMatchObject({ markPaid: false, noShow: false, cancel: false, rebind: true });
    expect(availableActions(appt({ customerPhone: null })).call).toBe(false);
    expect(availableActions(appt({ status: 'no_show' })).markPaid).toBe(false);
  });
});

describe('links and money', () => {
  it('cleans phone numbers for tel and sms', () => {
    expect(digits('(555) 123-4567')).toBe('5551234567');
    expect(digits('+1 555 123 4567')).toBe('+15551234567');
    expect(telUrl('(555) 123-4567')).toBe('tel:5551234567');
    expect(smsUrl('555-123-4567', 'Hi there')).toBe('sms:5551234567&body=Hi%20there');
  });
  it('formats prices', () => {
    expect(formatMoney(3000)).toBe('$30');
    expect(formatMoney(3050)).toBe('$30.50');
    expect(formatMoney(null)).toBe('Ask');
  });
});

describe('push taps and pickers', () => {
  it('opens on the day from date or start (in shop time)', () => {
    expect(dateFromPushData({ date: '2026-10-25' }, NY)).toBe('2026-10-25');
    expect(dateFromPushData({ start: '2026-10-24T02:30:00Z' }, NY)).toBe('2026-10-23');
    expect(dateFromPushData({ date: 'nope' }, NY)).toBeNull();
    expect(dateFromPushData(undefined, NY)).toBeNull();
  });
  it('rounds up to the next quarter hour', () => {
    expect(nextQuarter(Date.parse('2026-10-23T18:07:00Z'), NY)).toBe(14 * 60 + 15);
    expect(nextQuarter(Date.parse('2026-10-24T03:59:00Z'), NY)).toBe(23 * 60 + 45);
  });
  it('builds time-off ranges', () => {
    expect(blockRange('2026-10-23', NY, true, 0, 0)).toEqual(dayRange('2026-10-23', NY));
    expect(blockRange('2026-10-23', NY, false, 12 * 60, 13 * 60)).toEqual({
      start: '2026-10-23T16:00:00.000Z', end: '2026-10-23T17:00:00.000Z',
    });
    expect(blockRange('2026-10-23', NY, false, 13 * 60, 13 * 60)).toBeNull();
  });
});
