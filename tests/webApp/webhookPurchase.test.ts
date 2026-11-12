// api/web-app/webhook.ts: the server-side Meta / TikTok Purchase fires once per new paid subscription (the welcome claim)
// and never changes the 200.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ claimRows: [{}] as any[], livemode: true, status: 'active', purchase: vi.fn(async (..._a: any[]) => ({ meta: 'sent', tiktok: 'skipped' })), contact: vi.fn(async (..._a: any[]) => ({ email: 'a@b.co', firstName: 'A' })) }));

vi.mock('../../lib/webApp/serverPurchase.js', () => ({ sendServerPurchase: h.purchase }));
vi.mock('../../lib/webApp/emails.js', () => ({ sendMail: vi.fn(async () => 'id'), welcomeEmail: vi.fn(() => ({ subject: 's', html: '', text: '' })) }));
vi.mock('../../lib/webApp/dunning.js', () => ({ contactFor: h.contact, resetDunning: vi.fn(async () => {}), sendFailedPaymentIfDue: vi.fn(), liveSiteUrlFor: vi.fn(async () => null) }));
vi.mock('../../lib/webApp/duplicates.js', () => ({ handleDuplicates: vi.fn(async () => ({})), liveDupDeps: () => ({}) }));
vi.mock('../../lib/webApp/domainPlanEnd.js', () => ({ onPlanEnded: vi.fn(), onPlanResumed: vi.fn(), livePlanEndDeps: async () => ({}) }));
vi.mock('../../lib/webApp/userExists.js', () => ({ userExists: async () => true }));
vi.mock('../../lib/webApp/checkoutSessions.js', () => ({ expireSession: vi.fn(), forgetSession: vi.fn(), storedSessionId: async () => null }));
vi.mock('../../lib/webApp/stripeCore.js', async (orig) => ({ ...(await orig<any>()), verifyStripeSignature: () => true }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  webAppCheckoutOn: () => false, webAppEntitlementsOn: () => true,
  readRawBody: async () => JSON.stringify({ type: 'customer.subscription.created', livemode: h.livemode, data: { object: { id: 'sub_1', metadata: { app: 'aibarber-app' } } } }),
  stripeCall: async () => ({ id: 'sub_1', status: h.status, customer: 'cus_1', livemode: h.livemode, metadata: { app: 'aibarber-app', user_id: 'u1', tier: 'website', site_slug: 's' }, items: { data: [{ price: { id: 'price_x' } }] } }),
  sbRest: async (path: string) => (path.includes('welcome_sent_at=is.null') ? h.claimRows : []),
}));

import webhook from '../../api/web-app/webhook.js';
const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const post = async () => { const r = res(); await webhook({ method: 'POST', headers: { 'stripe-signature': 'x' } }, r); return r; };

beforeEach(() => {
  vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_x'); vi.stubEnv('STRIPE_WEBAPP_WEBHOOK_SECRET', 'whsec'); vi.stubEnv('STRIPE_WEBAPP_PRICE_WEBSITE_MONTH', 'price_x');
  h.claimRows = [{}]; h.livemode = true; h.status = 'active'; h.purchase.mockClear(); h.contact.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('webhook: server-side Purchase', () => {
  it('first paid delivery (the welcome claim succeeds): one Purchase with the subscription, the buyer email and user id, live flag', async () => {
    const r = await post();
    expect(r.code).toBe(200);
    expect(h.purchase).toHaveBeenCalledTimes(1);
    const [sub, who, opts] = h.purchase.mock.calls[0] as any[];
    expect(sub.id).toBe('sub_1'); expect(who).toEqual({ email: 'a@b.co', userId: 'u1' }); expect(opts).toEqual({ live: true });
  });
  it('a Stripe retry / second event for the same subscription (claim already taken): no second Purchase', async () => {
    h.claimRows = [];
    expect((await post()).code).toBe(200);
    expect(h.purchase).not.toHaveBeenCalled();
  });
  it('a subscription that is not paid (e.g. incomplete): no Purchase', async () => {
    h.status = 'incomplete';
    expect((await post()).code).toBe(200); expect(h.purchase).not.toHaveBeenCalled();
  });
  it('test-mode event: the helper is told live=false (it sends nothing unless WEB_APP_CAPI_TEST=1)', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); h.livemode = false;
    await post(); expect((h.purchase.mock.calls[0] as any[])[2]).toEqual({ live: false });
  });
  it('the helper throwing never changes the answer', async () => {
    h.purchase.mockRejectedValueOnce(new Error('meta exploded'));
    const r = await post(); expect(r.code).toBe(200); expect(r.body).toEqual({ ok: true });
  });
  it('a failing contact lookup still sends the Purchase (email null)', async () => {
    h.contact.mockRejectedValue(new Error('db')); // welcome mail also fails: its own best-effort path releases the claim
    const r = await post();
    expect(r.code).toBe(200); expect((h.purchase.mock.calls[0] as any[])[1]).toEqual({ email: null, userId: 'u1' });
    h.contact.mockResolvedValue({ email: 'a@b.co', firstName: 'A' });
  });
  it('a hung Purchase does not hold the webhook past ~6 s', async () => {
    vi.useFakeTimers();
    h.purchase.mockImplementationOnce(() => new Promise(() => {}));
    const p = post();
    await vi.advanceTimersByTimeAsync(6_500);
    expect((await p).code).toBe(200);
  });
});
