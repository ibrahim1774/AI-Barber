import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const guard = vi.hoisted(() => ({ state: 'active' as any, err: false }));
const dup = vi.hoisted(() => ({ handle: vi.fn(async () => ({ found: 0, alerted: 0, refunded: 0, errors: 0 })) }));
const stored = vi.hoisted(() => ({ rows: [] as any[] }));
const sbCalls = vi.hoisted(() => [] as any[]);

vi.mock('../../lib/webApp/appStoreGuard.js', () => ({ appStoreStateOf: async () => { if (guard.err) throw new Error('x'); return guard.state; } }));
vi.mock('../../lib/webApp/duplicates.js', () => ({ handleDuplicates: dup.handle, liveDupDeps: () => ({}) }));
vi.mock('../../lib/webApp/emails.js', () => ({ sendMail: vi.fn(), welcomeEmail: vi.fn() }));
vi.mock('../../lib/webApp/dunning.js', () => ({ contactFor: vi.fn(async () => ({ email: null, firstName: null })), resetDunning: vi.fn(async () => {}), sendFailedPaymentIfDue: vi.fn() }));
vi.mock('../../lib/webApp/stripeCore.js', async (orig) => ({ ...(await orig<any>()), verifyStripeSignature: () => true }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  webAppCors: () => false,
  webAppCheckoutOn: () => process.env.WEB_APP_CHECKOUT === '1',
  webAppEntitlementsOn: () => process.env.WEB_APP_ENTITLEMENTS === '1',
  callerFrom: async () => ({ id: 'u1', email: 'a@example.com' }),
  readRawBody: async () => JSON.stringify({ type: 'customer.subscription.created', livemode: false, data: { object: { id: 'sub_1', metadata: { app: 'aibarber-app' } } } }),
  stripeCall: async () => ({ id: 'sub_1', status: 'active', customer: 'cus_1', metadata: { app: 'aibarber-app', user_id: 'u1', tier: 'website' }, items: { data: [{ price: { id: 'price_x' } }] } }),
  sbRest: async (path: string, init: any = {}) => { sbCalls.push({ path, ...init }); return path.startsWith('web_app_entitlements?user_id=') ? stored.rows : []; },
}));

import me from '../../api/web-app/me.js';
import webhook from '../../api/web-app/webhook.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; return r; };

beforeEach(() => {
  vi.stubEnv('WEB_APP_CHECKOUT', '1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); vi.stubEnv('STRIPE_WEBAPP_WEBHOOK_SECRET', 'whsec');
  guard.state = 'active'; guard.err = false; dup.handle.mockClear(); sbCalls.length = 0; stored.rows = [];
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/web-app/me', () => {
  it('adds appStore and keeps the existing fields', async () => {
    const r = res(); await me({ method: 'GET', headers: { authorization: 'Bearer t' } }, r);
    expect(r.code).toBe(200);
    expect(r.body).toMatchObject({ appStore: 'active', entitled: false, tier: null, interval: null, status: null, subscriptionId: null });
  });
  it('returns the kept active subscription even when a newer duplicate arrived first', async () => {
    stored.rows = [
      { stripe_subscription_id: 'sub_duplicate', status: 'active', tier: 'store', created_at: '2026-10-01', dup_of: 'sub_keeper' },
      { stripe_subscription_id: 'sub_keeper', status: 'active', tier: 'website', created_at: '2026-10-02', cancel_at_period_end: true, current_period_end: '2026-12-01T00:00:00Z' },
    ];
    const r = res(); await me({ method: 'GET', headers: { authorization: 'Bearer t' } }, r);
    expect(r.body).toMatchObject({ entitled: true, subscriptionId: 'sub_keeper', tier: 'website', cancelAtPeriodEnd: true, currentPeriodEnd: '2026-12-01T00:00:00Z' });
  });
  it('prefers an active plan over an older past-due plan', async () => {
    stored.rows = [
      { stripe_subscription_id: 'sub_old', status: 'past_due', created_at: '2026-10-01' },
      { stripe_subscription_id: 'sub_active', status: 'active', created_at: '2026-10-02' },
    ];
    const r = res(); await me({ method: 'GET', headers: { authorization: 'Bearer t' } }, r);
    expect(r.body.subscriptionId).toBe('sub_active');
  });
  it('without a duplicate marker keeps the oldest entitled active plan', async () => {
    stored.rows = [
      { stripe_subscription_id: 'sub_new', status: 'active', created_at: '2026-10-02' },
      { stripe_subscription_id: 'sub_old', status: 'active', created_at: '2026-10-01' },
    ];
    const r = res(); await me({ method: 'GET', headers: { authorization: 'Bearer t' } }, r);
    expect(r.body.subscriptionId).toBe('sub_old');
    expect(r.body.cancelAtPeriodEnd).toBe(false);
  });
  it('fails open: a lookup error gives appStore null and /me still answers', async () => {
    guard.err = true;
    const r = res(); await me({ method: 'GET', headers: { authorization: 'Bearer t' } }, r);
    expect(r.code).toBe(200); expect(r.body.appStore).toBeNull();
  });
});

describe('web-app webhook: duplicate check', () => {
  const call = async () => { const r = res(); await webhook({ method: 'POST', headers: { 'stripe-signature': 'x' } }, r); return r; };
  it('runs the duplicate check for an entitled subscription', async () => {
    vi.stubEnv('STRIPE_WEBAPP_PRICE_WEBSITE_MONTH', 'price_x');
    expect((await call()).code).toBe(200);
    expect(dup.handle).toHaveBeenCalledTimes(1);
  });
  it('a duplicate check that throws still answers 200', async () => {
    vi.stubEnv('STRIPE_WEBAPP_PRICE_WEBSITE_MONTH', 'price_x');
    dup.handle.mockRejectedValueOnce(new Error('stripe down'));
    expect((await call()).code).toBe(200);
  });
  it('checkout flag off: the duplicate check is not run', async () => {
    vi.stubEnv('STRIPE_WEBAPP_PRICE_WEBSITE_MONTH', 'price_x'); vi.stubEnv('WEB_APP_CHECKOUT', '');
    expect((await call()).code).toBe(200);
    expect(dup.handle).not.toHaveBeenCalled();
  });
});
