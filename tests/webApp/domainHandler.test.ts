// api/web-app/domain.ts: gate, CORS, action routing. The logic is tested in tests/webDomainOneClick.test.ts.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const m = vi.hoisted(() => ({
  oneClickCard: vi.fn(async () => ({ status: 200, body: { card: true } })),
  oneClickDomainPurchase: vi.fn(async () => ({ status: 402, body: { error: 'no-card', fallback: true } })),
  createDomainCheckout: vi.fn(async () => ({ status: 200, body: { url: 'https://checkout.stripe.com/x' } })),
  purchaseDomain: vi.fn(async () => ({ status: 202, body: { state: 'registering' } })),
  webDomainPanelStatus: vi.fn(async () => ({ status: 200, body: { state: 'none' } })),
  webDomainPortal: vi.fn(async () => ({ status: 200, body: { url: 'https://billing.stripe.com/p' } })),
}));
vi.mock('../../lib/webDomains.js', () => m);
vi.mock('../../lib/webApp/domainOneClick.js', () => ({ oneClickCard: m.oneClickCard, oneClickDomainPurchase: m.oneClickDomainPurchase }));
vi.mock('../../lib/webApp/domainOneClickLive.js', () => ({ liveOneClickDeps: () => ({}), livePanelDeps: () => ({}), webPlanOf: async () => ({ customer: 'cus_x' }) }));
vi.mock('../../lib/ios/domainLive.js', () => ({ liveWebDomainDeps: () => ({}) }));
vi.mock('../../lib/deployAuth.js', () => ({ authorizeSiteOwner: vi.fn(), liveDeployAuthDeps: () => ({}) }));
vi.mock('../../lib/ios/vercelDomains.js', () => ({ liveVercelDomains: () => null, registrantContact: () => null }));
vi.mock('../../lib/ios/domainsRepo.js', () => ({ supabaseDomains: () => ({}) }));
vi.mock('../../lib/bookings/repo.js', () => ({ serviceClient: () => ({}) }));

import handler from '../../api/web-app/domain.js';

const mkRes = () => {
  const res: any = { headers: {} };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  res.status = vi.fn(() => res); res.json = vi.fn(() => res); res.end = vi.fn(() => res);
  return res;
};
const call = async (body: any, over: any = {}) => {
  const res = mkRes();
  await handler({ method: 'POST', headers: { origin: 'https://www.primebarber.org', authorization: 'Bearer t' }, body, ...over }, res);
  return res;
};

describe('api/web-app/domain', () => {
  afterAll(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('WEB_APP_CHECKOUT', '1');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'srk');
    vi.stubEnv('DOMAIN_CHECKOUT_SECRET', 's');
    Object.values(m).forEach((f) => f.mockClear());
  });

  it('off (404) unless WEB_APP_CHECKOUT=1; POST only; preflight answered with the web-app CORS (staging host included)', async () => {
    vi.stubEnv('WEB_APP_CHECKOUT', '');
    expect((await call({ action: 'card' })).status).toHaveBeenCalledWith(404);
    vi.stubEnv('WEB_APP_CHECKOUT', '1');
    expect((await call({ action: 'card' }, { method: 'GET' })).status).toHaveBeenCalledWith(405);
    const pre = mkRes();
    await handler({ method: 'OPTIONS', headers: { origin: 'https://prime-barber-app.vercel.app' } }, pre);
    expect(pre.status).toHaveBeenCalledWith(204);
    expect(pre.headers['Access-Control-Allow-Origin']).toBe('https://prime-barber-app.vercel.app');
    const evil = mkRes();
    await handler({ method: 'OPTIONS', headers: { origin: 'https://evil.example' } }, evil);
    expect(evil.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('routes each action to its function and answers its status and body; unknown action 400', async () => {
    const pairs: Array<[string, keyof typeof m, number]> = [
      ['card', 'oneClickCard', 200], ['buy', 'oneClickDomainPurchase', 402], ['checkout', 'createDomainCheckout', 200],
      ['purchase', 'purchaseDomain', 202], ['status', 'webDomainPanelStatus', 200], ['portal', 'webDomainPortal', 200],
    ];
    for (const [action, fn, status] of pairs) {
      const res = await call({ action, siteId: 'fresh-cuts', domain: 'freshcuts.com', sessionId: 'cs_x' });
      expect(m[fn]).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(status);
    }
    expect((await call({ action: 'nope' })).status).toHaveBeenCalledWith(400);
  });

  it("checkout always runs the web flow: app 'web' is forced and only domain + siteId are taken from the body", async () => {
    await call({ action: 'checkout', siteId: 'fresh-cuts', domain: 'freshcuts.com', app: 'legacy', customer: 'cus_evil', price: 1 });
    const [body, , , , web] = m.createDomainCheckout.mock.calls[0] as any[];
    expect(body).toEqual({ domain: 'freshcuts.com', siteId: 'fresh-cuts', app: 'web' });
    expect(web.returnBase).toBe('https://www.primebarber.org');
    expect(await web.customerOf('u1')).toBe('cus_x');
  });

  it('no Stripe key / database key: 500 before anything runs; the response is never cached', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const res = await call({ action: 'card' });
    expect(res.status).toHaveBeenCalledWith(500);
    expect(m.oneClickCard).not.toHaveBeenCalled();
    expect(res.headers['Cache-Control']).toBe('no-store');
  });
});
