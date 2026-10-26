// M4: the take-offline route fails CLOSED when the rate limiter store is down.
import { describe, it, expect, vi } from 'vitest';

const { allow, takeSiteOffline } = vi.hoisted(() => ({ allow: vi.fn(), takeSiteOffline: vi.fn(async () => ({ status: 200, body: { removed: true } })) }));
vi.mock('../../lib/bookings/rateLimit.js', () => ({ clientIp: () => '1.2.3.4', iosLimiter: { allow } }));
vi.mock('../../lib/ios/appleVerify.js', () => ({ lazyDefaultVerifier: () => async () => ({}) }));
vi.mock('../../lib/ios/purchases.js', () => ({ supabasePurchases: () => ({}) }));
vi.mock('../../lib/ios/removeSiteLive.js', () => ({ liveRemoveDeps: () => ({}) }));
vi.mock('../../lib/ios/publishFlow.js', () => ({ liveUserOf: async () => null }));
vi.mock('../../lib/ios/takeOffline.js', () => ({ takeSiteOffline }));

import handler from '../../api/ios/take-offline.js';

function res() {
  const r: any = { headers: {} as Record<string, string>, code: 0, body: null };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r; };
  r.status = (c: number) => { r.code = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}
const req = () => ({ method: 'POST', headers: {}, body: { transactionId: 't' } }) as any;

describe('api/ios/take-offline limiter', () => {
  it('limiter store error -> 503 and nothing is removed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    allow.mockRejectedValueOnce(new Error('redis down'));
    const r = res();
    await handler(req(), r);
    expect(r.code).toBe(503);
    expect(takeSiteOffline).not.toHaveBeenCalled();
  });
  it('allowed -> runs; denied -> 429; no credentials header (L3)', async () => {
    allow.mockResolvedValueOnce(true);
    const a = res(); await handler(req(), a);
    expect(a.code).toBe(200);
    expect(a.headers['Access-Control-Allow-Credentials']).toBeUndefined();
    allow.mockResolvedValueOnce(false);
    const b = res(); await handler(req(), b);
    expect(b.code).toBe(429);
  });
});
