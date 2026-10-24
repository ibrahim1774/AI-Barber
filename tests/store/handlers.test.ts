import { describe, it, expect, vi, beforeEach } from 'vitest';

// The handlers run the real flows over an in-memory store world.
const holder = vi.hoisted(() => ({ w: null as any }));
vi.mock('../../lib/store/live.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/store/live.js')>()),
  liveStoreDeps: () => holder.w.deps,
}));

// The shared (Supabase) rate store, faked: an in-memory ab_rate_hit.
const rpcState = vi.hoisted(() => ({ hits: new Map<string, number>(), calls: [] as unknown[] }));
vi.mock('../../lib/bookings/repo.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/bookings/repo.js')>()),
  serviceClient: () => ({
    rpc: async (fn: string, args: { p_key: string; p_window_s: number; p_max: number }) => {
      rpcState.calls.push([fn, args]);
      const n = (rpcState.hits.get(args.p_key) ?? 0) + 1;
      rpcState.hits.set(args.p_key, n);
      return { data: n <= args.p_max, error: null };
    },
  }),
}));

import shopHandler from '../../api/store/shop.js';
import ordersHandler, { config as ordersConfig } from '../../api/store/orders.js';
import orderHandler from '../../api/store/order.js';
import sentHandler from '../../api/store/sent.js';
import markHandler, { config as markConfig } from '../../api/shop/orders/[id]/mark.js';
import refundHandler, { config as refundConfig } from '../../api/shop/orders/[id]/refund.js';
import { orderIdParam } from '../../lib/store/http.js';
import { shopOrderLimiter } from '../../lib/store/live.js';
import { storeWorld } from './fakeRepo.js';

function res() {
  const r: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r; };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.send = (b: unknown) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

let ip = 0;
const nextIp = () => `10.1.0.${++ip}`;

beforeEach(() => {
  holder.w = storeWorld();
});

async function placeManual() {
  const w = holder.w;
  const r = res();
  await ordersHandler({
    method: 'POST', headers: { 'x-real-ip': nextIp() },
    body: {
      slug: 'fresh-cuts', clientKey: '9f0c5a52-7d7e-4a8e-9a65-3c1b2d4e5f60', items: [{ productId: w.ids.oil, quantity: 1 }],
      customer: { name: 'Sam', phone: '5551234567', email: 'sam@example.com' }, fulfilment: 'pickup', pay: 'manual', expectedTotalCents: 1500,
    },
  } as any, r);
  expect(r.statusCode).toBe(201);
  return w.state.orders.at(-1)!;
}


it('owner refund and mark may run 30 s (Stripe refund / email, past the plan default)', () => {
  expect(refundConfig).toEqual({ maxDuration: 30 });
  expect(markConfig).toEqual({ maxDuration: 30 });
});

it('POST /api/store/orders may run 30 s (Checkout create plus an expire on a store miss)', () => expect(ordersConfig).toEqual({ maxDuration: 30 }));

describe('public store handlers', () => {
  it('store/shop: GET by slug, 405 for POST, CORS OPTIONS', async () => {
    let r = res();
    await shopHandler({ method: 'GET', query: { slug: 'fresh-cuts' }, headers: { 'x-real-ip': nextIp() } } as any, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.paused).toBe(false);
    expect(r.headers['Cache-Control']).toBe('no-store');
    r = res();
    await shopHandler({ method: 'POST', headers: {} } as any, r);
    expect(r.statusCode).toBe(405);
    r = res();
    await shopHandler({ method: 'OPTIONS', headers: {} } as any, r);
    expect(r.statusCode).toBe(200);
    expect(r.headers['Access-Control-Allow-Methods']).toBe('OPTIONS,GET');
    expect(r.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  it('store/orders: 201 through the real flow; 405 for GET; OPTIONS allows POST', async () => {
    await placeManual();
    let r = res();
    await ordersHandler({ method: 'GET', headers: {} } as any, r);
    expect(r.statusCode).toBe(405);
    r = res();
    await ordersHandler({ method: 'OPTIONS', headers: {} } as any, r);
    expect(r.headers['Access-Control-Allow-Methods']).toBe('OPTIONS,POST');
  });

  it('a malformed JSON body returns 400 invalid (orders and sent)', async () => {
    for (const h of [ordersHandler, sentHandler]) {
      const r = res();
      const req = Object.defineProperty({ method: 'POST', headers: { 'x-real-ip': nextIp() } }, 'body', {
        get() { throw new Error('Invalid JSON'); },
      });
      await h(req as any, r);
      expect(r.statusCode).toBe(400);
      expect(r.body).toEqual({ error: 'invalid', field: 'body' });
    }
    const r = res();
    await ordersHandler({ method: 'POST', body: '{"slug":', headers: { 'x-real-ip': nextIp() } } as any, r);
    expect(r.body).toEqual({ error: 'invalid', field: 'body' });
  });

  it('store/order: GET by token; store/sent: POST', async () => {
    const o = await placeManual();
    let r = res();
    await orderHandler({ method: 'GET', query: { token: o.manage_token }, headers: { 'x-real-ip': nextIp() } } as any, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.order.number).toBe(1001);
    r = res();
    await sentHandler({ method: 'POST', body: JSON.stringify({ token: o.manage_token, method: 'cashapp' }), headers: { 'x-real-ip': nextIp() } } as any, r);
    expect(r.statusCode).toBe(200);
    expect(holder.w.notified.at(-1)).toMatchObject({ kind: 'order_says_paid' });
    r = res();
    await orderHandler({ method: 'POST', headers: {} } as any, r);
    expect(r.statusCode).toBe(405);
  });

  it('429 from the IP limiter on writes (10/min, shared store), reads stay in memory', async () => {
    rpcState.calls.length = 0;
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const r = res();
      await ordersHandler({ method: 'POST', body: '{}', headers: { 'x-real-ip': '10.9.9.9' } } as any, r);
      codes.push(r.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 400)).toBe(true);
    expect(codes[10]).toBe(429);
    expect(rpcState.calls[0]).toEqual(['ab_rate_hit', { p_key: 'public:write:10.9.9.9', p_window_s: 60, p_max: 10 }]);
    const r = res();
    await sentHandler({ method: 'POST', body: '{}', headers: { 'x-real-ip': '10.9.9.9' } } as any, r);
    expect(r.statusCode).toBe(429);
    expect(r.headers['Retry-After']).toBe('60');
    rpcState.calls.length = 0;
    await shopHandler({ method: 'GET', query: { slug: 'fresh-cuts' }, headers: { 'x-real-ip': '10.9.9.9' } } as any, res());
    expect(rpcState.calls).toEqual([]);
  });

  it('the per-shop order limiter counts shop-order:{id} at 30 per hour in the shared store', async () => {
    rpcState.calls.length = 0;
    const lim = shopOrderLimiter();
    expect(await lim.shopOrder('shop-1')).toBe(true);
    expect(rpcState.calls[0]).toEqual(['ab_rate_hit', { p_key: 'shop-order:shop-1', p_window_s: 3600, p_max: 30 }]);
  });

  it('a 429 from the per-shop limiter carries Retry-After 300', async () => {
    holder.w.limits.shopOrder.mockResolvedValue(false);
    const w = holder.w;
    const r = res();
    await ordersHandler({
      method: 'POST', headers: { 'x-real-ip': nextIp() },
      body: {
        slug: 'fresh-cuts', clientKey: '9f0c5a52-7d7e-4a8e-9a65-3c1b2d4e5f61', items: [{ productId: w.ids.oil, quantity: 1 }],
        customer: { name: 'Sam', phone: '5551234567', email: 'sam@example.com' }, fulfilment: 'pickup', pay: 'manual', expectedTotalCents: 1500,
      },
    } as any, r);
    expect(r.statusCode).toBe(429);
    expect(r.headers['Retry-After']).toBe('300');
  });
});

describe('owner order handlers', () => {
  it('mark: the [id] comes from the query or the URL; the bearer is passed through', async () => {
    const o = await placeManual();
    let r = res();
    await markHandler({ method: 'POST', query: { id: o.id }, body: { action: 'ready' }, headers: { authorization: 'Bearer owner-jwt' } } as any, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.order.status).toBe('ready');
    r = res();
    await markHandler({ method: 'POST', query: {}, url: `/api/shop/orders/${o.id}/mark`, body: { action: 'done' }, headers: { authorization: 'Bearer owner-jwt' } } as any, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.order.status).toBe('done');
    r = res();
    await markHandler({ method: 'POST', query: { id: o.id }, body: { action: 'done' }, headers: {} } as any, r);
    expect(r.statusCode).toBe(401);
    r = res();
    await markHandler({ method: 'GET', headers: {} } as any, r);
    expect(r.statusCode).toBe(405);
  });

  it('refund: a malformed body is 400 invalid body, never a full refund', async () => {
    const o = await placeManual();
    const r = res();
    const req = Object.defineProperty({ method: 'POST', query: { id: o.id }, headers: { authorization: 'Bearer owner-jwt' } }, 'body', {
      get() { throw new Error('Invalid JSON'); },
    });
    await refundHandler(req as any, r);
    expect(r.statusCode).toBe(400);
    expect(r.body).toEqual({ error: 'invalid', field: 'body' });
    const r2 = res();
    await refundHandler({ method: 'POST', query: {}, url: `/api/shop/orders/${o.id}/refund`, body: {}, headers: { authorization: 'Bearer owner-jwt' } } as any, r2);
    expect(r2.body).toEqual({ error: 'not-card' });
  });

  it('orderIdParam parses the query, then the URL', () => {
    expect(orderIdParam({ query: { id: 'abc' }, url: '/api/shop/orders/xyz/mark' } as any)).toBe('abc');
    expect(orderIdParam({ query: { id: ['a1', 'a2'] } } as any)).toBe('a1');
    expect(orderIdParam({ query: {}, url: '/api/shop/orders/xyz/refund?x=1' } as any)).toBe('xyz');
    expect(orderIdParam({ query: {}, url: '/api/shop/orders/%E0%A4/mark' } as any)).toBeUndefined();
    expect(orderIdParam({ query: {}, url: '/api/shop/appointments/xyz/mark' } as any)).toBeUndefined();
  });
});
