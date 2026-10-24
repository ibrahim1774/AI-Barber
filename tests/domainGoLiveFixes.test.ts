// Go-live review fixes (2026-10-24): B1 (no silent billing after a failed or stalled web
// purchase), B2 (fail closed before taking money), M1 (site_owners in authorizeSiteOwner),
// M2 (a paid checkout that fails verification is refunded and reported).
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DOMAIN_SESSION_APP, createDomainCheckout, domainSig, handleDomainStripeEvent, purchaseDomain,
} from '../lib/webDomains.js';
import { STALL_ALERT_MS, runDomainSearch, sweepDomains, type DomainFlowDeps } from '../lib/ios/domainFlow.js';
import { makePayer } from '../lib/ios/domainLive.js';
import { diagnoseRegistrantContact, registrantContact } from '../lib/ios/vercelDomains.js';
import { authorizeSiteOwner } from '../lib/deployAuth.js';
import type { SiteOwnerRow, SiteOwnerStore } from '../lib/siteOwners.js';
import { fakeRegistrar } from './ios/fakeRegistrar.js';
import { fakeDomainsRepo, blankRow } from './ios/fakeDomainsRepo.js';

const T0 = 1_800_000_000_000;
const DAY = 24 * 3600_000;
const SECRET = 'test-domain-secret';
const CONTACT = { firstName: 'A', lastName: 'B', email: 'a@b.co', phone: '+15555550100', address1: '1 Secret Street', city: 'c', state: 's', zip: 'z', country: 'US' };
const OWNER_AUTH = 'Bearer owner';
const SID = 'cs_live_abcdefghij';

afterEach(() => vi.restoreAllMocks());
const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

const authorize = vi.fn(async (siteId: unknown, authorization: unknown) =>
  authorization === OWNER_AUTH && String(siteId) === 'fresh-cuts'
    ? { ok: true, target: 'fresh-cuts', actor: 'web-user' as const }
    : { ok: false, status: 403 as const, error: 'not-authorized' });

const signedMd = (domain = 'freshcuts.com', slug = 'fresh-cuts', over: any = {}) =>
  ({ type: 'domain_purchase', app: DOMAIN_SESSION_APP, domain, siteId: slug, sig: domainSig(SECRET, domain, slug), ...over });

function world(opts: { contact?: any } = {}) {
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
  const cancelAndRefund = vi.fn(async (_id: string) => {});
  const notifySupport = vi.fn(async (_s: string, _t: string) => {});
  const flow: DomainFlowDeps = {
    repo, vercel: reg.api, contact: 'contact' in opts ? opts.contact : CONTACT,
    verifyDomain: vi.fn(async () => { throw new Error('no Apple here'); }),
    verifySite: vi.fn(async () => { throw new Error('no Apple here'); }),
    payer: makePayer(async () => { throw new Error('no Apple here'); }, getSubscription, clock),
    sitePurchase: async () => null,
    hooks: { onDomainLinked: vi.fn(async () => {}), onDomainUnlinked: vi.fn(async () => {}) },
    now: clock, notifySupport, cancelAndRefund: (id) => cancelAndRefund(id),
  };
  const session = { id: SID, mode: 'subscription', status: 'complete', payment_status: 'paid', currency: 'usd', amount_total: 3900, subscription: 'sub_dom1', metadata: signedMd() };
  const deps = {
    authorize, getStripeSession: vi.fn(async () => ({ ok: true, status: 200, data: session })),
    getSubscription, flow, secret: SECRET, cancelAndRefund, notifySupport,
  };
  return {
    reg, repo, subs, deps, flow, cancelAndRefund, notifySupport,
    tick: (ms: number) => { now += ms; },
    sweep: () => sweepDomains(flow, { deadline: clock() + 60_000 }),
    event: (type: string, object: any) => handleDomainStripeEvent({ type, data: { object } }, () => deps),
  };
}
const row = (w: ReturnType<typeof world>) => w.repo.rows.get('stripe:sub_dom1')!;
const completed = { id: SID, subscription: 'sub_dom1', payment_status: 'paid', metadata: signedMd() };

describe('B1: a web purchase that fails never keeps billing silently', () => {
  it('the registrar fails the order (ordered → failed:registrar): refunded at once, row marked, support emailed, no further Stripe event needed', async () => {
    quiet();
    const w = world();
    w.reg.setOrderMode({ failed: 'payment-failed' });
    const r = await purchaseDomain({ sessionId: SID }, OWNER_AUTH, w.deps);
    expect(r).toMatchObject({ status: 409, body: { refunded: true, message: expect.stringMatching(/could not register freshcuts\.com.*refunded in full/i) } });
    expect(row(w)).toMatchObject({ state: 'failed', failure_reason: 'registrar' });
    expect(row(w).refunded_at).not.toBeNull();
    expect(row(w).last_error).toMatch(/^REFUNDED/);
    expect(w.cancelAndRefund).toHaveBeenCalledTimes(1);
    expect(w.cancelAndRefund).toHaveBeenCalledWith('sub_dom1');
    expect(w.notifySupport).toHaveBeenCalledTimes(1);
    expect(w.notifySupport.mock.calls[0][0]).toBe('Domain refund: freshcuts.com');
    // replays (success page, webhook retry, sweep): still one refund, one email
    await purchaseDomain({ sessionId: SID }, OWNER_AUTH, w.deps);
    await w.event('checkout.session.completed', completed);
    await w.sweep();
    expect(w.cancelAndRefund).toHaveBeenCalledTimes(1);
    expect(w.notifySupport).toHaveBeenCalledTimes(1);
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('closed tab: the webhook background run refunds a failed order too', async () => {
    quiet();
    const w = world();
    w.reg.setOrderMode({ failed: 'payment-failed' });
    const r = await w.event('checkout.session.completed', completed);
    await r.background!();
    expect(row(w)).toMatchObject({ state: 'failed', failure_reason: 'registrar' });
    expect(row(w).refunded_at).not.toBeNull();
    expect(w.cancelAndRefund).toHaveBeenCalledWith('sub_dom1');
    expect(w.notifySupport).toHaveBeenCalledTimes(1);
  });

  it('a definite Vercel refusal (token scope, contact) is terminal for a web row: refunded, not parked in reserved', async () => {
    quiet();
    const w = world();
    w.reg.queueBuy({ code: 'forbidden', status: 403 });
    await purchaseDomain({ sessionId: SID }, OWNER_AUTH, w.deps);
    expect(row(w)).toMatchObject({ state: 'failed', failure_reason: 'registrar', last_error: expect.stringMatching(/forbidden/) });
    expect(row(w).refunded_at).not.toBeNull();
    expect(w.cancelAndRefund).toHaveBeenCalledTimes(1);
    expect(w.notifySupport).toHaveBeenCalledTimes(1);
  });

  it('a refund that fails at that moment is retried by the sweep (no Stripe event needed)', async () => {
    quiet();
    const w = world();
    w.reg.setOrderMode({ failed: 'payment-failed' });
    w.cancelAndRefund.mockRejectedValueOnce(new Error('stripe down'));
    await purchaseDomain({ sessionId: SID }, OWNER_AUTH, w.deps);
    expect(row(w)).toMatchObject({ state: 'failed', refunded_at: null });
    const s = await w.sweep();
    expect(s.refunded).toEqual(['freshcuts.com']);
    expect(row(w).refunded_at).not.toBeNull();
    expect(w.cancelAndRefund).toHaveBeenCalledTimes(2);
    expect(w.notifySupport).toHaveBeenCalledTimes(1);
  });

  it('a row that already bought something is never auto-refunded', async () => {
    quiet();
    const w = world();
    w.repo.rows.set('stripe:sub_dom1', blankRow({
      original_transaction_id: 'stripe:sub_dom1', source: 'stripe', site_slug: 'fresh-cuts', domain: 'freshcuts.com',
      state: 'failed', failure_reason: 'registrar', vercel_bought_at: new Date(T0).toISOString(),
    }));
    await w.sweep();
    expect(w.cancelAndRefund).not.toHaveBeenCalled();
  });

  it('subscription-inactive is alerted, not refunded (nothing to refund automatically)', async () => {
    quiet();
    const w = world();
    w.subs.sub_dom1.status = 'canceled';
    w.subs.sub_dom1.ended_at = (T0 - 60) / 1000;
    await w.repo.insertReserved({ original_transaction_id: 'stripe:sub_dom1', source: 'stripe', environment: 'Production', site_slug: 'fresh-cuts', domain: 'freshcuts.com', simulated: false, auto_renew: false });
    await w.sweep();
    await w.sweep();
    expect(row(w)).toMatchObject({ state: 'failed', failure_reason: 'subscription-inactive' });
    expect(w.cancelAndRefund).not.toHaveBeenCalled();
    expect(w.notifySupport).toHaveBeenCalledTimes(1);
  });

  it('an unknown buy outcome past 30 minutes alerts support ONCE; no refund, no second buy', async () => {
    quiet();
    const w = world();
    w.reg.queueBuy('network');
    await purchaseDomain({ sessionId: SID }, OWNER_AUTH, w.deps);
    expect(row(w).state).toBe('buying');
    w.tick(STALL_ALERT_MS - 60_000);
    expect((await w.sweep()).alerted).toEqual([]);
    expect(w.notifySupport).not.toHaveBeenCalled();
    w.tick(120_000);
    expect((await w.sweep()).alerted).toEqual(['freshcuts.com']);
    expect(w.notifySupport).toHaveBeenCalledTimes(1);
    const [subject, text] = w.notifySupport.mock.calls[0];
    expect(subject).toMatch(/stuck \(buying\).*freshcuts\.com/);
    expect(text).toMatch(/Site: fresh-cuts/);
    expect(text).toMatch(/State: buying/);
    expect(text).toMatch(/Last error:/);
    w.tick(DAY);
    await w.sweep();
    expect(w.notifySupport).toHaveBeenCalledTimes(1);
    expect(w.cancelAndRefund).not.toHaveBeenCalled();
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
    expect(row(w).state).toBe('buying');
  });

  it('an Apple row stuck in reserved (registrar not configured) is reported after 30 minutes too', async () => {
    quiet();
    const w = world({ contact: null });
    await w.repo.insertReserved({ original_transaction_id: 'o-apple', source: 'apple', environment: 'Production', site_slug: 'other-shop', domain: 'other.com', simulated: false, auto_renew: false });
    w.flow.payer = async () => ({ active: true, autoRenew: true, expiresAt: T0 + DAY, revoked: false });
    await w.sweep();
    w.tick(STALL_ALERT_MS + 1000);
    await w.sweep();
    expect(w.notifySupport).toHaveBeenCalledTimes(1);
    expect(w.notifySupport.mock.calls[0][1]).toMatch(/State: reserved/);
    expect(w.notifySupport.mock.calls[0][1]).toMatch(/registrar-not-configured/);
  });

  it('an Apple row keeps its retry on a definite refusal (nothing to refund from here) but support hears once', async () => {
    quiet();
    const w = world();
    await w.repo.insertReserved({ original_transaction_id: 'o-apple', source: 'apple', environment: 'Production', site_slug: 'other-shop', domain: 'other.com', simulated: false, auto_renew: false });
    w.flow.payer = async () => ({ active: true, autoRenew: true, expiresAt: T0 + DAY, revoked: false });
    w.reg.queueBuy({ code: 'forbidden', status: 403 });
    await w.sweep();
    expect(w.repo.rows.get('o-apple')!.state).toBe('reserved');
    expect(w.notifySupport).toHaveBeenCalledTimes(1);
    expect(w.notifySupport.mock.calls[0][0]).toMatch(/refused by Vercel/);
    await w.sweep(); // the retry succeeds
    expect(w.repo.rows.get('o-apple')!.state).toBe('live');
  });
});

describe('B2: fail closed before taking money', () => {
  const setup = (over: { vercel?: any; contact?: any; secret?: string } = {}) => {
    const w = world();
    const createStripeSession = vi.fn(async (_p: URLSearchParams) => ({ ok: true, status: 200, data: { url: 'https://checkout.stripe.com/x' } }));
    const flow = { vercel: 'vercel' in over ? over.vercel : w.reg.api, contact: 'contact' in over ? over.contact : CONTACT, repo: w.repo };
    return { w, createStripeSession, cdeps: { authorize, flow, secret: over.secret ?? SECRET, createStripeSession } };
  };
  const body = { domain: 'freshcuts.com', siteId: 'fresh-cuts' };

  it('a good configuration still sells', async () => {
    const { cdeps } = setup();
    expect((await createDomainCheckout(body, 'o', OWNER_AUTH, cdeps)).status).toBe(200);
  });

  it.each([
    ['registrant contact null', { contact: null }, /VERCEL_REGISTRANT_CONTACT/],
    ['VERCEL_TOKEN missing', { vercel: null }, /VERCEL_TOKEN/],
    ['DOMAIN_CHECKOUT_SECRET missing', { secret: '' }, /DOMAIN_CHECKOUT_SECRET/],
  ])('checkout: %s → 503 domains-not-configured, no Stripe session, which config is logged (no values)', async (_n, over, named) => {
    const err = quiet();
    const { cdeps, createStripeSession, w } = setup(over as any);
    const r = await createDomainCheckout(body, 'o', OWNER_AUTH, cdeps);
    expect(r).toEqual({ status: 503, body: { error: 'domains-not-configured' } });
    expect(createStripeSession).not.toHaveBeenCalled();
    expect(w.reg.api.availability).not.toHaveBeenCalled();
    const logged = err.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toMatch(named);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain('1 Secret Street');
  });

  it('search: no buyable name is shown when the contact or token is missing', async () => {
    quiet();
    const w = world();
    for (const flow of [{ vercel: w.reg.api, contact: null }, { vercel: null, contact: CONTACT }]) {
      expect(await runDomainSearch({ q: 'fresh cuts' }, flow as any)).toEqual({ status: 503, body: { error: 'domains-not-configured' } });
    }
    expect(w.reg.api.availability).not.toHaveBeenCalled();
    expect((await runDomainSearch({ q: 'fresh cuts' }, { vercel: w.reg.api, contact: CONTACT })).status).toBe(200);
  });

  it('the contact diagnosis names the field, never a value', () => {
    const base = { ...CONTACT };
    expect(diagnoseRegistrantContact(undefined).problem).toBe('missing');
    expect(diagnoseRegistrantContact('{nope').problem).toBe('not valid JSON');
    expect(diagnoseRegistrantContact(JSON.stringify({ ...base, phone: '+1 555 555 0100' })).problem).toMatch(/^field phone/);
    expect(diagnoseRegistrantContact(JSON.stringify({ ...base, country: 'us' })).problem).toMatch(/^field country/);
    expect(diagnoseRegistrantContact(JSON.stringify({ ...base, city: '' })).problem).toBe('field city missing or empty');
    expect(diagnoseRegistrantContact(JSON.stringify(base))).toMatchObject({ problem: null, contact: { city: 'c' } });
    expect(registrantContact('{nope')).toBeNull();
  });
});

describe('M2: a paid domain checkout that fails verification is refunded and reported', () => {
  it('forged / other-secret signature on a PAID session → cancelled + refunded, support emailed, 200', async () => {
    quiet();
    const w = world();
    w.subs.sub_other = { ...structuredClone(w.subs.sub_dom1), id: 'sub_other', metadata: signedMd('freshcuts.com', 'fresh-cuts', { sig: '0'.repeat(64) }) };
    const r = await w.event('checkout.session.completed', { id: 'cs_live_other0001', subscription: 'sub_other', payment_status: 'paid', metadata: signedMd('freshcuts.com', 'fresh-cuts', { sig: '0'.repeat(64) }) });
    expect(r).toMatchObject({ handled: true, status: 200, body: { refunded: true } });
    expect(r.purchase).toBeFalsy();
    expect(w.cancelAndRefund).toHaveBeenCalledWith('sub_other');
    expect(w.notifySupport).toHaveBeenCalledTimes(1);
    expect(w.notifySupport.mock.calls[0][1]).toMatch(/sub_other/);
    expect(w.repo.rows.size).toBe(0);
  });

  it('a changed price on a paid session is refunded the same way', async () => {
    quiet();
    const w = world();
    w.subs.sub_dom1.items.data[0].price.unit_amount = 5000;
    const r = await w.event('checkout.session.completed', completed);
    expect(r).toMatchObject({ status: 200, body: { refunded: true } });
    expect(w.cancelAndRefund).toHaveBeenCalledWith('sub_dom1');
  });

  it('a failing refund answers 500 so Stripe retries; unpaid sessions and non-checkout events are never refunded', async () => {
    quiet();
    const w = world();
    w.subs.sub_dom1.metadata = signedMd('freshcuts.com', 'fresh-cuts', { sig: '0'.repeat(64) });
    w.cancelAndRefund.mockRejectedValueOnce(new Error('stripe down'));
    expect(await w.event('checkout.session.completed', completed)).toMatchObject({ status: 500 });
    expect(await w.event('checkout.session.completed', { ...completed, payment_status: 'unpaid' })).toMatchObject({ status: 200, body: { ignored: 'not-a-domain-subscription' } });
    expect(await w.event('customer.subscription.updated', { id: 'sub_dom1', metadata: signedMd() })).toMatchObject({ status: 200, body: { ignored: 'not-a-domain-subscription' } });
    expect(w.cancelAndRefund).toHaveBeenCalledTimes(1);
  });
});

describe('M1: authorizeSiteOwner consults site_owners first', () => {
  const OWNER = '3f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f';
  const ATTACKER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
  const users: Record<string, { id: string; email: string | null; emailConfirmed?: boolean }> = {
    'owner-jwt': { id: OWNER, email: 'barber@example.com', emailConfirmed: true },
    'attacker-jwt': { id: ATTACKER, email: 'x@example.com', emailConfirmed: true },
  };
  function make(ownerRow: SiteOwnerRow | null, claims: string[]) {
    const store: SiteOwnerStore = {
      get: vi.fn(async () => ownerRow), insertIfAbsent: vi.fn(async () => false),
      claim: vi.fn(async () => false), upsert: vi.fn(async () => {}),
    };
    return {
      userOf: vi.fn(async (t: string) => users[t] ?? null), findBySlug: vi.fn(async () => null),
      webClaimants: vi.fn(async () => claims), storedStamp: vi.fn(async () => null), siteOwners: store, now: () => T0,
    };
  }
  const owned: SiteOwnerRow = { slug: 'fresh-cuts', user_id: OWNER, claim_email: null, source: 'checkout', checkout_session_id: null };
  const ask = (token: string, d: ReturnType<typeof make>) => authorizeSiteOwner({ siteId: 'fresh-cuts', authorization: `Bearer ${token}` }, d);

  it('the recorded owner is authorised even with no sites row of their own', async () => {
    expect(await ask('owner-jwt', make(owned, []))).toMatchObject({ ok: true, target: 'fresh-cuts', actor: 'web-user', userId: OWNER });
  });

  it('a second user-inserted sites claim cannot lock the real owner out', async () => {
    expect(await ask('owner-jwt', make(owned, [OWNER, ATTACKER]))).toMatchObject({ ok: true, actor: 'web-user' });
  });

  it('a user who inserted a sites claim on someone else\'s owned site is refused (no impersonation)', async () => {
    const d = make(owned, [ATTACKER]);
    expect(await ask('attacker-jwt', d)).toEqual({ ok: false, status: 403, error: 'not-authorized' });
  });

  it('no owner row yet: the claim rule applies exactly as before', async () => {
    expect(await ask('owner-jwt', make(null, [OWNER]))).toMatchObject({ ok: true });
    expect((await ask('owner-jwt', make(null, [OWNER, ATTACKER]))).status).toBe(403);
    expect((await ask('owner-jwt', make(null, []))).status).toBe(403);
  });

  it('an owner lookup outage fails closed (503)', async () => {
    quiet();
    const d = make(owned, []);
    (d.siteOwners.get as any).mockRejectedValueOnce(new Error('db'));
    expect((await ask('owner-jwt', d)).status).toBe(503);
  });
});

describe('L1: the browser racing the webhook resumes its own row', () => {
  it('holdingSite returns THIS subscription\'s row (webhook insert landed after our read) → no site-has-domain, no support email', async () => {
    quiet();
    const w = world();
    const r = await w.event('checkout.session.completed', completed); // the webhook reserved the slot
    expect(r.status).toBe(200);
    const realGet = w.repo.get.bind(w.repo);
    let blind = 2; // purchaseDomain's own read, then reserveSlot's: both before the webhook's insert is visible
    w.repo.get = async (id: string) => { if (blind > 0 && id === 'stripe:sub_dom1') { blind--; return null; } return realGet(id); };
    const out = await purchaseDomain({ sessionId: SID }, OWNER_AUTH, w.deps);
    expect(out).toMatchObject({ status: 200, body: { state: 'live', domain: 'freshcuts.com' } });
    expect(w.notifySupport).not.toHaveBeenCalled();
    expect(w.cancelAndRefund).not.toHaveBeenCalled();
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
  });
});

describe('L3: a cached Stripe 5xx does not delay the refund by 24h', () => {
  it('a 5xx on the refund is retried once under a fresh idempotency key', async () => {
    const { makeCancelAndRefund } = await import('../lib/ios/domainLive.js');
    const refunds: any[] = [];
    const call = vi.fn(async (method: string, path: string, opts?: any) => {
      if (path === '/v1/subscriptions/sub_abc123' && method === 'GET') return { ok: true, status: 200, data: { status: 'active', latest_invoice: 'in_1' } };
      if (path === '/v1/invoices/in_1') return { ok: true, status: 200, data: { payment_intent: 'pi_1' } };
      if (path === '/v1/refunds') { refunds.push(opts); return refunds.length === 1 ? { ok: false, status: 503, data: null } : { ok: true, status: 200, data: {} }; }
      return { ok: true, status: 200, data: {} };
    });
    await makeCancelAndRefund(call as any)('sub_abc123');
    expect(refunds.map((r) => r.idem)).toEqual(['domain-refund-sub_abc123', expect.stringMatching(/^domain-refund-sub_abc123-r[a-z0-9]+$/)]);
    expect(call).toHaveBeenCalledWith('DELETE', '/v1/subscriptions/sub_abc123', expect.anything());
  });
});

describe('S1: the support email only counts when it was really sent', () => {
  it('skipped (no SMTP env) and failed both throw; sent resolves', async () => {
    vi.resetModules();
    const sendEmail = vi.fn();
    vi.doMock('../lib/bookings/email.js', async (orig) => ({ ...(await orig<object>()), sendEmail }));
    const { notifySupportEmail } = await import('../lib/ios/domainLive.js');
    sendEmail.mockResolvedValueOnce('skipped');
    await expect(notifySupportEmail('s', 't')).rejects.toThrow(/skipped/);
    sendEmail.mockResolvedValueOnce('failed');
    await expect(notifySupportEmail('s', 't')).rejects.toThrow(/failed/);
    sendEmail.mockResolvedValueOnce('sent');
    await expect(notifySupportEmail('s', 't')).resolves.toBeUndefined();
    vi.doUnmock('../lib/bookings/email.js');
    vi.resetModules();
  });

  it('a failed alert email is retried by the next sweep (not marked sent)', async () => {
    quiet();
    const w = world();
    w.reg.queueBuy('network');
    await purchaseDomain({ sessionId: SID }, OWNER_AUTH, w.deps);
    w.tick(STALL_ALERT_MS + 60_000);
    w.notifySupport.mockRejectedValueOnce(new Error('smtp down'));
    expect((await w.sweep()).alerted).toEqual([]);
    expect((await w.sweep()).alerted).toEqual(['freshcuts.com']);
    expect(w.notifySupport).toHaveBeenCalledTimes(2);
  });
});

describe('S2: a refund that keeps failing is emailed once', () => {
  it('after 30 minutes of failed attempts, support hears once; the sweep keeps retrying', async () => {
    quiet();
    const w = world();
    w.reg.setOrderMode({ failed: 'payment-failed' });
    w.cancelAndRefund.mockRejectedValue(new Error('no invoice to refund'));
    await purchaseDomain({ sessionId: SID }, OWNER_AUTH, w.deps);
    await w.sweep();
    expect(w.notifySupport).not.toHaveBeenCalled();
    w.tick(STALL_ALERT_MS + 60_000);
    await w.sweep();
    await w.sweep();
    w.tick(DAY);
    await w.sweep();
    expect(w.notifySupport).toHaveBeenCalledTimes(1);
    expect(w.notifySupport.mock.calls[0][0]).toBe('Domain refund keeps failing: freshcuts.com');
    expect(row(w).refunded_at).toBeNull();
    w.cancelAndRefund.mockResolvedValue(undefined);
    await w.sweep();
    expect(row(w).refunded_at).not.toBeNull();
  });
});
