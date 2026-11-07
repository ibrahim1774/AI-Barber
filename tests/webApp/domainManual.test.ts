// Manual fulfilment of the web app's $39/year domain (lib/webApp/domainManual.ts): the claim parks a paid
// order in awaiting_setup and NEVER buys; mails go out exactly once; the three signed links move the row.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { DOMAIN_SESSION_APP, claimDomainSubscription, createDomainCheckout, domainSig, handleDomainStripeEvent, stripePayerStatus } from '../../lib/webDomains.js';
import { sweepDomains, projectFor, type DomainFlowDeps } from '../../lib/ios/domainFlow.js';
import { makePayer } from '../../lib/ios/domainLive.js';
import {
  domainActionView, runDomainAction, signDomainAction, sweepManualDomains, verifyDomainAction, webStatusBody, webStatusWithProbe,
  postAllowed, REPUBLISH_TIMEOUT_MS, type ManualEnv,
} from '../../lib/webApp/domainManual.js';
import { customDomainOf } from '../../lib/webApp/publishFlow.js';
import { fakeRegistrar } from '../ios/fakeRegistrar.js';
import { fakeDomainsRepo, blankRow } from '../ios/fakeDomainsRepo.js';
import { fakeManual } from './fakeManual.js';

const T0 = 1_800_000_000_000;
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const SECRET = 'test-domain-secret';
const SLUG = 'fresh-cuts';
const DOMAIN = 'freshcuts.com';
const KEY = 'stripe:sub_m1';

afterEach(() => vi.restoreAllMocks());

const md = (domain = DOMAIN, slug = SLUG, over: any = {}) =>
  ({ type: 'domain_purchase', app: DOMAIN_SESSION_APP, domain, siteId: slug, sig: domainSig(SECRET, domain, slug), fulfil: 'manual', ...over });

function mkSub(id: string, over: any = {}) {
  return {
    id, status: 'active', livemode: true, customer: 'cus_cust0001', cancel_at_period_end: false, cancel_at: null,
    current_period_end: (T0 + 365 * DAY) / 1000, metadata: md(), items: { data: [{ quantity: 1, price: { id: 'p', currency: 'usd', unit_amount: 3900, recurring: { interval: 'year', interval_count: 1 } } }] }, ...over,
  };
}

function world(o: { manual?: Parameters<typeof fakeManual>[0]; flow?: Partial<DomainFlowDeps> } = {}) {
  let now = T0;
  const clock = () => now;
  const reg = fakeRegistrar({ now: clock });
  const repo = fakeDomainsRepo([], clock);
  const subs: Record<string, any> = { sub_m1: mkSub('sub_m1') };
  const getSubscription = vi.fn(async (id: string) => (subs[id] ? structuredClone(subs[id]) : null));
  const hooks = { onDomainLinked: vi.fn(async (_s: string, _d: string) => {}), onDomainUnlinked: vi.fn(async (_s: string) => {}) };
  const cancelAndRefund = vi.fn(async (_id: string) => {});
  const notifySupport = vi.fn(async (_s: string, _t: string) => {});
  const probeHttps = vi.fn(async (_d: string) => true);
  const flow: DomainFlowDeps = {
    repo, vercel: reg.api, contact: null,
    verifyDomain: vi.fn(async () => { throw new Error('no Apple'); }), verifySite: vi.fn(async () => { throw new Error('no Apple'); }),
    payer: makePayer(async () => { throw new Error('no Apple'); }, getSubscription, clock),
    sitePurchase: async () => null, hooks, now: clock, notifySupport, cancelAndRefund, probeHttps,
    ...o.flow,
  } as DomainFlowDeps;
  const fm = fakeManual({ getSubscription, ...o.manual });
  const claimDeps = { flow, cancelAndRefund: (id: string) => cancelAndRefund(id), notifySupport, manual: fm.deps };
  const env: ManualEnv = { flow, manual: fm.deps, cancelAndRefund: (id) => cancelAndRefund(id), notifySupport };
  const whDeps = { getSubscription, flow, secret: SECRET, cancelAndRefund, notifySupport, manual: fm.deps };
  return {
    reg, repo, subs, flow, hooks, cancelAndRefund, notifySupport, probeHttps, fm, env, getSubscription,
    tick: (ms: number) => { now += ms; },
    claim: (id = 'sub_m1', simulated = false, domain = DOMAIN, slug = SLUG) => claimDomainSubscription(structuredClone(subs[id]), { domain, slug, subscriptionId: id }, simulated, claimDeps),
    event: (type: string, object: any) => handleDomainStripeEvent({ type, data: { object } }, () => whDeps as any),
    sweep: () => sweepManualDomains(env, now + 120_000),
    iosSweep: () => sweepDomains(flow, { deadline: now + 120_000 }),
    row: (k = KEY) => repo.rows.get(k)!,
    attach: async () => { await reg.api.addProjectDomain(projectFor(SLUG), DOMAIN); await reg.api.addProjectDomain(projectFor(SLUG), `www.${DOMAIN}`, DOMAIN); },
    tokenFor: (a: 'live' | 'cant' | 'end', over: any = {}) => signDomainAction(fm.deps.linkSecret, { a, k: KEY, d: DOMAIN, s: SLUG, exp: now + 30 * DAY, ...over }),
    cancelSub: (id = 'sub_m1') => { subs[id] = { ...subs[id], status: 'canceled', ended_at: Math.floor(now / 1000) - 3 * 86400 * 0, cancel_at_period_end: false }; },
  };
}
type W = ReturnType<typeof world>;

const linksIn = (text: string) => [...text.matchAll(/https:\/\/api\.example\.test\/api\/web-app\/domain-action\?t=[A-Za-z0-9_.-]+/g)].map((m) => m[0]);

describe('claim: a paid web domain subscription parks in awaiting_setup and is never bought', () => {
  it('creates the awaiting_setup row (real), answers 202 awaiting-setup, buys / attaches / republishes nothing', async () => {
    const w = world();
    const r = await w.claim();
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ domain: DOMAIN, state: 'awaiting-setup', autoRenew: true });
    expect(w.row()).toMatchObject({ state: 'awaiting_setup', source: 'stripe', site_slug: SLUG, domain: DOMAIN, simulated: false, auto_renew: true });
    expect(w.reg.api.buy).not.toHaveBeenCalled();
    expect(w.reg.api.addProjectDomain).not.toHaveBeenCalled();
    expect(w.hooks.onDomainLinked).not.toHaveBeenCalled();
    expect(w.cancelAndRefund).not.toHaveBeenCalled();
  });

  it('simulated follows the argument (Stripe test mode)', async () => {
    const w = world();
    expect((await w.claim('sub_m1', true)).body).toMatchObject({ sandbox: true, state: 'awaiting-setup' });
    expect(w.row().simulated).toBe(true);
  });

  it('a replay returns the same row and sends no second mail', async () => {
    const w = world();
    await w.claim();
    const again = await w.claim();
    expect(again.status).toBe(202);
    expect(w.repo.rows.size).toBe(1);
    expect(w.fm.toOrders()).toHaveLength(1);
    expect(w.fm.toCustomer()).toHaveLength(1);
    await w.sweep(); await w.sweep();
    expect(w.fm.sent).toHaveLength(2);
  });

  it('after payment: site-has-domain, taken and not-eligible are refunded in full with a support mail, no row, no mail', async () => {
    const hasDomain = world();
    await hasDomain.repo.insertAwaitingSetup({ original_transaction_id: 'stripe:sub_other', source: 'stripe', environment: 'Production', site_slug: SLUG, domain: 'other.com', simulated: false, auto_renew: true, paid_until: null });
    const r1 = await hasDomain.claim();
    expect(hasDomain.cancelAndRefund).toHaveBeenCalledWith('sub_m1');
    expect(hasDomain.notifySupport).toHaveBeenCalled();
    expect(hasDomain.repo.rows.get(KEY)?.state).toBe('failed');
    expect(r1.body).toMatchObject({ refunded: true });
    expect(hasDomain.fm.sent).toHaveLength(0);

    const taken = world();
    taken.reg.takeByStranger(DOMAIN);
    await taken.claim();
    expect(taken.cancelAndRefund).toHaveBeenCalledWith('sub_m1');
    expect(taken.reg.api.buy).not.toHaveBeenCalled();
    expect(taken.fm.sent).toHaveLength(0);
  });

  it('an inactive subscription is a 402 and creates nothing', async () => {
    const w = world();
    w.subs.sub_m1.status = 'canceled';
    const r = await w.claim();
    expect(r.status).toBe(402);
    expect(w.repo.rows.size).toBe(0);
  });

  it('an own detached name is handed over to the new row and flagged for Ibrahim', async () => {
    const w = world();
    await w.repo.insertReserved({ original_transaction_id: 'stripe:sub_old', source: 'stripe', environment: 'Production', site_slug: SLUG, domain: DOMAIN, simulated: false, auto_renew: false, paid_until: null });
    await w.repo.update('stripe:sub_old', null, { state: 'detached' });
    w.reg.seed(DOMAIN, 1, false); // already on the Vercel team
    await w.claim();
    expect(w.row().state).toBe('awaiting_setup');
    expect(w.row().last_error).toMatch(/own detached name/);
    expect(w.fm.toOrders()[0].mail.text).toMatch(/already on the Vercel team/);
  });

  it('the webhook created event parks the row with no mail and no background work; the sweep then sends both mails once', async () => {
    const w = world();
    const r: any = await w.event('customer.subscription.created', w.subs.sub_m1);
    expect(r).toMatchObject({ handled: true, status: 200, body: { received: true, domain: true } });
    expect(r.background).toBeUndefined();
    expect(w.row().state).toBe('awaiting_setup');
    expect(w.fm.sent).toHaveLength(0);
    await w.sweep();
    expect(w.fm.toOrders()).toHaveLength(1);
    expect(w.fm.toCustomer()).toHaveLength(1);
    await w.sweep(); await w.sweep();
    expect(w.fm.sent).toHaveLength(2);
    expect(w.reg.api.buy).not.toHaveBeenCalled();
  });

  it('a webhook for a manual sub without the manual wiring fails closed (500), never buys', async () => {
    const w = world();
    const r: any = await handleDomainStripeEvent({ type: 'customer.subscription.created', data: { object: w.subs.sub_m1 } }, () => ({ getSubscription: w.getSubscription, flow: w.flow, secret: SECRET, cancelAndRefund: w.cancelAndRefund } as any));
    expect(r.status).toBe(500);
    expect(w.reg.api.buy).not.toHaveBeenCalled();
    expect(w.repo.rows.size).toBe(0);
  });

  it('the legacy dashboard purchase (no fulfil marker) is unchanged: it still goes through the automatic machine', async () => {
    const w = world();
    w.subs.sub_m1.metadata = md(DOMAIN, SLUG, { fulfil: undefined });
    (w.flow as any).contact = { firstName: 'A', lastName: 'B', email: 'a@b.co', phone: '+15555550100', address1: '1', city: 'c', state: 's', zip: 'z', country: 'US' };
    await w.claim();
    expect(w.row().state).not.toBe('awaiting_setup');
    expect(w.fm.sent).toHaveLength(0);
  });

  it('subscription.deleted on awaiting_setup / manual_live: auto_renew off, state unchanged (the machine does nothing)', async () => {
    const w = world();
    await w.claim();
    w.subs.sub_m1 = { ...w.subs.sub_m1, status: 'canceled', ended_at: Math.floor(T0 / 1000) + 1 };
    await w.event('customer.subscription.deleted', w.subs.sub_m1);
    expect(w.row()).toMatchObject({ state: 'awaiting_setup', auto_renew: false });
    await w.repo.update(KEY, null, { state: 'manual_live', auto_renew: true });
    await w.event('customer.subscription.deleted', w.subs.sub_m1);
    expect(w.row()).toMatchObject({ state: 'manual_live', auto_renew: false });
    await w.iosSweep();
    expect(w.row().state).toBe('manual_live');
    expect(w.reg.api.removeProjectDomain).not.toHaveBeenCalled();
  });
});

describe('the order and customer emails', () => {
  it("Ibrahim's order mail: facts, steps and exactly two working links; the customer mail promises 1 to 3 business days", async () => {
    const w = world();
    await w.claim();
    const [o] = w.fm.toOrders();
    expect(o.to).toBe('orders@example.test');
    expect(o.mail.subject).toBe(`Domain order: ${DOMAIN} ($39 paid) - buy and attach`);
    for (const s of [`Domain: ${DOMAIN}`, 'Customer: shop@customer.test (Fresh Cuts)', `Site: ${SLUG}`, `Vercel project: ${projectFor(SLUG)}`, 'sub_m1', 'cus_cust0001', 'available, $11.25 first year']) expect(o.mail.text).toContain(s);
    const links = linksIn(o.mail.text);
    expect(links).toHaveLength(2);
    expect(links.map((l) => verifyDomainAction(l.split('?t=')[1], w.fm.deps.linkSecret, T0)?.a).sort()).toEqual(['cant', 'live']);
    expect(o.mail.html).toContain('<a href=');
    const [c] = w.fm.toCustomer();
    expect(c.to).toBe('shop@customer.test');
    expect(c.mail.subject).toBe(`We're setting up ${DOMAIN}`);
    expect(c.mail.text).toContain('usually within 1 business day, up to 3 business days');
    expect(c.mail.text).not.toMatch(/domain-action/); // the customer never gets operator links
  });

  it('every mail is keyed for Resend idempotency per (event, otid)', async () => {
    const w = world();
    await w.claim();
    expect(w.fm.sent.map((s) => s.key).sort()).toEqual([`domain-customer-ordered:${KEY}`, `domain-order:${KEY}`]);
  });

  it('a throwing sender leaves no marker; the next sweep sends it, once, under the same idempotency key', async () => {
    const w = world();
    w.fm.state.failSends = true;
    await w.claim();
    expect(w.fm.sent).toHaveLength(0);
    expect(w.row().alerts_sent?.order).toBeUndefined();
    await w.sweep();
    expect(w.fm.sent).toHaveLength(0);
    w.fm.state.failSends = false;
    await w.sweep(); await w.sweep();
    expect(w.fm.toOrders()).toHaveLength(1);
    expect(w.fm.toCustomer()).toHaveLength(1);
    expect(w.fm.toOrders()[0].key).toBe(`domain-order:${KEY}`);
  });

  it('a crash after Resend accepted but before the marker: the resend carries the same key (Resend delivers once)', async () => {
    const w = world();
    await w.claim();
    const before = w.fm.sent.length;
    await w.repo.update(KEY, null, { alerts_sent: null }); // marker lost
    await w.sweep();
    expect(w.fm.sent).toHaveLength(before); // same Idempotency-Key: the fake (like Resend) delivers nothing new
    expect(vi.mocked(w.fm.deps.sendMail).mock.calls.filter((c) => c[2] === `domain-order:${KEY}`).length).toBe(2);
  });

  it('unsent for 24 hours: ONE support alert across sweeps, and the mail still goes out when the sender recovers', async () => {
    const w = world();
    w.fm.state.failSends = true;
    await w.claim();
    w.tick(25 * HOUR);
    await w.sweep(); await w.sweep();
    const alerts = w.notifySupport.mock.calls.filter((c) => /not sent for 24 hours/.test(c[0]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0][1]).not.toMatch(/shop@customer|domain-action/);
    w.fm.state.failSends = false;
    await w.sweep();
    expect(w.fm.toOrders().length).toBeGreaterThanOrEqual(1);
  });

  it('a customer with no known address: the order mail still goes out, no customer mail', async () => {
    const w = world({ manual: { customerOf: vi.fn(async () => ({ email: null, shopName: null })) } });
    await w.claim();
    expect(w.fm.toOrders()).toHaveLength(1);
    expect(w.fm.toOrders()[0].mail.text).toContain('email unknown');
    expect(w.fm.toCustomer()).toHaveLength(0);
  });

  it('48 hours still waiting: ONE reminder with fresh links; none before, none after the order is void', async () => {
    const w = world();
    await w.claim();
    w.tick(47 * HOUR);
    await w.sweep();
    expect(w.fm.sent.filter((s) => /^Reminder/.test(s.mail.subject))).toHaveLength(0);
    w.tick(2 * HOUR);
    await w.sweep(); await w.sweep();
    const rem = w.fm.sent.filter((s) => /^Reminder/.test(s.mail.subject));
    expect(rem).toHaveLength(1);
    expect(linksIn(rem[0].mail.text)).toHaveLength(2);
    expect(rem[0].mail.text).toContain('usually within 1 business day, up to 3 business days');
  });

  it('order-void once when the subscription ends while awaiting (cancelled now / refunded / account deleted)', async () => {
    const w = world();
    await w.claim();
    w.cancelSub();
    w.tick(13 * HOUR); // past the payer refresh interval
    await w.sweep(); await w.sweep(); await w.sweep();
    const v = w.fm.sent.filter((s) => /^Domain order void/.test(s.mail.subject));
    expect(v).toHaveLength(1);
    expect(v[0].to).toBe('orders@example.test');
    expect(v[0].mail.text).toContain('Do not buy');
    expect(w.fm.sent.filter((s) => /^Reminder/.test(s.mail.subject))).toHaveLength(0);
  });

  it('order-void once when the owner removed the site while the order waited (detached / owner-removed)', async () => {
    const w = world();
    await w.claim();
    await w.repo.update(KEY, null, { state: 'detached', failure_reason: 'owner-removed' });
    await w.sweep(); await w.sweep();
    const v = w.fm.sent.filter((s) => /^Domain order void/.test(s.mail.subject));
    expect(v).toHaveLength(1);
    expect(v[0].mail.text).toMatch(/owner removed the site/);
  });

  it('ended: ONE mail with the Mark ended link when the payer reports a manual_live row inactive', async () => {
    const w = world();
    await w.claim();
    await w.repo.update(KEY, null, { state: 'manual_live', linked_at: new Date(T0).toISOString(), alerts_sent: { ...w.row().alerts_sent, 'customer-live': 'x' } });
    w.cancelSub();
    await w.sweep(); await w.sweep();
    const e = w.fm.sent.filter((s) => /^Domain period ended/.test(s.mail.subject));
    expect(e).toHaveLength(1);
    const links = linksIn(e[0].mail.text);
    expect(links).toHaveLength(1);
    expect(verifyDomainAction(links[0].split('?t=')[1], w.fm.deps.linkSecret, T0)?.a).toBe('end');
    expect(e[0].mail.text).toMatch(/Do not renew the registration/);
  });

  it('renewal-due: ONE mail per paid_until when the sub will renew within 30 days', async () => {
    const w = world();
    await w.claim();
    await w.repo.update(KEY, null, { state: 'manual_live', paid_until: new Date(T0 + 20 * DAY).toISOString(), alerts_sent: { ...w.row().alerts_sent, 'customer-live': 'x' } });
    w.subs.sub_m1.current_period_end = (T0 + 20 * DAY) / 1000;
    await w.sweep(); await w.sweep();
    expect(w.fm.sent.filter((s) => /^Domain renewal due/.test(s.mail.subject))).toHaveLength(1);
    // a cancelled-at-period-end sub does not renew: no reminder
    const w2 = world();
    await w2.claim();
    await w2.repo.update(KEY, null, { state: 'manual_live', auto_renew: false, paid_until: new Date(T0 + 20 * DAY).toISOString(), alerts_sent: { ...w2.row().alerts_sent, 'customer-live': 'x' } });
    w2.subs.sub_m1.cancel_at_period_end = true;
    await w2.sweep();
    expect(w2.fm.sent.filter((s) => /^Domain renewal due/.test(s.mail.subject))).toHaveLength(0);
  });

  it('no card number, secret or token ever reaches a log, and mails carry no card data', async () => {
    const logs: string[] = [];
    for (const m of ['error', 'warn', 'log'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
    const w = world();
    w.fm.state.failSends = true;
    await w.claim();
    w.fm.state.failSends = false;
    await w.sweep();
    w.cancelSub(); w.tick(13 * HOUR);
    await w.sweep();
    const all = JSON.stringify(w.fm.sent.map((s) => s.mail));
    expect(all).not.toMatch(/4242|sk_(live|test)|whsec_|last4|\bpan\b/i);
    expect(all).not.toContain(SECRET);
    const text = logs.join('\n');
    expect(text).not.toContain(w.fm.deps.linkSecret);
    expect(text).not.toMatch(/domain-action\?t=|[A-Za-z0-9_-]{30,}\.[0-9a-f]{64}/);
    expect(text).not.toMatch(/shop@customer\.test/);
  });

  it('no DOMAIN_ADMIN_LINK_SECRET: no links anywhere, the mail says so, and the handlers answer 503', async () => {
    const w = world({ manual: { linkSecret: '' } });
    await w.claim();
    const o = w.fm.toOrders()[0].mail.text;
    expect(o).not.toContain('domain-action');
    expect(o).toContain('DOMAIN_ADMIN_LINK_SECRET is not set');
    expect((await domainActionView('x.y', w.env)).status).toBe(503);
    expect((await runDomainAction('x.y', w.env)).status).toBe(503);
  });
});

describe('signed links', () => {
  const w0 = world();
  const secret = w0.fm.deps.linkSecret;
  const p = { a: 'live' as const, k: KEY, d: DOMAIN, s: SLUG, exp: T0 + DAY };

  it('round trips; tampering with payload, signature or action, expiry and another secret are all rejected', () => {
    const t = signDomainAction(secret, p);
    expect(verifyDomainAction(t, secret, T0)).toEqual(p);
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...p, a: 'cant' })).toString('base64url');
    expect(verifyDomainAction(`${forged}.${sig}`, secret, T0)).toBeNull();
    expect(verifyDomainAction(`${body}.${sig.replace(/.$/, sig.endsWith('0') ? '1' : '0')}`, secret, T0)).toBeNull();
    expect(verifyDomainAction(`${Buffer.from(JSON.stringify({ ...p, k: 'stripe:sub_x' })).toString('base64url')}.${sig}`, secret, T0)).toBeNull();
    expect(verifyDomainAction(t, secret, T0 + 2 * DAY)).toBeNull();
    expect(verifyDomainAction(t, 'another-secret', T0)).toBeNull();
    expect(verifyDomainAction(t, '', T0)).toBeNull();
    expect(verifyDomainAction(undefined, secret, T0)).toBeNull();
    expect(verifyDomainAction('garbage', secret, T0)).toBeNull();
  });

  it('a bad / expired / other-secret link is a 403 with no state change and no side effect', async () => {
    const w = world();
    await w.claim();
    const snapshot = JSON.stringify(w.row());
    for (const t of ['nope', signDomainAction('wrong-secret', { ...p, exp: T0 + DAY }), w.tokenFor('live', { exp: T0 - 1 }), w.tokenFor('live', { d: 'evil.com' }), w.tokenFor('cant', { s: 'other-site' })]) {
      expect((await domainActionView(t, w.env)).status).toBe(403);
      expect((await runDomainAction(t, w.env)).status).toBe(403);
    }
    expect(JSON.stringify(w.row())).toBe(snapshot);
    expect(w.cancelAndRefund).not.toHaveBeenCalled();
    expect(w.hooks.onDomainLinked).not.toHaveBeenCalled();
  });

  it('postAllowed: same-origin fetch metadata, or an Origin equal to the host; nothing else', () => {
    expect(postAllowed({ 'sec-fetch-site': 'same-origin' })).toBe(true);
    expect(postAllowed({ 'sec-fetch-site': 'cross-site' })).toBe(false);
    expect(postAllowed({ 'sec-fetch-site': 'cross-site', origin: 'https://h.example' , host: 'h.example' })).toBe(false);
    expect(postAllowed({ origin: 'https://h.example', host: 'h.example' })).toBe(true);
    expect(postAllowed({ origin: 'https://evil.example', host: 'h.example' })).toBe(false);
    expect(postAllowed({ host: 'h.example' })).toBe(false);
    expect(postAllowed({})).toBe(false);
  });
});

async function awaiting(w: W) { await w.claim(); await w.attach(); }

describe('GET shows the checks and never acts', () => {
  it('Mark live / Cant / Mark ended GET: zero writes, zero Stripe or republish calls', async () => {
    const w = world();
    await awaiting(w);
    await w.repo.update(KEY, null, { alerts_sent: { ...w.row().alerts_sent } });
    const snap = JSON.stringify(w.row());
    const upd = vi.spyOn(w.repo, 'update');
    for (const a of ['live', 'cant', 'end'] as const) {
      const r = await domainActionView(w.tokenFor(a), w.env);
      expect(r.status).toBe(200);
      expect(r.html).toContain(DOMAIN);
    }
    const live = await domainActionView(w.tokenFor('live'), w.env);
    expect(live.html).toContain('<form method="post"'); // all required checks are green: the button is offered
    expect(upd).not.toHaveBeenCalled();
    expect(JSON.stringify(w.row())).toBe(snap);
    expect(w.cancelAndRefund).not.toHaveBeenCalled();
    expect(w.hooks.onDomainLinked).not.toHaveBeenCalled();
    expect(w.hooks.onDomainUnlinked).not.toHaveBeenCalled();
    expect(w.reg.api.addProjectDomain).toHaveBeenCalledTimes(2); // only the operator's own attach in awaiting()
    expect(w.fm.sent).toHaveLength(2);
  });

  it('with a red check the page offers no button', async () => {
    const w = world();
    await w.claim(); // not attached
    const r = await domainActionView(w.tokenFor('live'), w.env);
    expect(r.html).toMatch(/FAIL/);
    expect(r.html).not.toContain('<form');
  });
});

describe('Mark live', () => {
  const refused = async (w: W, why: RegExp) => {
    const r = await runDomainAction(w.tokenFor('live'), w.env);
    expect(r.status).toBe(409);
    expect(r.html).toMatch(why);
    expect(w.row().state).toBe('awaiting_setup');
    expect(w.hooks.onDomainLinked).not.toHaveBeenCalled();
    expect(w.fm.sent.filter((s) => /is live/.test(s.mail.subject))).toHaveLength(0);
  };

  it('each failed check refuses and changes nothing: subscription inactive, not attached, not verified, misconfigured, HTTPS pending', async () => {
    const a = world(); await awaiting(a); a.cancelSub(); await refused(a, /no longer active/);
    const b = world(); await b.claim(); await refused(b, /is not on project/);
    const c = world(); await awaiting(c); vi.mocked(c.reg.api.projectDomain).mockImplementation(async (_p, n) => (n === DOMAIN ? { verified: false, redirect: null } : { verified: true, redirect: DOMAIN })); await refused(c, /not verified yet/);
    const d = world(); await awaiting(d); vi.mocked(d.reg.api.domainConfig).mockResolvedValue({ misconfigured: true }); await refused(d, /not pointed at Vercel/);
    const e = world(); await awaiting(e); e.probeHttps.mockResolvedValue(false); await refused(e, /does not answer yet/);
  });

  it('a missing www is only a warning', async () => {
    const w = world();
    await w.claim();
    await w.reg.api.addProjectDomain(projectFor(SLUG), DOMAIN);
    const r = await runDomainAction(w.tokenFor('live'), w.env);
    expect(r.status).toBe(200);
    expect(w.row().state).toBe('manual_live');
  });

  it('a republish failure leaves the row awaiting_setup (502) and a retry succeeds', async () => {
    const w = world();
    await awaiting(w);
    w.hooks.onDomainLinked.mockRejectedValueOnce(new Error('deploy failed'));
    const r = await runDomainAction(w.tokenFor('live'), w.env);
    expect(r.status).toBe(502);
    expect(w.row()).toMatchObject({ state: 'awaiting_setup', linked_at: null, dns_ready_at: null });
    expect((await runDomainAction(w.tokenFor('live'), w.env)).status).toBe(200);
    expect(w.row().state).toBe('manual_live');
  });

  it('success: manual_live + linked_at + dns_ready_at, onDomainLinked(slug, domain) once, ONE customer mail; a replay says already live and does nothing more', async () => {
    const w = world();
    await awaiting(w);
    const r = await runDomainAction(w.tokenFor('live'), w.env);
    expect(r.status).toBe(200);
    expect(r.html).toContain('is live');
    expect(r.html).toContain(`https://${DOMAIN}/`); // canonical found (display only)
    expect(w.row()).toMatchObject({ state: 'manual_live', linked_at: new Date(T0).toISOString(), dns_ready_at: new Date(T0).toISOString(), last_error: null });
    expect(w.hooks.onDomainLinked).toHaveBeenCalledTimes(1);
    expect(w.hooks.onDomainLinked).toHaveBeenCalledWith(SLUG, DOMAIN);
    const live = w.fm.toCustomer().filter((s) => s.mail.subject === `${DOMAIN} is live`);
    expect(live).toHaveLength(1);
    expect(live[0].mail.text).toContain(`https://${DOMAIN}`);
    expect(live[0].mail.text).toContain('$39/year');
    const again = await runDomainAction(w.tokenFor('live'), w.env);
    expect(again.html).toMatch(/Already live/);
    await w.sweep(); await w.sweep();
    expect(w.hooks.onDomainLinked).toHaveBeenCalledTimes(1);
    expect(w.fm.toCustomer().filter((s) => /is live/.test(s.mail.subject))).toHaveLength(1);
    expect(w.reg.api.buy).not.toHaveBeenCalled();
  });

  it('the site body reads it as ready; the status carries the probe and the live / cancelled-until states', async () => {
    const w = world();
    await awaiting(w);
    const before = customDomainOf(webStatusBody(w.row()), w.row());
    expect(before).toMatchObject({ state: 'awaiting-setup', ready: false, url: null });
    await runDomainAction(w.tokenFor('live'), w.env);
    const st = await webStatusWithProbe(w.row(), w.flow);
    expect(st.state).toBe('live');
    expect(w.probeHttps).toHaveBeenCalledWith(DOMAIN);
    const cd = customDomainOf(webStatusBody(w.row()), w.row());
    expect(cd).toMatchObject({ domain: DOMAIN, state: 'live', ready: true });
    await w.repo.update(KEY, null, { auto_renew: false });
    expect(webStatusBody(w.row()).state).toMatch(/^cancelled-until:/);
  });

  it('the verify stub skips Vercel / HTTPS and says so (staging only)', async () => {
    const w = world({ manual: { verifyStub: true } });
    await w.claim();
    const view = await domainActionView(w.tokenFor('live'), w.env);
    expect(view.html).toContain('STUB');
    const r = await runDomainAction(w.tokenFor('live'), w.env);
    expect(r.status).toBe(200);
    expect(r.html).toContain('STUB');
    expect(w.row().state).toBe('manual_live');
    expect(w.reg.api.projectDomain).not.toHaveBeenCalled();
  });
});

describe("Can't get this name", () => {
  it('failed:taken, cancelled and refunded once, support told, ONE refunded mail; a replay does nothing', async () => {
    const w = world();
    await w.claim();
    const r = await runDomainAction(w.tokenFor('cant'), w.env);
    expect(r.status).toBe(200);
    expect(r.html).toContain('Refunded');
    expect(w.row()).toMatchObject({ state: 'failed', failure_reason: 'taken', auto_renew: false });
    expect(w.row().refunded_at).toBeTruthy();
    expect(w.cancelAndRefund).toHaveBeenCalledTimes(1);
    expect(w.cancelAndRefund).toHaveBeenCalledWith('sub_m1');
    expect(w.notifySupport).toHaveBeenCalled();
    const refunded = w.fm.toCustomer().filter((s) => /was refunded/.test(s.mail.subject));
    expect(refunded).toHaveLength(1);
    expect(refunded[0].mail.text).toContain('refunded in full');
    const again = await runDomainAction(w.tokenFor('cant'), w.env);
    expect(again.html).toMatch(/Already done/);
    await w.sweep(); await w.sweep();
    expect(w.cancelAndRefund).toHaveBeenCalledTimes(1);
    expect(w.fm.toCustomer().filter((s) => /was refunded/.test(s.mail.subject))).toHaveLength(1);
    expect(w.reg.api.buy).not.toHaveBeenCalled();
    // the app's status is the existing refunded screen
    expect(webStatusBody(w.row()).state).toMatch(/^failed:/);
  });

  it('a refund that fails: order closed, no customer mail, the sweeps finish it later and the mail follows once', async () => {
    const w = world();
    await w.claim();
    w.cancelAndRefund.mockRejectedValueOnce(new Error('stripe down'));
    const r = await runDomainAction(w.tokenFor('cant'), w.env);
    expect(r.status).toBe(202);
    expect(r.html).toMatch(/Refund pending/);
    expect(w.row()).toMatchObject({ state: 'failed', refunded_at: null });
    expect(w.fm.toCustomer().filter((s) => /was refunded/.test(s.mail.subject))).toHaveLength(0);
    await w.iosSweep(); // the existing failed-row refund retry (pass 7)
    expect(w.row().refunded_at).toBeTruthy();
    await w.sweep(); await w.sweep();
    expect(w.fm.toCustomer().filter((s) => /was refunded/.test(s.mail.subject))).toHaveLength(1);
    expect(w.cancelAndRefund).toHaveBeenCalledTimes(2);
  });

  it('refused once the order went live', async () => {
    const w = world();
    await awaiting(w);
    await runDomainAction(w.tokenFor('live'), w.env);
    const r = await runDomainAction(w.tokenFor('cant'), w.env);
    expect(r.html).toMatch(/Already done/);
    expect(w.cancelAndRefund).not.toHaveBeenCalled();
  });
});

describe('Mark ended', () => {
  async function liveW() {
    const w = world();
    await awaiting(w);
    await runDomainAction(w.tokenFor('live'), w.env);
    w.hooks.onDomainLinked.mockClear();
    return w;
  }

  it('refused while the subscription is still active', async () => {
    const w = await liveW();
    const r = await runDomainAction(w.tokenFor('end'), w.env);
    expect(r.status).toBe(409);
    expect(r.html).toMatch(/still active/);
    expect(w.row().state).toBe('manual_live');
    expect(w.hooks.onDomainUnlinked).not.toHaveBeenCalled();
    expect((await domainActionView(w.tokenFor('end'), w.env)).html).not.toContain('<form');
  });

  it('refused while the domain is still on the Vercel project', async () => {
    const w = await liveW();
    w.cancelSub();
    const r = await runDomainAction(w.tokenFor('end'), w.env);
    expect(r.status).toBe(409);
    expect(r.html).toMatch(/still attached/);
    expect(w.row().state).toBe('manual_live');
  });

  it('success: transferred / manual-ended, onDomainUnlinked once, status expired, the slot is free for a new order; a replay is already ended', async () => {
    const w = await liveW();
    w.cancelSub();
    await w.reg.api.removeProjectDomain(projectFor(SLUG), DOMAIN);
    const r = await runDomainAction(w.tokenFor('end'), w.env);
    expect(r.status).toBe(200);
    expect(w.row()).toMatchObject({ state: 'transferred', transferred_by: 'manual-ended', auto_renew: false });
    expect(w.hooks.onDomainUnlinked).toHaveBeenCalledTimes(1);
    expect(w.hooks.onDomainUnlinked).toHaveBeenCalledWith(SLUG);
    expect(webStatusBody(w.row()).state).toBe('expired');
    expect(customDomainOf(webStatusBody(w.row()), w.row())).toBeNull();
    expect((await runDomainAction(w.tokenFor('end'), w.env)).html).toMatch(/Already ended/);
    expect(w.hooks.onDomainUnlinked).toHaveBeenCalledTimes(1);
    // a new order on the same site works
    w.subs.sub_m2 = mkSub('sub_m2', { metadata: md('freshcuts2.com') });
    const again = await w.claim('sub_m2', false, 'freshcuts2.com');
    expect(again.status).toBe(202);
    expect(w.repo.rows.get('stripe:sub_m2')?.state).toBe('awaiting_setup');
  });
});


// ─── B1: the server decides manual vs automatic from facts about the SITE, not from the request ───
describe('B1: a web-app site never reaches the registrar, whatever the client sent', () => {
  const unmarked = (w: W) => { w.subs.sub_m1.metadata = md(DOMAIN, SLUG, { fulfil: undefined }); };

  it('checkout: a web-app site WITHOUT app:web still gets the manual marker; a legacy site does not; a failed lookup is manual', async () => {
    const run = async (isWebAppSite: (s: string) => Promise<boolean>, body: any = {}) => {
      const w = world();
      const createStripeSession = vi.fn(async (_p: URLSearchParams) => ({ ok: true, status: 200, data: { url: 'https://checkout.stripe.com/x' } }));
      const authorize = async () => ({ ok: true, target: SLUG, actor: 'web-user' as const });
      const r = await createDomainCheckout({ domain: DOMAIN, siteId: SLUG, ...body }, 'https://www.aibarber.org', 'Bearer x',
        { authorize, flow: { ...w.flow, contact: {} as any }, secret: SECRET, createStripeSession, isWebAppSite });
      expect(r.status).toBe(200);
      return createStripeSession.mock.calls[0][0];
    };
    const web = await run(async () => true); // no `app` in the body
    expect(web.get('metadata[fulfil]')).toBe('manual');
    expect(web.get('subscription_data[metadata][fulfil]')).toBe('manual');
    expect((await run(async () => { throw new Error('db down'); })).get('metadata[fulfil]')).toBe('manual');
    expect((await run(async () => false)).get('metadata[fulfil]')).toBeNull(); // legacy aibarber.org site: unchanged
  });

  it('claim (API return): an unmarked subscription of a web-app site parks in awaiting_setup and buys nothing', async () => {
    const w = world({ manual: { isWebAppSite: vi.fn(async () => true) } });
    unmarked(w);
    const r = await w.claim();
    expect(r.status).toBe(202);
    expect(w.row()).toMatchObject({ state: 'awaiting_setup' });
    expect(w.reg.api.buy).not.toHaveBeenCalled();
    expect(w.reg.api.addProjectDomain).not.toHaveBeenCalled();
  });

  it('webhook: the same, and a failed web-app lookup is parked too (fail closed), not bought', async () => {
    for (const isWebAppSite of [vi.fn(async () => true), vi.fn(async () => { throw new Error('db down'); })]) {
      const w = world({ manual: { isWebAppSite } });
      unmarked(w);
      const r = await w.event('checkout.session.completed', { id: 'cs_1', payment_status: 'paid', mode: 'subscription', subscription: 'sub_m1', metadata: { type: 'domain_purchase', app: DOMAIN_SESSION_APP } });
      expect(r.status).toBe(200);
      expect(r.background).toBeUndefined();
      expect(w.row()).toMatchObject({ state: 'awaiting_setup' });
      expect(w.reg.api.buy).not.toHaveBeenCalled();
    }
  });

  it('a legacy (non web-app) unmarked subscription stays on the automatic path (unchanged)', async () => {
    const w = world({ flow: { contact: {} as any } }); // isWebAppSite -> false
    unmarked(w);
    await w.claim().catch(() => {});
    expect(w.repo.rows.get(KEY)?.state).not.toBe('awaiting_setup');
    expect(w.reg.api.buy).toHaveBeenCalled();
  });
});


// ─── B2 / S4: the republish is long; Mark live and Can't never interleave ───
describe('B2: Mark live fits the function budget and never hangs the page', () => {
  const ready = async (w: W) => { await w.claim(); await w.attach(); };

  it('the action endpoint and vercel.json both allow 300 s (a republish takes ~150 s)', () => {
    expect(readFileSync('api/web-app/domain-action.ts', 'utf8')).toMatch(/maxDuration:\s*300/);
    expect(JSON.parse(readFileSync('vercel.json', 'utf8')).functions['api/web-app/domain-action.ts'].maxDuration).toBe(300);
  });

  it('a republish that never returns ends the page with an honest 504, leaves the row awaiting_setup, frees the lease, and a retry works', async () => {
    vi.useFakeTimers();
    try {
      const w = world();
      await ready(w);
      w.hooks.onDomainLinked.mockImplementationOnce(() => new Promise<void>(() => {}));
      const pending = runDomainAction(w.tokenFor('live'), w.env);
      await vi.advanceTimersByTimeAsync(REPUBLISH_TIMEOUT_MS + 1000);
      const r = await pending;
      expect(r.status).toBe(504);
      expect(r.html).toMatch(/safe to repeat/);
      expect(w.row().state).toBe('awaiting_setup');
      expect(w.row().lease_until).toBeNull();
      const again = await runDomainAction(w.tokenFor('live'), w.env);
      expect(again.status).toBe(200);
      expect(w.row().state).toBe('manual_live');
      expect(w.hooks.onDomainLinked).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});

describe('S4: Can\'t and Mark live cannot interleave', () => {
  it('Can\'t during a Mark live republish is refused: no refund, row stays awaiting_setup', async () => {
    const w = world();
    await w.claim(); await w.attach();
    let release!: () => void;
    w.hooks.onDomainLinked.mockImplementationOnce(() => new Promise<void>((res) => { release = res; }));
    const live = runDomainAction(w.tokenFor('live'), w.env);
    await new Promise((r) => setTimeout(r, 0));
    const cant = await runDomainAction(w.tokenFor('cant'), w.env);
    expect(cant.status).toBe(409);
    expect(w.cancelAndRefund).not.toHaveBeenCalled();
    expect(w.row().state).toBe('awaiting_setup');
    release();
    expect((await live).status).toBe(200);
    expect(w.row().state).toBe('manual_live');
    expect(w.cancelAndRefund).not.toHaveBeenCalled();
  });

  it('losing the race after the republish (lease gone) undoes the republish', async () => {
    const w = world();
    await w.claim(); await w.attach();
    w.hooks.onDomainLinked.mockImplementationOnce(async () => {
      w.repo.rows.set(KEY, { ...w.row(), state: 'failed', failure_reason: 'taken' }); // Can't won meanwhile
    });
    const r = await runDomainAction(w.tokenFor('live'), w.env);
    expect(r.html).toMatch(/free address/);
    expect(w.hooks.onDomainUnlinked).toHaveBeenCalledWith(SLUG);
    expect(w.row().state).toBe('failed');
  });
});
