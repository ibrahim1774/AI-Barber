import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { expireStaleOrderHolds, retryPendingOrderRefunds } from '../../lib/store/core.js';
import { refundOwnerOrder } from '../../lib/store/ownerFlow.js';
import { createOrder } from '../../lib/store/publicFlow.js';
import { storeWorld, type StoreWorld } from './fakeRepo.js';

async function place(w: StoreWorld, over: Record<string, unknown> = {}) {
  const r = await createOrder({
    slug: 'fresh-cuts', clientKey: randomUUID(), items: [{ productId: w.ids.oil, quantity: 2 }],
    customer: { name: 'Sam', phone: '5551234567', email: 'sam@example.com' },
    fulfilment: 'pickup', pay: 'card', expectedTotalCents: 3000, ...over,
  }, w.deps);
  expect(r.status).toBe(201);
  return w.state.orders.at(-1)!;
}

const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

describe('expireStaleOrderHolds', () => {
  it('expires only card + awaiting + 0-paid orders older than 35 min, closes Checkout, sends nothing', async () => {
    const w = storeWorld();
    const old = await place(w);
    const orphan = await place(w);
    Object.assign(w.order(orphan.id), { stripe_checkout_session_id: null, checkout_url: null }); // died before Checkout
    const manual = await place(w, { pay: 'manual' });
    const paid = await place(w);
    Object.assign(w.order(paid.id), { status: 'paid', payment_status: 'paid', amount_paid_cents: 3000, stripe_payment_intent_id: 'pi_p' });
    w.setNow('2026-11-02T12:34:00Z');
    const young = await place(w);
    w.notified.length = 0;

    w.setNow('2026-11-02T12:36:00Z'); // the first four are 36 min old, the last 2 min
    expect(await expireStaleOrderHolds(w.deps, 50)).toEqual({ expired: 2 });
    for (const id of [old.id, orphan.id]) {
      expect(w.order(id)).toMatchObject({ status: 'cancelled', cancelled_by: 'customer', cancelled_at: '2026-11-02T12:36:00.000Z', payment_status: 'none' });
    }
    expect(w.order(young.id).status).toBe('new');
    expect(w.order(manual.id)).toMatchObject({ status: 'new', payment_status: 'awaiting' });
    expect(w.order(paid.id).status).toBe('paid');
    expect(w.payments.expireCheckoutSession).toHaveBeenCalledTimes(1);
    expect(w.payments.expireCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ id: w.ids.shopId }), `cs_${old.id}`);
    expect(w.payments.refundOrder).not.toHaveBeenCalled();
    expect(w.notified).toEqual([]);
    expect(await expireStaleOrderHolds(w.deps, 50)).toEqual({ expired: 0 }); // idempotent
  });

  it('leaves a just-paid row alone (the compare-and-set misses)', async () => {
    const w = storeWorld();
    const o = await place(w);
    w.setNow('2026-11-02T13:00:00Z');
    const orig = w.deps.repo.staleOrderHolds;
    w.deps.repo.staleOrderHolds = async (b, l) => {
      const rows = await orig(b, l);
      Object.assign(w.order(o.id), { status: 'paid', payment_status: 'paid', amount_paid_cents: 3000 }); // webhook lands
      return rows;
    };
    expect(await expireStaleOrderHolds(w.deps, 50)).toEqual({ expired: 0 });
    expect(w.order(o.id)).toMatchObject({ status: 'paid', cancelled_by: null });
    expect(w.payments.expireCheckoutSession).not.toHaveBeenCalled();
  });

  it('respects the limit', async () => {
    const w = storeWorld();
    await place(w); await place(w); await place(w);
    w.setNow('2026-11-02T13:00:00Z');
    expect(await expireStaleOrderHolds(w.deps, 2)).toEqual({ expired: 2 });
  });
});

describe('retryPendingOrderRefunds', () => {
  /** A paid card order whose owner refund of `amount` failed at Stripe (owed). */
  async function owed(w: StoreWorld, amount?: number) {
    const o = await place(w);
    Object.assign(w.order(o.id), { status: 'paid', payment_status: 'paid', amount_paid_cents: 3000, stripe_payment_intent_id: `pi_${o.id}` });
    w.payments.refundOrder.mockRejectedValueOnce(new Error('timeout'));
    const e = quiet();
    const r = await refundOwnerOrder('Bearer owner-jwt', o.id, amount ? { amountCents: amount } : {}, w.deps);
    e.mockRestore();
    expect(r.body).toMatchObject({ pending: true });
    return w.order(o.id);
  }

  it('retries with the same key as the first attempt and amount due − refunded', async () => {
    const w = storeWorld();
    const o = await owed(w, 1200);
    const firstKey = w.payments.refundOrder.mock.calls[0][3];
    w.setNow('2026-11-02T12:03:00Z');
    expect(await retryPendingOrderRefunds(w.deps)).toEqual({ retried: 1, refunded: 1, failed: 0, stuck: 0 });
    expect(w.payments.refundOrder).toHaveBeenCalledTimes(2);
    expect(w.payments.refundOrder.mock.calls[1][3]).toEqual(firstKey);
    expect(firstKey).toEqual({ idempotencyKey: `refund-order-${o.id}-1200` });
    expect(w.payments.refundOrder.mock.calls[1][2]).toBe(1200);
    expect(w.order(o.id)).toMatchObject({ amount_refunded_cents: 1200, refund_due_cents: 1200, payment_status: 'partially_refunded', status: 'paid' });
    expect(await retryPendingOrderRefunds(w.deps, Date.parse('2026-11-02T12:10:00Z'))).toEqual({ retried: 0, refunded: 0, failed: 0, stuck: 0 });
  });

  it('owed after a partial Stripe catch-up: refunds only the rest', async () => {
    const w = storeWorld();
    const o = await owed(w);
    w.order(o.id).amount_refunded_cents = 1000; // charge.refunded reported part of it
    w.setNow('2026-11-02T12:03:00Z');
    await retryPendingOrderRefunds(w.deps);
    expect(w.payments.refundOrder.mock.calls[1][2]).toBe(2000);
    expect(w.payments.refundOrder.mock.calls[1][3]).toEqual({ idempotencyKey: `refund-order-${o.id}-3000` });
    expect(w.order(o.id)).toMatchObject({ amount_refunded_cents: 3000, status: 'cancelled', cancelled_by: 'shop', payment_status: 'refunded' });
  });

  it('skips rows updated in the last 2 minutes', async () => {
    const w = storeWorld();
    await owed(w);
    w.setNow('2026-11-02T12:01:30Z');
    expect(await retryPendingOrderRefunds(w.deps)).toEqual({ retried: 0, refunded: 0, failed: 0, stuck: 0 });
    expect(w.payments.refundOrder).toHaveBeenCalledTimes(1);
  });

  it('a failure touches the row (no event) so the next run waits 2 more minutes', async () => {
    const w = storeWorld();
    const o = await owed(w);
    w.setNow('2026-11-02T12:05:00Z');
    w.payments.refundOrder.mockRejectedValueOnce(new Error('still down'));
    const e = quiet();
    expect(await retryPendingOrderRefunds(w.deps)).toEqual({ retried: 1, refunded: 0, failed: 1, stuck: 0 });
    e.mockRestore();
    expect(w.order(o.id).updated_at).toBe('2026-11-02T12:05:00.000Z');
    expect(w.state.events.filter((x) => x.kind === 'order_refund_failed')).toHaveLength(1); // only the owner attempt
    w.setNow('2026-11-02T12:06:00Z');
    expect((await retryPendingOrderRefunds(w.deps)).retried).toBe(0);
  });

  it('after 23 h sets refund_stuck_at once with one event, and never lowers refund_due_cents', async () => {
    const w = storeWorld();
    const o = await owed(w);
    w.setNow('2026-11-03T11:00:00Z'); // 23 h after the request
    const e = quiet();
    expect(await retryPendingOrderRefunds(w.deps)).toEqual({ retried: 0, refunded: 0, failed: 0, stuck: 1 });
    e.mockRestore();
    expect(w.order(o.id)).toMatchObject({ refund_stuck_at: '2026-11-03T11:00:00.000Z', refund_due_cents: 3000, amount_refunded_cents: 0 });
    expect(w.state.events.filter((x) => x.kind === 'order_refund_stuck')).toEqual([
      { shop_id: w.ids.shopId, kind: 'order_refund_stuck', payload: expect.objectContaining({ orderId: o.id, dueCents: 3000, owedCents: 3000 }) },
    ]);
    w.setNow('2026-11-03T12:00:00Z');
    expect(await retryPendingOrderRefunds(w.deps)).toEqual({ retried: 0, refunded: 0, failed: 0, stuck: 0 });
    expect(w.state.events.filter((x) => x.kind === 'order_refund_stuck')).toHaveLength(1);
    expect(w.payments.refundOrder).toHaveBeenCalledTimes(1);
  });

  it('ignores rows without a payment intent', async () => {
    const w = storeWorld();
    const o = await owed(w);
    w.order(o.id).stripe_payment_intent_id = null;
    w.setNow('2026-11-02T12:05:00Z');
    expect((await retryPendingOrderRefunds(w.deps)).retried).toBe(0);
  });
});
