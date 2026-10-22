import { describe, it, expect, vi } from 'vitest';
import {
  BUY_GIVE_UP_MS, BUY_UNCERTAIN_MS, applyDomainNotification, markTransferred, runDomainClaim, runDomainSearch, runDomainStatus,
  statusBody, sweepDomains, type DomainFlowDeps,
} from '../../lib/ios/domainFlow.js';
import { VerifyFailure, type VerifiedTx } from '../../lib/ios/appleVerify.js';
import { DOMAIN_PRODUCT_ID } from '../../lib/ios/tiers.js';
import { fakeDomainsRepo, blankRow } from './fakeDomainsRepo.js';
import { fakeRegistrar } from './fakeRegistrar.js';

const T0 = 1_800_000_000_000;
const DAY = 24 * 3600_000;
const CONTACT = {
  firstName: 'A', lastName: 'B', email: 'ops@example.com', phone: '+15555550100',
  address1: '1 Main St', city: 'Town', state: 'CA', zip: '90000', country: 'US',
};

interface AppleSub { otid: string; environment: 'Production' | 'Sandbox'; status: number; expiresAt: number; revoked?: boolean; account: string[] }

function world(opts: { taken?: string[]; prices?: Record<string, any>; contact?: any; sandboxRealOtids?: string[] } = {}) {
  let now = T0;
  const clock = () => now;
  const reg = fakeRegistrar({ now: clock, taken: opts.taken, prices: opts.prices });
  const repo = fakeDomainsRepo([], clock);
  // Domain subscriptions by transaction id AND by otid (renewals verify by otid).
  const domainSubs: Record<string, AppleSub> = {
    '100': { otid: 'd-o1', environment: 'Production', status: 1, expiresAt: T0 + 365 * DAY, account: ['d-o1', 's-o1'] },
    '101': { otid: 'd-o2', environment: 'Production', status: 1, expiresAt: T0 + 365 * DAY, account: ['d-o2', 's-o9'] },
    '102': { otid: 'd-o3', environment: 'Sandbox', status: 1, expiresAt: T0 + 365 * DAY, account: ['d-o3', 's-sb'] },
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
    sitePurchase: async (otid) => {
      const s = Object.values(sites).find((x) => x.otid === otid);
      return s ? { original_transaction_id: s.otid, site_slug: s.slug } : null;
    },
    hooks,
    now: clock,
    sandboxRealOtids: new Set(opts.sandboxRealOtids ?? []),
  };
  return {
    deps, reg, repo, hooks, domainSubs, sites, verifyDomain,
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
    expect(results.every((x: any) => x.domain.endsWith('.com'))).toBe(true);
  });

  it('a price sent as a string is not eligible', async () => {
    const w = world({ prices: { 'freshcuts.com': { purchasePrice: '11.25', renewalPrice: 11.25 } } });
    const r = await runDomainSearch({ q: 'freshcuts' }, w.deps);
    expect((r.body as any).results[0]).toEqual({ domain: 'freshcuts.com', available: true, eligible: false });
  });

  it('never asks Apple; the same answer whether the transactionId exists or not', async () => {
    const w = world();
    const a = await runDomainSearch({ q: 'freshcuts', transactionId: '100' }, w.deps);
    const b = await runDomainSearch({ q: 'freshcuts', transactionId: '999999' }, w.deps);
    const c = await runDomainSearch({ q: 'freshcuts' }, w.deps);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(w.verifyDomain).not.toHaveBeenCalled();
  });

  it('rate limited per transaction (hashed key, never the raw id)', async () => {
    const w = world();
    const allow = vi.fn(async () => false);
    const r = await runDomainSearch({ q: 'freshcuts', transactionId: '100' }, { ...w.deps, limiter: { allow } });
    expect(r.status).toBe(429);
    const key = (allow.mock.calls[0] as any[])[0] as string;
    expect(key).toMatch(/^domain-search-tx:[0-9a-f]{32}$/);
    expect(key).not.toContain('100');
  });

  it('per-IP limit in its own bucket, checked before any lookup', async () => {
    const w = world();
    const allow = vi.fn(async (key: string) => !key.startsWith('domain-search-ip:'));
    const r = await runDomainSearch({ q: 'freshcuts' }, { ...w.deps, limiter: { allow } }, '9.9.9.9');
    expect(r.status).toBe(429);
    expect(allow).toHaveBeenCalledWith('domain-search-ip:9.9.9.9', 'write');
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

// ─── claim: happy path and money rules ───

describe('POST /api/ios/domain/claim', () => {
  it('buys at the server-side Vercel price, attaches apex + www → apex, links, live', async () => {
    const w = world();
    const r = await w.claim({ ...CLAIM, price: 0.01, expectedPrice: 0.01, projectName: 'evil' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ domain: 'freshcuts.com', state: 'live', url: 'https://freshcuts.com', autoRenew: true });
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
    expect((w.reg.api.buy as any).mock.calls[0][1]).toMatchObject({ expectedPrice: 11.25, autoRenew: true, contact: CONTACT });
    expect([...w.reg.projects.get('fresh-cuts')!.entries()]).toEqual([
      ['freshcuts.com', { redirect: null }],
      ['www.freshcuts.com', { redirect: 'freshcuts.com' }],
    ]);
    expect(w.hooks.onDomainLinked).toHaveBeenCalledWith('fresh-cuts', 'freshcuts.com');
    const row = w.repo.rows.get('d-o1')!;
    expect(row).toMatchObject({ state: 'live', site_slug: 'fresh-cuts', domain: 'freshcuts.com', expected_price: 11.25, order_id: 'ord_1' });
    expect(row.lease_until).toBeNull();
    expect(row.registration_expires_at).not.toBeNull();
  });

  it('idempotent: claiming again never buys again', async () => {
    const w = world();
    await w.claim(CLAIM);
    const r = await w.claim(CLAIM);
    expect(r.status).toBe(200);
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
    expect(w.hooks.onDomainLinked).toHaveBeenCalledTimes(1);
  });

  it('another name while the slot holds one → 409 slot-in-use, nothing bought', async () => {
    const w = world();
    await w.claim(CLAIM);
    const r = await w.claim({ ...CLAIM, domain: 'othername.com' });
    expect(r).toMatchObject({ status: 409, body: { error: 'slot-in-use', domain: 'freshcuts.com' } });
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('a domain transaction is bound to one site forever, even after a failure', async () => {
    // The race: available at the precheck, taken at the buy → failed row bound to fresh-cuts.
    const w2 = world();
    w2.sites['203'] = { otid: 's-o9', slug: 'second-site' };
    w2.domainSubs['100'].account.push('s-o9');
    (w2.reg.api.buy as any).mockImplementationOnce(async () => ({ ok: false, code: 'domain_not_available', status: 400, definite: true }));
    const first = await w2.claim(CLAIM);
    expect(first).toMatchObject({ status: 409, body: { error: 'claim-failed', state: 'failed:taken', canRetry: true } });
    const other = await w2.claim({ ...CLAIM, siteTransactionId: '203', domain: 'secondsite.com' });
    expect(other).toEqual({ status: 409, body: { error: 'slot-bound-to-other-site' } });
    expect(w2.repo.rows.get('d-o1')!.site_slug).toBe('fresh-cuts');
  });

  it('taken (or premium) at search-to-buy time: the slot stays unused, pick another without paying again', async () => {
    const w = world({ taken: ['freshcuts.com'], prices: { 'pricey.com': { purchasePrice: 3000, renewalPrice: 3000 } } });
    expect(await w.claim(CLAIM)).toEqual({ status: 409, body: { error: 'domain-taken' } });
    expect(await w.claim({ ...CLAIM, domain: 'pricey.com' })).toEqual({ status: 409, body: { error: 'domain-not-eligible' } });
    expect(w.repo.rows.size).toBe(0);
    expect(w.reg.api.buy).not.toHaveBeenCalled();
    const r = await w.claim({ ...CLAIM, domain: 'freshcutsbarber.com' });
    expect(r).toMatchObject({ status: 200, body: { state: 'live', domain: 'freshcutsbarber.com' } });
  });

  it('registration fails after reserving (race) → failed:taken; the same slot then claims another name', async () => {
    const w = world();
    (w.reg.api.buy as any).mockImplementationOnce(async () => ({ ok: false, code: 'domain_not_available', status: 400, definite: true }));
    expect((await w.claim(CLAIM)).status).toBe(409);
    expect(w.repo.rows.get('d-o1')!.state).toBe('failed');
    const r = await w.claim({ ...CLAIM, domain: 'freshcutsnyc.com' });
    expect(r).toMatchObject({ status: 200, body: { state: 'live', domain: 'freshcutsnyc.com' } });
    expect(w.repo.rows.get('d-o1')!.site_slug).toBe('fresh-cuts');
  });

  it('an order the registrar fails → failed:registrar, slot reusable', async () => {
    const w = world();
    w.reg.setOrderMode({ failed: 'payment-failed' });
    expect(await w.claim(CLAIM)).toMatchObject({ status: 409, body: { state: 'failed:registrar' } });
    w.reg.setOrderMode('complete');
    expect((await w.claim(CLAIM)).status).toBe(200);
  });

  it('price moved between check and buy (expected_price_mismatch) → failed:price', async () => {
    const w = world();
    (w.reg.api.buy as any).mockImplementationOnce(async () => ({ ok: false, code: 'expected_price_mismatch', status: 400, definite: true }));
    expect(await w.claim(CLAIM)).toMatchObject({ status: 409, body: { state: 'failed:price' } });
  });

  it('a config refusal from the registrar (bad contact) never burns the slot: back to reserved, retried', async () => {
    const w = world();
    (w.reg.api.buy as any).mockImplementationOnce(async () => ({ ok: false, code: 'invalid_additional_contact_info', status: 400, definite: true }));
    expect((await w.claim(CLAIM)).status).toBe(202);
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'reserved', last_error: 'buy: invalid_additional_contact_info' });
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
  });
});

describe('claim: rate limits', () => {
  it('per IP and per transaction (hashed), before Apple is asked', async () => {
    const w = world();
    const keys: string[] = [];
    const deny = (prefix: string) => ({ allow: vi.fn(async (k: string) => { keys.push(k); return !k.startsWith(prefix); }) });
    expect((await runDomainClaim(CLAIM, undefined, { ...w.deps, limiter: deny('domain-claim-ip:') }, '9.9.9.9')).status).toBe(429);
    expect((await runDomainClaim(CLAIM, undefined, { ...w.deps, limiter: deny('domain-claim-tx:') }, '9.9.9.9')).status).toBe(429);
    expect(w.verifyDomain).not.toHaveBeenCalled();
    expect(keys.some((k) => k.includes('100'))).toBe(false);
  });
});

describe('claim: proof of ownership', () => {
  it('the site purchase must be under the same Apple account (Apple-listed), else 403 and nothing reserved', async () => {
    const w = world();
    const r = await w.claim({ ...CLAIM, siteTransactionId: '201' });
    expect(r).toEqual({ status: 403, body: { error: 'not-owner' } });
    expect(w.repo.rows.size).toBe(0);
  });

  it("signed-in fallback: the user's shop is linked to that site purchase", async () => {
    const w = world();
    const deps = { ...w.deps, getUser: async (jwt: string) => (jwt === 'good' ? { id: 'u1', email: null, fullName: null } : null), shopOtidOf: async (u: string) => (u === 'u1' ? 's-o2' : null) };
    expect((await runDomainClaim({ ...CLAIM, siteTransactionId: '201' }, 'Bearer bad', deps)).status).toBe(403);
    const r = await runDomainClaim({ ...CLAIM, siteTransactionId: '201' }, 'Bearer good', deps);
    expect(r).toMatchObject({ status: 200, body: { state: 'live' } });
    expect(w.repo.rows.get('d-o1')!.site_slug).toBe('other-shop');
  });

  it('a site transaction sent as the domain transaction → 400 bad-product (the domain verifier only takes the domain product)', async () => {
    const w = world();
    expect(await w.claim({ ...CLAIM, transactionId: '200' })).toEqual({ status: 400, body: { error: 'bad-product' } });
  });

  it('a domain transaction sent as the site transaction → 400 bad-product', async () => {
    const w = world();
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

  it('a site purchase without a site yet → 404 no-site', async () => {
    const w = world();
    w.domainSubs['100'].account.push('s-o3');
    expect(await w.claim({ ...CLAIM, siteTransactionId: '202' })).toEqual({ status: 404, body: { error: 'no-site' } });
  });

  it('one domain per site: a second subscription for the same site → 409 site-has-domain', async () => {
    const w = world();
    await w.claim(CLAIM);
    w.domainSubs['101'].account.push('s-o1');
    expect(await w.claim({ transactionId: '101', siteTransactionId: '200', domain: 'another.com' })).toEqual({ status: 409, body: { error: 'site-has-domain' } });
  });

  it.each([
    [{ ...CLAIM, transactionId: 'abc' }, 'transactionId'],
    [{ ...CLAIM, siteTransactionId: '' }, 'siteTransactionId'],
    [{ ...CLAIM, domain: 'fresh.net' }, 'domain'],
    [{ ...CLAIM, domain: 'xn--fresh.com' }, 'domain'],
  ])('bad input → 400 (%j)', async (body, field) => {
    expect(await world().claim(body)).toEqual({ status: 400, body: { error: 'invalid', field } });
  });

  it('registrar not configured (no registrant contact) → 503 before anything is reserved', async () => {
    const w = world({ contact: null });
    expect(await w.claim(CLAIM)).toEqual({ status: 503, body: { error: 'domains-unavailable' } });
    expect(w.repo.rows.size).toBe(0);
  });
});

describe('Sandbox (App Review / TestFlight) never buys a real domain', () => {
  it('simulated: no buy, no attach, no republish; status says sandbox', async () => {
    const w = world();
    const r = await w.claim({ transactionId: '102', siteTransactionId: '210', domain: 'freshcuts.com' });
    expect(r).toMatchObject({ status: 200, body: { state: 'live', sandbox: true } });
    expect(w.reg.api.buy).not.toHaveBeenCalled();
    expect(w.reg.api.addProjectDomain).not.toHaveBeenCalled();
    expect(w.reg.api.setAutoRenew).not.toHaveBeenCalled();
    expect(w.hooks.onDomainLinked).not.toHaveBeenCalled();
  });

  it('simulated even when the registrar is not configured', async () => {
    const w = world({ contact: null });
    expect((await w.claim({ transactionId: '102', siteTransactionId: '210', domain: 'freshcuts.com' })).status).toBe(200);
  });

  it('only allowlisted Sandbox otids use the real registrar', async () => {
    const w = world({ sandboxRealOtids: ['d-o3'] });
    await w.claim({ transactionId: '102', siteTransactionId: '210', domain: 'freshcuts.com' });
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('a Sandbox claim never holds the name against a paying customer', async () => {
    const w = world();
    await w.claim({ transactionId: '102', siteTransactionId: '210', domain: 'freshcuts.com' });
    expect(w.repo.rows.get('d-o3')!.state).toBe('live');
    const r = await w.claim(CLAIM);
    expect(r).toMatchObject({ status: 200, body: { state: 'live', domain: 'freshcuts.com' } });
    expect(r.body).not.toHaveProperty('sandbox');
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('a Sandbox domain never binds to a Production site (or the reverse): 403, nothing reserved', async () => {
    const w = world();
    w.sites['205'] = { otid: 's-o5', slug: 'prod-shop' };
    w.domainSubs['102'].account.push('s-o5');
    // world()'s verifySite answers Production for every site; the Sandbox domain sub must be refused.
    expect(await w.claim({ transactionId: '102', siteTransactionId: '205', domain: 'x-shop.com' })).toEqual({ status: 403, body: { error: 'environment-mismatch' } });
    expect(w.repo.rows.size).toBe(0);
  });

  it('a simulated lapse detaches without touching Vercel', async () => {
    const w = world();
    await w.claim({ transactionId: '102', siteTransactionId: '210', domain: 'freshcuts.com' });
    w.domainSubs['102'].status = 2;
    w.tick(400 * DAY);
    await w.sweep();
    expect(w.repo.rows.get('d-o3')!.state).toBe('detached');
    expect(w.reg.api.removeProjectDomain).not.toHaveBeenCalled();
    expect(w.hooks.onDomainUnlinked).not.toHaveBeenCalled();
  });
});

describe('crash / failure resumability (never buys twice, never loses the domain)', () => {
  it('buy response lost after the order went through → resumed as bought, buy never repeated', async () => {
    const w = world();
    w.reg.queueBuy('lost-response');
    expect((await w.claim(CLAIM)).status).toBe(202);
    expect(w.repo.rows.get('d-o1')!.state).toBe('buying');
    const r = await w.claim(CLAIM);
    expect(r).toMatchObject({ status: 200, body: { state: 'live' } });
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('network error with nothing placed: no retry inside the cooldown; after it, the sweep buys once more', async () => {
    const w = world();
    w.reg.queueBuy('network');
    await w.claim(CLAIM);
    await w.claim(CLAIM);
    await w.sweep();
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
    expect(w.repo.rows.get('d-o1')!.state).toBe('buying');
    w.tick(BUY_UNCERTAIN_MS + 1);
    await w.sweep(); // available → reserved → buy → live
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
    expect(w.reg.api.buy).toHaveBeenCalledTimes(2);
  });

  it('uncertain buy, name unavailable and not ours: keeps waiting (maybe our slow order), failed:taken only after a day', async () => {
    const w = world();
    w.reg.queueBuy('network');
    await w.claim(CLAIM);
    w.reg.takeByStranger('freshcuts.com');
    w.tick(BUY_UNCERTAIN_MS + 60_000);
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('buying');
    w.tick(BUY_GIVE_UP_MS);
    await w.sweep();
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'failed', failure_reason: 'taken' });
  });

  it('lost order id and the order still processing past 30 min: never freed, never bought twice', async () => {
    const w = world();
    // The order is placed and still processing, but the response is lost.
    (w.reg.api.buy as any).mockImplementationOnce(async (domain: string) => {
      w.reg.orders.set('ord_x', { domain, status: 'purchasing', errorCode: null });
      return { ok: false, code: 'timeout', status: 0, definite: false };
    });
    await w.claim(CLAIM);
    w.tick(BUY_UNCERTAIN_MS + 60_000);
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('buying');
    expect(await w.claim({ ...CLAIM, domain: 'another.com' })).toMatchObject({ status: 409, body: { error: 'slot-in-use' } });
    w.reg.completeOrders();
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('crash after the buy succeeded but before the order id was recorded → owned → bought, no second buy', async () => {
    const w = world();
    const update = w.repo.update.bind(w.repo);
    let blown = false;
    w.repo.update = vi.fn(async (otid, from, patch, where) => {
      if (!blown && patch.state === 'ordered') { blown = true; throw new Error('ios_domains update failed: connection reset'); }
      return update(otid, from, patch, where);
    }) as any;
    expect((await w.claim(CLAIM)).status).toBe(503);
    const row = w.repo.rows.get('d-o1')!;
    expect(row.state).toBe('buying');
    expect(row.lease_until).toBeNull();
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('order still processing → 202 registering; the sweep finishes it', async () => {
    const w = world();
    w.reg.setOrderMode('pending');
    expect(await w.claim(CLAIM)).toMatchObject({ status: 202, body: { state: 'registering' } });
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('ordered');
    w.reg.completeOrders();
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('attach fails → stays bought (linking); retry attaches without buying', async () => {
    const w = world();
    w.reg.failAttach(1);
    expect(await w.claim(CLAIM)).toMatchObject({ status: 202, body: { state: 'linking' } });
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'bought' });
    expect((await w.claim(CLAIM)).status).toBe(200);
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('republish fails → stays attached; the sweep links it', async () => {
    const w = world();
    w.hooks.onDomainLinked.mockRejectedValueOnce(new Error('publish-failed'));
    expect(await w.claim(CLAIM)).toMatchObject({ status: 202, body: { state: 'linking' } });
    expect(w.repo.rows.get('d-o1')!.state).toBe('attached');
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
    expect(w.hooks.onDomainLinked).toHaveBeenCalledTimes(2);
  });

  it('a claim in progress elsewhere (lease held) → 202, no step taken', async () => {
    const w = world();
    w.repo.rows.set('d-o1', blankRow({ original_transaction_id: 'd-o1', site_slug: 'fresh-cuts', domain: 'freshcuts.com', lease_until: new Date(T0 + 60_000).toISOString() }));
    expect(await w.claim(CLAIM)).toMatchObject({ status: 202, body: { state: 'registering' } });
    expect(w.reg.api.buy).not.toHaveBeenCalled();
    await w.sweep();
    expect(w.reg.api.buy).not.toHaveBeenCalled();
  });

  it('a reserved row the sweep resumes asks Apple first; ended subscription → failed, nothing bought', async () => {
    const w = world();
    w.repo.rows.set('d-o1', blankRow({ original_transaction_id: 'd-o1', site_slug: 'fresh-cuts', domain: 'freshcuts.com' }));
    w.domainSubs['100'].status = 2;
    await w.sweep();
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'failed', failure_reason: 'subscription-inactive' });
    expect(w.reg.api.buy).not.toHaveBeenCalled();
  });
});

describe('lifecycle: cancel, lapse, resubscribe (App Store notifications + sweep)', () => {
  const n = (type: string, over: any = {}) => ({ otid: 'd-o1', type, environment: 'Production' as const, expiresAt: null, revokedAt: null, reinstated: false, ...over });

  it('auto-renew off at Apple → Vercel auto-renew off; status shows cancelled-until', async () => {
    const w = world();
    await w.claim(CLAIM);
    await applyDomainNotification(n('DID_CHANGE_RENEWAL_STATUS', { subtype: 'AUTO_RENEW_DISABLED' }), w.deps);
    expect(w.repo.rows.get('d-o1')).toMatchObject({ auto_renew: false, auto_renew_synced: false, last_notification: 'DID_CHANGE_RENEWAL_STATUS:AUTO_RENEW_DISABLED' });
    await w.sweep();
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(false);
    expect(w.repo.rows.get('d-o1')!.auto_renew_synced).toBe(true);
    expect(statusBody(w.repo.rows.get('d-o1')!).state).toBe(`cancelled-until:${new Date(T0 + 365 * DAY).toISOString()}`);
    // and back on
    await applyDomainNotification(n('DID_CHANGE_RENEWAL_STATUS', { subtype: 'AUTO_RENEW_ENABLED' }), w.deps);
    await w.sweep();
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(true);
  });

  it('the domain keeps working until the paid year ends; then detached and the site republished', async () => {
    const w = world();
    await w.claim(CLAIM);
    await applyDomainNotification(n('DID_CHANGE_RENEWAL_STATUS', { subtype: 'AUTO_RENEW_DISABLED' }), w.deps);
    w.tick(200 * DAY);
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('live'); // still paid
    w.domainSubs['100'].status = 2;
    w.tick(170 * DAY); // past paid_until + grace
    await applyDomainNotification(n('EXPIRED', { subtype: 'VOLUNTARY' }), w.deps);
    const s = await w.sweep();
    expect(s.detached).toEqual(['freshcuts.com']);
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'detached', auto_renew: false });
    expect(w.reg.projects.get('fresh-cuts')!.size).toBe(0);
    expect(w.hooks.onDomainUnlinked).toHaveBeenCalledWith('fresh-cuts');
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(false);
  });

  it('billing grace: Apple still active → left alone', async () => {
    const w = world();
    await w.claim(CLAIM);
    w.domainSubs['100'].status = 4;
    w.tick(366 * DAY);
    const s = await w.sweep();
    expect(s.stillActive).toEqual(['freshcuts.com']);
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
  });

  it('Apple unreachable during a lapse check → no action', async () => {
    const w = world();
    await w.claim(CLAIM);
    w.tick(366 * DAY);
    w.verifyDomain.mockRejectedValueOnce(new VerifyFailure('apple-unavailable'));
    const s = await w.sweep();
    expect(s.appleUnavailable).toEqual(['freshcuts.com']);
    expect(w.repo.rows.get('d-o1')!.state).toBe('live');
  });

  it('refund → detached by the next sweep', async () => {
    const w = world();
    await w.claim(CLAIM);
    w.domainSubs['100'].revoked = true;
    await applyDomainNotification(n('REFUND', { revokedAt: T0 + 1000 }), w.deps);
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('detached');
  });

  it('resubscribe before the registration runs out → re-attached, auto-renew back on', async () => {
    const w = world();
    // Bought into the year: the registration (a year from the claim) outlives the Apple period.
    w.domainSubs['100'].expiresAt = T0 + 300 * DAY;
    await w.claim(CLAIM);
    w.domainSubs['100'].status = 2;
    w.tick(301 * DAY);
    await applyDomainNotification(n('EXPIRED'), w.deps);
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('detached');
    w.domainSubs['100'].status = 1;
    w.domainSubs['100'].expiresAt = w.deps.now() + 365 * DAY;
    await applyDomainNotification(n('SUBSCRIBED', { subtype: 'RESUBSCRIBE', expiresAt: w.deps.now() + 365 * DAY }), w.deps);
    expect(w.repo.rows.get('d-o1')!.state).toBe('bought');
    await w.sweep();
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'live', auto_renew: true, auto_renew_synced: true });
    expect(w.reg.registered.get('freshcuts.com')!.renew).toBe(true);
    expect(w.reg.projects.get('fresh-cuts')!.has('freshcuts.com')).toBe(true);
    expect(w.reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('resubscribe after the registration ran out → failed:registration-expired (pick a new name)', async () => {
    const w = world();
    w.repo.rows.set('d-o1', blankRow({
      original_transaction_id: 'd-o1', site_slug: 'fresh-cuts', domain: 'freshcuts.com', state: 'detached',
      registration_expires_at: new Date(T0 - DAY).toISOString(),
    }));
    await applyDomainNotification(n('SUBSCRIBED', { expiresAt: T0 + 365 * DAY }), w.deps);
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'failed', failure_reason: 'registration-expired' });
  });

  it('paid_until never moves backwards (a late, older notification)', async () => {
    const w = world();
    await w.claim(CLAIM);
    await applyDomainNotification(n('DID_RENEW', { expiresAt: T0 + 730 * DAY }), w.deps);
    await applyDomainNotification(n('DID_RENEW', { expiresAt: T0 + 365 * DAY }), w.deps);
    expect(w.repo.rows.get('d-o1')!.paid_until).toBe(new Date(T0 + 730 * DAY).toISOString());
  });

  it('a notification before any claim does nothing', async () => {
    const w = world();
    expect(await applyDomainNotification(n('DID_RENEW'), w.deps)).toEqual({ ok: true, ignored: 'no-domain' });
  });
});

describe('admin: transferred', () => {
  it('marks the domain transferred; notifications and the sweep never touch it again', async () => {
    const w = world();
    await w.claim(CLAIM);
    expect(await markTransferred('fresh-cuts', 'admin@x', w.deps)).toEqual({ ok: true, domain: 'freshcuts.com' });
    expect(w.repo.rows.get('d-o1')).toMatchObject({ state: 'transferred', transferred_by: 'admin@x' });
    expect(await applyDomainNotification({ otid: 'd-o1', type: 'REFUND', environment: 'Production', expiresAt: null, revokedAt: T0, reinstated: false }, w.deps))
      .toEqual({ ok: true, ignored: 'transferred' });
    w.domainSubs['100'].status = 2;
    w.tick(400 * DAY);
    await w.sweep();
    expect(w.repo.rows.get('d-o1')!.state).toBe('transferred');
    expect(w.reg.api.removeProjectDomain).not.toHaveBeenCalled();
    w.domainSubs['100'].status = 1;
    w.domainSubs['100'].expiresAt = w.deps.now() + DAY;
    expect(await w.claim(CLAIM)).toMatchObject({ status: 409, body: { error: 'transferred' } });
  });

  it('no domain → error', async () => {
    expect(await markTransferred('nope', 'a', world().deps)).toEqual({ ok: false, error: 'no-domain' });
  });
});

describe('GET /api/ios/domain/status', () => {
  it('none, then live with Vercel verification / DNS state', async () => {
    const w = world();
    expect(await runDomainStatus('100', w.deps)).toEqual({ status: 200, body: { domain: null, state: 'none' } });
    await w.claim(CLAIM);
    const r = await runDomainStatus('100', { ...w.deps, probeHttps: async () => true });
    expect(r).toMatchObject({ status: 200, body: { domain: 'freshcuts.com', state: 'live', vercel: { verified: true, dnsOk: true, ssl: 'ready' } } });
  });

  it('only the domain product verifies; bad input 400', async () => {
    const w = world();
    expect((await runDomainStatus('200', w.deps)).status).toBe(400);
    expect((await runDomainStatus('x', w.deps)).status).toBe(400);
  });
});
