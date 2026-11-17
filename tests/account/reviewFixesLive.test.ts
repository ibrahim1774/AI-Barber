// Real kind loader over a fake data layer (sbRest): checkout in Production ignores a Sandbox Apple row; legacy lookup fails soft.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ ios: [] as any[], ownersFail: false, guard: 'linked' as any }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  APP_ORIGIN: () => 'https://app.test', webAppCors: () => false, webAppCheckoutOn: () => true,
  callerFrom: async () => ({ id: 'u1', email: 'o@example.com' }),
  stripeCall: async () => { throw Object.assign(new Error('stop here'), { status: 500 }); },
  sbRest: async (path: string) => {
    if (path.startsWith('ios_purchases?')) return h.ios;
    if (path.startsWith('site_owners?')) { if (h.ownersFail) throw new Error('owners down'); return []; }
    return [];
  },
}));
vi.mock('../../lib/webApp/appStoreGuard.js', () => ({ appStoreStateOf: async () => h.guard }));

import handler from '../../api/web-app/checkout.js';
import { livePlanKindDeps } from '../../lib/account/plan.js';

const run = async () => { const r: any = { code: 0, body: null, setHeader() {}, end() { return r; } }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { tier: 'website', interval: 'month' } }, r); return r; };
const row = (environment: string) => ({ original_transaction_id: '1', product_id: 'com.ibrahim1774.aibarber.bookings.monthly', environment, expires_at: '2099-01-01T00:00:00Z', revoked_at: null, taken_down_at: null, site_slug: 'a-site', published_at: '2026-10-01T00:00:00Z', removed_at: null, user_id: 'u1' });

beforeEach(() => { vi.stubEnv('WEB_APP_CHECKOUT', '1'); vi.stubEnv('GATE_ANY_SOURCE', '1'); vi.stubEnv('STRIPE_WEBAPP_PRICE_WEBSITE_MONTH', 'price_x'); h.guard = 'linked'; h.ios = []; h.ownersFail = false; vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('checkout with the real kind over a fake data layer', () => {
  it('live Stripe key: a Sandbox Apple address does not refuse', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_x');
    h.ios = [row('Sandbox')];
    expect((await run()).body?.error).not.toBe('ios_subscription_active');
  });
  it('live Stripe key: a Production Apple address refuses', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_x');
    h.ios = [row('Production')];
    const r = await run();
    expect(r.code).toBe(409); expect(r.body).toEqual({ error: 'ios_subscription_active' });
  });
  it('test Stripe key: the Sandbox address counts, like appStoreGuard.counts', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
    h.ios = [row('Sandbox')];
    expect((await run()).code).toBe(409);
  });
});

describe('legacy lookup', () => {
  it('fails soft: legacy=false and logged', async () => {
    h.ownersFail = true;
    expect(await livePlanKindDeps().legacyOwner('u1')).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});
