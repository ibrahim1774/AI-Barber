import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const stripe = vi.hoisted(() => ({ calls: [] as any[], handler: null as any }));
const sb = vi.hoisted(() => ({ calls: [] as any[], customers: [] as any[], ents: [] as any[] }));
const guard = vi.hoisted(() => ({ state: null as any, err: null as any }));

vi.mock('../../lib/webApp/webAppServer.js', () => ({
  APP_ORIGIN: () => 'https://app.test',
  webAppCors: () => false,
  webAppCheckoutOn: () => process.env.WEB_APP_CHECKOUT === '1',
  callerFrom: async () => ({ id: 'u1', email: 'owner@example.com' }),
  stripeCall: async (path: string, body: any, method = 'POST', opts: any = {}) => { stripe.calls.push({ path, body, method, opts }); return stripe.handler(path, body, method, opts); },
  sbRest: async (path: string, init: any = {}) => {
    sb.calls.push({ path, ...init });
    if (path.startsWith('web_app_entitlements')) return sb.ents;
    if (path.startsWith('web_app_customers') && (init.method ?? 'GET') === 'GET') return sb.customers.slice(0, 1);
    if (path.startsWith('web_app_customers')) { if (!sb.customers.length) sb.customers.push(init.body); return null; }
    if (path.startsWith('site_owners')) return [];
    return [];
  },
}));
vi.mock('../../lib/webApp/appStoreGuard.js', () => ({
  appStoreStateOf: async () => { if (guard.err) throw guard.err; return guard.state; },
}));

import handler from '../../api/web-app/checkout.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };
const req = (body: any = { tier: 'website', interval: 'month' }) => ({ method: 'POST', headers: { authorization: 'Bearer t' }, body });
const run = async (b?: any) => { const r = res(); await handler(req(b), r); return r; };

let subs: any[]; let open: any[]; let sessionOverride: any;
beforeEach(() => {
  vi.stubEnv('WEB_APP_CHECKOUT', '1');
  vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
  vi.stubEnv('STRIPE_WEBAPP_PRICE_WEBSITE_MONTH', 'price_w_m');
  stripe.calls = []; sb.calls = []; sb.customers = []; sb.ents = []; guard.state = null; guard.err = null;
  subs = []; open = []; sessionOverride = null;
  const keyed = new Map<string, any>();
  stripe.handler = (path: string, body: any, method: string, opts: any) => {
    if (path === 'customers') { const k = opts.idempotencyKey; if (!keyed.has(k)) keyed.set(k, { id: `cus_${keyed.size + 1}` }); return keyed.get(k); }
    if (path.startsWith('subscriptions?')) return { data: subs };
    if (path.startsWith('checkout/sessions?')) return { data: open };
    if (path === 'checkout/sessions') { return sessionOverride ?? { id: 'cs_new', status: 'open', url: 'https://stripe.test/pay' }; }
    if (path.endsWith('/expire')) return {};
    throw new Error(`unexpected ${path}`);
  };
});
afterEach(() => vi.unstubAllEnvs());

const created = () => stripe.calls.filter((c) => c.path === 'checkout/sessions');

describe('POST /api/web-app/checkout', () => {
  it('flag off: 404', async () => {
    vi.stubEnv('WEB_APP_CHECKOUT', '');
    expect((await run()).code).toBe(404);
  });

  it('first click: customer created once with an idempotency key, stored, then a session is created', async () => {
    const r = await run();
    expect(r.code).toBe(200);
    expect(r.body).toEqual({ url: 'https://stripe.test/pay' });
    const cust = stripe.calls.filter((c) => c.path === 'customers');
    expect(cust).toHaveLength(1);
    expect(cust[0].opts.idempotencyKey).toBe('aibarber-app:cust:u1:test');
    expect(sb.calls.some((c) => c.path.startsWith('web_app_customers') && c.method === 'POST' && /ignore-duplicates/.test(c.prefer))).toBe(true);
  });

  it('two parallel first clicks use the same customer id', async () => {
    const [a, b] = await Promise.all([run(), run()]);
    expect(a.code).toBe(200); expect(b.code).toBe(200);
    const custs = new Set(created().map((c) => c.body.customer));
    expect(custs.size).toBe(1);
  });

  it('a stored customer is reused and no customer is created', async () => {
    sb.customers = [{ stripe_customer_id: 'cus_stored' }];
    await run();
    expect(stripe.calls.some((c) => c.path === 'customers')).toBe(false);
    expect(created()[0].body.customer).toBe('cus_stored');
  });

  it('an older user (customer only on an entitlement row) reuses it and stores it', async () => {
    sb.ents = [{ stripe_customer_id: 'cus_old', status: 'canceled' }];
    await run();
    expect(stripe.calls.some((c) => c.path === 'customers')).toBe(false);
    expect(created()[0].body.customer).toBe('cus_old');
    expect(sb.customers[0]).toMatchObject({ stripe_customer_id: 'cus_old', environment: 'test' });
  });

  it('DB shows an entitled row: 409 already_subscribed, Stripe untouched', async () => {
    sb.ents = [{ stripe_customer_id: 'c', status: 'active' }];
    const r = await run();
    expect(r.code).toBe(409); expect(r.body.error).toBe('already_subscribed');
    expect(stripe.calls).toHaveLength(0);
  });

  it('Stripe lists an active tagged subscription while the DB has no row: 409, no session', async () => {
    subs = [{ id: 'sub_1', status: 'active', metadata: { app: 'aibarber-app' } }];
    const r = await run();
    expect(r.code).toBe(409); expect(r.body.error).toBe('already_subscribed');
    expect(created()).toHaveLength(0);
  });

  it('an untagged active subscription (old marketing flow) is ignored', async () => {
    subs = [{ id: 'sub_x', status: 'active', metadata: {} }];
    expect((await run()).code).toBe(200);
  });

  it('an incomplete subscription: 409 payment_processing', async () => {
    subs = [{ id: 'sub_1', status: 'incomplete', metadata: { app: 'aibarber-app' } }];
    const r = await run();
    expect(r.code).toBe(409); expect(r.body.error).toBe('payment_processing');
    expect(created()).toHaveLength(0);
  });

  it('other open tagged sessions are expired once the new one exists; untagged and the new one are left alone', async () => {
    open = [{ id: 'cs_old', metadata: { app: 'aibarber-app' } }, { id: 'cs_other', metadata: {} }, { id: 'cs_new', metadata: { app: 'aibarber-app' } }];
    await run();
    const expired = stripe.calls.filter((c) => c.path.endsWith('/expire')).map((c) => c.path);
    expect(expired).toEqual(['checkout/sessions/cs_old/expire']);
    const idxCreate = stripe.calls.findIndex((c) => c.path === 'checkout/sessions');
    expect(stripe.calls.findIndex((c) => c.path.endsWith('/expire'))).toBeGreaterThan(idxCreate);
  });

  it('a failed expire never fails the checkout', async () => {
    open = [{ id: 'cs_old', metadata: { app: 'aibarber-app' } }];
    const h = stripe.handler;
    stripe.handler = (p: string, ...rest: any[]) => { if (p.endsWith('/expire')) throw new Error('boom'); return h(p, ...rest); };
    expect((await run()).code).toBe(200);
  });

  it('the session has a 30-40 minute expiry, an idempotency key and the interval in metadata', async () => {
    const now = Date.now();
    await run();
    const c = created()[0];
    const exp = Number(c.body.expires_at);
    expect(exp).toBeGreaterThanOrEqual(Math.floor(now / 1000) + 1800);
    expect(exp).toBeLessThanOrEqual(Math.floor(now / 1000) + 2400 + 1);
    expect(c.opts.idempotencyKey).toMatch(/^aibarber-app:cs:u1:website:month:\d+$/);
    expect(c.body['metadata[interval]']).toBe('month');
    expect(c.body['subscription_data[metadata][app]']).toBe('aibarber-app');
  });

  it('a replay that returns a completed session: 409 payment_processing, never a second URL', async () => {
    sessionOverride = { id: 'cs_new', status: 'complete', url: null };
    const r = await run();
    expect(r.code).toBe(409); expect(r.body.error).toBe('payment_processing');
  });

  it('a replay of a session a newer click expired: a fresh session is created', async () => {
    let n = 0;
    const h = stripe.handler;
    stripe.handler = (p: string, ...rest: any[]) => (p === 'checkout/sessions' ? (n++ === 0 ? { id: 'cs_dead', status: 'expired', url: null } : { id: 'cs_fresh', status: 'open', url: 'https://stripe.test/fresh' }) : h(p, ...rest));
    const r = await run();
    expect(r.body).toEqual({ url: 'https://stripe.test/fresh' });
    expect(created()[1].opts.idempotencyKey).toMatch(/:r\d+$/);
  });

  it('an idempotency_error: 409 checkout_in_progress', async () => {
    const h = stripe.handler;
    stripe.handler = (p: string, ...rest: any[]) => { if (p === 'checkout/sessions') throw Object.assign(new Error('keys'), { type: 'idempotency_error', status: 400 }); return h(p, ...rest); };
    const r = await run();
    expect(r.code).toBe(409); expect(r.body.error).toBe('checkout_in_progress');
  });

  it('an active App Store subscription: 409 ios_subscription_active and Stripe is never called', async () => {
    guard.state = 'active';
    const r = await run();
    expect(r.code).toBe(409); expect(r.body.error).toBe('ios_subscription_active');
    expect(stripe.calls).toHaveLength(0);
  });

  it('a shop linked to a lapsed iOS purchase: 409 ios_linked_lapsed', async () => {
    guard.state = 'linked';
    const r = await run();
    expect(r.body.error).toBe('ios_linked_lapsed');
    expect(stripe.calls).toHaveLength(0);
  });

  it('an App Store lookup error fails closed: 503 and Stripe is never called', async () => {
    guard.err = new Error('supabase 500');
    const r = await run();
    expect(r.code).toBe(503); expect(r.body.error).toBe('try_again');
    expect(stripe.calls).toHaveLength(0);
  });
});
