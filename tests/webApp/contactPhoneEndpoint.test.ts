import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({ caller: { id: 'u1', email: 'a@example.com' } as any, allow: true, saved: [] as any[] }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  webAppCors: (req: any) => req.method === 'OPTIONS',
  webAppCheckoutOn: () => process.env.WEB_APP_CHECKOUT === '1',
  callerFrom: async () => state.caller,
  sbRest: async () => [],
}));
vi.mock('../../lib/webApp/contactPhoneLive.js', () => ({
  liveContactPhoneDeps: (mode: string) => ({
    callerFrom: async () => state.caller, mode, now: () => 't',
    upsertContact: async (r: any) => { state.saved.push(r); }, stampSite: async () => null,
    syncAuthPhone: async () => 'conflict', mergeMetadataPhone: async () => {},
  }),
}));
vi.mock('../../lib/bookings/rateLimit.js', () => ({ supabaseRateStore: () => ({}), withFallback: () => ({ hit: async () => state.allow }) }));
vi.mock('../../lib/bookings/repo.js', () => ({ serviceClient: () => ({}) }));

import handler from '../../api/web-app/contact-phone.js';
const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };
const post = (body: any) => ({ method: 'POST', headers: { authorization: 'Bearer t' }, body });

beforeEach(() => { vi.stubEnv('WEB_APP_CHECKOUT', '1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); state.caller = { id: 'u1', email: 'a@example.com' }; state.allow = true; state.saved = []; });
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/web-app/contact-phone', () => {
  it('404 when the web app is off, 405 for non-POST', async () => {
    vi.stubEnv('WEB_APP_CHECKOUT', '0'); let r = res(); await handler(post({ phone: '5552345678' }), r); expect(r.code).toBe(404);
    vi.stubEnv('WEB_APP_CHECKOUT', '1'); r = res(); await handler({ method: 'GET', headers: {} }, r); expect(r.code).toBe(405);
  });
  it('401 without a caller', async () => { state.caller = null; const r = res(); await handler(post({ phone: '5552345678' }), r); expect(r.code).toBe(401); });
  it('400 for an invalid phone', async () => { const r = res(); await handler(post({ phone: '12' }), r); expect(r.code).toBe(400); expect(r.body).toEqual({ error: 'invalid_phone' }); });
  it('429 when rate limited', async () => { state.allow = false; const r = res(); await handler(post({ phone: '5552345678' }), r); expect(r.code).toBe(429); expect(state.saved).toHaveLength(0); });
  it('200 and a JSON string body is parsed; auth conflict leaks nothing', async () => {
    const r = res(); await handler(post(JSON.stringify({ phone: '555 234 5678' })), r);
    expect(r.code).toBe(200); expect(r.body).toEqual({ ok: true, phone: '+15552345678' });
  });
});
