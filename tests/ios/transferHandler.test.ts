import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ios/transferLive.js', () => ({ liveTransferDeps: vi.fn(() => ({ marker: 'deps' })) }));
vi.mock('../../lib/ios/transfer.js', () => ({ runTransfer: vi.fn(async () => ({ status: 200, body: { moved: true, linked: true } })) }));

import handler from '../../api/ios/transfer.js';
import { runTransfer } from '../../lib/ios/transfer.js';

function res() {
  const r: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r; };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}
beforeEach(() => vi.clearAllMocks());

describe('api/ios/transfer', () => {
  it('POST passes the parsed body and the Authorization header', async () => {
    const r = res();
    await handler({ method: 'POST', headers: { authorization: 'Bearer j' }, body: '{"transactionId":"1","confirm":true}' } as any, r);
    expect(runTransfer).toHaveBeenCalledWith({ transactionId: '1', confirm: true }, { marker: 'deps' }, { authorization: 'Bearer j' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ moved: true, linked: true });
    expect(r.headers['Cache-Control']).toBe('no-store');
  });
  it('OPTIONS 200 with CORS incl. Authorization; other methods 405; bad JSON 400', async () => {
    const o = res();
    await handler({ method: 'OPTIONS', headers: {} } as any, o);
    expect(o.statusCode).toBe(200);
    expect(o.headers['Access-Control-Allow-Headers']).toMatch(/Authorization/);
    const g = res();
    await handler({ method: 'GET', headers: {} } as any, g);
    expect(g.statusCode).toBe(405);
    const b = res();
    await handler({ method: 'POST', headers: {}, body: '{nope' } as any, b);
    expect(b.statusCode).toBe(400);
    expect(runTransfer).not.toHaveBeenCalled();
  });
  it('429 sets Retry-After; a throwing flow is 503', async () => {
    (runTransfer as any).mockResolvedValueOnce({ status: 429, body: { error: 'rate-limited' } });
    const r = res();
    await handler({ method: 'POST', headers: {}, body: {} } as any, r);
    expect(r.headers['Retry-After']).toBe('60');
    (runTransfer as any).mockRejectedValueOnce(new Error('x'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const e = res();
    await handler({ method: 'POST', headers: {}, body: {} } as any, e);
    expect(e.statusCode).toBe(503);
  });
});
