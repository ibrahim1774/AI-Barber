let mockSession: { access_token: string } | null = { access_token: 'tok' };
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: mockSession } }) } },
}));

import { friendlyOrderError, markOrder, OrderApiError, refundOrder } from '@/lib/store/api';

const fetchMock = jest.fn();
beforeEach(() => {
  mockSession = { access_token: 'tok' };
  fetchMock.mockReset();
  (global as any).fetch = fetchMock;
});
const reply = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const last = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url: url as string, init, body: JSON.parse(init.body) };
};

describe('markOrder', () => {
  it('posts the action and tracking with the bearer token', async () => {
    reply(200, { order: { id: 'o1', status: 'shipped' } });
    const o = await markOrder('o1', 'shipped', { trackingNumber: ' 1Z999 ', trackingUrl: 'https://t.example/1Z999' });
    const { url, init, body } = last();
    expect(url).toBe('https://www.aibarber.org/api/shop/orders/o1/mark');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(body).toEqual({ action: 'shipped', trackingNumber: '1Z999', trackingUrl: 'https://t.example/1Z999' });
    expect(o.status).toBe('shipped');
  });
  it('sends only the action when there is no tracking', async () => {
    reply(200, { order: { id: 'o1' } });
    await markOrder('o1', 'ready');
    expect(last().body).toEqual({ action: 'ready' });
  });
  it('needs a session', async () => {
    mockSession = null;
    await expect(markOrder('o1', 'ready')).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('refundOrder', () => {
  it('returns pending and sends the amount only when given', async () => {
    reply(200, { order: { id: 'o1' }, refundedCents: 0, pending: true });
    const r = await refundOrder('o1', 500);
    expect(last().url).toBe('https://www.aibarber.org/api/shop/orders/o1/refund');
    expect(last().body).toEqual({ amountCents: 500 });
    expect(r.pending).toBe(true);
    reply(200, { order: { id: 'o1' }, refundedCents: 3300, pending: false });
    const full = await refundOrder('o1');
    expect(last().body).toEqual({});
    expect(full).toMatchObject({ refundedCents: 3300, pending: false });
  });
});

describe('errors', () => {
  it.each([
    ['card-payment', /Stripe/],
    ['wrong-fulfilment', /pickup/i],
    ['has-payment', /Refund it first/],
    ['refund-pending', /already on its way/],
    ['nothing-to-refund', /nothing left/i],
    ['not-markable', /just changed/],
    ['not-card', /card/i],
    ['store-paused', /plan needs to be active/],
  ])('maps %s', async (code, re) => {
    reply(409, { error: code });
    const e = await markOrder('o1', 'paid').catch((x) => x);
    expect(e).toBeInstanceOf(OrderApiError);
    expect(e.code).toBe(code);
    expect(friendlyOrderError(e)).toMatch(re);
  });
  it('maps the network error to the offline text', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const e = await markOrder('o1', 'paid').catch((x) => x);
    expect(e.status).toBe(0);
    expect(friendlyOrderError(e)).toMatch(/Couldn't reach AI Barber/);
  });
  it('falls back for unknown codes and non-API errors', () => {
    expect(friendlyOrderError(new OrderApiError(500, 'http-500', 'x'))).toBe('Something went wrong. Please try again.');
    expect(friendlyOrderError(new Error('x'))).toBe('Something went wrong. Please try again.');
  });
});
