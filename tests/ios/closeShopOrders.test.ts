import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createOrder } from '../../lib/store/publicFlow.js';
import { closeShopForDeletion, orderLane, type OrderQueries } from '../../lib/ios/closeShop.js';
import { storeWorld, OWNER_USER, OTHER_USER, type StoreWorld } from '../store/fakeRepo.js';

async function place(w: StoreWorld, over: Record<string, unknown> = {}) {
  const r = await createOrder({
    slug: 'fresh-cuts', clientKey: randomUUID(), items: [{ productId: w.ids.oil, quantity: 2 }],
    customer: { name: 'Sam Lee', phone: '5551234567', email: 'sam@example.com' },
    fulfilment: 'pickup', pay: 'manual', expectedTotalCents: 3000, ...over,
  }, w.deps);
  expect(r.status).toBe(201);
  w.notified.length = 0;
  return w.state.orders.at(-1)!;
}
const paidCard = async (w: StoreWorld) => {
  const o = await place(w, { pay: 'card' });
  Object.assign(w.order(o.id), { status: 'paid', payment_status: 'paid', amount_paid_cents: o.total_cents, stripe_payment_intent_id: `pi_${o.id}`, paid_at: '2026-11-02T12:01:00.000Z' });
  return w.order(o.id);
};
const queries = (w: StoreWorld): OrderQueries => ({
  openIds: async (shopId, limit) => w.state.orders.filter((o) => o.shop_id === shopId && ['new', 'paid'].includes(o.status)).slice(0, limit).map((o) => o.id),
  readyIds: async (shopId) => w.state.orders.filter((o) => o.shop_id === shopId && o.status === 'ready').map((o) => o.id),
});
const run = (w: StoreWorld, user = OWNER_USER) =>
  closeShopForDeletion(user, { now: () => 0, shopIdFor: async () => w.ids.shopId, lanes: (s, u) => [orderLane(w.deps, u, s, queries(w))] });

describe('orders on account deletion', () => {
  it('an unpaid manual order is cancelled through the owner path and the customer is emailed as closed', async () => {
    const w = storeWorld();
    const o = await place(w);
    const r = await run(w);
    expect(r).toMatchObject({ ok: true, ordersCancelled: 1, needsRefund: [] });
    expect(w.order(o.id)).toMatchObject({ status: 'cancelled', cancelled_by: 'shop' });
    expect(w.notified).toEqual([expect.objectContaining({ kind: 'order_cancelled', orderId: o.id, closed: true })]);
  });

  it('a paid card order is refunded through the existing refund path, which cancels it and emails', async () => {
    const w = storeWorld();
    const o = await paidCard(w);
    const r = await run(w);
    expect(w.payments.refundOrder).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, ordersCancelled: 1, needsRefund: [] });
    expect(w.order(o.id)).toMatchObject({ status: 'cancelled', amount_refunded_cents: o.total_cents });
    expect(w.notified.filter((e) => e.kind === 'order_cancelled')).toHaveLength(1);
    expect(w.notified[0]).toMatchObject({ closed: true });
  });

  it('a failed card refund aborts; the retry refunds, and no second email is sent', async () => {
    const w = storeWorld();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const o = await paidCard(w);
    w.payments.refundOrder.mockRejectedValueOnce(new Error('stripe down'));
    expect((await run(w)).ok).toBe(false);
    expect(w.order(o.id).status).toBe('paid');
    expect(w.notified).toEqual([]);
    const r = await run(w);
    expect(r.ok).toBe(true);
    expect(w.order(o.id).status).toBe('cancelled');
    expect(w.notified).toHaveLength(1);
    expect((await run(w)).ok).toBe(true);
    expect(w.notified).toHaveLength(1);
    err.mockRestore();
  });

  it('a manual order the customer already paid is cancelled and flagged, with no money moved', async () => {
    const w = storeWorld();
    const o = await place(w);
    Object.assign(w.order(o.id), { status: 'paid', payment_status: 'paid', amount_paid_cents: o.total_cents });
    const r = await run(w);
    expect(w.payments.refundOrder).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, needsRefund: [`order:${o.id}`] });
  });

  it('an unpaid card hold is expired without an email', async () => {
    const w = storeWorld();
    const o = await place(w, { pay: 'card' });
    const r = await run(w);
    expect(r.ok).toBe(true);
    expect(w.order(o.id).status).toBe('cancelled');
    expect(w.notified).toEqual([]);
  });

  it('orders ready for pickup are left alone and reported', async () => {
    const w = storeWorld();
    const o = await place(w);
    w.order(o.id).status = 'ready';
    const r = await run(w);
    expect(r).toMatchObject({ ok: true, ordersCancelled: 0, notCancelled: [`order:${o.id}`] });
    expect(w.order(o.id).status).toBe('ready');
  });

  it("another account's id cannot reach this shop's orders", async () => {
    const w = storeWorld();
    const o = await place(w);
    // Pretend the other account's id is asked about this shop: the owner path 404s, so the cancel fails and nothing is touched.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await run(w, OTHER_USER);
    expect(r.ok).toBe(false);
    expect(w.order(o.id).status).toBe('new');
    err.mockRestore();
  });
});
