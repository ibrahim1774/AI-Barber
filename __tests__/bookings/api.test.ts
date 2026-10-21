import { ApiError } from '@/lib/api';

const mockSession = { access_token: 'tok' } as { access_token: string } | null;
let mockCalls: { table: string; op: string; args: any[] }[] = [];
let mockResult: { data: any; error: any } = { data: [], error: null };

jest.mock('@/lib/supabase', () => {
  const chain = (table: string, op: string, first: any[]): any => {
    mockCalls.push({ table, op, args: first });
    const c: any = new Proxy(() => {}, {
      get(_t, prop: string) {
        if (prop === 'then') return (res: any) => Promise.resolve(mockResult).then(res);
        return (...args: any[]) => {
          mockCalls.push({ table, op: prop, args });
          return c;
        };
      },
    });
    return c;
  };
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: mockSession } }) },
      from: (table: string) => ({
        select: (...a: any[]) => chain(table, 'select', a),
        update: (...a: any[]) => chain(table, 'update', a),
      }),
    },
  };
});

import {
  BookingApiError, addBooking, alternativesOf, blockTime, cancelBooking, friendlyBookingError, listAppointments,
  markDone, markNoShow, markPaid, postPushToken, rescheduleBooking, toAppointment,
} from '@/lib/bookings/api';

const fetchMock = jest.fn();
beforeEach(() => {
  mockCalls = [];
  mockResult = { data: [], error: null };
  fetchMock.mockReset();
  (global as any).fetch = fetchMock;
});

const reply = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url: url as string, init, body: JSON.parse(init.body) };
};

describe('owner endpoints', () => {
  it('adds a walk-in with the bearer token and only the customer fields given', async () => {
    reply(201, { appointment: { id: 'x' } });
    await addBooking({ memberId: 'm', serviceId: 's', start: '2026-10-23T18:00:00.000Z', customer: { name: 'Sam', phone: '' } });
    const { url, init, body } = lastCall();
    expect(url).toBe('https://www.aibarber.org/api/shop/appointments');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(body.customer).toEqual({ name: 'Sam' });
  });

  it('cancels and reschedules by id', async () => {
    reply(200, { appointment: {} });
    await cancelBooking('a b');
    expect(lastCall().url).toBe('https://www.aibarber.org/api/shop/appointments/a%20b/cancel');
    reply(200, { appointment: {} });
    await rescheduleBooking('a1', '2026-10-24T14:00:00.000Z', 'm2');
    expect(lastCall().url).toMatch(/\/a1\/reschedule$/);
    expect(lastCall().body).toEqual({ start: '2026-10-24T14:00:00.000Z', memberId: 'm2' });
  });

  it('sends time off and returns the conflicts either way', async () => {
    reply(200, { conflicts: [{ id: 'c1', start: '2026-10-23T18:00:00Z', customerName: 'Sam' }] });
    const out = await blockTime({ memberId: 'm', start: 's', end: 'e' });
    expect(lastCall().body).toEqual({ memberId: 'm', start: 's', end: 'e', cancelConflicts: false });
    expect(out.conflicts).toHaveLength(1);
    reply(200, {});
    expect((await blockTime({ memberId: 'm', start: 's', end: 'e', reason: 'Lunch' })).conflicts).toEqual([]);
    expect(lastCall().body.reason).toBe('Lunch');
  });

  it('registers the push token for ios', async () => {
    reply(200, {});
    await postPushToken('ExponentPushToken[abc]');
    expect(lastCall().url).toMatch(/\/api\/shop\/push-token$/);
    expect(lastCall().body).toEqual({ expoToken: 'ExponentPushToken[abc]', platform: 'ios' });
  });

  it('keeps the 409 body so the app can show alternatives', async () => {
    reply(409, { error: 'slot-taken', alternatives: [{ start: '2026-10-23T19:00:00Z', memberId: 'm' }] });
    const err = await addBooking({ memberId: 'm', serviceId: 's', start: 'x', customer: { name: 'A' } }).catch((e) => e);
    expect(err).toBeInstanceOf(BookingApiError);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe('slot-taken');
    expect(alternativesOf(err)).toHaveLength(1);
    expect(friendlyBookingError(err)).toBe('That time is already taken.');
  });

  it('maps a dead network and a missing session', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const err = await cancelBooking('a').catch((e) => e);
    expect(err.status).toBe(0);
    expect(err.code).toBe('network');
    expect(friendlyBookingError(err)).toMatch(/connection/);
  });

  it('handles an HTML gateway error body', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, text: async () => '<html>bad gateway</html>' });
    const err = await cancelBooking('a').catch((e) => e);
    expect(err.code).toBe('http-502');
  });
});

describe('supabase reads and updates', () => {
  const row = {
    id: 'a1', shop_id: 's', member_id: 'm', service_id: null, start_at: '2026-10-23T18:00:00Z', end_at: '2026-10-23T18:30:00Z',
    service_name: 'Fade', price_cents: 3000, duration_min: 30, customer_name: 'Sam', customer_phone: null, customer_email: null,
    note: null, status: 'booked', payment_status: 'none', payment_method: null, amount_paid_cents: 0, source: 'walk_in',
  };

  it('maps rows to appointments', () => {
    expect(toAppointment(row)).toMatchObject({ id: 'a1', shopId: 's', memberId: 'm', start: row.start_at, priceCents: 3000, source: 'walk_in' });
  });

  it('lists the shop window without cancelled bookings', async () => {
    mockResult = { data: [row], error: null };
    const out = await listAppointments('s', 'from', 'to');
    expect(out).toHaveLength(1);
    const ops = mockCalls.map((c) => [c.op, ...c.args.slice(0, 2)]);
    expect(ops).toEqual(expect.arrayContaining([
      ['eq', 'shop_id', 's'], ['neq', 'status', 'cancelled'], ['gte', 'start_at', 'from'], ['lt', 'start_at', 'to'],
    ]));
  });

  it('marks done, no-show and paid through the mark endpoint', async () => {
    reply(200, { appointment: { id: 'a1' } });
    reply(200, { appointment: { id: 'a1' } });
    reply(200, { appointment: { id: 'a1' } });
    await markDone('a1');
    await markNoShow('a1');
    await markPaid({ id: 'a1' });
    const calls = fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(init.body)]);
    expect(calls).toEqual([
      ['https://www.aibarber.org/api/shop/appointments/a1/mark', { action: 'done' }],
      ['https://www.aibarber.org/api/shop/appointments/a1/mark', { action: 'no_show' }],
      ['https://www.aibarber.org/api/shop/appointments/a1/mark', { action: 'paid' }],
    ]);
    expect(mockCalls.filter((c) => c.op === 'update')).toHaveLength(0);
  });

  it('turns a refused card mark into a friendly error', async () => {
    reply(409, { error: 'card-payment' });
    const err = await markPaid({ id: 'a1' }).catch((e) => e);
    expect(err).toBeInstanceOf(BookingApiError);
    expect(friendlyBookingError(err)).toBe('Card payments are recorded by Stripe automatically.');
  });
});
