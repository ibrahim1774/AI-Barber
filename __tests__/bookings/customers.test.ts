import {
  filterCustomers, groupCustomers, isAbandonedHold, normalizeEmail, normalizePhone, type CustomerAppt,
} from '@/lib/bookings/customers';

let n = 0;
const row = (o: Partial<CustomerAppt> = {}): CustomerAppt => {
  n += 1;
  return {
    id: `a${n}`, start: '2026-10-01T15:00:00.000Z', end: '2026-10-01T15:30:00.000Z', serviceName: 'Cut', priceCents: 3000,
    memberId: 'm1', name: 'Jane', phone: null, email: null, status: 'done', cancelledBy: null, paymentStatus: 'none',
    paymentMethod: null, amountPaidCents: 0, amountRefundedCents: 0, source: 'online', createdAt: '2026-09-30T10:00:00.000Z', ...o,
  };
};
const NOW = '2026-10-25T12:00:00.000Z';

describe('normalizePhone / normalizeEmail', () => {
  it('treats the common US formats as one key', () => {
    for (const p of ['(512) 555-0142', '512-555-0142', '+1 512 555 0142', '15125550142']) expect(normalizePhone(p)).toBe('5125550142');
    expect(normalizePhone('12')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
  it('lowercases and trims emails', () => {
    expect(normalizeEmail(' Jane@X.com ')).toBe('jane@x.com');
    expect(normalizeEmail('jane')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

describe('groupCustomers', () => {
  it('merges by email or phone, transitively', () => {
    const out = groupCustomers([
      row({ email: 'e1@x.com', phone: '5125550001' }),
      row({ email: 'E1@x.com', phone: '5125550002' }),
      row({ email: 'e2@x.com', phone: '(512) 555-0002' }),
      row({ email: 'e3@x.com', phone: '5125550003' }),
    ], NOW);
    expect(out).toHaveLength(2);
    const big = out.find((c) => c.history.length === 3)!;
    expect(big.emails).toHaveLength(2);
    expect(big.phones).toHaveLength(2);
  });

  it('drops abandoned card holds', () => {
    const hold = row({ email: 'h@x.com', status: 'cancelled', cancelledBy: 'customer', paymentMethod: 'card', amountPaidCents: 0 });
    expect(isAbandonedHold(hold)).toBe(true);
    expect(groupCustomers([hold], NOW)).toHaveLength(0);
    const out = groupCustomers([hold, row({ email: 'h@x.com' })], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].cancelled).toBe(0);
    expect(out[0].history).toHaveLength(1);
  });

  it('counts a shop cancellation of a paid card booking', () => {
    const out = groupCustomers([
      row({ email: 'p@x.com', status: 'cancelled', cancelledBy: 'shop', paymentMethod: 'card', amountPaidCents: 3000 }),
    ], NOW);
    expect(out[0].cancelled).toBe(1);
  });

  it('skips name-only walk-ins', () => {
    expect(groupCustomers([row({ source: 'walk_in', phone: null, email: null })], NOW)).toHaveLength(0);
  });

  it('computes stats', () => {
    const out = groupCustomers([
      row({ email: 's@x.com', start: '2026-09-01T15:00:00.000Z', amountPaidCents: 3000 }),
      row({ email: 's@x.com', start: '2026-10-10T15:00:00.000Z', amountPaidCents: 2500, amountRefundedCents: 500 }),
      row({ email: 's@x.com', start: '2026-11-02T15:00:00.000Z', status: 'booked' }),
      row({ email: 's@x.com', start: '2026-10-20T15:00:00.000Z', status: 'no_show' }),
      row({ email: 's@x.com', start: '2026-08-01T15:00:00.000Z', status: 'cancelled', cancelledBy: 'shop' }),
    ], NOW);
    const c = out[0];
    expect(c.bookings).toBe(4);
    expect(c.paidCents).toBe(5000);
    expect(c.noShows).toBe(1);
    expect(c.cancelled).toBe(1);
    expect(c.nextAt).toBe('2026-11-02T15:00:00.000Z');
    expect(c.firstAt).toBe('2026-09-01T15:00:00.000Z');
    expect(c.lastAt).toBe('2026-10-20T15:00:00.000Z');
    expect(c.history.map((h) => h.start)).toEqual([...c.history.map((h) => h.start)].sort().reverse());
  });

  it('picks name from the latest created row and id from the earliest start', () => {
    const early = row({ email: 'n@x.com', name: 'Jane Doe', start: '2026-08-01T15:00:00.000Z', createdAt: '2026-07-01T00:00:00.000Z' });
    const late = row({ email: 'n@x.com', name: 'Janie', start: '2026-09-01T15:00:00.000Z', createdAt: '2026-08-15T00:00:00.000Z' });
    const dup = row({ email: 'n@x.com', name: 'JANIE', start: '2026-09-05T15:00:00.000Z', createdAt: '2026-08-10T00:00:00.000Z' });
    const other = row({ email: 'n@x.com', name: 'Kid', start: '2026-09-06T15:00:00.000Z', createdAt: '2026-08-11T00:00:00.000Z' });
    const c = groupCustomers([late, other, early, dup], NOW)[0];
    expect(c.name).toBe('Janie');
    expect(c.otherNames.sort()).toEqual(['Jane Doe', 'Kid']);
    expect(c.id).toBe(early.id);
  });

  it('sorts by last visit, nulls last', () => {
    const out = groupCustomers([
      row({ email: 'a@x.com', start: '2026-09-01T15:00:00.000Z' }),
      row({ email: 'b@x.com', start: '2026-10-01T15:00:00.000Z' }),
      row({ email: 'c@x.com', start: '2026-12-01T15:00:00.000Z', status: 'booked' }),
    ], NOW);
    expect(out.map((c) => c.emails[0])).toEqual(['b@x.com', 'a@x.com', 'c@x.com']);
  });
});

describe('filterCustomers', () => {
  const list = groupCustomers([
    row({ email: 'jane@x.com', phone: '(512) 555-0142', name: 'Jane', start: '2026-09-01T15:00:00.000Z', amountPaidCents: 1000 }),
    row({ email: 'jane@x.com', start: '2026-09-02T15:00:00.000Z', amountPaidCents: 1000 }),
    row({ email: 'zed@x.com', name: 'Zed', start: '2026-10-01T15:00:00.000Z', amountPaidCents: 5000 }),
    row({ email: 'amy@x.com', name: 'Amy', start: '2026-10-05T15:00:00.000Z' }),
  ], NOW);
  it('matches phone digits, name and email', () => {
    expect(filterCustomers(list, '555 0142', 'recent').map((c) => c.name)).toEqual(['Jane']);
    expect(filterCustomers(list, 'JANE', 'recent')).toHaveLength(1);
    expect(filterCustomers(list, 'zed@', 'recent')).toHaveLength(1);
    expect(filterCustomers(list, '  ', 'recent')).toHaveLength(3);
  });
  it('sorts', () => {
    expect(filterCustomers(list, '', 'name').map((c) => c.name)).toEqual(['Amy', 'Jane', 'Zed']);
    expect(filterCustomers(list, '', 'bookings').map((c) => c.name)).toEqual(['Jane', 'Amy', 'Zed']);
    expect(filterCustomers(list, '', 'paid').map((c) => c.name)).toEqual(['Zed', 'Jane', 'Amy']);
  });
});
