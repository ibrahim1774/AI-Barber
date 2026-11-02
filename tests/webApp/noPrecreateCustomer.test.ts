import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const st = vi.hoisted(() => ({ stripe: [] as any[], sb: [] as any[], sub: null as any, subsByCustomer: {} as Record<string, any[]>, ents: [] as any[], shop: undefined as any, event: null as any }));

vi.mock('../../lib/webApp/stripeCore.js', async (orig) => ({ ...(await orig<any>()), verifyStripeSignature: () => true }));
vi.mock('../../lib/webApp/emails.js', () => ({ sendMail: vi.fn(), welcomeEmail: vi.fn(), alertOwner: vi.fn(), duplicateRefundEmail: vi.fn() }));
const gone = vi.hoisted(() => ({ deleted: false }));
vi.mock('../../lib/webApp/userExists.js', () => ({ userExists: async () => !gone.deleted, emailOfUser: async () => null }));
vi.mock('../../lib/webApp/dunning.js', () => ({ contactFor: vi.fn(async () => ({ email: null, firstName: null })), resetDunning: vi.fn(async () => {}), sendFailedPaymentIfDue: vi.fn() }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  webAppCors: () => false,
  webAppCheckoutOn: () => false,
  webAppEntitlementsOn: () => false,
  readRawBody: async () => JSON.stringify(st.event),
  stripeCall: async (path: string, body: any, method = 'POST', opts: any = {}) => {
    st.stripe.push({ path, body, method, opts });
    if (path.startsWith('subscriptions/') && method === 'GET') return st.sub;
    if (path.startsWith('subscriptions?customer=')) return { data: st.subsByCustomer[decodeURIComponent(path.split('=')[1].split('&')[0])] ?? [] };
    if (path.startsWith('subscriptions/') && method === 'POST') return {};
    if (path.startsWith('customers/')) return {};
    throw new Error('unexpected ' + path);
  },
  sbRest: async (path: string, init: any = {}) => {
    st.sb.push({ path, ...init });
    if (path.startsWith('web_app_drafts')) return st.shop === undefined ? [] : [{ shop: st.shop }];
    if (path.startsWith('web_app_entitlements?user_id=')) return st.ents;
    if (path.startsWith('web_app_customers?user_id=')) return [];
    return [];
  },
}));

import webhook from '../../api/web-app/webhook.js';
import { handleDuplicates, liveDupDeps } from '../../lib/webApp/duplicates.js';
import { cleanShopName, planDescription, shopFromDescription } from '../../lib/webApp/stripeCore.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const fire = async (event: any) => { st.event = event; const r = res(); await webhook({ method: 'POST', headers: { 'stripe-signature': 'x' } }, r); return r; };
const mkSub = (over: any = {}) => ({ id: 'sub_1', status: 'active', customer: 'cus_new', metadata: { app: 'aibarber-app', user_id: 'u1', tier: 'website' }, items: { data: [{ price: { id: 'price_w_m', recurring: { interval: 'month' } } }] }, ...over });

beforeEach(() => {
  vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); vi.stubEnv('STRIPE_WEBAPP_WEBHOOK_SECRET', 'whsec');
  vi.stubEnv('STRIPE_WEBAPP_PRICE_WEBSITE_MONTH', 'price_w_m'); vi.stubEnv('STRIPE_WEBAPP_PRICE_BOOKINGS_MONTH', 'price_b_m');
  st.stripe = []; st.sb = []; st.sub = mkSub(); st.subsByCustomer = {}; st.ents = []; st.shop = 'Fade Masters'; gone.deleted = false;
});
afterEach(() => vi.unstubAllEnvs());

const subEvent = (type = 'customer.subscription.created') => ({ type, livemode: false, data: { object: { id: 'sub_1', metadata: { app: 'aibarber-app' } } } });

describe('webhook records the customer Checkout created', () => {
  it('subscription.created: upserts web_app_customers (ignore-duplicates) and tags the customer with app + user_id', async () => {
    expect((await fire(subEvent())).code).toBe(200);
    const up = st.sb.find((c) => c.path.startsWith('web_app_customers?on_conflict') && c.method === 'POST');
    expect(up.body).toEqual({ user_id: 'u1', environment: 'test', stripe_customer_id: 'cus_new' });
    expect(up.prefer).toMatch(/ignore-duplicates/);
    const meta = st.stripe.find((c) => c.path === 'customers/cus_new');
    expect(meta.body).toEqual({ 'metadata[app]': 'aibarber-app', 'metadata[user_id]': 'u1' });
    expect(meta.opts.idempotencyKey).toBeTruthy();
  });
  it('checkout.session.completed (subscription mode) resolves to the same subscription path', async () => {
    const r = await fire({ type: 'checkout.session.completed', livemode: false, data: { object: { mode: 'subscription', subscription: 'sub_1', metadata: { app: 'aibarber-app', user_id: 'u1' } } } });
    expect(r.code).toBe(200);
    expect(st.sb.some((c) => c.path.startsWith('web_app_customers?on_conflict'))).toBe(true);
  });
  it('checkout.session.completed from another app or a payment-mode session is ignored', async () => {
    expect((await fire({ type: 'checkout.session.completed', livemode: false, data: { object: { mode: 'payment', metadata: { app: 'aibarber-app' } } } })).body).toEqual({ ignored: true });
    expect((await fire({ type: 'checkout.session.completed', livemode: false, data: { object: { mode: 'subscription', subscription: 'sub_1', metadata: {} } } })).body).toEqual({ ignored: true });
    expect(st.sb).toHaveLength(0);
  });
  it('a failed customer tag never fails the webhook', async () => {
    const mod: any = await import('../../lib/webApp/webAppServer.js');
    const orig = mod.stripeCall;
    mod.stripeCall = async (p: string, ...r: any[]) => { if (p.startsWith('customers/')) throw new Error('boom'); return orig(p, ...r); };
    expect((await fire(subEvent())).code).toBe(200);
    mod.stripeCall = orig;
  });
});

describe('deleted account', () => {
  it('the webhook does not re-insert web_app_customers or tag the customer for a user that no longer exists, but still stores the entitlement', async () => {
    gone.deleted = true;
    expect((await fire(subEvent())).code).toBe(200);
    expect(st.sb.some((c) => c.path.startsWith('web_app_customers'))).toBe(false);
    expect(st.stripe.some((c) => c.path === 'customers/cus_new')).toBe(false);
    expect(st.sb.some((c) => c.path.startsWith('web_app_entitlements?on_conflict'))).toBe(true);
  });
});

describe('subscription description follows the plan', () => {
  it('writes the plan text when it is missing', async () => {
    await fire(subEvent());
    const u = st.stripe.find((c) => c.path === 'subscriptions/sub_1' && c.method === 'POST');
    expect(u.body).toEqual({ description: 'Prime Barber · Fade Masters: Website hosting plan' });
  });
  it('is idempotent: already correct means no write', async () => {
    st.sub = mkSub({ description: 'Prime Barber · Fade Masters: Website hosting plan' });
    await fire(subEvent('customer.subscription.updated'));
    expect(st.stripe.some((c) => c.path === 'subscriptions/sub_1' && c.method === 'POST')).toBe(false);
  });
  it('a portal upgrade (new price) rewrites the description to the new plan', async () => {
    st.sub = mkSub({ description: 'Prime Barber · Fade Masters: Website hosting plan', items: { data: [{ price: { id: 'price_b_m', recurring: { interval: 'month' } } }] } });
    await fire(subEvent('customer.subscription.updated'));
    expect(st.stripe.find((c) => c.path === 'subscriptions/sub_1' && c.method === 'POST').body.description).toBe('Prime Barber · Fade Masters: Site + booking plan');
  });
  it('with no draft name it keeps the real name already in the description instead of the fallback', async () => {
    st.shop = undefined;
    st.sub = mkSub({ description: 'Prime Barber · Old Name: Website hosting plan', items: { data: [{ price: { id: 'price_b_m', recurring: { interval: 'month' } } }] } });
    await fire(subEvent('customer.subscription.updated'));
    expect(st.stripe.find((c) => c.path === 'subscriptions/sub_1' && c.method === 'POST').body.description).toBe('Prime Barber · Old Name: Site + booking plan');
  });
  it('a canceled subscription is not rewritten', async () => {
    st.sub = mkSub({ status: 'canceled' });
    await fire(subEvent('customer.subscription.deleted'));
    expect(st.stripe.some((c) => c.path === 'subscriptions/sub_1' && c.method === 'POST')).toBe(false);
  });
});

describe('plan text helpers', () => {
  it('uses the three plain-words plans', () => {
    expect(planDescription('website', 'Joe')).toBe('Prime Barber · Joe: Website hosting plan');
    expect(planDescription('bookings', 'Joe')).toBe('Prime Barber · Joe: Site + booking plan');
    expect(planDescription('store', 'Joe')).toBe('Prime Barber · Joe: Site, booking & store plan');
  });
  it('strips control characters, collapses space, caps length, falls back', () => {
    expect(cleanShopName('A\u0000B\r\nC​  D')).toBe('A B C​ D');
    expect(cleanShopName('x'.repeat(5000))).toHaveLength(80);
    expect(planDescription('store', 'y'.repeat(100000)).length).toBeLessThan(500);
    for (const v of [undefined, null, '', '   ', 42]) expect(cleanShopName(v)).toBe('your shop');
  });
  it('shopFromDescription round-trips and ignores the fallback and foreign text', () => {
    expect(shopFromDescription(planDescription('website', 'Joe: Cuts'))).toBe('Joe: Cuts'.replace(': ', ': '));
    expect(shopFromDescription(planDescription('website', undefined))).toBeNull();
    expect(shopFromDescription('something else')).toBeNull();
  });
});

describe('duplicate handling with no pre-existing customer', () => {
  it('two tabs paid, two different Stripe customers and no web_app_customers row: both found through entitlement rows, one kept', async () => {
    process.env.STRIPE_WEBAPP_SECRET_KEY = 'sk_test_x';
    const s = (id: string, cus: string, created: number) => mkSub({ id, customer: cus, created });
    st.ents = [];
    st.subsByCustomer = { cus_a: [s('sub_a', 'cus_a', 100)], cus_b: [s('sub_b', 'cus_b', 200)] };
    const mod: any = await import('../../lib/webApp/webAppServer.js');
    const orig = mod.sbRest;
    mod.sbRest = async (p: string, init: any = {}) => p.startsWith('web_app_entitlements?user_id=') ? [{ stripe_subscription_id: 'sub_a', stripe_customer_id: 'cus_a' }, { stripe_subscription_id: 'sub_b', stripe_customer_id: 'cus_b' }] : orig(p, init);
    const alerts: string[] = [];
    const deps = { ...liveDupDeps('test'), claim: async () => true, alert: async (subj: string) => { alerts.push(subj); } };
    const r = await handleDuplicates('u1', deps as any);
    mod.sbRest = orig;
    expect(r).toMatchObject({ found: 1, alerted: 1, refunded: 0 }); // refund flag off: alert only
    expect(alerts[0]).toMatch(/paying twice/);
  });
});
