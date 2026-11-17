// /api/web-app/checkout under GATE_ANY_SOURCE: the stray-link refusal ('linked') is replaced by a refusal by account kind.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ guard: null as any, kind: 'web' as any, live: true, kindErr: false, kindCalls: 0 }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  APP_ORIGIN: () => 'https://app.test', webAppCors: () => false, webAppCheckoutOn: () => true,
  callerFrom: async () => ({ id: 'u1', email: 'o@example.com' }),
  stripeCall: async () => { throw Object.assign(new Error('stop here'), { status: 500 }); },
  sbRest: async () => [],
}));
vi.mock('../../lib/webApp/appStoreGuard.js', () => ({ appStoreStateOf: async () => h.guard }));
vi.mock('../../lib/account/kind.js', async (orig) => ({ ...(await orig<any>()), accountKindReading: async () => { h.kindCalls++; if (h.kindErr) throw new Error('db'); return { kind: h.kind, liveApplePurchase: h.live }; } }));

import handler from '../../api/web-app/checkout.js';
const run = async () => { const r: any = { code: 0, body: null, setHeader() {}, end() { return r; } }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { tier: 'website', interval: 'month' } }, r); return r; };

beforeEach(() => { vi.stubEnv('WEB_APP_CHECKOUT', '1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); vi.stubEnv('STRIPE_WEBAPP_PRICE_WEBSITE_MONTH', 'price_x'); Object.assign(h, { guard: null, kind: 'web', live: true, kindErr: false, kindCalls: 0 }); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('checkout, switch off', () => {
  it('a stray lapsed link is still refused and the kind is never read', async () => {
    h.guard = 'linked';
    const r = await run();
    expect(r.body.error).toBe('ios_linked_lapsed');
    expect(h.kindCalls).toBe(0);
  });
  it('an apple holder with no shop link is not refused (today)', async () => {
    h.kind = 'apple';
    const r = await run();
    expect(r.body?.error).not.toBe('ios_subscription_active');
    expect(h.kindCalls).toBe(0);
  });
});

describe('checkout, GATE_ANY_SOURCE on', () => {
  beforeEach(() => vi.stubEnv('GATE_ANY_SOURCE', '1'));
  it("'active' is refused exactly as today, before any kind read", async () => {
    h.guard = 'active';
    const r = await run();
    expect(r.code).toBe(409); expect(r.body).toEqual({ error: 'ios_subscription_active' });
    expect(h.kindCalls).toBe(0);
  });
  it('a stray lapsed link on a web account no longer locks the web', async () => {
    h.guard = 'linked'; h.kind = 'web';
    const r = await run();
    expect(r.body?.error).not.toBe('ios_linked_lapsed');
    expect(r.body?.error).not.toBe('ios_subscription_active');
  });
  it('a stray lapsed link on a neither account is allowed too', async () => {
    h.guard = 'linked'; h.kind = 'neither';
    expect((await run()).body?.error).not.toBe('ios_linked_lapsed');
  });
  for (const kind of ['apple', 'mixed']) {
    it(`${kind} with a live Apple purchase: ios_subscription_active, shop link or not`, async () => {
      h.kind = kind; h.live = true;
      for (const guard of [null, 'linked']) {
        h.guard = guard;
        const r = await run();
        expect(r.code).toBe(409); expect(r.body).toEqual({ error: 'ios_subscription_active' });
      }
    });
    it(`${kind} with a lapsed or removed Apple purchase: ios_linked_lapsed, never "active"`, async () => {
      h.kind = kind; h.live = false;
      for (const guard of [null, 'linked']) {
        h.guard = guard;
        const r = await run();
        expect(r.code).toBe(409); expect(r.body).toEqual({ error: 'ios_linked_lapsed' });
      }
    });
  }
  it('a kind lookup error fails closed with 503', async () => {
    h.kindErr = true;
    const r = await run();
    expect(r.code).toBe(503); expect(r.body).toEqual({ error: 'try_again' });
  });
});
