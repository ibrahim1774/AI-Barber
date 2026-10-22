import { describe, it, expect, vi } from 'vitest';
import {
  DOMAIN_SESSION_APP, WEB_DOMAIN_PRICE_CENTS, createDomainCheckout, domainSig, handleDomainStripeEvent, purchaseDomain,
  readDomainMetadata, stripePayerStatus, verifyDomainSubscription,
} from '../lib/webDomains.js';
import { sweepDomains, type DomainFlowDeps } from '../lib/ios/domainFlow.js';
import { makePayer } from '../lib/ios/domainLive.js';
import { safeAttributionKey } from '../lib/stripeMetadata.js';
import { firstPartyOrigin } from '../lib/webCors.js';
import { fakeRegistrar } from './ios/fakeRegistrar.js';
import { fakeDomainsRepo } from './ios/fakeDomainsRepo.js';

const T0 = 1_800_000_000_000;
const DAY = 24 * 3600_000;
const SECRET = 'test-domain-secret';
const CONTACT = { firstName: 'A', lastName: 'B', email: 'a@b.co', phone: '+15555550100', address1: '1', city: 'c', state: 's', zip: 'z', country: 'US' };
const OWNER_AUTH = 'Bearer owner';
const SID = 'cs_live_abcdefghij';

/** Fake authorizeSiteOwner: 'Bearer owner' owns fresh-cuts only; 'Bearer down' is an outage. */
const authorize = vi.fn(async (siteId: unknown, authorization: unknown) => {
  if (authorization === 'Bearer down') return { ok: false, status: 503 as const, error: 'temporarily-unavailable' };
  if (!authorization) return { ok: false, status: 401 as const, error: 'sign-in-required' };
  const slug = String(siteId ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return authorization === OWNER_AUTH && slug === 'fresh-cuts'
    ? { ok: true, target: 'fresh-cuts', actor: 'web-user' as const }
    : { ok: false, status: 403 as const, error: 'not-authorized' };
});

const signedMd = (domain = 'freshcuts.com', slug = 'fresh-cuts', over: any = {}) =>
  ({ type: 'domain_purchase', app: DOMAIN_SESSION_APP, domain, siteId: slug, sig: domainSig(SECRET, domain, slug), ...over });

function world() {
  let now = T0;
  const clock = () => now;
  const reg = fakeRegistrar({ now: clock });
  const repo = fakeDomainsRepo([], clock);
  const subs: Record<string, any> = {
    sub_dom1: {
      id: 'sub_dom1', status: 'active', cancel_at_period_end: false, cancel_at: null, current_period_end: (T0 + 365 * DAY) / 1000,
      metadata: signedMd(), items: { data: [{ quantity: 1, price: { id: 'price_x', currency: 'usd', unit_amount: 3900, recurring: { interval: 'year', interval_count: 1 } } }] },
    },
  };
  const getSubscription = vi.fn(async (id: string) => (subs[id] ? structuredClone(subs[id]) : null));
  const hooks = { onDomainLinked: vi.fn(async () => {}), onDomainUnlinked: vi.fn(async () => {}) };
  const flow: DomainFlowDeps = {
    repo, vercel: reg.api, contact: CONTACT,
    verifyDomain: vi.fn(async () => { throw new Error('no Apple here'); }),
    verifySite: vi.fn(async () => { throw new Error('no Apple here'); }),
    payer: makePayer(async () => { throw new Error('no Apple here'); }, getSubscription, clock),
    sitePurchase: async () => null,
    hooks, now: clock,
  };
  const session = (over: any = {}) => ({
    id: SID, mode: 'subscription', status: 'complete', payment_status: 'paid', currency: 'usd', amount_total: 3900,
    subscription: 'sub_dom1', metadata: signedMd(), ...over,
  });
  let sessionData: any = session();
  const deps = {
    authorize,
    getStripeSession: vi.fn(async () => ({ ok: true, status: 200, data: sessionData })),
    getSubscription, flow, secret: SECRET, testMode: false,
  };
  return {
    reg, repo, subs, deps, flow, hooks,
    setSession: (over: any) => { sessionData = session(over); },
    tick: (ms: number) => { now += ms; },
    sweep: () => sweepDomains(flow, { deadline: clock() + 60_000 }),
    event: (type: string, object: any) => handleDomainStripeEvent({ type, data: { object } }, () => deps),
  };
}

describe('create-domain-checkout: $39/year subscription, owner only, signed server-side', () => {
  const setup = () => {
    const w = world();
    const createStripeSession = vi.fn(async (_p: URLSearchParams) => ({ ok: true, status: 200, data: { url: 'https://checkout.stripe.com/x' } }));
    return { ...w, createStripeSession, cdeps: { authorize, flow: w.flow, secret: SECRET, createStripeSession } };
  };

  it('mode=subscription, $39.00 USD yearly, metadata signed on the session AND the subscription; client price/project ignored', async () => {
    const { cdeps, createStripeSession } = setup();
    const r = await createDomainCheckout({ domain: 'FreshCuts.com', siteId: 'Fresh Cuts', vercelPrice: 0.01, projectName: 'victim' }, 'https://www.aibarber.org', OWNER_AUTH, cdeps);
    expect(r).toEqual({ status: 200, body: { url: 'https://checkout.stripe.com/x' } });
    const p = createStripeSession.mock.calls[0][0];
    expect(p.get('mode')).toBe('subscription');
    expect(p.get('line_items[0][price_data][unit_amount]')).toBe('3900');
    expect(p.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(p.get('line_items[0][price_data][recurring][interval]')).toBe('year');
    for (const prefix of ['metadata', 'subscription_data[metadata]']) {
      expect(p.get(`${prefix}[type]`)).toBe('domain_purchase');
      expect(p.get(`${prefix}[app]`)).toBe('aibarber-domain');
      expect(p.get(`${prefix}[domain]`)).toBe('freshcuts.com');
      expect(p.get(`${prefix}[siteId]`)).toBe('fresh-cuts');
      expect(p.get(`${prefix}[sig]`)).toBe(domainSig(SECRET, 'freshcuts.com', 'fresh-cuts'));
    }
    expect(p.get('success_url')).toMatch(/^https:\/\/www\.aibarber\.org\?domain_payment=success/);
  });

  it('a configured Stripe price id is used instead of price_data', async () => {
    const { cdeps, createStripeSession } = setup();
    await createDomainCheckout({ domain: 'freshcuts.com', siteId: 'fresh-cuts' }, 'o', OWNER_AUTH, { ...cdeps, priceId: 'price_dom' });
    const p = createStripeSession.mock.calls[0][0];
    expect(p.get('line_items[0][price]')).toBe('price_dom');
    expect(p.has('line_items[0][price_data][unit_amount]')).toBe(false);
  });

  it('owner only (401/403/503) before any lookup; a site that already has a domain, a taken name → 409', async () => {
    const { cdeps, createStripeSession, reg, repo } = setup();
    const body = { domain: 'freshcuts.com', siteId: 'fresh-cuts' };
    expect((await createDomainCheckout(body, 'o', undefined, cdeps)).status).toBe(401);
    expect((await createDomainCheckout(body, 'o', 'Bearer stranger', cdeps)).status).toBe(403);
    expect((await createDomainCheckout({ ...body, siteId: 'other-shop' }, 'o', OWNER_AUTH, cdeps)).status).toBe(403);
    expect((await createDomainCheckout(body, 'o', 'Bearer down', cdeps)).status).toBe(503);
    expect(reg.api.availability).not.toHaveBeenCalled();
    reg.takeByStranger('freshcuts.com');
    expect((await createDomainCheckout(body, 'o', OWNER_AUTH, cdeps)).status).toBe(409);
    await repo.insertReserved({ original_transaction_id: 'x', source: 'apple', environment: 'Production', site_slug: 'fresh-cuts', domain: 'other.com', simulated: false, auto_renew: false });
    expect(await createDomainCheckout({ ...body, domain: 'free.com' }, 'o', OWNER_AUTH, cdeps)).toMatchObject({ status: 409, body: { error: 'This site already has a custom domain' } });
    expect(createStripeSession).not.toHaveBeenCalled();
  });

  it.each([[{ siteId: 's' }], [{ domain: 'x.com' }], [{ domain: 'not a domain', siteId: 's' }], [{ domain: 'fresh.net', siteId: 's' }]])('bad input %j → 400', async (body) => {
    expect((await createDomainCheckout(body, 'o', OWNER_AUTH, setup().cdeps)).status).toBe(400);
  });
});

describe('signed metadata and the domain price', () => {
  it('a forged or tampered signature never reads as a domain purchase', () => {
    expect(readDomainMetadata(signedMd(), SECRET)).toEqual({ domain: 'freshcuts.com', slug: 'fresh-cuts' });
    expect(readDomainMetadata({ ...signedMd(), domain: 'other.com' }, SECRET)).toBeNull();
    expect(readDomainMetadata({ ...signedMd(), siteId: 'victim' }, SECRET)).toBeNull();
    expect(readDomainMetadata({ ...signedMd(), app: 'aibarber' }, SECRET)).toBeNull();
    expect(readDomainMetadata({ type: 'domain_purchase', app: DOMAIN_SESSION_APP, domain: 'freshcuts.com', siteId: 'fresh-cuts' }, SECRET)).toBeNull();
    expect(readDomainMetadata(signedMd(), 'other-secret')).toBeNull();
    expect(readDomainMetadata(signedMd(), '')).toBeNull();
  });

  it('only one item at $39.00 USD yearly (or the configured price) is a domain subscription', () => {
    const { subs } = world();
    const sub = subs.sub_dom1;
    expect(verifyDomainSubscription(sub, SECRET)).toEqual({ domain: 'freshcuts.com', slug: 'fresh-cuts', subscriptionId: 'sub_dom1' });
    const price = (p: any) => ({ ...sub, items: { data: [{ quantity: 1, price: { ...sub.items.data[0].price, ...p } }] } });
    expect(verifyDomainSubscription(price({ unit_amount: 2000 }), SECRET)).toBeNull();
    expect(verifyDomainSubscription(price({ currency: 'eur' }), SECRET)).toBeNull();
    expect(verifyDomainSubscription(price({ recurring: { interval: 'month' } }), SECRET)).toBeNull();
    expect(verifyDomainSubscription({ ...sub, items: { data: [sub.items.data[0], sub.items.data[0]] } }, SECRET)).toBeNull();
    expect(verifyDomainSubscription(sub, SECRET, 'price_x')).not.toBeNull();
    expect(verifyDomainSubscription(sub, SECRET, 'price_other')).toBeNull();
  });

  it("the Stripe subscription's current state", () => {
    const base = { status: 'active', cancel_at_period_end: false, cancel_at: null, current_period_end: 2000 };
    expect(stripePayerStatus(base, 0)).toEqual({ active: true, autoRenew: true, expiresAt: 2_000_000, revoked: false });
    expect(stripePayerStatus({ ...base, cancel_at_period_end: true }, 0)).toMatchObject({ active: true, autoRenew: false });
    expect(stripePayerStatus({ ...base, status: 'past_due' }, 0)).toMatchObject({ active: false, autoRenew: false });
    expect(stripePayerStatus({ ...base, status: 'canceled', ended_at: 100, current_period_end: 100_000 }, 0)).toMatchObject({ active: false, revoked: true });
    expect(stripePayerStatus({ ...base, status: 'canceled', ended_at: 100_000, current_period_end: 100_000 }, 0)).toMatchObject({ revoked: false });
    // newer Stripe API: the period on the item
    expect(stripePayerStatus({ status: 'active', items: { data: [{ current_period_end: 3000 }] } }, 0)).toMatchObject({ expiresAt: 3_000_000 });
  });
});

describe('purchase-domain: owner of the session site, strict session checks, idempotent', () => {
  it('claims the slot: buys with auto-renew OFF, then on (Stripe renews), attaches; replay never buys again', async () => {
    const w = world();
    const r = await purchaseDomain({ sessionId: SID }, OWNER_AUTH, w.deps);
    expect(r).toMatchObject({ status: 200, body: { domain: 'freshcuts.com', state: 'live' } });
    expect((w.reg.api.buy as any).mock.calls[0][1]).toMatchObject({ autoRenew: false, expectedPrice: 11.25 });
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(true);
    expect(w.repo.rows.get('stripe:sub_dom1')).toMatchObject({ source: 'stripe', site_slug: 'fresh-cuts', state: 'live' });
    expect((await purchaseDomain({ sessionId: SID }, OWNER_AUTH, w.deps)).status).toBe(200);
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('ownership is checked BEFORE anything about the session is revealed', async () => {
    const w = world();
    w.setSession({ payment_status: 'unpaid' });
    expect(await purchaseDomain({ sessionId: SID }, 'Bearer stranger', w.deps)).toEqual({ status: 403, body: { error: 'not-authorized' } });
    expect(await purchaseDomain({ sessionId: SID }, undefined, w.deps)).toEqual({ status: 401, body: { error: 'sign-in-required' } });
    expect((await purchaseDomain({ sessionId: SID }, 'Bearer down', w.deps)).status).toBe(503);
    expect(w.deps.getSubscription).not.toHaveBeenCalled();
  });

  it.each([
    ['a payment-mode session', { mode: 'payment' }],
    ['a session without a mode', { mode: undefined }],
    ['unpaid', { payment_status: 'unpaid' }],
    ['not complete', { status: 'open' }],
    ['a different amount', { amount_total: 3800 }],
    ['another currency', { currency: 'eur' }],
    ['unsigned metadata (e.g. cookie-injected)', { metadata: { type: 'domain_purchase', app: DOMAIN_SESSION_APP, domain: 'freshcuts.com', siteId: 'fresh-cuts' } }],
    ['a site subscription session', { metadata: { app: 'aibarber', siteId: 'fresh-cuts', plan: 'monthly' } }],
  ])('%s → 400, nothing bought', async (_n, over) => {
    const w = world();
    w.setSession(over);
    expect((await purchaseDomain({ sessionId: SID }, OWNER_AUTH, w.deps)).status).toBe(400);
    expect(w.reg.api.buy).not.toHaveBeenCalled();
  });

  it('the subscription itself must be the domain subscription for that site and domain', async () => {
    const w = world();
    w.subs.sub_dom1.items.data[0].price.unit_amount = 500;
    expect((await purchaseDomain({ sessionId: SID }, OWNER_AUTH, w.deps)).status).toBe(400);
    expect(w.reg.api.buy).not.toHaveBeenCalled();
  });

  it('a domain named by the caller must be the session domain; a bad session id → 400 before Stripe', async () => {
    const w = world();
    expect((await purchaseDomain({ sessionId: SID, domain: 'other.com' }, OWNER_AUTH, w.deps)).status).toBe(400);
    expect((await purchaseDomain({ sessionId: '../x' }, OWNER_AUTH, w.deps)).status).toBe(400);
    expect(w.reg.api.buy).not.toHaveBeenCalled();
  });

  it('Stripe test mode is simulated: nothing is bought', async () => {
    const w = world();
    expect(await purchaseDomain({ sessionId: SID }, OWNER_AUTH, { ...w.deps, testMode: true })).toMatchObject({ status: 200, body: { sandbox: true } });
    expect(w.reg.api.buy).not.toHaveBeenCalled();
  });
});

describe('Stripe webhook: the same lifecycle as the app', () => {
  it('checkout.session.completed reserves the slot at once (a closed tab still gets the domain) and buys in the background', async () => {
    const w = world();
    const r = await w.event('checkout.session.completed', { id: SID, subscription: 'sub_dom1', metadata: signedMd() });
    expect(r).toMatchObject({ handled: true, status: 200 });
    expect(w.repo.rows.get('stripe:sub_dom1')!.state).toBe('reserved');
    await r.background!();
    expect(w.repo.rows.get('stripe:sub_dom1')!.state).toBe('live');
    // the browser's return afterwards is idempotent
    expect((await purchaseDomain({ sessionId: SID }, OWNER_AUTH, w.deps)).status).toBe(200);
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('cancel (cancel_at_period_end) → Vercel auto-renew off; works until the period ends, then detached; resubscribe re-attaches', async () => {
    const w = world();
    await purchaseDomain({ sessionId: SID }, OWNER_AUTH, w.deps);
    w.subs.sub_dom1.cancel_at_period_end = true;
    await w.event('customer.subscription.updated', { id: 'sub_dom1', metadata: signedMd() });
    await w.sweep();
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(false);
    expect(w.repo.rows.get('stripe:sub_dom1')!.state).toBe('live');
    w.tick(366 * DAY);
    w.subs.sub_dom1.status = 'canceled';
    w.subs.sub_dom1.ended_at = (T0 + 365 * DAY) / 1000;
    await w.event('customer.subscription.deleted', { id: 'sub_dom1', metadata: signedMd() });
    await w.sweep();
    expect(w.repo.rows.get('stripe:sub_dom1')!.state).toBe('detached');
    // A NEW subscription is a new slot; resubscribing the same subscription (reactivated) re-attaches
    // while the registration is ours. Here: reactivated before the registration ran out.
    w.reg.registered.get('freshcuts.com')!.expiresAt = w.flow.now() + 30 * DAY;
    w.subs.sub_dom1 = { ...w.subs.sub_dom1, status: 'active', cancel_at_period_end: false, ended_at: null, current_period_end: (w.flow.now() + 365 * DAY) / 1000 };
    await w.event('invoice.paid', { subscription: 'sub_dom1', subscription_details: { metadata: signedMd() } });
    await w.sweep();
    expect(w.repo.rows.get('stripe:sub_dom1')!.state).toBe('live');
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(true);
  });

  it('events are applied from the subscription re-read from Stripe, never the event payload', async () => {
    const w = world();
    await purchaseDomain({ sessionId: SID }, OWNER_AUTH, w.deps);
    w.subs.sub_dom1.cancel_at_period_end = true;
    // a late, older "renewing" event arrives after the cancel
    await w.event('customer.subscription.updated', { id: 'sub_dom1', cancel_at_period_end: false, metadata: signedMd() });
    expect(w.repo.rows.get('stripe:sub_dom1')!.auto_renew).toBe(false);
  });

  it('non-domain events are untouched (no lookups); a forged domain subscription is ignored', async () => {
    const w = world();
    const getDeps = vi.fn(() => w.deps);
    for (const [type, obj] of [
      ['checkout.session.completed', { metadata: { app: 'aibarber', siteId: 'x' } }],
      ['customer.subscription.updated', { id: 'sub_site', metadata: { app: 'aibarber' } }],
      ['invoice.paid', { subscription: 'sub_site', subscription_details: { metadata: { app: 'aibarber' } } }],
      ['payment_intent.succeeded', {}],
    ] as const) {
      expect(await handleDomainStripeEvent({ type, data: { object: obj } }, getDeps)).toEqual({ handled: false });
    }
    expect(getDeps).not.toHaveBeenCalled();
    w.subs.sub_forged = { ...w.subs.sub_dom1, id: 'sub_forged', metadata: { type: 'domain_purchase', app: DOMAIN_SESSION_APP, domain: 'x.com', siteId: 'victim', sig: '0'.repeat(64) } };
    expect(await w.event('customer.subscription.updated', { id: 'sub_forged', metadata: { type: 'domain_purchase' } }))
      .toMatchObject({ handled: true, status: 200, body: { ignored: 'not-a-domain-subscription' } });
    expect(w.repo.rows.size).toBe(0);
  });

  it('a Stripe outage → 500 so Stripe retries', async () => {
    const w = world();
    w.deps.getSubscription.mockRejectedValueOnce(new Error('stripe down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await w.event('customer.subscription.updated', { id: 'sub_dom1', metadata: signedMd() })).toMatchObject({ handled: true, status: 500 });
  });
});

describe('cookie attribution never shadows server metadata keys', () => {
  it.each(['type', 'TYPE', 'app', 'domain', 'siteId', 'projectName', 'vercelPrice', 'sig', 'plan'])('%s refused', (k) => {
    expect(safeAttributionKey(k)).toBe(false);
  });
  it('ordinary attribution keys pass; keys already set by the server are refused', () => {
    expect(safeAttributionKey('utm_source')).toBe(true);
    expect(safeAttributionKey('tw_adid')).toBe(true);
    expect(safeAttributionKey('utm_source', (k) => k === 'utm_source')).toBe(false);
    expect(safeAttributionKey('bad-key!')).toBe(false);
  });
});

describe('first-party CORS', () => {
  it('only aibarber.org origins in production (localhost only outside production)', () => {
    expect(firstPartyOrigin('https://www.aibarber.org', 'production')).toBe('https://www.aibarber.org');
    expect(firstPartyOrigin('https://evil.example', 'production')).toBeNull();
    expect(firstPartyOrigin('http://localhost:3000', 'production')).toBeNull();
    expect(firstPartyOrigin('http://localhost:3000', 'preview')).toBe('http://localhost:3000');
  });
});

it('the domain price is $39.00', () => expect(WEB_DOMAIN_PRICE_CENTS).toBe(3900));
