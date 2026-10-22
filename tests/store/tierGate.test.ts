// Phase 4 tiers: the shop page opens only on the Store plan. Orders already placed stay
// visible, fulfillable and refundable after a downgrade (spec §11).
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createOrder, getOrder, getStoreShop, postOrderSent } from '../../lib/store/publicFlow.js';
import { markOwnerOrder, refundOwnerOrder } from '../../lib/store/ownerFlow.js';
import { storeOpen } from '../../lib/store/core.js';
import { storeWorld, type StoreWorld } from './fakeRepo.js';

const P = 'com.ibrahim1774.aibarber.';
const AUTH = 'Bearer owner-jwt';
const PAUSED_PAGE = { status: 200, body: { paused: true, shop: { name: 'Fresh Cuts' } } };

const setProduct = (w: StoreWorld, product: string) => { w.state.purchases[w.shop().ios_otid!].product_id = P + product; };

const order = (w: StoreWorld, over: Record<string, unknown> = {}) => createOrder({
  slug: 'fresh-cuts', clientKey: randomUUID(), items: [{ productId: w.ids.oil, quantity: 2 }],
  customer: { name: 'Sam Lee', phone: '5551234567', email: 'sam@example.com' },
  fulfilment: 'pickup', pay: 'manual', expectedTotalCents: 3000, ...over,
}, w.deps);

/** An order placed on the Store plan; then the plan changes. */
async function placedThen(product: string, over: Record<string, unknown> = {}) {
  const w = storeWorld();
  expect((await order(w, over)).status).toBe(201);
  setProduct(w, product);
  return { w, o: w.state.orders.at(-1)! };
}

describe('public shop page gate', () => {
  it.each(['hosting.monthly', 'bookings.monthly', 'bookings.yearly'])('%s → GET /api/store/shop paused and order create 423', async (product) => {
    const w = storeWorld();
    setProduct(w, product);
    expect(await getStoreShop({ slug: 'fresh-cuts' }, w.deps)).toEqual(PAUSED_PAGE);
    expect(await order(w)).toEqual({ status: 423, body: { error: 'store-paused' } });
    expect(w.state.orders).toHaveLength(0);
    expect(await storeOpen(w.deps.repo, w.shop())).toBe(false);
  });

  it.each(['store.monthly', 'store.yearly'])('%s → open', async (product) => {
    const w = storeWorld();
    setProduct(w, product);
    expect(((await getStoreShop({ slug: 'fresh-cuts' }, w.deps)).body as any).paused).not.toBe(true);
    expect((await order(w)).status).toBe(201);
  });

  it('a missing product is closed (fails closed)', async () => {
    const w = storeWorld();
    w.state.purchases[w.shop().ios_otid!].product_id = null;
    expect(await storeOpen(w.deps.repo, w.shop())).toBe(false);
  });

  it('a lapse (revoked or taken down) closes the Store plan too', async () => {
    for (const k of ['revoked_at', 'taken_down_at'] as const) {
      const w = storeWorld();
      w.state.purchases[w.shop().ios_otid!][k] = '2026-10-01T00:00:00Z';
      expect(await storeOpen(w.deps.repo, w.shop())).toBe(false);
    }
  });
});

describe('orders placed before a downgrade', () => {
  it("the owner's mark still works on hosting.monthly", async () => {
    const { w, o } = await placedThen('hosting.monthly');
    expect((await markOwnerOrder(AUTH, o.id, { action: 'paid' }, w.deps)).status).toBe(200);
    expect((await markOwnerOrder(AUTH, o.id, { action: 'ready' }, w.deps)).status).toBe(200);
    expect((await markOwnerOrder(AUTH, o.id, { action: 'done' }, w.deps)).status).toBe(200);
    expect(w.order(o.id).status).toBe('done');
  });

  it("the owner's refund still works on hosting.monthly", async () => {
    const { w, o } = await placedThen('hosting.monthly', { pay: 'card' });
    Object.assign(w.order(o.id), {
      status: 'paid', payment_status: 'paid', amount_paid_cents: o.total_cents, stripe_payment_intent_id: `pi_${o.id}`,
      paid_at: '2026-11-02T12:01:00.000Z',
    });
    const r = await refundOwnerOrder(AUTH, o.id, {}, w.deps);
    expect(r.status).toBe(200);
    expect(w.payments.refundOrder).toHaveBeenCalledTimes(1);
    expect(w.order(o.id)).toMatchObject({ status: 'cancelled', payment_status: 'refunded' });
  });

  it('GET /api/store/order by token works on hosting', async () => {
    const { w, o } = await placedThen('hosting.monthly');
    const r = await getOrder({ token: o.manage_token }, w.deps);
    expect(r.status).toBe(200);
    expect((r.body as any).order.id).toBe(o.id);
  });
});

describe('I2: a linked purchase the sweep never takes down', () => {
  const LAPSED = '2026-01-01T00:00:00Z';
  it.each([
    ['unbound', { site_slug: null }],
    ['bound but never published', { site_slug: 'fresh-cuts', published_at: null }],
  ])('%s and expired → shop closed', async (_n, over) => {
    const w = storeWorld();
    Object.assign(w.state.purchases[w.shop().ios_otid!], { expires_at: LAPSED, ...over });
    expect(await getStoreShop({ slug: 'fresh-cuts' }, w.deps)).toEqual(PAUSED_PAGE);
    expect(await order(w)).toEqual({ status: 423, body: { error: 'store-paused' } });
  });

  it('bound, published Production past expiry stays open (the sweep decides)', async () => {
    const w = storeWorld();
    Object.assign(w.state.purchases[w.shop().ios_otid!], { expires_at: LAPSED, site_slug: 'fresh-cuts', published_at: '2025-12-01T00:00:00Z', environment: 'Production' });
    expect((await order(w)).status).toBe(201);
  });
});

// M5 (controller ruling): "I've sent it" on an EXISTING order works after a downgrade; only a
// full lapse refuses it.
describe('POST /api/store/sent after a downgrade', () => {
  it.each(['hosting.monthly', 'bookings.yearly'])('on %s → 200, recorded', async (product) => {
    const { w, o } = await placedThen(product);
    expect(o.payment_method).toBeTruthy();
    expect(await postOrderSent({ token: o.manage_token, method: o.payment_method }, w.deps)).toEqual({ status: 200, body: {} });
    expect(w.order(o.id).customer_says_paid_at).not.toBeNull();
  });

  it.each([
    ['taken down', { taken_down_at: '2026-10-01T00:00:00Z' }],
    ['revoked', { revoked_at: '2026-10-01T00:00:00Z' }],
    ['an unswept purchase past expiry', { site_slug: null, expires_at: '2026-01-01T00:00:00Z' }],
  ])('a full lapse (%s) → 423 store-paused', async (_n, over) => {
    const { w, o } = await placedThen('store.monthly');
    Object.assign(w.state.purchases[w.shop().ios_otid!], over);
    expect(await postOrderSent({ token: o.manage_token, method: o.payment_method }, w.deps)).toEqual({ status: 423, body: { error: 'store-paused' } });
  });
});
