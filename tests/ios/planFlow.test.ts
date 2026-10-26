import { describe, it, expect, vi } from 'vitest';
import { getPlan, refreshPlan, planView, type PlanDeps } from '../../lib/ios/planFlow.js';
import { VerifyFailure, type VerifiedTx } from '../../lib/ios/appleVerify.js';
import type { PurchaseRow } from '../../lib/ios/purchases.js';

const P = 'com.ibrahim1774.aibarber.';
const NOW = 1_800_000_000_000;
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SHOP = '33333333-3333-4333-8333-333333333333';
const OTID = '2000000123456789';
const AUTH = 'Bearer owner-jwt';
const EXPIRES = '2027-01-01T00:00:00.000Z';

const purchaseRow = (over: Partial<PurchaseRow> = {}): PurchaseRow => ({
  original_transaction_id: OTID, product_id: `${P}bookings.monthly`, environment: 'Production',
  site_slug: 'fresh-cuts', user_id: USER, expires_at: EXPIRES, revoked_at: null, last_notification: null,
  published_at: '2026-10-01T00:00:00.000Z', taken_down_at: null, lapse_checked_at: null, product_purchased_at: null, ...over,
});

const vtx = (over: Partial<VerifiedTx> = {}): VerifiedTx => ({
  originalTransactionId: OTID, transactionId: '2000000555', productId: `${P}store.monthly`, environment: 'Production',
  expiresAt: Date.parse(EXPIRES), revoked: false, status: 1, productPurchasedAt: NOW - 1000, ...over,
});

function fakes(o: { otid?: string | null; rows?: Record<string, PurchaseRow>; verified?: VerifiedTx | Error; taken?: boolean } = {}) {
  const shop = { id: SHOP, ios_otid: o.otid === undefined ? OTID : o.otid };
  const rows: Record<string, PurchaseRow> = { ...(o.rows ?? { [OTID]: purchaseRow() }) };
  const deps: PlanDeps = {
    getUser: vi.fn(async (jwt: string) => (jwt === 'owner-jwt' ? { id: USER, email: null, fullName: null } : jwt === 'noshop-jwt' ? { id: OTHER, email: null, fullName: null } : null)),
    shopByOwner: vi.fn(async (uid: string) => (uid === USER ? { ...shop } : null)),
    purchase: vi.fn(async (otid: string) => (rows[otid] ? { ...rows[otid] } : null)),
    verify: vi.fn(async () => {
      const v = o.verified ?? vtx();
      if (v instanceof Error) throw v;
      return v;
    }),
    upsertVerified: vi.fn(async (tx: VerifiedTx) => {
      const prev = rows[tx.originalTransactionId] ?? purchaseRow({ original_transaction_id: tx.originalTransactionId, user_id: null, site_slug: null });
      rows[tx.originalTransactionId] = { ...prev, product_id: tx.productId, expires_at: tx.expiresAt == null ? null : new Date(tx.expiresAt).toISOString() };
      return { ...rows[tx.originalTransactionId] };
    }),
    setShopOtid: vi.fn(async (_id: string, otid: string | null) => {
      if (o.taken) return 'taken' as const;
      shop.ios_otid = otid;
      return 'ok' as const;
    }),
    setUserIfUnlinked: vi.fn(async (otid: string, uid: string) => { if (!rows[otid] || rows[otid].user_id) return false; rows[otid].user_id = uid; return true; }),
    now: () => NOW,
  };
  return { deps, shop, rows };
}

const NONE = { hosting: false, bookings: false, store: false };

describe('planView', () => {
  it('an unlinked shop: linked false, tier null, nothing granted', () => {
    expect(planView({ ios_otid: null }, null, NOW)).toEqual({
      linked: false, tier: null, entitlements: NONE, active: false, expiresAt: null, takenDownAt: null, revoked: false, purchaseAccount: null,
    });
  });

  it('linked bookings.monthly → tier bookings, hosting + bookings', () => {
    expect(planView({ ios_otid: OTID }, purchaseRow(), NOW)).toEqual({
      linked: true, tier: 'bookings', entitlements: { hosting: true, bookings: true, store: false },
      active: true, expiresAt: EXPIRES, takenDownAt: null, revoked: false, purchaseAccount: null,
    });
  });

  it.each([
    ['hosting.yearly', 'website', { hosting: true, bookings: false, store: false }],
    ['store.yearly', 'store', { hosting: true, bookings: true, store: true }],
  ])('%s → %s', (suffix, tier, ents) => {
    const v = planView({ ios_otid: OTID }, purchaseRow({ product_id: P + suffix }), NOW);
    expect(v.tier).toBe(tier);
    expect(v.entitlements).toEqual(ents);
  });

  it('a taken-down purchase → active false and every entitlement false (tier kept)', () => {
    const v = planView({ ios_otid: OTID }, purchaseRow({ product_id: `${P}store.monthly`, taken_down_at: '2026-10-01T00:00:00+00:00' }), NOW);
    expect(v).toMatchObject({ linked: true, tier: 'store', active: false, entitlements: NONE, revoked: false, takenDownAt: '2026-10-01T00:00:00.000Z' });
  });

  it('a revoked purchase → revoked true, active false, nothing granted', () => {
    const v = planView({ ios_otid: OTID }, purchaseRow({ revoked_at: '2026-10-01T00:00:00Z' }), NOW);
    expect(v).toMatchObject({ active: false, revoked: true, entitlements: NONE });
  });

  it('I2: an unbound purchase past its expiry → inactive, nothing granted', () => {
    const v = planView({ ios_otid: OTID }, purchaseRow({ site_slug: null, expires_at: '2026-01-01T00:00:00Z' }), NOW);
    expect(v).toMatchObject({ tier: 'bookings', active: false, entitlements: NONE, revoked: false });
  });

  it('linked but the purchase row is missing → tier null, inactive', () => {
    expect(planView({ ios_otid: OTID }, null, NOW)).toEqual({
      linked: true, tier: null, entitlements: NONE, active: false, expiresAt: null, takenDownAt: null, revoked: false, purchaseAccount: null,
    });
  });
});

describe('GET /api/shop/plan', () => {
  it('401 without a valid token; a signed-in user without a shop gets 200 unlinked (not 404)', async () => {
    const { deps } = fakes();
    expect(await getPlan(undefined, deps)).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(await getPlan('Bearer nope', deps)).toEqual({ status: 401, body: { error: 'unauthorized' } });
    const r = await getPlan('Bearer noshop-jwt', deps);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      linked: false, tier: null, entitlements: { hosting: false, bookings: false, store: false },
      active: false, expiresAt: null, takenDownAt: null, revoked: false, purchaseAccount: null,
    });
    expect(deps.purchase).not.toHaveBeenCalled();
  });

  it('an unlinked shop → linked false, tier null (no purchase read)', async () => {
    const { deps } = fakes({ otid: null });
    const r = await getPlan(AUTH, deps);
    expect(r).toEqual({ status: 200, body: planView({ ios_otid: null }, null, NOW) });
    expect(deps.purchase).not.toHaveBeenCalled();
  });

  it('a linked bookings.monthly shop', async () => {
    const { deps } = fakes();
    const r = await getPlan(AUTH, deps);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ linked: true, tier: 'bookings', entitlements: { hosting: true, bookings: true, store: false }, active: true });
    expect(deps.purchase).toHaveBeenCalledWith(OTID);
    expect(deps.verify).not.toHaveBeenCalled();
  });

  it('a taken-down purchase → active false, nothing granted', async () => {
    const { deps } = fakes({ rows: { [OTID]: purchaseRow({ taken_down_at: '2026-10-01T00:00:00Z' }) } });
    expect((await getPlan(AUTH, deps)).body).toMatchObject({ active: false, entitlements: NONE });
  });
});

describe('H2: GET plan for the caller\'s own purchase', () => {
  const mineRow = (over: Partial<PurchaseRow> = {}) => purchaseRow({ original_transaction_id: '2000000777', user_id: OTHER, site_slug: null, ...over });
  const NOSHOP = 'Bearer noshop-jwt'; // account OTHER, no shop

  it('no shop: the newest active purchase linked to the caller grants its entitlements, purchaseAccount self, linked false', async () => {
    const { deps } = fakes({ rows: {} });
    deps.purchasesOfUser = vi.fn(async () => [
      mineRow({ original_transaction_id: '1', product_id: `${P}hosting.monthly`, expires_at: '2029-12-01T00:00:00.000Z' }),
      mineRow({ original_transaction_id: '2', product_id: `${P}store.monthly`, expires_at: '2030-06-01T00:00:00.000Z' }),
    ]);
    const r = await getPlan(NOSHOP, deps);
    expect(r.body).toMatchObject({ linked: false, tier: 'store', active: true, purchaseAccount: 'self', entitlements: { hosting: true, bookings: true, store: true } });
    expect(deps.purchasesOfUser).toHaveBeenCalledWith(OTHER);
  });

  it('no shop: revoked / lapsed purchases and rows linked to someone else grant nothing', async () => {
    const { deps } = fakes({ rows: {} });
    deps.purchasesOfUser = vi.fn(async () => [
      mineRow({ revoked_at: '2026-10-01T00:00:00Z' }),
      mineRow({ expires_at: '2026-01-01T00:00:00Z' }),
      mineRow({ user_id: USER }), // never returned by the real query; defence in depth
    ]);
    expect((await getPlan(NOSHOP, deps)).body).toMatchObject({ linked: false, tier: null, purchaseAccount: null, active: false, entitlements: NONE });
  });

  it('a shop pointing at a purchase linked to ANOTHER account: other, nothing granted', async () => {
    const { deps } = fakes({ rows: { [OTID]: purchaseRow({ user_id: OTHER }) } });
    expect((await getPlan(AUTH, deps)).body).toMatchObject({ linked: true, purchaseAccount: 'other', active: false, entitlements: NONE });
  });

  it('the ?otid probe is gone: a third argument is ignored and no purchase is read by id', async () => {
    const { deps } = fakes({ otid: null, rows: { '555': purchaseRow({ original_transaction_id: '555', user_id: OTHER }) } });
    const r = await (getPlan as any)(AUTH, deps, { otid: '555' });
    expect(r.body).toMatchObject({ purchaseAccount: null });
    expect(deps.purchase).not.toHaveBeenCalled();
  });
});

describe('GET /api/shop/plan capabilities (migration 015 flag)', () => {
  it('absent dep: body unchanged; present: capabilities.memberProfile mirrors the probe; a failing probe reads false', async () => {
    const { deps } = fakes();
    expect((await getPlan(AUTH, deps)).body).not.toHaveProperty('capabilities');
    deps.memberProfileLive = vi.fn(async () => true);
    expect((await getPlan(AUTH, deps)).body).toMatchObject({ linked: true, capabilities: { memberProfile: true } });
    deps.memberProfileLive = vi.fn(async () => false);
    expect((await getPlan(AUTH, deps)).body).toMatchObject({ capabilities: { memberProfile: false } });
    deps.memberProfileLive = vi.fn(async () => { throw new Error('db'); });
    expect((await getPlan(AUTH, deps)).body).toMatchObject({ capabilities: { memberProfile: false } });
  });
});

describe('POST /api/shop/plan', () => {
  it('verifies with Apple, upserts, and returns the GET body with the new tier', async () => {
    const { deps } = fakes();
    const r = await refreshPlan(AUTH, { transactionId: ' 2000000555 ' }, deps);
    expect(deps.verify).toHaveBeenCalledWith('2000000555');
    expect(deps.upsertVerified).toHaveBeenCalledWith(vtx(), { checkedAt: NOW });
    expect(r).toEqual({ status: 200, body: {
      linked: true, tier: 'store', entitlements: { hosting: true, bookings: true, store: true },
      active: true, expiresAt: EXPIRES, takenDownAt: null, revoked: false, purchaseAccount: 'self',
    } });
    expect(deps.setShopOtid).not.toHaveBeenCalled(); // already linked to this purchase
    expect(deps.setUserIfUnlinked).not.toHaveBeenCalled(); // already the caller's
  });

  it('links the otid when the shop has none, and attaches an account-less purchase', async () => {
    const { deps, shop, rows } = fakes({ otid: null, rows: {} });
    const r = await refreshPlan(AUTH, { transactionId: '2000000555' }, deps);
    expect(r.status).toBe(200);
    expect(deps.setShopOtid).toHaveBeenCalledWith(SHOP, OTID);
    expect(shop.ios_otid).toBe(OTID);
    expect(deps.setUserIfUnlinked).toHaveBeenCalledWith(OTID, USER);
    expect(rows[OTID].user_id).toBe(USER);
    expect(r.body).toMatchObject({ linked: true, tier: 'store' });
  });

  it('a failing setUserIfUnlinked does not fail the refresh', async () => {
    const { deps } = fakes({ otid: null, rows: {} });
    (deps.setUserIfUnlinked as any).mockRejectedValueOnce(new Error('db'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await refreshPlan(AUTH, { transactionId: '2000000555' }, deps)).status).toBe(200);
    err.mockRestore();
  });

  it('409 purchase-in-use when another user owns the purchase (nothing linked)', async () => {
    const { deps } = fakes({ otid: null, rows: { [OTID]: purchaseRow({ user_id: OTHER }) } });
    expect(await refreshPlan(AUTH, { transactionId: '2000000555' }, deps)).toEqual({ status: 409, body: { error: 'purchase-in-use', reason: 'purchase-other-account', hint: null } });
    expect(deps.setShopOtid).not.toHaveBeenCalled();
    expect(deps.setUserIfUnlinked).not.toHaveBeenCalled();
  });

  it('409 purchase-in-use when another shop is linked to it', async () => {
    const { deps } = fakes({ otid: null, rows: {}, taken: true });
    expect(await refreshPlan(AUTH, { transactionId: '2000000555' }, deps)).toEqual({ status: 409, body: { error: 'purchase-in-use' } });
  });

  it('M1: a shop linked to a different purchase is relinked to the one just paid for', async () => {
    const { deps, shop } = fakes({ otid: '2000000999', rows: { '2000000999': purchaseRow({ original_transaction_id: '2000000999', product_id: `${P}hosting.monthly` }) } });
    const r = await refreshPlan(AUTH, { transactionId: '2000000555' }, deps);
    expect(r.status).toBe(200);
    expect(deps.setShopOtid).toHaveBeenCalledWith(SHOP, OTID);
    expect(shop.ios_otid).toBe(OTID);
    expect(r.body).toMatchObject({ linked: true, tier: 'store' });
  });

  it('M1: relinking follows setup\'s 409 rules (another shop holds it, or another user owns it)', async () => {
    const taken = fakes({ otid: '2000000999', rows: {}, taken: true });
    expect(await refreshPlan(AUTH, { transactionId: '2000000555' }, taken.deps)).toEqual({ status: 409, body: { error: 'purchase-in-use' } });
    expect(taken.shop.ios_otid).toBe('2000000999');
    const owned = fakes({ otid: '2000000999', rows: { [OTID]: purchaseRow({ user_id: OTHER }) } });
    expect(await refreshPlan(AUTH, { transactionId: '2000000555' }, owned.deps)).toEqual({ status: 409, body: { error: 'purchase-in-use', reason: 'purchase-other-account', hint: null } });
    expect(owned.deps.setShopOtid).not.toHaveBeenCalled();
  });

  describe('N2: link or relink only to an active purchase', () => {
    it.each([
      ['expired', { expiresAt: NOW - 86_400_000, status: 2 }],
      ['revoked', { revoked: true, status: 5 }],
      ['billing retry', { status: 3 }],
    ])('%s: the shop keeps its link and the current plan comes back unchanged', async (_n, over) => {
      const { deps, shop } = fakes({ otid: '2000000999', rows: { '2000000999': purchaseRow({ original_transaction_id: '2000000999', product_id: `${P}bookings.yearly` }) }, verified: vtx(over) });
      const r = await refreshPlan(AUTH, { transactionId: '2000000555' }, deps);
      expect(r.status).toBe(200);
      expect(deps.setShopOtid).not.toHaveBeenCalled();
      expect(deps.setUserIfUnlinked).not.toHaveBeenCalled();
      expect(shop.ios_otid).toBe('2000000999');
      expect(r.body).toMatchObject({ linked: true, tier: 'bookings', active: true });
      expect(deps.upsertVerified).toHaveBeenCalled(); // Apple's answer is still recorded
    });

    it('an unlinked shop stays unlinked on an inactive purchase', async () => {
      const { deps, shop } = fakes({ otid: null, rows: {}, verified: vtx({ status: 2, expiresAt: NOW - 1000 }) });
      const r = await refreshPlan(AUTH, { transactionId: '2000000555' }, deps);
      expect(r).toEqual({ status: 200, body: planView({ ios_otid: null }, null, NOW) });
      expect(shop.ios_otid).toBeNull();
    });

    it('billing grace (status 4) counts as active: relinked', async () => {
      const { deps, shop } = fakes({ otid: '2000000999', rows: {}, verified: vtx({ status: 4, expiresAt: NOW - 1000 }) });
      expect((await refreshPlan(AUTH, { transactionId: '2000000555' }, deps)).status).toBe(200);
      expect(shop.ios_otid).toBe(OTID);
    });
  });

  describe('M2: per-user write limit', () => {
    it('over the limit → 429 rate-limited with Retry-After, before Apple is asked; keyed by user', async () => {
      const { deps } = fakes();
      deps.limiter = { allow: vi.fn(async () => false) };
      const r = await refreshPlan(AUTH, { transactionId: '2000000555' }, deps);
      expect(r).toEqual({ status: 429, body: { error: 'rate-limited' }, headers: { 'Retry-After': '60' } });
      expect(deps.limiter.allow).toHaveBeenCalledWith(USER, 'write');
      expect(deps.verify).not.toHaveBeenCalled();
    });

    it('a limiter failure fails open', async () => {
      const { deps } = fakes();
      deps.limiter = { allow: vi.fn(async () => { throw new Error('store down'); }) };
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect((await refreshPlan(AUTH, { transactionId: '2000000555' }, deps)).status).toBe(200);
      err.mockRestore();
    });

    it('GET is not limited', async () => {
      const { deps } = fakes();
      deps.limiter = { allow: vi.fn(async () => false) };
      expect((await getPlan(AUTH, deps)).status).toBe(200);
      expect(deps.limiter.allow).not.toHaveBeenCalled();
    });
  });

  it.each(['bad-product', 'not-found', 'bad-bundle'] as const)('%s → 400 invalid', async (code) => {
    const { deps } = fakes({ verified: new VerifyFailure(code) });
    expect(await refreshPlan(AUTH, { transactionId: '2000000555' }, deps)).toEqual({ status: 400, body: { error: 'invalid', field: 'transactionId' } });
    expect(deps.upsertVerified).not.toHaveBeenCalled();
  });

  it('Apple down → 503 temporarily-unavailable', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const e of [new VerifyFailure('apple-unavailable'), new Error('network')]) {
      const { deps } = fakes({ verified: e });
      expect(await refreshPlan(AUTH, { transactionId: '2000000555' }, deps)).toEqual({ status: 503, body: { error: 'temporarily-unavailable' } });
    }
    err.mockRestore();
  });

  it('a bad or missing transactionId → 400 invalid before Apple is asked', async () => {
    const { deps } = fakes();
    for (const b of [undefined, null, {}, { transactionId: '' }, { transactionId: 'abc' }, { transactionId: 123 }, { transactionId: '1'.repeat(33) }]) {
      expect(await refreshPlan(AUTH, b, deps)).toEqual({ status: 400, body: { error: 'invalid', field: 'transactionId' } });
    }
    expect(deps.verify).not.toHaveBeenCalled();
  });

  it('no auth → 401; no shop → 404 (Apple never asked)', async () => {
    const { deps } = fakes();
    expect(await refreshPlan(undefined, { transactionId: '2000000555' }, deps)).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(await refreshPlan('Bearer noshop-jwt', { transactionId: '2000000555' }, deps)).toEqual({ status: 404, body: { error: 'no-shop' } });
    expect(deps.verify).not.toHaveBeenCalled();
  });
});
