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
    if (path.startsWith('web_app_customers') && (globalThis as any).__failCustomers) throw new Error('supabase 404');
    if (path.startsWith('web_app_customers') && (init.method ?? 'GET') === 'GET') return sb.customers.slice(0, 1);
    if (path.startsWith('web_app_customers')) { if (!sb.customers.length) sb.customers.push(init.body); return null; }
    if (path.startsWith('web_app_checkout_sessions')) { if ((globalThis as any).__csFail) throw new Error('relation does not exist'); if ((init.method ?? 'GET') === 'GET') return (globalThis as any).__cs ? [{ stripe_session_id: (globalThis as any).__cs }] : []; (globalThis as any).__csSaved = init.body; return null; }
    if (path.startsWith('web_app_drafts')) return (globalThis as any).__shop === undefined ? [] : [{ shop: (globalThis as any).__shop }];
    if (path.startsWith('web_app_price_groups')) {
      const g = globalThis as any;
      if (g.__pgFail) throw Object.assign(new Error('supabase 500'), { status: g.__pgFail });
      if ((init.method ?? 'GET') === 'GET') return g.__pg ? [{ price_group: g.__pg }] : [];
      g.__pg ??= init.body.price_group; g.__pgWrites = (g.__pgWrites ?? 0) + 1; return null;
    }
    if (path.startsWith('site_owners')) return [];
    if (path.startsWith('web_app_publish_intents') && init.method === 'PATCH') return [{ id: 'int1' }];
    return [];
  },
}));
vi.mock('../../lib/webApp/appStoreGuard.js', () => ({
  appStoreStateOf: async () => { if (guard.err) throw guard.err; return guard.state; },
}));

vi.mock('../../lib/webApp/reliability.js', async (orig) => {
  const a: any = await orig();
  return { ...a, planIntent: async (...x: any[]) => ((globalThis as any).__plan ? { id: 'int1' } : a.planIntent(...x)), submitIntent: async (...x: any[]) => ((globalThis as any).__plan ? { id: 'int1' } : a.submitIntent(...x)) };
});

import handler from '../../api/web-app/checkout.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };
const req = (body: any = { tier: 'website', interval: 'month' }) => ({ method: 'POST', headers: { authorization: 'Bearer t' }, body });
const run = async (b?: any) => { const r = res(); await handler(req(b), r); return r; };

let subs: any[]; let open: any[]; let real: Record<string, any>; let nextId: string[];
beforeEach(() => {
  vi.stubEnv('WEB_APP_CHECKOUT', '1');
  vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
  vi.stubEnv('STRIPE_WEBAPP_PRICE_WEBSITE_MONTH', 'price_w_m');
  stripe.calls = []; sb.calls = []; sb.customers = [{ stripe_customer_id: 'cus_stored' }]; sb.ents = []; guard.state = null; guard.err = null;
  (globalThis as any).__pg = undefined; (globalThis as any).__pgFail = undefined; (globalThis as any).__pgWrites = 0;
  subs = []; open = []; real = {}; nextId = ['cs_new'];
  const keyed = new Map<string, any>();
  stripe.handler = (path: string, body: any, method: string, opts: any) => {
    if (path === 'customers') { const k = opts.idempotencyKey; if (!keyed.has(k)) keyed.set(k, { id: `cus_${keyed.size + 1}` }); return keyed.get(k); }
    if (path.startsWith('subscriptions?')) return { data: subs };
    if (path.startsWith('subscriptions/') && (globalThis as any).__subFail) throw new Error('stripe 500');
    if (path.startsWith('subscriptions/')) { const id = decodeURIComponent(path.split('?')[0].split('/')[1]); const f = subs.find((x) => x.id === id); if (!f) throw new Error('no sub'); return f; }
    if (path.startsWith('checkout/sessions?')) return { data: open };
    // Stripe replays the FIRST response for a repeated key: the create response always says 'open'. Real state is only visible via GET.
    if (path === 'checkout/sessions') { const id = nextId.shift() ?? `cs_${Math.random()}`; real[id] ??= { id, status: 'open', url: `https://stripe.test/${id}` }; return { id, status: 'open', url: `https://stripe.test/${id}` }; }
    if (path.startsWith('checkout/sessions/') && method === 'GET') return real[path.split('/')[2]];
    if (path.endsWith('/expire')) return {};
    throw new Error(`unexpected ${path}`);
  };
});
afterEach(() => { vi.unstubAllEnvs(); (globalThis as any).__shop = undefined; (globalThis as any).__cs = undefined; (globalThis as any).__csFail = false; (globalThis as any).__csSaved = undefined; (globalThis as any).__subFail = false; (globalThis as any).__plan = false; });

const created = () => stripe.calls.filter((c) => c.path === 'checkout/sessions' && c.method === 'POST');

describe('POST /api/web-app/checkout', () => {
  it('new plan checkouts use the no-Cash-App configuration when STRIPE_NEW_CHECKOUT_PMC is set', async () => {
    vi.stubEnv('STRIPE_NEW_CHECKOUT_PMC', 'pmc_newsignups');
    sb.customers = [];
    expect((await run()).code).toBe(200);
    expect(created()[0].body.payment_method_configuration).toBe('pmc_newsignups');
  });

  it('flag off: 404', async () => {
    vi.stubEnv('WEB_APP_CHECKOUT', '');
    expect((await run()).code).toBe(404);
  });

  it('first click, no customer yet: NO Stripe customer is created, customer_email is passed, nothing stored', async () => {
    sb.customers = [];
    const r = await run();
    expect(r.code).toBe(200);
    expect(r.body).toEqual({ url: 'https://stripe.test/cs_new' });
    expect(stripe.calls.some((c) => c.path === 'customers')).toBe(false);
    expect(stripe.calls.some((c) => c.path.startsWith('subscriptions'))).toBe(false); // nothing to look up
    const c = created()[0].body;
    expect(c.customer).toBeUndefined();
    expect(c.customer_email).toBe('owner@example.com');
    expect(c.client_reference_id).toBe('u1');
    expect(c.payment_method_configuration).toBeUndefined(); // env unset: Stripe default
    expect(c['metadata[user_id]']).toBe('u1'); expect(c['metadata[app]']).toBe('aibarber-app');
    expect(c['subscription_data[metadata][user_id]']).toBe('u1'); expect(c['subscription_data[metadata][app]']).toBe('aibarber-app');
    expect(sb.calls.some((x) => x.path.startsWith('web_app_customers') && x.method === 'POST')).toBe(false);
  });

  it('two parallel first clicks with no customer: same idempotency key, still no customer created', async () => {
    sb.customers = [];
    const [a, b] = await Promise.all([run(), run()]);
    expect(a.code).toBe(200); expect(b.code).toBe(200);
    expect(new Set(created().map((c) => c.opts.idempotencyKey)).size).toBe(1);
    expect(stripe.calls.some((c) => c.path === 'customers')).toBe(false);
  });

  it('no customer but a just-paid session (webhook not landed): its customer is checked and the user gets 409 already_subscribed', async () => {
    sb.customers = [];
    const h = stripe.handler;
    stripe.handler = (p: string, ...rest: any[]) => p.startsWith('checkout/sessions?customer_details') ? { data: [{ id: 'cs_paid', status: 'complete', customer: 'cus_new', metadata: { app: 'aibarber-app', user_id: 'u1' } }, { id: 'cs_x', status: 'complete', customer: 'cus_other', metadata: { app: 'aibarber-app', user_id: 'u2' } }] }
      : p === 'subscriptions?customer=cus_new&status=all&limit=20' ? { data: [{ id: 'sub_p', status: 'active', metadata: { app: 'aibarber-app' } }] } : h(p, ...rest);
    const r = await run();
    expect(r.code).toBe(409); expect(r.body.error).toBe('already_subscribed');
    expect(created()).toHaveLength(0);
    expect(stripe.calls.some((c) => c.path.includes('cus_other'))).toBe(false);
  });

  it('no customer: another open tab session of this user is expired (found by email); other users and untagged are left alone', async () => {
    sb.customers = [];
    open = [{ id: 'cs_old', metadata: { app: 'aibarber-app', user_id: 'u1' } }, { id: 'cs_u2', metadata: { app: 'aibarber-app', user_id: 'u2' } }, { id: 'cs_n', metadata: {} }];
    await run();
    expect(stripe.calls.filter((c) => c.path.endsWith('/expire')).map((c) => c.path)).toEqual(['checkout/sessions/cs_old/expire']);
  });

  it('plan text: description and custom_text name Prime Barber, the shop and the plan; shop name is cleaned and capped', async () => {
    const withShop = async (shop: any, tier = 'website') => {
      stripe.calls = [];
      const orig = sb.calls;
      const r = await run({ tier, interval: 'month' }); return { r, orig };
    };
    const h = (globalThis as any).__shop;
    (globalThis as any).__shop = 'Fade  Masters\n\u0007 Cuts';
    await withShop(null);
    let c = created()[0].body;
    expect(c['subscription_data[description]']).toBe('Prime Barber · Fade Masters Cuts: Website hosting plan');
    expect(c['custom_text[submit][message]']).toBe(c['subscription_data[description]']);
    (globalThis as any).__shop = 'x'.repeat(2000);
    await withShop(null);
    c = created()[0].body;
    expect(c['subscription_data[description]'].length).toBeLessThan(150);
    (globalThis as any).__shop = undefined;
    await withShop(null);
    expect(created()[0].body['subscription_data[description]']).toBe('Prime Barber · your shop: Website hosting plan');
    (globalThis as any).__shop = h;
  });

  it('a stored customer is reused and no customer is created', async () => {
    sb.customers = [{ stripe_customer_id: 'cus_stored' }];
    await run();
    expect(stripe.calls.some((c) => c.path === 'customers')).toBe(false);
    expect(created()[0].body.customer).toBe('cus_stored');
  });

  it('an older user (customer only on an entitlement row) reuses it and stores it', async () => {
    sb.customers = [];
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
    subs = [{ id: 'sub_1', status: 'incomplete', created: Math.floor(Date.now() / 1000) - 60, metadata: { app: 'aibarber-app' } }];
    const r = await run();
    expect(r.code).toBe(409); expect(r.body.error).toBe('payment_processing');
    expect(created()).toHaveLength(0);
  });

  const incompleteWith = (pi: any, ageSec = 60) => [{ id: 'sub_1', status: 'incomplete', created: Math.floor(Date.now() / 1000) - ageSec, metadata: { app: 'aibarber-app' }, latest_invoice: { id: 'in_1', payment_intent: pi } }];

  it('FIX1: a declined card (payment intent requires_payment_method) does not block: a session URL is returned, no duplicate subscription, nothing cancelled', async () => {
    subs = incompleteWith({ id: 'pi_1', status: 'requires_payment_method' });
    const r = await run();
    expect(r.code).toBe(200); expect(r.body.url).toMatch(/^https:\/\/stripe\.test\//);
    expect(stripe.calls.some((c) => c.method === 'DELETE' || /subscriptions\/sub_1$/.test(c.path) && c.method === 'POST')).toBe(false);
    expect(created()).toHaveLength(1);
  });

  it('FIX1: the still-open stored session is reused (its URL returned) after a decline, none created', async () => {
    subs = incompleteWith({ id: 'pi_1', status: 'requires_payment_method' });
    (globalThis as any).__cs = 'cs_open';
    real.cs_open = { id: 'cs_open', status: 'open', url: 'https://stripe.test/cs_open', mode: 'subscription', expires_at: Math.floor(Date.now() / 1000) + 1800, metadata: { app: 'aibarber-app', user_id: 'u1', tier: 'website', interval: 'month' } };
    const r = await run();
    expect(r.code).toBe(200); expect(r.body).toEqual({ url: 'https://stripe.test/cs_open' });
    expect(created()).toHaveLength(0);
  });

  it('FIX1: payment intent requires_action (3DS in progress) or processing still blocks with payment_processing', async () => {
    for (const status of ['requires_action', 'processing', 'requires_confirmation']) {
      subs = incompleteWith({ id: 'pi_1', status });
      const r = await run();
      expect(r.code).toBe(409); expect(r.body.error).toBe('payment_processing');
    }
    expect(created()).toHaveLength(0);
  });

  it('FIX1: an incomplete sub whose payment state cannot be read keeps blocking (fail closed)', async () => {
    subs = incompleteWith(null);
    expect((await run()).body.error).toBe('payment_processing');
  });

  const openStored = (over: any = {}) => { (globalThis as any).__cs = 'cs_open'; real.cs_open = { id: 'cs_open', status: 'open', url: 'https://stripe.test/cs_open', mode: 'subscription', expires_at: Math.floor(Date.now() / 1000) + 1800, metadata: { app: 'aibarber-app', user_id: 'u1', tier: 'website', interval: 'month' }, ...over }; };

  it('L2/I3: a stored session of another tier, with an intent, another site, another user or about to expire is NOT reused (a new one is created)', async () => {
    const bad: any[] = [
      { metadata: { app: 'aibarber-app', user_id: 'u1', tier: 'bookings', interval: 'month' } },
      { metadata: { app: 'aibarber-app', user_id: 'u1', tier: 'website', interval: 'month', intent_id: 'i1' } },
      { metadata: { app: 'aibarber-app', user_id: 'u1', tier: 'website', interval: 'month', site_slug: 'other' } },
      { metadata: { app: 'aibarber-app', user_id: 'u2', tier: 'website', interval: 'month' } },
      { expires_at: Math.floor(Date.now() / 1000) + 60 },
    ];
    for (const b of bad) {
      stripe.calls = []; nextId = ['cs_new'];
      subs = incompleteWith({ id: 'pi_1', status: 'requires_payment_method' });
      openStored(b);
      const r = await run();
      expect(r.body.url).toBe('https://stripe.test/cs_new');
      expect(created()).toHaveLength(1);
    }
  });

  it('I3: publish-with-checkout after a decline creates and links its own session (the old one is not reused)', async () => {
    vi.stubEnv('WEB_APP_RELIABILITY', '1'); (globalThis as any).__plan = true;
    try {
      subs = incompleteWith({ id: 'pi_1', status: 'requires_payment_method' });
      openStored();
      const r = await run({ tier: 'website', interval: 'month', publish: true, draftId: 'd1', revision: 1 });
      expect(r.code).toBe(200); expect(r.body.url).toBe('https://stripe.test/cs_new');
      expect(created()).toHaveLength(1);
      expect(created()[0].body['metadata[intent_id]']).toBe('int1');
      expect(sb.calls.some((c) => c.path.startsWith('web_app_publish_intents?id=eq.int1') && c.body?.stripe_session_id === 'cs_new')).toBe(true);
    } finally { (globalThis as any).__plan = false; }
  });

  it('I3: mixed declined + processing incomplete subscriptions: 409 payment_processing', async () => {
    const now = Math.floor(Date.now() / 1000);
    subs = [
      { id: 'sub_a', status: 'incomplete', created: now - 60, metadata: { app: 'aibarber-app' }, latest_invoice: { payment_intent: { status: 'requires_payment_method' } } },
      { id: 'sub_b', status: 'incomplete', created: now - 60, metadata: { app: 'aibarber-app' }, latest_invoice: { payment_intent: { status: 'processing' } } },
    ];
    const r = await run();
    expect(r.code).toBe(409); expect(r.body.error).toBe('payment_processing');
  });

  it('I2: a failed Stripe payment-state lookup is 503 try_again, not a processing lockout', async () => {
    subs = incompleteWith({ id: 'pi_1', status: 'requires_payment_method' });
    (globalThis as any).__subFail = true;
    const r = await run();
    expect(r.code).toBe(503); expect(r.body.error).toBe('try_again');
    expect(created()).toHaveLength(0);
  });

  it('I1: pins the Stripe 2024-06-20 dependency: the lookup expands latest_invoice.payment_intent', async () => {
    subs = incompleteWith({ id: 'pi_1', status: 'requires_payment_method' });
    await run();
    expect(stripe.calls.some((c) => c.path === 'subscriptions/sub_1?expand[0]=latest_invoice.payment_intent')).toBe(true);
    const src = (await import('node:fs')).readFileSync(new URL('../../lib/webApp/webAppServer.ts', import.meta.url), 'utf8');
    expect(src).toContain("const STRIPE_API_VERSION = '2024-06-20'");
  });

  it('R2: after a decline the old Checkout session is expired BEFORE the new one is created', async () => {
    subs = incompleteWith({ id: 'pi_1', status: 'requires_payment_method' });
    openStored({ metadata: { app: 'aibarber-app', user_id: 'u1', tier: 'website', interval: 'month', intent_id: 'old' } });
    expect((await run()).code).toBe(200);
    const iExp = stripe.calls.findIndex((c) => c.path === 'checkout/sessions/cs_open/expire');
    const iNew = stripe.calls.findIndex((c) => c.path === 'checkout/sessions' && c.method === 'POST');
    expect(iExp).toBeGreaterThanOrEqual(0); expect(iExp).toBeLessThan(iNew);
  });

  it('R2: the old tab retried and is now processing / mid-3DS (incomplete, not declined): new session expired, 409 payment_processing', async () => {
    subs = incompleteWith({ id: 'pi_1', status: 'requires_payment_method' });
    openStored({ metadata: { app: 'aibarber-app', user_id: 'u1', tier: 'website', interval: 'month', intent_id: 'old' } });
    const h = stripe.handler; let listed = 0;
    stripe.handler = (p: string, ...rest: any[]) => {
      if (p.startsWith('subscriptions?') && ++listed === 2) { subs = incompleteWith({ id: 'pi_1', status: 'requires_action' }); return { data: subs }; }
      return h(p, ...rest);
    };
    const r = await run();
    expect(r.code).toBe(409); expect(r.body.error).toBe('payment_processing');
    expect(stripe.calls.some((c) => c.path === 'checkout/sessions/cs_new/expire')).toBe(true);
  });

  it('L1: the declined tab paid while the new session was being made: the new session is expired and 409 already_subscribed', async () => {
    subs = incompleteWith({ id: 'pi_1', status: 'requires_payment_method' });
    openStored({ metadata: { app: 'aibarber-app', user_id: 'u1', tier: 'website', interval: 'month', intent_id: 'old' } }); // forces a new session
    const h = stripe.handler; let listed = 0;
    stripe.handler = (p: string, ...rest: any[]) => {
      if (p.startsWith('subscriptions?') && ++listed === 2) return { data: [{ id: 'sub_1', status: 'active', metadata: { app: 'aibarber-app' } }] };
      return h(p, ...rest);
    };
    const r = await run();
    expect(r.code).toBe(409); expect(r.body.error).toBe('already_subscribed');
    expect(stripe.calls.some((c) => c.path === 'checkout/sessions/cs_new/expire')).toBe(true);
  });

  it('L1b: the old session completed: the new one is expired and 409 already_subscribed', async () => {
    subs = incompleteWith({ id: 'pi_1', status: 'requires_payment_method' });
    openStored({ metadata: { app: 'aibarber-app', user_id: 'u1', tier: 'website', interval: 'month', intent_id: 'old' } });
    const h = stripe.handler; let gets = 0;
    stripe.handler = (p: string, b: any, m: string, o: any) => {
      if (p === 'checkout/sessions/cs_open' && m === 'GET' && ++gets === 2) return { id: 'cs_open', status: 'complete' };
      return h(p, b, m, o);
    };
    const r = await run();
    expect(r.code).toBe(409); expect(r.body.error).toBe('already_subscribed');
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
    expect(exp).toBeGreaterThanOrEqual(Math.floor(now / 1000) + 1800 + 120);
    expect(exp).toBeLessThanOrEqual(Math.floor(now / 1000) + 2400 + 120 + 1);
    expect(c.opts.idempotencyKey).toMatch(/^aibarber-app:cs:u1:website:month:base:\d+:[0-9a-f]{8}$/);
    expect(c.body['metadata[interval]']).toBe('month');
    expect(c.body['subscription_data[metadata][app]']).toBe('aibarber-app');
  });

  it('a replayed create (Stripe returns the stale first response) whose real status is complete: 409 payment_processing, never a second URL', async () => {
    real.cs_new = { id: 'cs_new', status: 'complete', url: null };
    const r = await run();
    expect(r.code).toBe(409); expect(r.body.error).toBe('payment_processing');
  });

  it('a replay whose real status is expired: a fresh session is created with a :r key', async () => {
    real.cs_new = { id: 'cs_new', status: 'expired', url: null };
    nextId = ['cs_new', 'cs_fresh'];
    const r = await run();
    expect(r.body).toEqual({ url: 'https://stripe.test/cs_fresh' });
    expect(created()[1].opts.idempotencyKey).toMatch(/:r\d+$/);
  });

  it('N3: an incomplete subscription older than an hour is abandoned and does not block; a fresh one still does', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    subs = [{ id: 's', status: 'incomplete', created: nowSec - 7200, metadata: { app: 'aibarber-app' } }];
    expect((await run()).code).toBe(200);
    expect(stripe.calls.some((c) => c.method === 'DELETE')).toBe(false); // ignored, never cancelled
    subs = [{ id: 's', status: 'incomplete', created: nowSec - 600, metadata: { app: 'aibarber-app' } }];
    expect((await run()).body.error).toBe('payment_processing');
  });

  it('N1: at the very end of a 10-minute window expires_at is still at least 30 min + 2 min ahead', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const windowStart = Math.floor(Date.now() / 600_000) * 600_000;
      vi.setSystemTime(windowStart + 599_000);
      await run();
      const nowSec = Math.floor((windowStart + 599_000) / 1000);
      expect(Number(created()[0].body.expires_at) - nowSec).toBeGreaterThanOrEqual(1800 + 119);
    } finally { vi.useRealTimers(); }
  });

  it('unpaid and paused tagged subscriptions block checkout', async () => {
    for (const status of ['unpaid', 'paused']) {
      subs = [{ id: 's', status, metadata: { app: 'aibarber-app' } }];
      const r = await run();
      expect(r.code).toBe(409); expect(r.body.error).toBe('already_subscribed');
    }
    expect(created()).toHaveLength(0);
  });

  it('migration 024 missing (web_app_customers unreadable): 502 and no Stripe session or customer is created', async () => {
    const orig = sb.customers;
    (globalThis as any).__failCustomers = true;
    const r = await run();
    delete (globalThis as any).__failCustomers;
    expect(r.code).toBe(502);
    expect(created()).toHaveLength(0);
    expect(stripe.calls.some((c) => c.path === 'customers')).toBe(false);
    expect(sb.customers).toBe(orig);
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

  it('stores the new open session id; a previously stored one is expired by id (no email needed, no listing)', async () => {
    sb.customers = [];
    (globalThis as any).__cs = 'cs_prev';
    const h = stripe.handler;
    stripe.handler = (p: string, ...r: any[]) => p.startsWith('checkout/sessions?') ? (() => { throw new Error('must not list'); })() : h(p, ...r);
    const noEmail = vi.fn();
    const r = await run();
    expect(r.code).toBe(200);
    expect(stripe.calls.filter((c) => c.path.endsWith('/expire')).map((c) => c.path)).toContain('checkout/sessions/cs_prev/expire');
    expect((globalThis as any).__csSaved).toMatchObject({ user_id: 'u1', environment: 'test', stripe_session_id: 'cs_new' });
    void noEmail;
  });

  it('the stored session is not expired when it is the one just returned (idempotent replay)', async () => {
    (globalThis as any).__cs = 'cs_new';
    await run();
    expect(stripe.calls.some((c) => c.path === 'checkout/sessions/cs_new/expire')).toBe(false);
  });

  it('fail-soft: web_app_checkout_sessions missing (migration 026 not applied) never blocks checkout', async () => {
    (globalThis as any).__csFail = true;
    expect((await run()).code).toBe(200);
  });

  describe('price test groups', () => {
    const sessionBody = () => created()[0].body;
    beforeEach(() => {
      vi.stubEnv('STRIPE_WEBAPP_PRICE_G10_WEBSITE_MONTH', 'price_g10_w_m');
      vi.stubEnv('STRIPE_WEBAPP_PRICE_G20_WEBSITE_MONTH', 'price_g20_w_m');
      vi.stubEnv('STRIPE_WEBAPP_PRICE_G10_STORE_YEAR', 'price_g10_s_y');
    });
    it('no stored group and no priceGroup: base price, metadata price_group=base, nothing stored', async () => {
      const r = await run();
      expect(r.code).toBe(200);
      expect(sessionBody()['line_items[0][price]']).toBe('price_w_m');
      expect(sessionBody()['metadata[price_group]']).toBe('base');
      expect(sessionBody()['subscription_data[metadata][price_group]']).toBe('base');
      expect((globalThis as any).__pgWrites).toBe(0);
    });
    it('a stored g10 user is charged the g10 price, even if the body asks for g20', async () => {
      (globalThis as any).__pg = 'g10';
      const r = await run({ tier: 'website', interval: 'month', priceGroup: 'g20' });
      expect(r.code).toBe(200);
      expect(sessionBody()['line_items[0][price]']).toBe('price_g10_w_m');
      expect(sessionBody()['metadata[price_group]']).toBe('g10');
      expect(sessionBody()['subscription_data[metadata][price_group]']).toBe('g10');
    });
    it('yearly g10 works', async () => {
      (globalThis as any).__pg = 'g10';
      await run({ tier: 'store', interval: 'year' });
      expect(sessionBody()['line_items[0][price]']).toBe('price_g10_s_y');
    });
    it('a new user asking for g20 gets the g20 price and the group is stored', async () => {
      sb.customers = []; // a brand-new sign-up: no Stripe history
      const r = await run({ tier: 'website', interval: 'month', priceGroup: 'g20' });
      expect(r.code).toBe(200);
      expect(sessionBody()['line_items[0][price]']).toBe('price_g20_w_m');
      expect((globalThis as any).__pg).toBe('g20');
    });
    it('a user with Stripe history asking for g10 is stored and charged base', async () => {
      sb.ents = [{ stripe_customer_id: 'cus_old', status: 'canceled' }];
      const r = await run({ tier: 'website', interval: 'month', priceGroup: 'g10' });
      expect(r.code).toBe(200);
      expect(sessionBody()['line_items[0][price]']).toBe('price_w_m');
      expect((globalThis as any).__pg).toBe('base');
    });
    it('an invalid priceGroup is ignored (base)', async () => {
      await run({ tier: 'website', interval: 'month', priceGroup: 'g99' });
      expect(sessionBody()['line_items[0][price]']).toBe('price_w_m');
      expect((globalThis as any).__pgWrites).toBe(0);
    });
    it('requested group with the price env empty: base price, no group stored', async () => {
      vi.stubEnv('STRIPE_WEBAPP_PRICE_G10_WEBSITE_MONTH', '');
      const r = await run({ tier: 'website', interval: 'month', priceGroup: 'g10' });
      expect(r.code).toBe(200);
      expect(sessionBody()['line_items[0][price]']).toBe('price_w_m');
      expect((globalThis as any).__pg).toBeUndefined();
    });
    it('a STORED g10 user with the price env empty: 503 price_not_configured, no session', async () => {
      vi.stubEnv('STRIPE_WEBAPP_PRICE_G10_WEBSITE_MONTH', '');
      (globalThis as any).__pg = 'g10';
      const r = await run();
      expect(r.code).toBe(503); expect(r.body).toEqual({ error: 'price_not_configured' });
      expect(created()).toHaveLength(0);
    });
    it('a price group lookup failure is 503 try_again (never guesses a price)', async () => {
      (globalThis as any).__pgFail = 500;
      const r = await run({ tier: 'website', interval: 'month', priceGroup: 'g10' });
      expect(r.code).toBe(503); expect(r.body).toEqual({ error: 'try_again' });
      expect(created()).toHaveLength(0);
    });
    it('table missing (404 on read): treated as no group, base', async () => {
      (globalThis as any).__pgFail = 404;
      const r = await run();
      expect(r.code).toBe(200);
      expect(sessionBody()['line_items[0][price]']).toBe('price_w_m');
    });
    it('the idempotency key carries the group', async () => {
      (globalThis as any).__pg = 'g10';
      await run();
      expect(created()[0].opts.idempotencyKey).toMatch(/^aibarber-app:cs:u1:website:month:g10:\d+:/);
    });
    it('declined-session reuse requires the same group', async () => {
      (globalThis as any).__pg = 'g10';
      subs = incompleteWith({ id: 'pi_1', status: 'requires_payment_method' });
      (globalThis as any).__cs = 'cs_open';
      const meta = (price_group?: string) => ({ app: 'aibarber-app', user_id: 'u1', tier: 'website', interval: 'month', ...(price_group ? { price_group } : {}) });
      real.cs_open = { id: 'cs_open', status: 'open', url: 'https://stripe.test/cs_open', mode: 'subscription', expires_at: Math.floor(Date.now() / 1000) + 1800, metadata: meta('g10') };
      expect((await run()).body).toEqual({ url: 'https://stripe.test/cs_open' });
      expect(created()).toHaveLength(0);
      // an old base session (no price_group metadata) is NOT reused for a g10 user
      real.cs_open = { ...real.cs_open, status: 'open', metadata: meta() };
      const r = await run();
      expect(r.body.url).not.toBe('https://stripe.test/cs_open');
      expect(created()).toHaveLength(1);
    });
  });
});
