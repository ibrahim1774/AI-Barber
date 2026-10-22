import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/bookings/live.js', () => ({ liveDeps: vi.fn(() => ({ marker: 'deps' })) }));

// The shared (Supabase) rate store, faked: an in-memory ab_rate_hit, or an RPC error.
const rpcState = vi.hoisted(() => ({ hits: new Map<string, number>(), fail: false, calls: [] as unknown[] }));
vi.mock('../../lib/bookings/repo.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/bookings/repo.js')>()),
  serviceClient: () => ({
    rpc: async (fn: string, args: { p_key: string; p_window_s: number; p_max: number }) => {
      rpcState.calls.push([fn, args]);
      if (rpcState.fail) return { data: null, error: { message: 'connection refused' } };
      const n = (rpcState.hits.get(args.p_key) ?? 0) + 1;
      rpcState.hits.set(args.p_key, n);
      return { data: n <= args.p_max, error: null };
    },
  }),
}));
vi.mock('../../lib/bookings/publicFlow.js', () => ({
  getShop: vi.fn(async () => ({ status: 200, body: { paused: true, shop: { name: 'X' } } })),
  getManage: vi.fn(async () => ({ status: 200, body: { m: 1 } })),
  postManage: vi.fn(async () => ({ status: 200, body: { p: 1 } })),
  createAppointment: vi.fn(async () => ({ status: 201, body: {} })),
}));
vi.mock('../../lib/bookings/ownerFlow.js', () => ({
  cancelOwnerAppointment: vi.fn(async () => ({ status: 200, body: {} })),
  markOwnerAppointment: vi.fn(async () => ({ status: 200, body: { appointment: {} } })),
}));

import shopHandler from '../../api/book/shop.js';
import manageHandler from '../../api/book/manage.js';
import appointmentsHandler from '../../api/book/appointments.js';
import cancelHandler from '../../api/shop/appointments/[id]/cancel.js';
import markHandler from '../../api/shop/appointments/[id]/mark.js';
import { createAppointment, getManage, getShop, postManage } from '../../lib/bookings/publicFlow.js';
import { cancelOwnerAppointment, markOwnerAppointment } from '../../lib/bookings/ownerFlow.js';

function res() {
  const r: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r; };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.send = (b: unknown) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

beforeEach(() => vi.clearAllMocks());

describe('api handlers', () => {
  it('book/shop passes the slug query', async () => {
    const r = res();
    await shopHandler({ method: 'GET', query: { slug: 'fresh' }, headers: { 'x-real-ip': '10.0.0.1' } } as any, r);
    expect(getShop).toHaveBeenCalledWith({ slug: 'fresh' }, { marker: 'deps' });
    expect(r.statusCode).toBe(200);
  });

  it('book/manage routes GET and POST, OPTIONS allows both', async () => {
    let r = res();
    await manageHandler({ method: 'GET', query: { token: 't' }, headers: { 'x-real-ip': '10.0.0.2' } } as any, r);
    expect(getManage).toHaveBeenCalledWith({ token: 't' }, { marker: 'deps' });
    r = res();
    await manageHandler({ method: 'POST', body: { token: 't', action: 'cancel' }, headers: { 'x-real-ip': '10.0.0.2' } } as any, r);
    expect(postManage).toHaveBeenCalledWith({ token: 't', action: 'cancel' }, { marker: 'deps' });
    r = res();
    await manageHandler({ method: 'OPTIONS' } as any, r);
    expect(r.statusCode).toBe(200);
    expect(r.headers['Access-Control-Allow-Methods']).toBe('OPTIONS,GET,POST');
  });

  it('malformed JSON reaches the flow as undefined (-> 400 invalid body)', async () => {
    const r = res();
    const req = Object.defineProperty({ method: 'POST', headers: { 'x-real-ip': '10.0.0.3' } }, 'body', {
      get() { throw new Error('Invalid JSON'); },
    });
    await appointmentsHandler(req as any, r);
    expect(createAppointment).toHaveBeenCalledWith(undefined, { marker: 'deps' });
  });

  it('public writes are limited to 10/min per IP in the shared store (every instance sees the same count)', async () => {
    rpcState.calls.length = 0;
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const r = res();
      await appointmentsHandler({ method: 'POST', body: '{}', headers: { 'x-real-ip': '10.9.9.9' } } as any, r);
      codes.push(r.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 201)).toBe(true);
    expect(codes[10]).toBe(429);
    expect(rpcState.calls[0]).toEqual(['ab_rate_hit', { p_key: 'public:write:10.9.9.9', p_window_s: 60, p_max: 10 }]);
    // another instance (a fresh in-memory map) would still be refused: the count is in the store
    expect(rpcState.hits.get('public:write:10.9.9.9')).toBe(11);
  });

  it('reads stay in memory (no RPC)', async () => {
    rpcState.calls.length = 0;
    await shopHandler({ method: 'GET', query: { slug: 'x' }, headers: { 'x-real-ip': '10.7.7.7' } } as any, res());
    expect(rpcState.calls).toEqual([]);
  });

  it('when the RPC errors, writes fall back to the in-memory limit (fail open, logged, never 500)', async () => {
    rpcState.fail = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const codes: number[] = [];
      for (let i = 0; i < 11; i++) {
        const r = res();
        await appointmentsHandler({ method: 'POST', body: '{}', headers: { 'x-real-ip': '10.8.8.8' } } as any, r);
        codes.push(r.statusCode);
      }
      expect(codes.slice(0, 10).every((c) => c === 201)).toBe(true);
      expect(codes[10]).toBe(429);
      expect(err).toHaveBeenCalledWith(expect.stringContaining('shared store failed'));
    } finally {
      rpcState.fail = false;
      err.mockRestore();
    }
  });

  it('shop/appointments/[id]/cancel passes the bearer and id', async () => {
    const r = res();
    await cancelHandler({ method: 'POST', query: { id: 'abc' }, headers: { authorization: 'Bearer j' } } as any, r);
    expect(cancelOwnerAppointment).toHaveBeenCalledWith('Bearer j', 'abc', { marker: 'deps' });
  });
});

describe('mark handler', () => {
  it('shop/appointments/[id]/mark passes the bearer, id (from [id] or the URL) and body', async () => {
    let r = res();
    await markHandler({ method: 'POST', query: { id: 'abc' }, body: { action: 'paid' }, headers: { authorization: 'Bearer j' } } as any, r);
    expect(markOwnerAppointment).toHaveBeenCalledWith('Bearer j', 'abc', { action: 'paid' }, { marker: 'deps' });
    expect(r.statusCode).toBe(200);
    r = res();
    await markHandler({ method: 'POST', query: {}, url: '/api/shop/appointments/xyz/mark', body: { action: 'done' }, headers: {} } as any, r);
    expect(markOwnerAppointment).toHaveBeenLastCalledWith(undefined, 'xyz', { action: 'done' }, { marker: 'deps' });
    r = res();
    await markHandler({ method: 'GET', headers: {} } as any, r);
    expect(r.statusCode).toBe(405);
  });
});

describe('vercel.json', () => {
  it('shop/setup ships the Apple root certs (it verifies the purchase with lib/ios)', async () => {
    const fs = await import('node:fs');
    const cfg = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
    expect(cfg.functions['api/shop/setup.ts'].includeFiles).toBe('lib/ios/certs/**');
  });
});
