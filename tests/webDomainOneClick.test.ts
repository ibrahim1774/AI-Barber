// The web app's one-click custom domain (lib/webApp/domainOneClick.ts) and the pieces it shares with
// hosted Checkout: customer / returnTo on createDomainCheckout, the one-click Purchase report, the
// staging real-sub list. A fake Stripe records every call; the registrar and repo are the shared fakes.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DOMAIN_SESSION_APP, createDomainCheckout, domainSig, handleDomainStripeEvent, readDomainMetadata,
} from '../lib/webDomains.js';
import { cardOnFile, oneClickCard, oneClickDomainPurchase, oneClickFlagOn, type OneClickDeps, type StripeFn } from '../lib/webApp/domainOneClick.js';
import type { DomainFlowDeps } from '../lib/ios/domainFlow.js';
import { makePayer, domainTestRealSites } from '../lib/ios/domainLive.js';
import { fakeRegistrar } from './ios/fakeRegistrar.js';
import { fakeDomainsRepo, blankRow } from './ios/fakeDomainsRepo.js';

const T0 = 1_800_000_000_000;
const DAY = 24 * 3600_000;
const SECRET = 'test-domain-secret';
const CONTACT = { firstName: 'A', lastName: 'B', email: 'a@b.co', phone: '+15555550100', address1: '1 Secret Street', city: 'c', state: 's', zip: 'z', country: 'US' };
const OWNER = 'Bearer owner';
const PRICE = 'price_domain';

afterEach(() => vi.restoreAllMocks());

const authorize = vi.fn(async (siteId: unknown, authorization: unknown) => {
  if (!authorization) return { ok: false, status: 401 as const, error: 'sign-in-required' };
  if (String(siteId) !== 'fresh-cuts') return { ok: false, status: 403 as const, error: 'not-authorized' };
  if (authorization === OWNER) return { ok: true, target: 'fresh-cuts', actor: 'web-user' as const, userId: 'u1' };
  if (authorization === 'Bearer ios') return { ok: true, target: 'fresh-cuts', actor: 'app-owner' as const, userId: 'u2' };
  if (authorization === 'Bearer admin') return { ok: true, target: 'fresh-cuts', actor: 'admin' as const, userId: 'u3' };
  return { ok: false, status: 403 as const, error: 'not-authorized' };
});

interface FakeStripeOpts { livemode?: boolean; priceId?: string }

/** A recording fake of the Stripe REST calls one-click makes (the plan customer cus_plan0001 with a Visa 4242). */
function fakeStripe(o: FakeStripeOpts = {}) {
  const calls: { method: string; path: string; form?: Record<string, string>; idem?: string }[] = [];
  const subs = new Map<string, any>();
  const idem = new Map<string, { ok: boolean; status: number; data: any }>();
  const state = {
    card: { id: 'pm_ok000001', type: 'card', customer: 'cus_plan0001', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2099 } } as any | null,
    customerMissing: false,
    createMode: 'ok' as 'ok' | 'decline' | 'auth' | 'missing' | 'lost' | '5xx' | 'incomplete',
    n: 0,
    onCreated: undefined as undefined | ((sub: any) => Promise<void>),
  };
  const fn: StripeFn = async (method, path, opts = {}) => {
    calls.push({ method, path, form: opts.form, idem: opts.idem });
    const ok = (data: any) => ({ ok: true, status: 200, data });
    if (state.customerMissing && method === 'GET' && /sub_plan0001|\/v1\/customers|\/v1\/payment_methods/.test(path)) return { ok: false, status: 404, data: { error: { code: 'resource_missing' } } };
    if (method === 'GET' && path.startsWith('/v1/subscriptions/sub_plan0001')) return ok({ id: 'sub_plan0001', customer: 'cus_plan0001', default_payment_method: state.card?.id ?? null });
    if (method === 'GET' && path.startsWith('/v1/customers/')) return state.customerMissing ? { ok: false, status: 404, data: { error: { code: 'resource_missing' } } } : ok({ id: 'cus_plan0001', invoice_settings: { default_payment_method: null } });
    if (method === 'GET' && path.startsWith('/v1/payment_methods/')) return state.card && path.endsWith(state.card.id) ? ok(state.card) : { ok: false, status: 404, data: {} };
    if (method === 'GET' && path.startsWith('/v1/payment_methods?')) return ok({ data: state.card ? [state.card] : [] });
    if (method === 'GET' && path.startsWith('/v1/subscriptions?')) return ok({ data: [...subs.values()].filter((s) => s.status === 'active').map((s) => structuredClone(s)) });
    if (method === 'DELETE' && path.startsWith('/v1/subscriptions/')) { const s = subs.get(path.split('/').pop()!); if (s) s.status = 'canceled'; return ok({}); }
    if (method === 'POST' && path === '/v1/subscriptions') {
      const key = opts.idem!;
      if (idem.has(key)) { if (state.createMode === 'lost') throw new Error('socket hang up'); return idem.get(key)!; }
      const f = opts.form!;
      let r: { ok: boolean; status: number; data: any };
      if (state.createMode === 'decline') r = { ok: false, status: 402, data: { error: { type: 'card_error', code: 'card_declined', message: 'Your card 4242 was declined' } } };
      else if (state.createMode === 'auth') r = { ok: false, status: 402, data: { error: { type: 'card_error', code: 'subscription_payment_intent_requires_action' } } };
      else if (state.createMode === 'missing') r = { ok: false, status: 404, data: { error: { type: 'invalid_request_error', code: 'resource_missing' } } };
      else if (state.createMode === '5xx') return { ok: false, status: 500, data: {} };
      else {
        const md: Record<string, string> = {};
        for (const [k, v] of Object.entries(f)) { const m = /^metadata\[(.+)\]$/.exec(k); if (m) md[m[1]] = v; }
        const id = `sub_oneclick${++state.n}`;
        const sub = {
          id, status: state.createMode === 'incomplete' ? 'incomplete' : 'active', livemode: o.livemode ?? true, customer: f.customer,
          cancel_at_period_end: false, cancel_at: null, current_period_end: (T0 + 365 * DAY) / 1000, metadata: md,
          latest_invoice: { id: `in_${id}`, status: state.createMode === 'incomplete' ? 'open' : 'paid' },
          items: { data: [{ quantity: 1, price: { id: o.priceId ?? (f['items[0][price]'] || 'price_inline'), currency: 'usd', unit_amount: 3900, recurring: { interval: 'year', interval_count: 1 } } }] },
        };
        subs.set(id, sub);
        r = { ok: true, status: 200, data: structuredClone(sub) };
        idem.set(key, r);
        await state.onCreated?.(sub);
        if (state.createMode === 'lost') throw new Error('socket hang up'); // Stripe created it, the answer never arrives
        return r;
      }
      idem.set(key, r);
      return r;
    }
    return { ok: false, status: 404, data: {} };
  };
  return { fn, calls, subs, state, posts: () => calls.filter((c) => c.method === 'POST') };
}

function world(opts: { livemode?: boolean; priceId?: string; flow?: Partial<DomainFlowDeps>; deps?: Partial<OneClickDeps>; taken?: string[] } = {}) {
  let now = T0;
  const clock = () => now;
  const reg = fakeRegistrar({ now: clock, taken: opts.taken });
  const repo = fakeDomainsRepo([], clock);
  const st = fakeStripe({ livemode: opts.livemode, priceId: opts.priceId });
  const hooks = { onDomainLinked: vi.fn(async () => {}), onDomainUnlinked: vi.fn(async () => {}) };
  const cancelAndRefund = vi.fn(async (_id: string) => {});
  const notifySupport = vi.fn(async (_s: string, _t: string) => {});
  const flow: DomainFlowDeps = {
    repo, vercel: reg.api, contact: CONTACT,
    verifyDomain: vi.fn(async () => { throw new Error('no Apple'); }),
    verifySite: vi.fn(async () => { throw new Error('no Apple'); }),
    payer: makePayer(async () => { throw new Error('no Apple'); }, async (id) => (st.subs.has(id) ? structuredClone(st.subs.get(id)) : null), clock),
    sitePurchase: async () => null, hooks, now: clock, notifySupport, cancelAndRefund: (id) => cancelAndRefund(id),
    ...opts.flow,
  };
  const deps: OneClickDeps = {
    authorize, flow, secret: SECRET, priceId: PRICE, stripe: st.fn,
    planOf: vi.fn(async () => ({ customer: 'cus_plan0001', subscriptionId: 'sub_plan0001' })),
    ownsWebSite: vi.fn(async (slug: string, userId: string) => slug === 'fresh-cuts' && userId === 'u1'),
    cancelAndRefund, notifySupport, enabled: true,
    ...opts.deps,
  };
  const webhookDeps = { getSubscription: async (id: string) => (st.subs.has(id) ? structuredClone(st.subs.get(id)) : null), flow, secret: SECRET, priceId: deps.priceId, cancelAndRefund, notifySupport, testRealSites: deps.testRealSites };
  return {
    reg, repo, st, deps, flow, hooks, cancelAndRefund, notifySupport,
    buy: (body: any = { domain: 'freshcuts.com', siteId: 'fresh-cuts' }, auth: unknown = OWNER) => oneClickDomainPurchase(body, auth, deps),
    card: (auth: unknown = OWNER) => oneClickCard({ siteId: 'fresh-cuts' }, auth, deps),
    event: (type: string, object: any) => handleDomainStripeEvent({ type, data: { object } }, () => webhookDeps as any),
    rows: () => [...repo.rows.values()],
  };
}

describe('one-click buy: the charge', () => {
  it('creates ONE signed subscription on the plan card: server price, signed metadata, off-session, error_if_incomplete', async () => {
    const w = world();
    const r = await w.buy();
    expect([200, 202]).toContain(r.status);
    const posts = w.st.posts();
    expect(posts).toHaveLength(1);
    const f = posts[0].form!;
    expect(f).toMatchObject({
      customer: 'cus_plan0001', default_payment_method: 'pm_ok000001', collection_method: 'charge_automatically',
      payment_behavior: 'error_if_incomplete', off_session: 'true', 'items[0][price]': PRICE, 'items[0][quantity]': '1',
      'metadata[type]': 'domain_purchase', 'metadata[app]': DOMAIN_SESSION_APP, 'metadata[domain]': 'freshcuts.com', 'metadata[siteId]': 'fresh-cuts',
      description: 'Custom domain - freshcuts.com', 'expand[0]': 'latest_invoice',
    });
    expect(f['metadata[sig]']).toBe(domainSig(SECRET, 'freshcuts.com', 'fresh-cuts'));
    expect(readDomainMetadata({ type: 'domain_purchase', app: DOMAIN_SESSION_APP, domain: 'freshcuts.com', siteId: 'fresh-cuts', sig: f['metadata[sig]'] }, SECRET)).toEqual({ domain: 'freshcuts.com', slug: 'fresh-cuts' });
    // only the authorised slug and the validated domain came from the request: nothing else is client-controlled
    expect(Object.keys(f).filter((k) => !/^(items|metadata|expand)\[/.test(k)).sort()).toEqual(['collection_method', 'customer', 'default_payment_method', 'description', 'off_session', 'payment_behavior']);
  });

  it('with no price id the price comes from price_data on the configured product (never product_data), $39 yearly', async () => {
    const w = world({ deps: { priceId: undefined, productId: 'prod_dom' } });
    await w.buy();
    const f = w.st.posts()[0].form!;
    expect(f).toMatchObject({ 'items[0][price_data][currency]': 'usd', 'items[0][price_data][unit_amount]': '3900', 'items[0][price_data][recurring][interval]': 'year', 'items[0][price_data][product]': 'prod_dom' });
    expect(Object.keys(f).some((k) => k.includes('product_data'))).toBe(false);
  });

  it('neither price nor product configured: one-click is off (402), nothing called', async () => {
    const w = world({ deps: { priceId: undefined, productId: undefined } });
    expect((await w.buy()).body).toMatchObject({ error: 'one-click-off', fallback: true });
    expect(w.st.calls).toHaveLength(0);
    expect((await w.card()).body).toEqual({ oneClick: false, card: null });
  });

  it('idempotency key = site, domain, card and a 10-minute window; a double click makes one subscription and one row', async () => {
    const w = world();
    const [a, b] = await Promise.all([w.buy(), w.buy()]);
    for (const r of [a, b]) expect([200, 202]).toContain(r.status);
    expect(w.st.posts()[0].idem).toMatch(/^domain-oneclick:fresh-cuts:freshcuts\.com:pm_ok000001:\d+$/);
    expect(new Set(w.st.posts().map((p) => p.idem)).size).toBe(1);
    expect(w.st.subs.size).toBe(1);
    expect(w.rows()).toHaveLength(1);
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('a retry in a later 10-minute window is a new attempt key (a fixed card is not stuck on a cached decline)', async () => {
    const w = world();
    const keys: string[] = [];
    w.deps.stripe = (async (m, p, o) => { if (m === 'POST') keys.push(o!.idem!); return w.st.fn(m, p, o); }) as StripeFn;
    w.st.state.createMode = 'decline';
    await w.buy();
    (w.flow as any).now = () => T0 + 11 * 60_000;
    await w.buy();
    expect(new Set(keys).size).toBe(2);
  });
});

describe('one-click buy: who and what, before any Stripe write', () => {
  it('no token 401, another site 403, an iOS site owner 403 app-site, the admin 403 owner-only: Stripe is never touched', async () => {
    const w = world();
    expect((await w.buy(undefined, null)).status).toBe(401);
    expect((await w.buy({ domain: 'freshcuts.com', siteId: 'other-site' })).status).toBe(403);
    expect(await w.buy(undefined, 'Bearer ios')).toMatchObject({ status: 403, body: { error: 'app-site' } });
    expect(await w.buy(undefined, 'Bearer admin')).toMatchObject({ status: 403, body: { error: 'owner-only' } });
    expect(w.st.calls).toHaveLength(0);
    expect(w.deps.planOf).not.toHaveBeenCalled();
  });

  it('bad fields: only a .com domain, a siteId; nothing called', async () => {
    const w = world();
    for (const b of [{ domain: 'freshcuts.net', siteId: 'fresh-cuts' }, { domain: 'a b.com', siteId: 'fresh-cuts' }, { domain: 'freshcuts.com' }, { siteId: 'fresh-cuts' }, null]) {
      expect((await w.buy(b)).status).toBe(400);
    }
    expect(w.st.calls).toHaveLength(0);
    expect(authorize).toBeDefined();
  });

  it('fails closed (503) without the signing secret, the Vercel token or a contact, before the owner lookup', async () => {
    for (const over of [{ secret: '' }, { flow: { vercel: null } }, { flow: { contact: null } }] as any[]) {
      const w = world(over.flow ? { flow: over.flow } : { deps: over });
      const before = authorize.mock.calls.length;
      expect((await w.buy()).status).toBe(503);
      expect(authorize.mock.calls.length).toBe(before);
      expect(w.st.calls).toHaveLength(0);
    }
  });

  it('a site that already holds a domain: 409 before any Stripe call', async () => {
    const w = world();
    w.repo.rows.set('stripe:sub_old', blankRow({ original_transaction_id: 'stripe:sub_old', source: 'stripe', site_slug: 'fresh-cuts', domain: 'old.com', state: 'live' }));
    expect(await w.buy()).toMatchObject({ status: 409, body: { error: 'This site already has a custom domain' } });
    expect(w.st.calls).toHaveLength(0);
  });

  it('a taken name, and a name above the standard price: 409 before any Stripe call', async () => {
    const taken = world({ taken: ['freshcuts.com'] });
    expect(await taken.buy()).toMatchObject({ status: 409, body: { error: 'Domain is not available' } });
    expect(taken.st.calls).toHaveLength(0);
    const dear = world();
    dear.reg.api.prices = vi.fn(async () => new Map([['freshcuts.com', { purchasePrice: 99, renewalPrice: 99 }]])) as any;
    expect(await dear.buy()).toMatchObject({ status: 409, body: { error: 'Domain is not available at a standard price' } });
    expect(dear.st.calls).toHaveLength(0);
  });

  it('one-click off (flag): 402 one-click-off, nothing called; the card answer says so', async () => {
    const w = world({ deps: { enabled: false } });
    expect(await w.buy()).toMatchObject({ status: 402, body: { error: 'one-click-off', fallback: true } });
    expect((await w.card()).body).toEqual({ oneClick: false, card: null });
    expect(w.st.calls).toHaveLength(0);
    expect(oneClickFlagOn({})).toBe(true);
    expect(oneClickFlagOn({ WEB_DOMAIN_ONECLICK: '0' })).toBe(false);
    expect(oneClickFlagOn({ WEB_DOMAIN_ONECLICK: 'off' })).toBe(false);
    expect(oneClickFlagOn({ WEB_DOMAIN_ONECLICK: '1' })).toBe(true);
  });
});

describe('one-click buy: no card, declined, SCA: nothing charged, nothing left behind', () => {
  it.each([
    ['no plan customer', (w: ReturnType<typeof world>) => { (w.deps.planOf as any).mockResolvedValue(null); }],
    ['no saved card', (w: ReturnType<typeof world>) => { w.st.state.card = null; }],
    ['an expired card', (w: ReturnType<typeof world>) => { w.st.state.card.card.exp_year = 2020; }],
    ["a card of another customer", (w: ReturnType<typeof world>) => { w.st.state.card.customer = 'cus_other0001'; }],
    ['a customer unknown to this Stripe account (other account)', (w: ReturnType<typeof world>) => { w.st.state.customerMissing = true; }],
  ])('%s: 402 no-card with fallback, no Stripe write, no row', async (_n, setup) => {
    const w = world();
    setup(w);
    expect(await w.buy()).toMatchObject({ status: 402, body: { error: 'no-card', fallback: true } });
    expect(w.st.posts()).toHaveLength(0);
    expect(w.rows()).toHaveLength(0);
  });

  it('card_declined → 402 card-failed (reason declined), Stripe message never relayed, no row, no log of the card', async () => {
    const logs = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})];
    const w = world();
    w.st.state.createMode = 'decline';
    const r = await w.buy();
    expect(r).toMatchObject({ status: 402, body: { error: 'card-failed', fallback: true, reason: 'declined' } });
    expect(JSON.stringify(r.body)).not.toMatch(/4242|Your card/);
    expect(w.rows()).toHaveLength(0);
    expect(w.reg.api.buy).not.toHaveBeenCalled();
    expect(JSON.stringify(logs.map((l) => l.mock.calls))).not.toMatch(/4242/);
  });

  it('SCA (requires_action) → 402 card-failed reason authentication; a create answering resource_missing → no-card', async () => {
    const w = world();
    w.st.state.createMode = 'auth';
    expect(await w.buy()).toMatchObject({ status: 402, body: { error: 'card-failed', reason: 'authentication', fallback: true } });
    const m = world();
    m.st.state.createMode = 'missing';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await m.buy()).toMatchObject({ status: 402, body: { error: 'no-card' } });
  });

  it('a subscription that comes back incomplete is cancelled, never claimed (402)', async () => {
    const w = world();
    w.st.state.createMode = 'incomplete';
    const r = await w.buy();
    expect(r).toMatchObject({ status: 402, body: { error: 'card-failed', fallback: true } });
    expect(w.st.calls.some((c) => c.method === 'DELETE' && c.path === '/v1/subscriptions/sub_oneclick1')).toBe(true);
    expect(w.rows()).toHaveLength(0);
    expect(w.cancelAndRefund).not.toHaveBeenCalled();
  });

  it('a Stripe 5xx (twice) or a lost response: 503, retried under the same key; the next call claims the subscription instead of charging again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const five = world();
    five.st.state.createMode = '5xx';
    expect((await five.buy()).status).toBe(503);
    expect(five.st.posts()).toHaveLength(2);
    expect(new Set(five.st.posts().map((p) => p.idem)).size).toBe(1);

    const lost = world();
    lost.st.state.createMode = 'lost'; // Stripe created it, the answer never arrived
    expect((await lost.buy()).status).toBe(503);
    expect(lost.st.subs.size).toBe(1);
    expect(lost.rows()).toHaveLength(0);
    lost.st.state.createMode = 'ok';
    const again = await lost.buy();
    expect([200, 202]).toContain(again.status);
    expect(lost.st.subs.size).toBe(1); // no second subscription
    expect(lost.rows().map((r) => r.original_transaction_id)).toEqual(['stripe:sub_oneclick1']);
    expect(lost.st.posts().length).toBe(2); // the two attempts of the first call only
  });
});

describe('one-click buy: the claim (shared state machine)', () => {
  it('paid + active: the row stripe:<sub> goes reserved → bought → live through the real registrar; auto-renew off, link hook ran', async () => {
    const w = world();
    const r = await w.buy();
    expect(r.status).toBe(200);
    const row = w.repo.rows.get('stripe:sub_oneclick1')!;
    expect(row).toMatchObject({ state: 'live', source: 'stripe', site_slug: 'fresh-cuts', domain: 'freshcuts.com', simulated: false });
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
    expect(w.reg.registered.get('freshcuts.com')?.renew).toBe(true); // auto-renew follows the active subscription (the machine bought it with renew off)
    expect(w.reg.api.buy).toHaveBeenCalledWith('freshcuts.com', expect.objectContaining({ autoRenew: false }));
    expect(w.hooks.onDomainLinked).toHaveBeenCalled();
  });

  it('Stripe test mode: the row is simulated and Vercel is never asked to buy or attach', async () => {
    const w = world({ livemode: false });
    const r = await w.buy();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sandbox: true });
    expect(w.repo.rows.get('stripe:sub_oneclick1')).toMatchObject({ simulated: true, state: 'live' });
    expect(w.reg.api.buy).not.toHaveBeenCalled();
    expect(w.reg.api.addProjectDomain).not.toHaveBeenCalled();
  });

  it('DOMAINS_TEST_REAL_SITES flips simulated only for the listed site slugs', async () => {
    const real = world({ livemode: false, deps: { testRealSites: new Set(['fresh-cuts']) } });
    await real.buy();
    expect(real.repo.rows.get('stripe:sub_oneclick1')?.simulated).toBe(false);
    const other = world({ livemode: false, deps: { testRealSites: new Set(['other-site']) } });
    await other.buy();
    expect(other.repo.rows.get('stripe:sub_oneclick1')?.simulated).toBe(true);
    // the list means nothing for a live subscription: it is real either way
    const live = world({ livemode: true, deps: { testRealSites: new Set() } });
    await live.buy();
    expect(live.repo.rows.get('stripe:sub_oneclick1')?.simulated).toBe(false);
  });

  it('refused AFTER payment (the site got a domain in the meantime): cancelled and refunded in full, support told once, never left paid without a domain', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = world();
    const real = w.repo.holdingSite.bind(w.repo);
    let calls = 0;
    w.repo.holdingSite = async (slug: string) => {
      calls++;
      if (calls === 1) return null; // the sale check passed
      return blankRow({ original_transaction_id: 'stripe:sub_rival', source: 'stripe', site_slug: slug, domain: 'rival.com', state: 'live' });
    };
    void real;
    const r = await w.buy();
    expect(r).toMatchObject({ status: 409, body: { refunded: true } });
    expect(w.cancelAndRefund).toHaveBeenCalledWith('sub_oneclick1');
    expect(w.notifySupport).toHaveBeenCalledTimes(1);
    expect(w.repo.rows.get('stripe:sub_oneclick1')).toMatchObject({ state: 'failed', failure_reason: 'site-has-domain' });
    expect(w.repo.rows.get('stripe:sub_oneclick1')!.refunded_at).not.toBeNull();
    expect(w.reg.api.buy).not.toHaveBeenCalled();
  });

  it('the webhook wins the race (its created event reserved the row first): the same row resumes, one registrar buy', async () => {
    const w = world();
    w.st.state.onCreated = async (sub) => { await w.event('customer.subscription.created', sub); };
    const r = await w.buy();
    expect([200, 202]).toContain(r.status);
    expect(w.rows()).toHaveLength(1);
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
    expect(w.repo.rows.get('stripe:sub_oneclick1')?.state).toBe('live');
  });

  it('a paid, verified subscription of this site with no row (died after Stripe took the money) is claimed, not charged again', async () => {
    const w = world();
    const f = { customer: 'cus_plan0001', ...Object.fromEntries(Object.entries({ type: 'domain_purchase', app: DOMAIN_SESSION_APP, domain: 'other.com', siteId: 'fresh-cuts', sig: domainSig(SECRET, 'other.com', 'fresh-cuts') }).map(([k, v]) => [`metadata[${k}]`, v])), 'items[0][price]': PRICE };
    await w.st.fn('POST', '/v1/subscriptions', { form: f as any, idem: 'seed' });
    w.st.calls.length = 0;
    const r = await w.buy(); // asks for freshcuts.com; the orphan (other.com) is what was paid for
    expect([200, 202]).toContain(r.status);
    expect(w.st.posts()).toHaveLength(0);
    expect(w.repo.rows.get('stripe:sub_oneclick1')).toMatchObject({ domain: 'other.com', state: 'live' });
    // another site's subscription on the same customer is never taken
    const w2 = world();
    const g = { ...f, 'metadata[siteId]': 'someone-else', 'metadata[sig]': domainSig(SECRET, 'other.com', 'someone-else') };
    await w2.st.fn('POST', '/v1/subscriptions', { form: g as any, idem: 'seed' });
    w2.st.calls.length = 0;
    await w2.buy();
    expect(w2.st.posts()).toHaveLength(1);
  });

  it('paid but not a valid domain subscription (wrong price id): refunded in full, support told, no row, no registrar call', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = world({ priceId: 'price_wrong' });
    const r = await w.buy();
    expect(r).toMatchObject({ status: 409, body: { refunded: true } });
    expect(w.cancelAndRefund).toHaveBeenCalledWith('sub_oneclick1');
    expect(w.notifySupport).toHaveBeenCalledTimes(1);
    expect(w.rows()).toHaveLength(0);
    expect(w.reg.api.buy).not.toHaveBeenCalled();
  });

  it('that refund failing: 503 and a support email (a human refunds it), never a silent success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = world({ priceId: 'price_wrong' });
    w.cancelAndRefund.mockRejectedValueOnce(new Error('stripe down'));
    expect((await w.buy()).status).toBe(503);
    expect(w.notifySupport.mock.calls[0][0]).toMatch(/refund needed/);
  });
});

describe('card on file', () => {
  const cardOf = (w: ReturnType<typeof world>) => w.card();
  it('the owner sees the card the buy would charge (brand, last4, expiry); the plan subscription card first', async () => {
    const w = world();
    expect(await cardOf(w)).toEqual({ status: 200, body: { oneClick: true, card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2099 } } });
    expect(w.st.calls[0].path).toBe('/v1/subscriptions/sub_plan0001');
  });
  it('no card: oneClick false; an iOS site and a stranger are refused; Stripe outage is 503', async () => {
    const w = world();
    w.st.state.card = null;
    expect((await w.card()).body).toEqual({ oneClick: false, card: null });
    expect((await w.card('Bearer ios')).status).toBe(403);
    expect((await w.card('Bearer nobody')).status).toBe(403);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const down = world({ deps: { stripe: (async () => ({ ok: false, status: 503, data: {} })) as StripeFn } });
    expect((await down.card()).status).toBe(503);
  });
  it('falls back to the customer default, then the newest card, and ignores malformed ids', async () => {
    const calls: string[] = [];
    const pm = { id: 'pm_new00001', type: 'card', customer: 'cus_a1b2c3', card: { brand: 'amex', last4: '0005', exp_month: 1, exp_year: 2099 } };
    const stripe: StripeFn = async (_m, path) => {
      calls.push(path);
      if (path.startsWith('/v1/customers/')) return { ok: true, status: 200, data: { invoice_settings: { default_payment_method: '../evil' } } };
      if (path.startsWith('/v1/payment_methods?')) return { ok: true, status: 200, data: { data: [{ id: 'bad id', type: 'card' }, pm] } };
      return { ok: false, status: 404, data: {} };
    };
    const c = await cardOnFile({ customer: 'cus_a1b2c3', subscriptionId: null }, stripe, T0);
    expect(c).toMatchObject({ id: 'pm_new00001', brand: 'amex' });
    expect(calls.some((p) => p.includes('evil'))).toBe(false);
    expect(await cardOnFile({ customer: 'not-a-customer', subscriptionId: null }, stripe, T0)).toBeNull();
  });
});

describe('hosted Checkout stays the fallback (customer + return page are web-only)', () => {
  const setup = (over: any = {}) => {
    const w = world();
    const createStripeSession = vi.fn(async (_p: URLSearchParams) => ({ ok: true, status: 200, data: { url: 'https://checkout.stripe.com/x' } }));
    return { w, createStripeSession, deps: { authorize, flow: w.flow, secret: SECRET, createStripeSession, ...over } };
  };
  const web = { returnBase: 'https://www.primebarber.org', customerOf: vi.fn(async () => 'cus_plan0001') };

  it('without the web option the form is the old site\'s, byte for byte (no customer, root return urls)', async () => {
    const { deps, createStripeSession } = setup();
    await createDomainCheckout({ domain: 'freshcuts.com', siteId: 'fresh-cuts' }, 'https://www.aibarber.org', OWNER, deps);
    const sig = domainSig(SECRET, 'freshcuts.com', 'fresh-cuts');
    const want = new URLSearchParams();
    want.append('mode', 'subscription');
    want.append('success_url', 'https://www.aibarber.org?domain_payment=success&session_id={CHECKOUT_SESSION_ID}');
    want.append('cancel_url', 'https://www.aibarber.org?domain_payment=cancelled');
    want.append('line_items[0][price_data][currency]', 'usd');
    want.append('line_items[0][price_data][unit_amount]', '3900');
    want.append('line_items[0][price_data][recurring][interval]', 'year');
    want.append('line_items[0][price_data][product_data][name]', 'Custom domain - freshcuts.com');
    want.append('line_items[0][quantity]', '1');
    for (const p of ['metadata', 'subscription_data[metadata]']) {
      want.append(`${p}[type]`, 'domain_purchase'); want.append(`${p}[app]`, DOMAIN_SESSION_APP); want.append(`${p}[domain]`, 'freshcuts.com');
      want.append(`${p}[siteId]`, 'fresh-cuts'); want.append(`${p}[sig]`, sig);
    }
    expect(createStripeSession.mock.calls[0][0].toString()).toBe(want.toString());
    // the web option alone (a request without app: 'web') changes nothing either
    const { deps: d2, createStripeSession: c2 } = setup();
    await createDomainCheckout({ domain: 'freshcuts.com', siteId: 'fresh-cuts' }, 'https://www.aibarber.org', OWNER, d2, web);
    expect(c2.mock.calls[0][0].toString()).toBe(want.toString());
    expect(web.customerOf).not.toHaveBeenCalled();
  });

  it("app: 'web': the plan's customer on the session and the web app's return page; the rest of the form is unchanged", async () => {
    const { deps, createStripeSession } = setup();
    const legacy = setup();
    await createDomainCheckout({ domain: 'freshcuts.com', siteId: 'fresh-cuts', app: 'web' }, 'https://x.example', OWNER, deps, web);
    await createDomainCheckout({ domain: 'freshcuts.com', siteId: 'fresh-cuts' }, 'https://x.example', OWNER, legacy.deps);
    const p = createStripeSession.mock.calls[0][0];
    expect(p.get('customer')).toBe('cus_plan0001');
    expect(p.get('success_url')).toBe('https://www.primebarber.org/app/domain?domain_payment=success&session_id={CHECKOUT_SESSION_ID}');
    expect(p.get('cancel_url')).toBe('https://www.primebarber.org/app/domain?domain_payment=cancelled');
    expect(web.customerOf).toHaveBeenCalledWith('u1');
    const strip = (x: URLSearchParams) => [...x.entries()].filter(([k]) => !['customer', 'success_url', 'cancel_url'].includes(k));
    expect(strip(p)).toEqual(strip(legacy.createStripeSession.mock.calls[0][0]));
  });

  it("app: 'web' by an iOS site owner: 403 app-site, no session; a customer lookup failure just means Checkout asks for the card", async () => {
    const a = setup();
    expect(await createDomainCheckout({ domain: 'freshcuts.com', siteId: 'fresh-cuts', app: 'web' }, 'https://x', 'Bearer ios', a.deps, web)).toMatchObject({ status: 403, body: { error: 'app-site' } });
    expect(a.createStripeSession).not.toHaveBeenCalled();
    const b = setup();
    const r = await createDomainCheckout({ domain: 'freshcuts.com', siteId: 'fresh-cuts', app: 'web' }, 'https://x', OWNER, b.deps, { ...web, customerOf: async () => { throw new Error('db'); } });
    expect(r.status).toBe(200);
    expect(b.createStripeSession.mock.calls[0][0].has('customer')).toBe(false);
  });

  it("a customer unknown to the domain Stripe account (resource_missing) retries once without it", async () => {
    const w = world();
    const seen: boolean[] = [];
    const answers = [{ ok: false, status: 400, data: { error: { code: 'resource_missing' } } }, { ok: true, status: 200, data: { url: 'https://checkout.stripe.com/y' } }];
    const create = vi.fn(async (p: URLSearchParams) => { seen.push(p.has('customer')); return answers.shift()!; });
    const r = await createDomainCheckout({ domain: 'freshcuts.com', siteId: 'fresh-cuts', app: 'web' }, 'https://x', OWNER, { authorize, flow: w.flow, secret: SECRET, createStripeSession: create }, { returnBase: 'https://www.primebarber.org', customerOf: async () => 'cus_plan0001' });
    expect(r).toMatchObject({ status: 200, body: { url: 'https://checkout.stripe.com/y' } });
    expect(seen).toEqual([true, false]);
  });
});

describe('Stripe webhook: one-click sale report and the staging list', () => {
  const makeSub = async (w: ReturnType<typeof world>, md: Record<string, string> = {}) => {
    await w.buy();
    const sub = structuredClone(w.st.subs.get('sub_oneclick1'));
    sub.metadata = { ...sub.metadata, ...md };
    return sub;
  };
  it('customer.subscription.created of a one-click subscription reports ONE purchase, keyed on the subscription (amount $39)', async () => {
    const w = world();
    const sub = await makeSub(w);
    const r = await w.event('customer.subscription.created', sub);
    expect(r).toMatchObject({ handled: true, status: 200, purchase: true, purchaseObject: { id: 'sub_oneclick1', amount_total: 3900, currency: 'usd' } });
  });
  it('not for a Checkout-made subscription (its session is the sale), not for later events, not when unverifiable', async () => {
    const w = world();
    const sub = await makeSub(w);
    delete w.st.subs.get('sub_oneclick1').metadata.oneclick; // a Checkout-made subscription has no oneclick mark (the event re-reads Stripe)
    expect((await w.event('customer.subscription.created', sub)).purchase).toBeFalsy();
    expect((await w.event('customer.subscription.updated', sub)).purchase).toBeFalsy();
    expect((await w.event('invoice.paid', { subscription: 'sub_oneclick1', subscription_details: { metadata: sub.metadata } })).purchase).toBeFalsy();
    const forged = world();
    const f = await makeSub(forged);
    f.metadata.sig = '0'.repeat(64);
    forged.repo.rows.clear();
    forged.st.subs.set('sub_oneclick1', f);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await forged.event('customer.subscription.created', f)).purchase).toBeFalsy();
  });
  it('domainTestRealSites honours DOMAINS_TEST_REAL_SITES only with DOMAINS_BUY_DISABLED=1 and never in production', () => {
    const base = { DOMAINS_TEST_REAL_SITES: 'site-a, site-b', STRIPE_SECRET_KEY: 'sk_test_x' };
    expect(domainTestRealSites(base).size).toBe(0);
    expect([...domainTestRealSites({ ...base, DOMAINS_BUY_DISABLED: '1', VERCEL_ENV: 'preview' })]).toEqual(['site-a', 'site-b']);
    expect(domainTestRealSites({ ...base, DOMAINS_BUY_DISABLED: '1', VERCEL_ENV: 'production' }).size).toBe(0);
    // B1: a LIVE Stripe key (or none) never opens the staging list, even with the buy gate on
    expect(domainTestRealSites({ ...base, DOMAINS_BUY_DISABLED: '1', VERCEL_ENV: 'preview', STRIPE_SECRET_KEY: 'sk_live_x' }).size).toBe(0);
    expect(domainTestRealSites({ DOMAINS_TEST_REAL_SITES: 'site-a', DOMAINS_BUY_DISABLED: '1', VERCEL_ENV: 'preview' }).size).toBe(0);
  });
});


describe('review B fixes', () => {
  it('S1: a concurrent double tap (Stripe 409 idempotency_error), a 429 and a connection error are NOT card failures: 503, no fallback offered', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const [status, err] of [[409, { type: 'idempotency_error', code: 'idempotency_key_in_use' }], [429, { type: 'rate_limit_error', code: 'rate_limit' }], [400, { type: 'invalid_request_error', code: 'parameter_invalid' }]] as const) {
      const w = world();
      const base = w.deps.stripe;
      w.deps.stripe = async (m, p, o) => (m === 'POST' && p === '/v1/subscriptions' ? { ok: false, status, data: { error: err } } : base(m, p, o));
      const r = await w.buy();
      expect(r.status).toBe(503);
      expect(r.body).not.toHaveProperty('fallback');
      expect(w.rows()).toHaveLength(0);
    }
  });

  it('S5: a stranger with a plan cannot one-click a slug that is not their own web_app_sites row (no Stripe call at all)', async () => {
    const w = world({ deps: { ownsWebSite: vi.fn(async () => false) } });
    const r = await w.buy();
    expect(r.status).toBe(403);
    expect(w.st.calls).toHaveLength(0);
    expect(w.repo.rows.size).toBe(0);
    // an outage of the ownership lookup refuses too, without charging
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const o = world({ deps: { ownsWebSite: vi.fn(async () => { throw new Error('db down'); }) } });
    expect((await o.buy()).status).toBe(503);
    expect(o.st.calls).toHaveLength(0);
  });

  it('N1: an orphan claim for a different domain than the one typed says so (claimedOther)', async () => {
    const w = world();
    const first = await w.buy({ domain: 'freshcuts.com', siteId: 'fresh-cuts' });
    expect(first.status).toBeLessThan(300);
    // a paid subscription of this site for ANOTHER domain, with no row: the next call claims it
    const sub = structuredClone(w.st.subs.get('sub_oneclick1'));
    sub.id = 'sub_orphan0001';
    sub.metadata = { ...sub.metadata, domain: 'othername.com', sig: domainSig(SECRET, 'othername.com', 'fresh-cuts') };
    w.st.subs.set(sub.id, sub);
    w.st.subs.get('sub_oneclick1').status = 'canceled';
    w.repo.rows.clear();
    const r = await w.buy({ domain: 'freshcuts2.com', siteId: 'fresh-cuts' });
    expect(w.st.posts()).toHaveLength(1); // no second charge
    expect(r.body).toMatchObject({ claimedOther: true });
  });
});
