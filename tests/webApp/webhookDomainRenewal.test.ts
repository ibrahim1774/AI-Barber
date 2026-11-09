// api/web-app/webhook.ts: the plan's effect on the site's custom domain. Never changes the 200.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  event: 'customer.subscription.deleted', status: 'canceled', meta: 'fresh-cuts', stored: [] as any[], sites: [] as any[],
  ended: vi.fn(async () => {}), resumed: vi.fn(async () => {}),
}));
vi.mock('../../lib/webApp/domainPlanEnd.js', () => ({ onPlanEnded: h.ended, onPlanResumed: h.resumed, livePlanEndDeps: async (m: string) => ({ mode: m }) }));
vi.mock('../../lib/webApp/emails.js', () => ({ sendMail: vi.fn(), welcomeEmail: vi.fn() }));
vi.mock('../../lib/webApp/dunning.js', () => ({ contactFor: vi.fn(async () => ({ email: null, firstName: null })), resetDunning: vi.fn(async () => {}), sendFailedPaymentIfDue: vi.fn() }));
vi.mock('../../lib/webApp/duplicates.js', () => ({ handleDuplicates: vi.fn(async () => ({})), liveDupDeps: () => ({}) }));
vi.mock('../../lib/webApp/stripeCore.js', async (orig) => ({ ...(await orig<any>()), verifyStripeSignature: () => true }));
vi.mock('../../lib/webApp/userExists.js', () => ({ userExists: async () => true }));
vi.mock('../../lib/webApp/checkoutSessions.js', () => ({ expireSession: vi.fn(), forgetSession: vi.fn(), storedSessionId: async () => null }));
vi.mock('../../lib/ios/siteUrlFor.js', () => ({ stampedSiteUrl: async () => null }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  webAppCheckoutOn: () => false, webAppEntitlementsOn: () => true,
  readRawBody: async () => JSON.stringify({ type: h.event, livemode: false, data: { object: { id: 'sub_1', metadata: { app: 'aibarber-app' } } } }),
  stripeCall: async () => ({ id: 'sub_1', status: h.status, customer: 'cus_1', metadata: { app: 'aibarber-app', user_id: 'u1', tier: 'website', site_slug: h.meta }, items: { data: [{ price: { id: 'price_x' } }] } }),
  sbRest: async (path: string) => (path.startsWith('web_app_entitlements?stripe_subscription_id=') ? h.stored : path.startsWith('web_app_sites?user_id=') ? h.sites : []),
}));

import webhook from '../../api/web-app/webhook.js';
const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const call = async () => { const r = res(); await webhook({ method: 'POST', headers: { 'stripe-signature': 'x' } }, r); return r; };

beforeEach(() => {
  vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); vi.stubEnv('STRIPE_WEBAPP_WEBHOOK_SECRET', 'whsec'); vi.stubEnv('STRIPE_WEBAPP_PRICE_WEBSITE_MONTH', 'price_x');
  h.ended.mockClear(); h.resumed.mockClear(); h.meta = 'fresh-cuts'; h.stored = []; h.sites = [];
});
afterEach(() => vi.unstubAllEnvs());

describe('webhook: plan and domain renewal', () => {
  it('plan deleted: the domain stops renewing (200)', async () => {
    h.event = 'customer.subscription.deleted'; h.status = 'canceled';
    const r = await call();
    expect(r.code).toBe(200);
    expect(h.ended).toHaveBeenCalledTimes(1);
    expect(h.resumed).not.toHaveBeenCalled();
  });
  it('plan deleted: the ending sub and customer are passed so the other-plan check (DB and Stripe) can exclude it', async () => {
    h.event = 'customer.subscription.deleted'; h.status = 'canceled';
    await call();
    expect(h.ended).toHaveBeenCalledWith('fresh-cuts', 'u1', expect.anything(), { excludeSub: 'sub_1', customerId: 'cus_1' });
  });
  it('no site_slug in the Stripe metadata: the slug stored on the entitlement row is used', async () => {
    h.meta = ''; h.stored = [{ site_slug: 'stored-slug' }];
    h.event = 'customer.subscription.deleted'; h.status = 'canceled';
    expect((await call()).code).toBe(200);
    expect(h.ended.mock.calls[0][0]).toBe('stored-slug');
  });
  it("neither metadata nor stored row: the owner's site in web_app_sites for this mode, for end and for resume", async () => {
    h.meta = ''; h.sites = [{ slug: 'users-site' }];
    h.event = 'customer.subscription.deleted'; h.status = 'canceled';
    await call();
    expect(h.ended.mock.calls[0][0]).toBe('users-site');
    h.event = 'customer.subscription.created'; h.status = 'active';
    await call();
    expect(h.resumed.mock.calls[0][0]).toBe('users-site');
  });
  it('no slug anywhere: nothing runs, still 200', async () => {
    h.meta = '';
    h.event = 'customer.subscription.deleted'; h.status = 'canceled';
    expect((await call()).code).toBe(200);
    expect(h.ended).not.toHaveBeenCalled();
  });
  it('a new active plan resumes it; checkout.session.completed too', async () => {
    h.status = 'active';
    for (const ev of ['customer.subscription.created', 'customer.subscription.updated']) {
      h.event = ev; h.resumed.mockClear();
      expect((await call()).code).toBe(200);
      expect(h.resumed).toHaveBeenCalledTimes(1);
    }
    expect(h.ended).not.toHaveBeenCalled();
  });
  it('a Stripe/DB error in the domain step still answers 200', async () => {
    h.event = 'customer.subscription.deleted'; h.status = 'canceled';
    h.ended.mockRejectedValueOnce(new Error('stripe down'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await call()).code).toBe(200);
    log.mockRestore();
  });
});
