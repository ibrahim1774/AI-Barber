// The custom-domain subscription must never satisfy a website / bookings / store gate
// (spec 2026-10-22-custom-domains, Server). Each test feeds a domain transaction through a
// real gate and expects a refusal.
import { describe, it, expect, vi } from 'vitest';
import {
  makeVerifier, VerifyFailure, IOS_PRODUCT_IDS,
  type AppleLookup, type AppleDecode, type AppleStatuses,
} from '../../lib/ios/appleVerify.js';
import { DOMAIN_PRODUCT_ID, entitlementsOf, grants, isDomainProduct, stripLapsedLinks, tierOf } from '../../lib/ios/tiers.js';
import { entitlementActive, purchaseLive } from '../../lib/ios/lapse.js';
import { runIosPublish, runIosSiteLookup } from '../../lib/ios/publishFlow.js';
import { refreshPlan, planView } from '../../lib/ios/planFlow.js';
import { makePurchaseVerifier } from '../../lib/bookings/live.js';
import { handleAppleNotification } from '../../lib/ios/notifications.js';

const BUNDLE = 'com.ibrahim1774.aibarber';
const NOW = 1_800_000_000_000;
const SITE_PRODUCT = 'com.ibrahim1774.aibarber.store.yearly';

/** A real makeVerifier whose Apple fakes answer with a transaction of `productId`. */
function verifierFor(productId: string, opts: { products?: readonly string[]; includeAccount?: boolean; includeRenewal?: boolean; renewal?: any } = {}) {
  const decoded = { bundleId: BUNDLE, productId, originalTransactionId: 'dom-o1', transactionId: 'dom-t1', expiresDate: NOW + 1e9 };
  const lookup = vi.fn<AppleLookup>(async () => ({ status: 200, signedTransactionInfo: 'signed' }));
  const decode = vi.fn<AppleDecode>(async () => decoded);
  const statuses = vi.fn<AppleStatuses>(async () => ({
    status: 200,
    items: [
      { status: 1, originalTransactionId: 'dom-o1', signedTransactionInfo: 'latest', signedRenewalInfo: opts.renewal === undefined ? 'renew-on' : opts.renewal },
      { status: 1, originalTransactionId: 'site-o1', signedTransactionInfo: 'other-group' },
    ],
  }));
  const decodeRenewal = vi.fn(async (_env: string, signed: string) => {
    if (signed === 'bad') throw new Error('bad signature');
    return { autoRenewStatus: signed === 'renew-on' ? 1 : 0 };
  });
  const { renewal: _r, ...rest } = opts;
  return makeVerifier({ lookup, decode, statuses, bundleId: BUNDLE, decodeRenewal, ...rest });
}

const code = async (p: Promise<unknown>) => { try { await p; } catch (e) { return (e as VerifyFailure).code; } return null; };

describe('domain product: never a tier', () => {
  it('is its own id, outside the six site products', () => {
    expect(DOMAIN_PRODUCT_ID).toBe('com.ibrahim1774.aibarber.domain.yearly');
    expect(IOS_PRODUCT_IDS).not.toContain(DOMAIN_PRODUCT_ID);
    expect(IOS_PRODUCT_IDS).toHaveLength(6);
    expect(isDomainProduct(DOMAIN_PRODUCT_ID)).toBe(true);
    expect(isDomainProduct(SITE_PRODUCT)).toBe(false);
  });

  it('grants no entitlement and no tier', () => {
    expect(tierOf(DOMAIN_PRODUCT_ID)).toBeNull();
    expect([...entitlementsOf(DOMAIN_PRODUCT_ID)]).toEqual([]);
    for (const ent of ['hosting', 'bookings', 'store'] as const) expect(grants(DOMAIN_PRODUCT_ID, ent)).toBe(false);
  });

  it('strips Book and Shop links like an unknown product', () => {
    const out = stripLapsedLinks({ bookingUrl: 'https://aibarber.org/book/x', shopUrl: 'https://aibarber.org/shop/x' }, DOMAIN_PRODUCT_ID);
    expect(out).toEqual({});
  });

  it('a purchase row carrying it is never live for any gate (defense in depth)', () => {
    const row = { product_id: DOMAIN_PRODUCT_ID, revoked_at: null, taken_down_at: null, site_slug: 's', published_at: new Date(NOW).toISOString(), expires_at: new Date(NOW + 1e9).toISOString() };
    expect(purchaseLive(row, NOW)).toBe(false);
    for (const ent of ['hosting', 'bookings', 'store'] as const) expect(entitlementActive(row, ent, NOW)).toBe(false);
    const view = planView({ ios_otid: 'dom-o1' }, row as any, NOW);
    expect(view.active).toBe(false);
    expect(view.entitlements).toEqual({ hosting: false, bookings: false, store: false });
  });
});

describe('site verifier (default products) rejects a domain transaction', () => {
  it('bad-product', async () => {
    expect(await code(verifierFor(DOMAIN_PRODUCT_ID)('dom-t1'))).toBe('bad-product');
  });

  it('the domain verifier accepts only the domain product', async () => {
    const domainOnly = { products: [DOMAIN_PRODUCT_ID] };
    expect((await verifierFor(DOMAIN_PRODUCT_ID, domainOnly)('dom-t1')).productId).toBe(DOMAIN_PRODUCT_ID);
    expect(await code(verifierFor(SITE_PRODUCT, domainOnly)('t'))).toBe('bad-product');
  });

  it('account ids are opt-in (every subscription of the Apple ID, all groups)', async () => {
    const plain = await verifierFor(SITE_PRODUCT)('t');
    expect(plain).not.toHaveProperty('accountOriginalTransactionIds');
    const withAcct = await verifierFor(DOMAIN_PRODUCT_ID, { products: [DOMAIN_PRODUCT_ID], includeAccount: true })('dom-t1');
    expect(withAcct.accountOriginalTransactionIds).toEqual(['dom-o1', 'site-o1']);
    expect(withAcct).not.toHaveProperty('autoRenew');
  });

  it("renewal status is opt-in and comes from Apple's latest signedRenewalInfo; unknown is null (never 'on')", async () => {
    const o = { products: [DOMAIN_PRODUCT_ID], includeRenewal: true };
    expect((await verifierFor(DOMAIN_PRODUCT_ID, o)('dom-t1')).autoRenew).toBe(true);
    expect((await verifierFor(DOMAIN_PRODUCT_ID, { ...o, renewal: 'renew-off' })('dom-t1')).autoRenew).toBe(false);
    expect((await verifierFor(DOMAIN_PRODUCT_ID, { ...o, renewal: null })('dom-t1')).autoRenew).toBeNull();
    expect((await verifierFor(DOMAIN_PRODUCT_ID, { ...o, renewal: 'bad' })('dom-t1')).autoRenew).toBeNull();
  });
});

describe('every site gate refuses a domain transaction', () => {
  const verify = verifierFor(DOMAIN_PRODUCT_ID);
  const repo = new Proxy({}, { get: () => vi.fn(async () => { throw new Error('repo must not be touched'); }) }) as any;
  const siteData = {
    shopName: 'Fresh Cuts', hero: { headline: 'h', subheadline: 's', imageUrl: '' },
    about: { title: 'a', description: ['d'], imageUrl: '' }, gallery: [], services: [], contact: { address: '', email: '' },
  } as any;

  it('/api/ios/publish → 400 bad-product, nothing written', async () => {
    const r = await runIosPublish({ transactionId: 'dom-t1', siteData }, {
      verify, repo, isTaken: vi.fn(), writePending: vi.fn(), publish: vi.fn(), readPending: vi.fn(), now: () => NOW,
    });
    expect(r).toEqual({ status: 400, body: { error: 'bad-product' } });
  });

  it('/api/ios/site → 404, no site returned', async () => {
    const r = await runIosSiteLookup('dom-t1', { verify, repo, readPending: vi.fn(), now: () => NOW, userOf: async () => ({ id: '3f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f' }) }, { authorization: 'Bearer t' });
    expect(r.status).toBe(404);
  });

  it('/api/shop/plan POST → 400 invalid, the shop link untouched', async () => {
    const setShopOtid = vi.fn();
    const upsertVerified = vi.fn();
    const r = await refreshPlan('Bearer jwt', { transactionId: '2000000123' }, {
      getUser: async () => ({ id: 'u1', email: null, fullName: null }),
      shopByOwner: async () => ({ id: 'shop1', ios_otid: null }),
      purchase: vi.fn(), verify, upsertVerified, setShopOtid, setUser: vi.fn(), now: () => NOW,
    } as any);
    expect(r).toEqual({ status: 400, body: { error: 'invalid', field: 'transactionId' } });
    expect(setShopOtid).not.toHaveBeenCalled();
    expect(upsertVerified).not.toHaveBeenCalled();
  });

  it('shop setup / bookings purchase verifier → throws before any ios_purchases row is written', async () => {
    const upsertVerified = vi.fn();
    const pv = makePurchaseVerifier(async () => ({ verify, repo: { upsertVerified, setUser: vi.fn() } }));
    await expect(pv.verify('dom-t1')).rejects.toMatchObject({ code: 'bad-product' });
    expect(upsertVerified).not.toHaveBeenCalled();
  });
});

describe('App Store notifications: the domain product never reaches ios_purchases', () => {
  const base = (over: any = {}) => ({
    bundleId: BUNDLE,
    now: () => NOW,
    repo: { applyNotification: vi.fn(async () => {}) } as any,
    decodeNotification: vi.fn(async () => ({ notificationType: 'DID_RENEW', data: { environment: 'Production', bundleId: BUNDLE, signedTransactionInfo: 'tx' } })),
    decodeTransaction: vi.fn(async () => ({ bundleId: BUNDLE, productId: DOMAIN_PRODUCT_ID, originalTransactionId: 'dom-o1', transactionId: 'dom-t2', expiresDate: NOW + 1000 })),
    ...over,
  });

  it('routes it to the domain lifecycle', async () => {
    const domain = { applyNotification: vi.fn(async () => ({ ok: true })) };
    const d = base({ domain });
    const r = await handleAppleNotification('jws', d);
    expect(r.status).toBe(200);
    expect(d.repo.applyNotification).not.toHaveBeenCalled();
    expect(domain.applyNotification).toHaveBeenCalledWith(expect.objectContaining({
      otid: 'dom-o1', type: 'DID_RENEW', expiresAt: NOW + 1000, environment: 'Production',
    }));
  });

  it('without a domain handler wired: 500 so Apple retries, still never written as a purchase', async () => {
    const d = base();
    const r = await handleAppleNotification('jws', d);
    expect(r.status).toBe(500);
    expect(d.repo.applyNotification).not.toHaveBeenCalled();
  });

  it('a domain handler failure is a 500 (Apple retries)', async () => {
    const d = base({ domain: { applyNotification: vi.fn(async () => { throw new Error('db down'); }) } });
    expect((await handleAppleNotification('jws', d)).status).toBe(500);
  });

  it('site products still go to ios_purchases, never to the domain handler', async () => {
    const domain = { applyNotification: vi.fn() };
    const d = base({
      domain,
      decodeTransaction: vi.fn(async () => ({ bundleId: BUNDLE, productId: SITE_PRODUCT, originalTransactionId: 'o', transactionId: 't', expiresDate: NOW })),
    });
    expect((await handleAppleNotification('jws', d)).status).toBe(200);
    expect(d.repo.applyNotification).toHaveBeenCalled();
    expect(domain.applyNotification).not.toHaveBeenCalled();
  });
});
