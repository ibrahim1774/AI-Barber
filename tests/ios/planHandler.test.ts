import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ios/planFlow.js', () => ({
  livePlanDeps: vi.fn(() => ({ marker: 'deps' })),
  getPlan: vi.fn(async () => ({ status: 200, body: { linked: false } })),
  refreshPlan: vi.fn(async () => ({ status: 200, body: { linked: true } })),
}));

import handler from '../../api/shop/plan.js';
import { getPlan, refreshPlan } from '../../lib/ios/planFlow.js';

function res() {
  const r: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r; };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

beforeEach(() => vi.clearAllMocks());

describe('api/shop/plan', () => {
  it('GET passes the bearer header', async () => {
    const r = res();
    await handler({ method: 'GET', headers: { authorization: 'Bearer j' }, query: {} } as any, r);
    expect(getPlan).toHaveBeenCalledWith('Bearer j', { marker: 'deps' }, { otid: undefined });
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ linked: false });
    expect(r.headers['Cache-Control']).toBe('no-store');
  });

  it('POST passes the parsed body', async () => {
    const r = res();
    await handler({ method: 'POST', headers: { authorization: 'Bearer j' }, body: '{"transactionId":"123"}' } as any, r);
    expect(refreshPlan).toHaveBeenCalledWith('Bearer j', { transactionId: '123' }, { marker: 'deps' });
    expect(r.body).toEqual({ linked: true });
  });

  it('OPTIONS allows GET and POST with CORS', async () => {
    const r = res();
    await handler({ method: 'OPTIONS', headers: {} } as any, r);
    expect(r.statusCode).toBe(200);
    expect(r.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(r.headers['Access-Control-Allow-Methods']).toBe('OPTIONS,GET,POST');
    expect(r.headers['Access-Control-Allow-Headers']).toMatch(/Authorization/);
  });

  it('other methods → 405', async () => {
    const r = res();
    await handler({ method: 'DELETE', headers: {} } as any, r);
    expect(r.statusCode).toBe(405);
  });

  it('a throwing flow → 500 server-error', async () => {
    (getPlan as any).mockRejectedValueOnce(new Error('db'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = res();
    await handler({ method: 'GET', headers: {} } as any, r);
    expect(r.statusCode).toBe(500);
    err.mockRestore();
  });
});
