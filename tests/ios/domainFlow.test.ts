import { describe, it, expect, vi } from 'vitest';
import {
  BASE_PENDING, RENEWAL_UNKNOWN, advance, applyDomainNotification, markTransferred, releaseStuckBuy, runDomainClaim, runDomainSearch, runDomainStatus,
  statusBody, sweepDomains, type DomainFlowDeps,
} from '../../lib/ios/domainFlow.js';
import { VerifyFailure, type VerifiedTx } from '../../lib/ios/appleVerify.js';
import { DOMAIN_PRODUCT_ID } from '../../lib/ios/tiers.js';
import { makePayer } from '../../lib/ios/domainLive.js';
import { fakeDomainsRepo, blankRow } from './fakeDomainsRepo.js';
import { fakeRegistrar, YEAR_MS } from './fakeRegistrar.js';

const T0 = 1_800_000_000_000;
const DAY = 24 * 3600_000;
const CONTACT = {
  firstName: 'A', lastName: 'B', email: 'ops@example.com', phone: '+15555550100',
  address1: '1 Main St', city: 'Town', state: 'CA', zip: '90000', country: 'US',
};

interface AppleSub { otid: string; environment: 'Production' | 'Sandbox'; status: number; expiresAt: number; revoked?: boolean; autoRenew?: boolean | null; account: string[] }

function world(opts: { taken?: string[]; prices?: Record<string, any>; contact?: any; sandboxRealOtids?: string[] } = {}) {
  let now = T0;
  const clock = () => now;
  const reg = fakeRegistrar({ now: clock, taken: opts.taken, prices: opts.prices });
  const repo = fakeDomainsRepo([], clock);
  // Domain subscriptions by transaction id AND by otid (renewals verify by otid). Apple's CURRENT state.
  const domainSubs: Record<string, AppleSub> = {
    '100': { otid: 'd-o1', environment: 'Production', status: 1, expiresAt: T0 + 365 * DAY, autoRenew: true, account: ['d-o1', 's-o1'] },
    '101': { otid: 'd-o2', environment: 'Production', status: 1, expiresAt: T0 + 365 * DAY, autoRenew: true, account: ['d-o2', 's-o9'] },
    '102': { otid: 'd-o3', environment: 'Sandbox', status: 1, expiresAt: T0 + 365 * DAY, autoRenew: true, account: ['d-o3', 's-sb'] },
  };
  const sites: Record<string, { otid: string; slug: string | null; env?: 'Production' | 'Sandbox' }> = {
    '200': { otid: 's-o1', slug: 'fresh-cuts' },
    '201': { otid: 's-o2', slug: 'other-shop' },
    '202': { otid: 's-o3', slug: null },
    '210': { otid: 's-sb', slug: 'review-shop', env: 'Sandbox' },
  };
  const tx = (s: AppleSub, productId: string): VerifiedTx => ({
    originalTransactionId: s.otid, transactionId: 't', productId, environment: s.environment, expiresAt: s.expiresAt,
    revoked: !!s.revoked, status: s.status, productPurchasedAt: null, accountOriginalTransactionIds: s.account,
    autoRenew: s.autoRenew === undefined ? true : s.autoRenew,
  });
  const verifyDomain = vi.fn(async (id: string) => {
    if (sites[id]) throw new VerifyFailure('bad-product'); // a site transaction is not the domain product
    const s = domainSubs[id] ?? Object.values(domainSubs).find((x) => x.otid === id);
    if (!s) throw new VerifyFailure('not-found');
    return tx(s, DOMAIN_PRODUCT_ID);
  });
  const verifySite = vi.fn(async (id: string) => {
    if (domainSubs[id]) throw new VerifyFailure('bad-product');
    const s = sites[id];
    if (!s) throw new VerifyFailure('not-found');
    return { ...tx({ otid: s.otid, environment: s.env ?? 'Production', status: 1, expiresAt: T0 + DAY, account: [] }, 'com.ibrahim1774.aibarber.hosting.monthly'), accountOriginalTransactionIds: undefined };
  });
  const hooks = { onDomainLinked: vi.fn(async () => {}), onDomainUnlinked: vi.fn(async () => {}) };
  const deps: DomainFlowDeps = {
    repo,
    vercel: reg.api,
    contact: opts.contact === undefined ? CONTACT : opts.contact,
    verifyDomain,
    verifySite,
    payer: makePayer(verifyDomain, async () => null, clock),
    sitePurchase: async (otid) => {
      const s = Object.values(sites).find((x) => x.otid === otid);
      return s ? { original_transaction_id: s.otid, site_slug: s.slug } : null;
    },
    hooks,
    now: clock,
    sandboxRealOtids: new Set(opts.sandboxRealOtids ?? []),
  };
  const notify = (type: string, otid = 'd-o1', subtype?: string) =>
    applyDomainNotification({ otid, type, subtype, environment: 'Production', expiresAt: null, revokedAt: null, reinstated: false }, deps);
  return {
    deps, reg, repo, hooks, domainSubs, sites, verifyDomain, notify,
    tick: (ms: number) => { now += ms; },
    claim: (body: any, auth?: string) => runDomainClaim(body, auth, deps),
    sweep: () => sweepDomains(deps, { deadline: clock() + 60_000 }),
  };
}

const CLAIM = { transactionId: '100', siteTransactionId: '200', domain: 'freshcuts.com' };

// ─── search ───

describe('POST /api/ios/domain/search', () => {
  it('the exact .com first, suggestions after, each Available/Taken and eligible', async () => {
    const w = world({ taken: ['freshcuts.com'], prices: { 'freshcutsbarber.com': { purchasePrice: 99, renewalPrice: 99 } } });
    const r = await runDomainSearch({ q: 'Fresh Cuts' }, w.deps);
    expect(r.status).toBe(200);
    const results = (r.body as any).results;
    expect(results[0]).toEqual({ domain: 'freshcuts.com', available: false, eligible: false });
    expect(results.find((x: any) => x.domain === 'freshcutsbarber.com')).toEqual({ domain: 'freshcutsbarber.com', available: true, eligible: false });
    expect(results.find((x: any) => x.domain === 'freshcutsbarbershop.com')).toEqual({ domain: 'freshcutsbarbershop.com', available: true, eligible: true });
  });

  it('a price sent as a string is not eligible', async () => {
    const w = world({ prices: { 'freshcuts.com': { purchasePrice: '11.25', renewalPrice: 11.25 } } });
    expect(((await runDomainSearch({ q: 'freshcuts' }, w.deps)).body as any).results[0]).toEqual({ domain: 'freshcuts.com', available: true, eligible: false });
  });

  it('never asks Apple; the same answer whether the transactionId exists or not', async () => {
    const w = world();
    const a = await runDomainSearch({ q: 'freshcuts', transactionId: '100' }, w.deps);
    const b = await runDomainSearch({ q: 'freshcuts', transactionId: '999999' }, w.deps);
    expect(a).toEqual(b);
    expect(w.verifyDomain).not.toHaveBeenCalled();
  });

  it('rate limited per IP and per transaction (hashed key, never the raw id)', async () => {
    const w = world();
    const allow = vi.fn(async () => false);
    expect((await runDomainSearch({ q: 'freshcuts', transactionId: '100' }, { ...w.deps, limiter: { allow } })).status).toBe(429);
    expect((allow.mock.calls[0] as any[])[0]).toMatch(/^domain-search-tx:[0-9a-f]{32}$/);
    const ipAllow = vi.fn(async (key: string) => !key.startsWith('domain-search-ip:'));
    expect((await runDomainSearch({ q: 'freshcuts' }, { ...w.deps, limiter: { allow: ipAllow } }, '9.9.9.9')).status).toBe(429);
    expect(w.reg.api.availability).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ q: '' }], [{ q: 'ab' }], [{ q: 42 }], [null], [{ q: 'ok-name', transactionId: 5 }]])('bad input %j → 400', async (body) => {
    expect((await runDomainSearch(body, world().deps)).status).toBe(400);
  });

  it('Vercel down → 503; not configured → 503', async () => {
    const w = world();
    (w.reg.api.availability as any).mockRejectedValueOnce(new Error('boom'));
    expect((await runDomainSearch({ q: 'freshcuts' }, w.deps)).status).toBe(503);
    expect((await runDomainSearch({ q: 'freshcuts' }, { ...w.deps, vercel: null })).status).toBe(503);
  });
});

// ─── claim ───

describe('POST /api/ios/domain/claim', () => {
  it('buys at the server-side price with Vercel auto-renew OFF, then turns it on (Apple renews), attaches, links', async () => {
    const w = world();
    const r = await w.claim({ ...CLAIM, price: 0.01, expectedPrice: 0.01, projectName: 'evil' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ domain: 'freshcuts.com', state: 'live', url: 'https://freshcuts.com', autoRenew: true });
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
    expect((w.reg.api.buy as any).mock.calls[0][1]).toMatchObject({ expectedPrice: 11.25, autoRenew: false, contact: CONTACT });
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(true);
    expect([...w.reg.projects.get('fresh-cuts')!.entries()]).toEqual([
      ['freshcuts.com', { redirect: null }],
      ['www.freshcuts.com', { redirect: 'freshcuts.com' }],
    ]);
    expect(w.hooks.onDomainLinked).toHaveBeenCalledWith('fresh-cuts', 'freshcuts.com');
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'live', auto_renew: true, auto_renew_synced: true, lease_until: null });
  });

  it('P3: cancelled at Apple before the claim → bought, and Vercel auto-renew stays OFF', async () => {
    const w = world();
    w.domainSubs['100'].autoRenew = false;
    await w.notify('DID_CHANGE_RENEWAL_STATUS', 'd-o1', 'AUTO_RENEW_DISABLED'); // no row yet: ignored
    const r = await w.claim(CLAIM);
    expect(r).toMatchObject({ status: 200, body: { state: `cancelled-until:${new Date(T0 + 365 * DAY).toISOString()}`, autoRenew: false } });
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(false);
    expect(w.reg.api.setAutoRenew).not.toHaveBeenCalled();
  });

  it('unknown Apple renewal status never turns auto-renew on', async () => {
    const w = world();
    w.domainSubs['100'].autoRenew = null;
    await w.claim(CLAIM);
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(false);
  });

  it('idempotent: claiming again never buys again', async () => {
    const w = world();
    await w.claim(CLAIM);
    expect((await w.claim(CLAIM)).status).toBe(200);
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
    expect(w.hooks.onDomainLinked).toHaveBeenCalledTimes(1);
  });

  it('another name while the slot holds one → 409 slot-in-use, nothing bought', async () => {
    const w = world();
    await w.claim(CLAIM);
    expect(await w.claim({ ...CLAIM, domain: 'othername.com' })).toMatchObject({ status: 409, body: { error: 'slot-in-use', domain: 'freshcuts.com' } });
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('a domain transaction is bound to one site forever, even after a failure', async () => {
    const w = world();
    w.sites['203'] = { otid: 's-o9', slug: 'second-site' };
    w.domainSubs['100'].account.push('s-o9');
    (w.reg.api.buy as any).mockImplementationOnce(async () => ({ ok: false, code: 'domain_not_available', status: 400, definite: true }));
    expect(await w.claim(CLAIM)).toMatchObject({ status: 409, body: { error: 'claim-failed', state: 'failed:taken', canRetry: true } });
    expect(await w.claim({ ...CLAIM, siteTransactionId: '203', domain: 'secondsite.com' })).toEqual({ status: 409, body: { error: 'slot-bound-to-other-site' } });
  });

  it('taken (or premium) at claim time: the slot stays unused, pick another without paying again', async () => {
    const w = world({ taken: ['freshcuts.com'], prices: { 'pricey.com': { purchasePrice: 3000, renewalPrice: 3000 } } });
    expect(await w.claim(CLAIM)).toEqual({ status: 409, body: { error: 'domain-taken' } });
    expect(await w.claim({ ...CLAIM, domain: 'pricey.com' })).toEqual({ status: 409, body: { error: 'domain-not-eligible' } });
    expect(w.repo.rows.size).toBe(0);
    expect((await w.claim({ ...CLAIM, domain: 'freshcutsbarber.com' })).status).toBe(200);
  });

  it('registration fails after reserving (race) → failed:taken; the same slot then claims another name', async () => {
    const w = world();
    (w.reg.api.buy as any).mockImplementationOnce(async () => ({ ok: false, code: 'domain_not_available', status: 400, definite: true }));
    expect((await w.claim(CLAIM)).status).toBe(409);
    expect(await w.claim({ ...CLAIM, domain: 'freshcutsnyc.com' })).toMatchObject({ status: 200, body: { state: 'live', domain: 'freshcutsnyc.com' } });
  });

  it('an order the registrar fails → failed:registrar, slot reusable', async () => {
    const w = world();
    w.reg.setOrderMode({ failed: 'payment-failed' });
    expect(await w.claim(CLAIM)).toMatchObject({ status: 409, body: { state: 'failed:registrar' } });
    w.reg.setOrderMode('complete');
    expect((await w.claim(CLAIM)).status).toBe(200);
  });

  it('price moved between check and buy → failed:price', async () => {
    const w = world();
    (w.reg.api.buy as any).mockImplementationOnce(async () => ({ ok: false, code: 'expected_price_mismatch', status: 400, definite: true }));
    expect(await w.claim(CLAIM)).toMatchObject({ status: 409, body: { state: 'failed:price' } });
  });

  it('a config refusal from the registrar never burns the slot: back to reserved, retried by the sweep', async () => {
    const w = world();
    (w.reg.api.buy as any).mockImplementationOnce(async () => ({ ok: false, code: 'invalid_additional_contact_info', status: 400, definite: true }));
    expect((await w.claim(CLAIM)).status).toBe(202);
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'reserved', last_error: 'buy: invalid_additional_contact_info' });
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
  });

  it('two subscriptions racing for one site: the loser hears site-has-domain', async () => {
    const w = world();
    w.domainSubs['101'].account.push('s-o1');
    const [a, b] = await Promise.all([w.claim(CLAIM), w.claim({ transactionId: '101', siteTransactionId: '200', domain: 'another.com' })]);
    const errors = [a, b].filter((r) => r.status === 409).map((r) => (r.body as any).error);
    expect(errors).toEqual(['site-has-domain']);
  });
});

describe('claim: proof of ownership', () => {
  it('the site purchase must be under the same Apple account, else 403 and nothing reserved', async () => {
    const w = world();
    expect(await w.claim({ ...CLAIM, siteTransactionId: '201' })).toEqual({ status: 403, body: { error: 'not-owner' } });
    expect(w.repo.rows.size).toBe(0);
  });

  it("signed-in fallback: the user's shop is linked to that site purchase", async () => {
    const w = world();
    const deps = { ...w.deps, getUser: async (jwt: string) => (jwt === 'good' ? { id: 'u1', email: null, fullName: null } : null), shopOtidOf: async (u: string) => (u === 'u1' ? 's-o2' : null) };
    expect((await runDomainClaim({ ...CLAIM, siteTransactionId: '201' }, 'Bearer bad', deps)).status).toBe(403);
    expect(await runDomainClaim({ ...CLAIM, siteTransactionId: '201' }, 'Bearer good', deps)).toMatchObject({ status: 200, body: { state: 'live' } });
  });

  it('site and domain transactions swapped → 400 bad-product', async () => {
    const w = world();
    expect(await w.claim({ ...CLAIM, transactionId: '200' })).toEqual({ status: 400, body: { error: 'bad-product' } });
    expect(await w.claim({ ...CLAIM, siteTransactionId: '100' })).toEqual({ status: 400, body: { error: 'bad-product' } });
  });

  it('inactive domain subscription → 402; unknown → 404; Apple down → 503', async () => {
    const w = world();
    w.domainSubs['100'].status = 2;
    expect(await w.claim(CLAIM)).toEqual({ status: 402, body: { error: 'subscription-inactive' } });
    expect((await w.claim({ ...CLAIM, transactionId: '555' })).status).toBe(404);
    w.verifyDomain.mockRejectedValueOnce(new VerifyFailure('apple-unavailable'));
    expect((await w.claim({ ...CLAIM, transactionId: '101' })).status).toBe(503);
  });

  it('a site purchase without a site → 404; one domain per site → 409 site-has-domain', async () => {
    const w = world();
    w.domainSubs['100'].account.push('s-o3');
    expect(await w.claim({ ...CLAIM, siteTransactionId: '202' })).toEqual({ status: 404, body: { error: 'no-site' } });
    await w.claim(CLAIM);
    w.domainSubs['101'].account.push('s-o1');
    expect(await w.claim({ transactionId: '101', siteTransactionId: '200', domain: 'another.com' })).toEqual({ status: 409, body: { error: 'site-has-domain' } });
  });

  it.each([
    [{ ...CLAIM, transactionId: 'abc' }, 'transactionId'],
    [{ ...CLAIM, siteTransactionId: '' }, 'siteTransactionId'],
    [{ ...CLAIM, domain: 'fresh.net' }, 'domain'],
  ])('bad input → 400 (%j)', async (body, field) => {
    expect(await world().claim(body)).toEqual({ status: 400, body: { error: 'invalid', field } });
  });

  it('registrar not configured → 503 before anything is reserved', async () => {
    const w = world({ contact: null });
    expect(await w.claim(CLAIM)).toEqual({ status: 503, body: { error: 'domains-unavailable' } });
    expect(w.repo.rows.size).toBe(0);
  });

  it('rate limits per IP and per transaction, before Apple is asked', async () => {
    const w = world();
    const deny = (prefix: string) => ({ allow: vi.fn(async (k: string) => !k.startsWith(prefix)) });
    expect((await runDomainClaim(CLAIM, undefined, { ...w.deps, limiter: deny('domain-claim-ip:') }, '9.9.9.9')).status).toBe(429);
    expect((await runDomainClaim(CLAIM, undefined, { ...w.deps, limiter: deny('domain-claim-tx:') }, '9.9.9.9')).status).toBe(429);
    expect(w.verifyDomain).not.toHaveBeenCalled();
  });
});

describe('Sandbox (App Review / TestFlight) never buys a real domain', () => {
  const SB = { transactionId: '102', siteTransactionId: '210', domain: 'freshcuts.com' };

  it('simulated: no Vercel call, no republish; status says sandbox', async () => {
    const w = world();
    expect(await w.claim(SB)).toMatchObject({ status: 200, body: { state: 'live', sandbox: true } });
    for (const f of ['buy', 'addProjectDomain', 'setAutoRenew', 'owned'] as const) expect(w.reg.api[f]).not.toHaveBeenCalled();
    expect(w.hooks.onDomainLinked).not.toHaveBeenCalled();
  });

  it('never holds the name against a paying customer; never binds across environments', async () => {
    const w = world();
    await w.claim(SB);
    expect(await w.claim(CLAIM)).toMatchObject({ status: 200, body: { state: 'live', domain: 'freshcuts.com' } });
    w.sites['205'] = { otid: 's-o5', slug: 'prod-shop' };
    w.domainSubs['102'].account.push('s-o5');
    const w2 = world();
    w2.sites['205'] = { otid: 's-o5', slug: 'prod-shop' };
    w2.domainSubs['102'].account.push('s-o5');
    expect(await w2.claim({ ...SB, siteTransactionId: '205' })).toEqual({ status: 403, body: { error: 'environment-mismatch' } });
  });

  it('only allowlisted Sandbox otids use the real registrar', async () => {
    const w = world({ sandboxRealOtids: ['d-o3'] });
    await w.claim(SB);
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('a simulated lapse detaches without touching Vercel', async () => {
    const w = world();
    await w.claim(SB);
    w.domainSubs['102'].status = 2;
    w.tick(400 * DAY);
    await w.sweep();
    expect(w.repo.rows.get('d-o3')!.state).toBe('detached');
    expect(w.reg.api.removeProjectDomain).not.toHaveBeenCalled();
    expect(w.hooks.onDomainUnlinked).not.toHaveBeenCalled();
  });
});

describe('unknown buy outcomes and crashes (never buys twice, never re-buys on availability alone)', () => {
  it('buy response lost after the order went through → resumed as bought, buy never repeated', async () => {
    const w = world();
    w.reg.queueBuy('lost-response');
    expect((await w.claim(CLAIM)).status).toBe(202);
    expect(w.repo.rows.get('d-o1')!.state).toBe('buying');
    expect(await w.claim(CLAIM)).toMatchObject({ status: 200, body: { state: 'live' } });
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('network error, nothing placed, name still available: STAYS buying (admin-visible), never re-bought automatically', async () => {
    const w = world();
    w.reg.queueBuy('network');
    await w.claim(CLAIM);
    for (const t of [10 * 60_000, 2 * 3600_000, 3 * DAY]) {
      w.tick(t);
      await w.sweep();
      await w.claim(CLAIM);
    }
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'buying' });
    expect(w.repo.rows.get('d-o1')!.last_error).toMatch(/admin/);
    // The admin checked Vercel: nothing was bought → retry.
    expect(await releaseStuckBuy('fresh-cuts', 'retry', 'admin@x', w.deps)).toEqual({ ok: true, domain: 'freshcuts.com' });
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
    expect(w.reg.api.buy).toHaveBeenCalledTimes(2);
  });

  it('admin abandon frees the slot', async () => {
    const w = world();
    w.reg.queueBuy('network');
    await w.claim(CLAIM);
    expect(await releaseStuckBuy('fresh-cuts', 'abandon', 'admin@x', w.deps)).toEqual({ ok: true, domain: 'freshcuts.com' });
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'failed', failure_reason: 'registrar' });
    expect(await releaseStuckBuy('fresh-cuts', 'retry', 'a', w.deps)).toEqual({ ok: false, error: 'no-domain' });
  });

  it('lost order id while the order is still processing: never freed, never bought twice', async () => {
    const w = world();
    (w.reg.api.buy as any).mockImplementationOnce(async (domain: string) => {
      w.reg.orders.set('ord_x', { domain, status: 'purchasing', errorCode: null, years: 1, renew: false });
      return { ok: false, code: 'timeout', status: 0, definite: false };
    });
    await w.claim(CLAIM);
    w.tick(2 * DAY);
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('buying');
    expect(await w.claim({ ...CLAIM, domain: 'another.com' })).toMatchObject({ status: 409, body: { error: 'slot-in-use' } });
    w.reg.completeOrders();
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(true); // turned on after recording
  });

  it('crash after the buy succeeded but before the order id was recorded → owned → bought, no second buy', async () => {
    const w = world();
    const update = w.repo.update.bind(w.repo);
    let blown = false;
    w.repo.update = vi.fn(async (otid, from, patch, where) => {
      if (!blown && patch.state === 'ordered') { blown = true; throw new Error('ios_domains update failed: connection reset'); }
      return update(otid, from, patch, where);
    }) as any;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await w.claim(CLAIM)).status).toBe(503);
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'buying', lease_until: null });
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('two runners with no lease racing reserved→buying: exactly one buy()', async () => {
    const w = world();
    w.repo.rows.set('d-o1', blankRow({ original_transaction_id: 'd-o1', site_slug: 'fresh-cuts', domain: 'freshcuts.com', paid_until: new Date(T0 + 365 * DAY).toISOString() }));
    const row = w.repo.rows.get('d-o1')!;
    await Promise.all([advance({ ...row }, w.deps), advance({ ...row }, w.deps)]);
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('order still processing → 202 registering; the sweep finishes it', async () => {
    const w = world();
    w.reg.setOrderMode('pending');
    expect(await w.claim(CLAIM)).toMatchObject({ status: 202, body: { state: 'registering' } });
    w.reg.completeOrders();
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
  });

  it('attach fails → stays bought; republish fails → stays attached; both retried without buying', async () => {
    const w = world();
    w.reg.failAttach(1);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await w.claim(CLAIM)).toMatchObject({ status: 202, body: { state: 'linking' } });
    w.hooks.onDomainLinked.mockRejectedValueOnce(new Error('publish-failed'));
    await w.claim(CLAIM);
    expect(w.repo.rows.get('d-o1')!.state).toBe('attached');
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('a claim in progress elsewhere (lease held) → 202, no step taken by the claim or the sweep', async () => {
    const w = world();
    w.repo.rows.set('d-o1', blankRow({ original_transaction_id: 'd-o1', site_slug: 'fresh-cuts', domain: 'freshcuts.com', lease_until: new Date(T0 + 60_000).toISOString() }));
    expect(await w.claim(CLAIM)).toMatchObject({ status: 202, body: { state: 'registering' } });
    await w.sweep();
    expect(w.reg.api.buy).not.toHaveBeenCalled();
  });

  it('a lease is released only by its holder', async () => {
    const w = world();
    w.repo.rows.set('d-o1', blankRow({ original_transaction_id: 'd-o1', site_slug: 'fresh-cuts', domain: 'freshcuts.com' }));
    const t1 = await w.repo.acquireLease('d-o1', T0, 1000);
    w.tick(2000);
    const t2 = await w.repo.acquireLease('d-o1', T0 + 2000, 1000);
    await w.repo.releaseLease('d-o1', t1!);
    expect(w.repo.rows.get('d-o1')!.lease_until).toBe(t2);
  });

  it('a reserved row the sweep resumes asks the payer first; ended subscription → failed, nothing bought', async () => {
    const w = world();
    w.repo.rows.set('d-o1', blankRow({ original_transaction_id: 'd-o1', site_slug: 'fresh-cuts', domain: 'freshcuts.com' }));
    w.domainSubs['100'].status = 2;
    await w.sweep();
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'failed', failure_reason: 'subscription-inactive' });
    expect(w.reg.api.buy).not.toHaveBeenCalled();
  });
});

describe('lifecycle: cancel, lapse, resubscribe — always from the payer and Vercel NOW', () => {
  it('auto-renew off at Apple → Vercel auto-renew off; status cancelled-until; back on', async () => {
    const w = world();
    await w.claim(CLAIM);
    w.domainSubs['100'].autoRenew = false;
    await w.notify('DID_CHANGE_RENEWAL_STATUS', 'd-o1', 'AUTO_RENEW_DISABLED');
    expect(w.repo.rows.get('d-o1')).toMatchObject({ auto_renew: false, auto_renew_synced: false, last_notification: 'DID_CHANGE_RENEWAL_STATUS:AUTO_RENEW_DISABLED' });
    await w.sweep();
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(false);
    expect(statusBody(w.repo.rows.get('d-o1')!).state).toBe(`cancelled-until:${new Date(T0 + 365 * DAY).toISOString()}`);
    w.domainSubs['100'].autoRenew = true;
    await w.notify('DID_CHANGE_RENEWAL_STATUS', 'd-o1', 'AUTO_RENEW_ENABLED');
    await w.sweep();
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(true);
  });

  it('out-of-order: a late DID_RENEW after a cancel never turns auto-renew back on (Apple re-read)', async () => {
    const w = world();
    await w.claim(CLAIM);
    w.domainSubs['100'].autoRenew = false;
    await w.notify('DID_CHANGE_RENEWAL_STATUS', 'd-o1', 'AUTO_RENEW_DISABLED');
    await w.notify('DID_RENEW'); // older, delivered late
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.auto_renew).toBe(false);
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(false);
  });

  it('turning auto-renew OFF is sent even when Vercel reads the registration as expired (registry grace window)', async () => {
    const w = world();
    await w.claim(CLAIM);
    w.domainSubs['100'].autoRenew = false;
    await w.notify('DID_CHANGE_RENEWAL_STATUS', 'd-o1', 'AUTO_RENEW_DISABLED');
    (w.reg.api.owned as any).mockResolvedValueOnce(null);
    await w.sweep();
    expect(w.reg.api.setAutoRenew).toHaveBeenLastCalledWith('freshcuts.com', false);
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(false);
  });

  it('a missed notification is caught by the periodic payer refresh', async () => {
    const w = world();
    await w.claim(CLAIM);
    w.domainSubs['100'].autoRenew = false; // Apple changed; the notification never arrived
    w.tick(13 * 3600_000);
    await w.sweep();
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(false);
  });

  it('notifications fail (Apple retries) when Apple cannot be asked', async () => {
    const w = world();
    await w.claim(CLAIM);
    w.verifyDomain.mockRejectedValueOnce(new VerifyFailure('apple-unavailable'));
    await expect(w.notify('DID_RENEW')).rejects.toBeTruthy();
  });

  it('P1: after Vercel auto-renewed into year 2, a cancel still turns Vercel auto-renew off', async () => {
    const w = world();
    await w.claim(CLAIM);
    w.tick(366 * DAY);
    w.domainSubs['100'].expiresAt = T0 + 730 * DAY; // Apple renewed
    await w.notify('DID_RENEW');
    await w.reg.api.owned('freshcuts.com');
    expect(w.reg.renewals('freshcuts.com')).toBe(1); // Vercel renewed on its own (the registry moved the expiry)
    w.tick(30 * DAY);
    w.domainSubs['100'].autoRenew = false;
    await w.notify('DID_CHANGE_RENEWAL_STATUS', 'd-o1', 'AUTO_RENEW_DISABLED');
    await w.sweep();
    expect(w.reg.api.setAutoRenew).toHaveBeenLastCalledWith('freshcuts.com', false);
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(false);
    w.tick(400 * DAY);
    w.reg.api.owned('freshcuts.com'); // the registry checks for renewals
    expect(w.reg.renewals('freshcuts.com')).toBe(1); // never renewed again
  });

  it('P2: lapse in year 2 → detached; resubscribe → re-attached (registration still ours), no second domain', async () => {
    const w = world();
    await w.claim(CLAIM);
    w.tick(366 * DAY);
    w.domainSubs['100'].expiresAt = T0 + 730 * DAY;
    await w.notify('DID_RENEW');
    w.tick(370 * DAY); // past the Apple period (and Vercel renewed the registration again)
    w.domainSubs['100'].status = 2;
    await w.notify('EXPIRED');
    await w.sweep();
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'detached', auto_renew: false });
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(false);
    expect(w.hooks.onDomainUnlinked).toHaveBeenCalledWith('fresh-cuts');
    w.domainSubs['100'].status = 1;
    w.domainSubs['100'].expiresAt = w.deps.now() + 365 * DAY;
    await w.notify('SUBSCRIBED', 'd-o1', 'RESUBSCRIBE');
    await w.sweep();
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'live', auto_renew: true });
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(true);
    expect(await w.claim({ ...CLAIM, domain: 'freshcutsbarber.com' })).toMatchObject({ status: 409, body: { error: 'slot-in-use' } });
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('resubscribe after the registration really ran out (Vercel confirms) → failed:registration-expired', async () => {
    const w = world();
    w.domainSubs['100'].autoRenew = false; // cancelled: the registration is bought non-renewing
    await w.claim(CLAIM);
    w.domainSubs['100'].status = 2;
    w.tick(366 * DAY + 2 * 3600_000);
    await w.sweep(); // detached, Vercel auto-renew off → the registration ends
    expect(w.repo.rows.get('d-o1')!.state).toBe('detached');
    w.tick(30 * DAY);
    w.domainSubs['100'].status = 1;
    w.domainSubs['100'].autoRenew = true;
    w.domainSubs['100'].expiresAt = w.deps.now() + 365 * DAY;
    await w.notify('SUBSCRIBED');
    await w.sweep();
    // expired 31 days ago: may still renew in the registry's grace window → not freed yet
    expect(w.repo.rows.get('d-o1')!.state).toBe('detached');
    w.tick(20 * DAY);
    w.domainSubs['100'].autoRenew = true;
    w.domainSubs['100'].expiresAt = w.deps.now() + 365 * DAY;
    await w.notify('SUBSCRIBED');
    await w.sweep();
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'failed', failure_reason: 'registration-expired' });
  });

  it('a Vercel outage during the re-attach check never frees the slot', async () => {
    const w = world();
    await w.claim(CLAIM);
    w.domainSubs['100'].status = 2;
    w.tick(366 * DAY);
    await w.sweep();
    w.domainSubs['100'].status = 1;
    w.domainSubs['100'].expiresAt = w.deps.now() + 365 * DAY;
    await w.notify('SUBSCRIBED');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    (w.reg.api.owned as any).mockRejectedValueOnce(new Error('vercel down'));
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).not.toBe('failed');
  });

  it('resubscribe while the site has a NEWER domain: newer wins, the old one stays detached and stops renewing (no 500)', async () => {
    const w = world();
    await w.claim(CLAIM);
    w.domainSubs['100'].status = 2;
    w.tick(366 * DAY);
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('detached');
    w.domainSubs['101'].account.push('s-o1');
    w.domainSubs['101'].expiresAt = w.deps.now() + 365 * DAY;
    expect((await w.claim({ transactionId: '101', siteTransactionId: '200', domain: 'newname.com' })).status).toBe(200);
    w.domainSubs['100'].status = 1;
    w.domainSubs['100'].expiresAt = w.deps.now() + 365 * DAY;
    await w.notify('SUBSCRIBED');
    const s = await w.sweep();
    expect(s.errors).toEqual([]);
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'detached', auto_renew: false });
    expect(w.repo.rows.get('d-o1')!.last_error).toMatch(/newer domain/);
    expect(w.reg.registered.get('freshcuts.com')?.renew ?? false).toBe(false);
  });

  it('billing grace: Apple still active → left alone; Apple unreachable → no action', async () => {
    const w = world();
    await w.claim(CLAIM);
    w.domainSubs['100'].status = 4;
    w.tick(366 * DAY);
    expect((await w.sweep()).stillActive).toEqual(['freshcuts.com']);
    w.verifyDomain.mockRejectedValue(new VerifyFailure('apple-unavailable'));
    w.tick(DAY);
    const s = await w.sweep();
    expect(s.payerUnavailable).toContain('freshcuts.com');
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
  });

  it('refund → detached by the next sweep', async () => {
    const w = world();
    await w.claim(CLAIM);
    w.domainSubs['100'].revoked = true;
    await w.notify('REFUND');
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('detached');
  });

  it('a lapse never interferes with a claim mid-step (lease): detached only afterwards', async () => {
    const w = world();
    let release!: () => void;
    w.hooks.onDomainLinked.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
    const claim = w.claim(CLAIM);
    await new Promise((r) => setTimeout(r, 0));
    while (!release) await new Promise((r) => setTimeout(r, 0));
    w.domainSubs['100'].status = 2;
    w.repo.rows.set('d-o1', { ...w.repo.rows.get('d-o1')!, paid_until: new Date(T0 - DAY).toISOString() });
    const s = await w.sweep();
    expect(s.detached).toEqual([]);
    expect(w.repo.rows.get('d-o1')!.state).toBe('attached');
    release();
    await claim;
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('detached');
  });

  it('a multi-year registration: cancel turns renew off, lapse detaches while it is still registered, resubscribe re-attaches', async () => {
    const w = world();
    w.reg.seed('freshcuts.com', 3, true); // e.g. bought for 3 years earlier
    w.repo.rows.set('d-o1', blankRow({ original_transaction_id: 'd-o1', site_slug: 'fresh-cuts', domain: 'freshcuts.com', state: 'live', auto_renew: true, paid_until: new Date(T0 + 365 * DAY).toISOString() }));
    w.domainSubs['100'].autoRenew = false;
    await w.notify('DID_CHANGE_RENEWAL_STATUS', 'd-o1', 'AUTO_RENEW_DISABLED');
    await w.sweep();
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(false);
    w.domainSubs['100'].status = 2;
    w.tick(400 * DAY);
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('detached');
    w.domainSubs['100'].status = 1;
    w.domainSubs['100'].autoRenew = true;
    w.domainSubs['100'].expiresAt = w.deps.now() + 365 * DAY;
    await w.notify('SUBSCRIBED');
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(true);
  });

  it('a notification before any claim does nothing (the claim reads Apple itself)', async () => {
    expect(await world().notify('DID_RENEW')).toEqual({ ok: true, ignored: 'no-domain' });
  });
});

describe('DNS: republish once Vercel reports the domain verified with correct DNS', () => {
  it('the sweep relinks once, after config is correct', async () => {
    const w = world();
    (w.reg.api.domainConfig as any).mockResolvedValue({ misconfigured: true });
    await w.claim(CLAIM);
    expect(w.hooks.onDomainLinked).toHaveBeenCalledTimes(1);
    await w.sweep();
    expect(w.hooks.onDomainLinked).toHaveBeenCalledTimes(1);
    (w.reg.api.domainConfig as any).mockResolvedValue({ misconfigured: false });
    expect((await w.sweep()).relinked).toEqual(['freshcuts.com']);
    await w.sweep();
    expect(w.hooks.onDomainLinked).toHaveBeenCalledTimes(2);
    expect(w.repo.rows.get('d-o1')!.dns_ready_at).not.toBeNull();
  });
});

describe('admin: transferred', () => {
  it('marks the live domain transferred; payer events and the sweep never touch it again', async () => {
    const w = world();
    await w.claim(CLAIM);
    expect(await markTransferred('fresh-cuts', 'admin@x', w.deps)).toEqual({ ok: true, domain: 'freshcuts.com' });
    expect(await w.notify('REFUND')).toEqual({ ok: true, ignored: 'transferred' });
    w.domainSubs['100'].status = 2;
    w.tick(400 * DAY);
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('transferred');
    expect(w.reg.api.removeProjectDomain).not.toHaveBeenCalled();
    w.domainSubs['100'].status = 1;
    w.domainSubs['100'].expiresAt = w.deps.now() + DAY;
    expect(await w.claim(CLAIM)).toMatchObject({ status: 409, body: { error: 'transferred' } });
  });

  it('targets the live row, not an old detached one', async () => {
    const w = world();
    w.repo.rows.set('old', blankRow({ original_transaction_id: 'old', site_slug: 'fresh-cuts', domain: 'oldname.com', state: 'detached', updated_at: new Date(T0 + 5).toISOString() }));
    w.repo.rows.set('cur', blankRow({ original_transaction_id: 'cur', site_slug: 'fresh-cuts', domain: 'newname.com', state: 'live' }));
    expect(await markTransferred('fresh-cuts', 'a', w.deps)).toEqual({ ok: true, domain: 'newname.com' });
    expect(await markTransferred('nope', 'a', w.deps)).toEqual({ ok: false, error: 'no-domain' });
  });
});

describe('GET /api/ios/domain/status', () => {
  it('none, then live with Vercel verification / DNS state', async () => {
    const w = world();
    expect(await runDomainStatus('100', w.deps)).toEqual({ status: 200, body: { domain: null, state: 'none' } });
    await w.claim(CLAIM);
    expect(await runDomainStatus('100', { ...w.deps, probeHttps: async () => true }))
      .toMatchObject({ status: 200, body: { domain: 'freshcuts.com', state: 'live', vercel: { verified: true, dnsOk: true, ssl: 'ready' } } });
  });

  it('only the domain product verifies; bad input 400', async () => {
    const w = world();
    expect((await runDomainStatus('200', w.deps)).status).toBe(400);
    expect((await runDomainStatus('x', w.deps)).status).toBe(400);
  });
});

describe('fake registrar sanity (the regression tests rely on it)', () => {
  it('auto-renews a renewing registration at expiry and charges; an expired one is not owned', async () => {
    let t = 0;
    const r = fakeRegistrar({ now: () => t });
    r.seed('a.com', 1, true);
    r.seed('b.com', 2, false);
    t = YEAR_MS + 1;
    expect(await r.api.owned('a.com')).toMatchObject({ expiresAt: 2 * YEAR_MS });
    expect(r.renewals('a.com')).toBe(1);
    expect(await r.api.owned('b.com')).toMatchObject({ expiresAt: 2 * YEAR_MS });
    t = 2 * YEAR_MS + 1;
    expect(await r.api.owned('b.com')).toBeNull();
  });
});

describe('fix round 2', () => {
  it('N1/Q1: paid at Apple but the registration is gone at Vercel → unlinked, failed:registration-expired, pick another name', async () => {
    const w = world();
    w.domainSubs['100'].autoRenew = null; // renewal info never decodes
    await w.claim(CLAIM);
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(false);
    w.tick(390 * DAY);
    w.domainSubs['100'].expiresAt = w.deps.now() + 300 * DAY;
    await w.sweep(); // expired 25 days ago: not gone yet (grace window)
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
    w.tick(30 * DAY);
    w.domainSubs['100'].expiresAt = w.deps.now() + 300 * DAY; // Apple keeps renewing
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await w.sweep();
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'failed', failure_reason: 'registration-expired' });
    expect(w.repo.rows.get('d-o1')!.last_error).toMatch(/ALERT/);
    expect(w.reg.projects.get('fresh-cuts')!.size).toBe(0);
    expect(w.hooks.onDomainUnlinked).toHaveBeenCalledWith('fresh-cuts');
    expect(await w.claim({ ...CLAIM, domain: 'freshcutsbarber.com' })).toMatchObject({ status: 200, body: { domain: 'freshcutsbarber.com', url: 'https://freshcutsbarber.com' } });
  });

  it('N1/Q2: renewal off while the registration ends before the paid period → Vercel renews it once to cover what was paid', async () => {
    const w = world();
    w.domainSubs['100'].expiresAt = T0 + 500 * DAY; // paid well past the registration (late claim)
    w.domainSubs['100'].autoRenew = false;
    await w.claim(CLAIM);
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(true); // covers the paid period
    w.tick(366 * DAY);
    await w.reg.api.owned('freshcuts.com');
    expect(w.reg.renewals('freshcuts.com')).toBe(1);
    w.tick(13 * 3600_000);
    await w.sweep(); // now the registration outlasts paid_until → off
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(false);
  });

  it('N1: Apple renewal status unknown later → the current Vercel setting is kept and flagged', async () => {
    const w = world();
    await w.claim(CLAIM);
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(true);
    w.domainSubs['100'].autoRenew = null;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await w.notify('DID_RENEW');
    await w.sweep();
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(true);
    expect(w.repo.rows.get('d-o1')).toMatchObject({ auto_renew: true, last_error: RENEWAL_UNKNOWN });
    w.domainSubs['100'].autoRenew = false;
    await w.notify('DID_CHANGE_RENEWAL_STATUS', 'd-o1', 'AUTO_RENEW_DISABLED');
    expect(w.repo.rows.get('d-o1')!.last_error).toBeNull();
  });

  it('N3: the post-DNS step retries until the stored base is the domain', async () => {
    const w = world();
    let stored: string | null = 'https://fresh-cuts.vercel.app';
    let blips = 1;
    const refresh = vi.fn(async () => { stored = 'https://freshcuts.com'; });
    w.hooks.onDomainLinked.mockImplementation(async () => { if (blips-- <= 0) stored = 'https://freshcuts.com'; });
    w.deps.base = { read: async () => stored, refresh, clear: vi.fn(async () => {}) };
    await w.claim(CLAIM); // republish #1 (blip: base unchanged)
    await w.sweep(); // DNS ok → republish #2 → still blip? no: second call sets it
    expect(w.repo.rows.get('d-o1')!.dns_ready_at).not.toBeNull();
    expect(stored).toBe('https://freshcuts.com');
  });

  it('N3: a refresh blip keeps the step pending, the next sweep refreshes the base only', async () => {
    const w = world();
    let stored: string | null = 'https://fresh-cuts.vercel.app';
    const refresh = vi.fn(async () => { stored = 'https://freshcuts.com'; });
    w.deps.base = { read: async () => stored, refresh, clear: vi.fn(async () => {}) };
    await w.claim(CLAIM);
    await w.sweep();
    expect(w.repo.rows.get('d-o1')).toMatchObject({ dns_ready_at: null, last_error: BASE_PENDING });
    await w.sweep();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(w.repo.rows.get('d-o1')!.dns_ready_at).not.toBeNull();
    expect(w.hooks.onDomainLinked).toHaveBeenCalledTimes(2); // claim + first DNS republish only
  });

  it('N3: unlinking retries the base refresh when it still points at the detached domain', async () => {
    const w = world();
    let stored: string | null = 'https://freshcuts.com';
    let calls = 0;
    const clear = vi.fn(async () => {});
    w.deps.base = { read: async () => stored, refresh: vi.fn(async () => { if (++calls >= 2) stored = 'https://fresh-cuts.vercel.app'; }), clear };
    await w.claim(CLAIM);
    w.domainSubs['100'].status = 2;
    w.tick(366 * DAY);
    await w.sweep(); // lapse pass: first refresh blips → waits; resume pass: second refresh works
    expect(w.repo.rows.get('d-o1')!.state).toBe('detached');
    expect(stored).toBe('https://fresh-cuts.vercel.app');
    expect(clear).not.toHaveBeenCalled();
  });

  it('N6: the same site re-buys its own detached name with a new subscription: handed over, no second purchase', async () => {
    const w = world();
    w.domainSubs['100'].autoRenew = true;
    await w.claim(CLAIM);
    w.domainSubs['100'].status = 2;
    w.tick(300 * DAY + 400 * DAY);
    w.reg.registered.get('freshcuts.com')!.expiresAt = w.deps.now() + 100 * DAY;
    w.domainSubs['100'].expiresAt = T0 + 365 * DAY;
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('detached');
    w.domainSubs['101'].account.push('s-o1');
    w.domainSubs['101'].expiresAt = w.deps.now() + 365 * DAY;
    expect(await w.claim({ transactionId: '101', siteTransactionId: '200', domain: 'freshcuts.com' })).toMatchObject({ status: 200, body: { state: 'live' } });
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'failed', failure_reason: 'moved-to-new-subscription' });
  });

  it('N7: a detached row whose registration is gone and whose payer ended is never re-checked again', async () => {
    const w = world();
    w.domainSubs['100'].autoRenew = false;
    await w.claim(CLAIM);
    w.domainSubs['100'].status = 2;
    w.tick(370 * DAY);
    await w.sweep();
    w.tick(50 * DAY);
    await w.sweep();
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'failed', failure_reason: 'registration-expired' });
    const calls = w.verifyDomain.mock.calls.length;
    w.tick(13 * 3600_000);
    await w.sweep();
    expect(w.verifyDomain.mock.calls.length).toBe(calls);
  });
});

describe('fix round 3', () => {
  it('R1: a renewing registration that reads as expired (renewal lag) is never failed; renew OFF is sent before any fail', async () => {
    let now = T0;
    const w = world();
    // swap in a registrar with a 20-day renewal lag
    const lagReg = fakeRegistrar({ now: () => w.deps.now(), renewLagMs: 20 * DAY });
    w.deps.vercel = lagReg.api;
    await w.claim(CLAIM);
    expect(lagReg.registered.get('freshcuts.com')!.renew).toBe(true);
    w.tick(370 * DAY); // expired 5 days, the renewal not landed yet
    w.domainSubs['100'].expiresAt = w.deps.now() + 300 * DAY;
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
    w.tick(20 * DAY); // the renewal lands
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
    expect(lagReg.renewals('freshcuts.com')).toBe(1);
    void now;
  });

  it('R1: before failing a gone registration, auto-renew OFF is sent', async () => {
    const w = world();
    w.domainSubs['100'].autoRenew = false;
    await w.claim(CLAIM);
    w.domainSubs['100'].status = 2;
    w.tick(370 * DAY);
    await w.sweep();
    w.tick(50 * DAY);
    (w.reg.api.setAutoRenew as any).mockClear();
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('failed');
    expect(w.reg.api.setAutoRenew).toHaveBeenCalledWith('freshcuts.com', false);
  });

  it('R3: no cover-the-paid-period renewal for a revoked (refunded) payer', async () => {
    const w = world();
    w.domainSubs['100'].expiresAt = T0 + 500 * DAY;
    w.domainSubs['100'].autoRenew = false;
    w.domainSubs['100'].revoked = true;
    w.domainSubs['100'].status = 1;
    w.repo.rows.set('d-o1', blankRow({ original_transaction_id: 'd-o1', site_slug: 'fresh-cuts', domain: 'freshcuts.com', state: 'live', paid_until: new Date(T0 + 500 * DAY).toISOString(), revoked_at: new Date(T0).toISOString(), auto_renew_synced: false }));
    w.reg.seed('freshcuts.com', 1, false);
    await w.sweep();
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(false);
  });

  it('R6: unlinking never waits forever: no vercel.app fallback → the base is cleared and the row detaches', async () => {
    const w = world();
    let stored: string | null = 'https://freshcuts.com';
    const clear = vi.fn(async () => { stored = null; });
    w.deps.base = { read: async () => stored, refresh: vi.fn(async () => {}), clear };
    await w.claim(CLAIM);
    w.domainSubs['100'].status = 2;
    w.tick(366 * DAY);
    await w.sweep(); // waits once, then (resume pass) clears instead of waiting forever
    expect(clear).toHaveBeenCalledWith('fresh-cuts');
    expect(w.repo.rows.get('d-o1')!.state).toBe('detached');
    expect(stored).toBeNull();
  });
});

describe('re-review 3: G1–G3', () => {
  it('G1+G3: a paid domain found expired alerts support at once, only once; the row still waits 45 days', async () => {
    const w = world();
    const notifySupport = vi.fn(async (_s: string, _t: string) => {});
    w.deps.notifySupport = notifySupport;
    w.domainSubs['100'].autoRenew = null;
    await w.claim(CLAIM);
    w.tick(370 * DAY);
    w.domainSubs['100'].expiresAt = w.deps.now() + 300 * DAY;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await w.sweep();
    expect(notifySupport).toHaveBeenCalledTimes(1);
    expect(notifySupport.mock.calls[0][0]).toBe('Domain expired while paid: freshcuts.com');
    expect(notifySupport.mock.calls[0][1]).not.toMatch(/@/);
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
    w.tick(13 * 3600_000);
    await w.sweep();
    w.tick(13 * 3600_000);
    await w.sweep();
    expect(notifySupport).toHaveBeenCalledTimes(1);
    expect(Object.keys(w.repo.rows.get('d-o1')!.alerts_sent!)).toHaveLength(1);
  });

  it('G3: a failed send is retried next time, then recorded', async () => {
    const w = world();
    const notifySupport = vi.fn().mockRejectedValueOnce(new Error('smtp')).mockResolvedValue(undefined);
    w.deps.notifySupport = notifySupport;
    w.repo.rows.set('d-o1', blankRow({ original_transaction_id: 'd-o1', site_slug: 'fresh-cuts', domain: 'freshcuts.com' }));
    const { alertOnce } = await import('../../lib/ios/domainFlow.js');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await alertOnce(w.repo.rows.get('d-o1')!, 'k', 's', 't', w.deps)).toBe(false);
    expect(await alertOnce(w.repo.rows.get('d-o1')!, 'k', 's', 't', w.deps)).toBe(true);
    expect(await alertOnce(w.repo.rows.get('d-o1')!, 'k', 's', 't', w.deps)).toBe(false);
    expect(notifySupport).toHaveBeenCalledTimes(2);
  });

  it('G2: any 4xx from auto-renew OFF on a long-expired name counts as done (the row is not stuck)', async () => {
    const w = world();
    w.domainSubs['100'].autoRenew = false;
    await w.claim(CLAIM);
    w.domainSubs['100'].status = 2;
    w.tick(370 * DAY);
    await w.sweep();
    w.tick(50 * DAY);
    const { VercelApiError } = await import('../../lib/ios/vercelDomains.js');
    (w.reg.api.setAutoRenew as any).mockRejectedValue(new VercelApiError(400, 'domain_expired'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await w.sweep();
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'failed', failure_reason: 'registration-expired' });
  });

  it('G2: a 4xx on a name that is NOT long expired is still retried', async () => {
    const { forceRenewOff } = await import('../../lib/ios/domainFlow.js');
    const { VercelApiError } = await import('../../lib/ios/vercelDomains.js');
    const vercel = { setAutoRenew: vi.fn(async () => { throw new VercelApiError(400, 'weird'); }) } as any;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await forceRenewOff('x.com', { vercel })).toBe(false);
    expect(await forceRenewOff('x.com', { vercel }, { longExpired: true })).toBe(true);
  });
});
