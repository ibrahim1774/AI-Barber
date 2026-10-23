import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createOrder } from '../../lib/store/publicFlow.js';
import { markOwnerOrder, refundOwnerOrder } from '../../lib/store/ownerFlow.js';
import { storeWorld, type StoreWorld } from './fakeRepo.js';

const AUTH = 'Bearer owner-jwt';
const ADDRESS = { name: 'Sam Lee', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701' };

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

const shipping = { fulfilment: 'shipping', address: ADDRESS, expectedTotalCents: 3500 };

/** A card order the webhook has marked paid (total 3000 for pickup). */
async function paidCard(w: StoreWorld, over: Record<string, unknown> = {}) {
  const o = await place(w, { pay: 'card', ...over });
  Object.assign(w.order(o.id), {
    status: 'paid', payment_status: 'paid', amount_paid_cents: o.total_cents, stripe_payment_intent_id: `pi_${o.id}`,
    paid_at: '2026-11-02T12:01:00.000Z',
  });
  return w.order(o.id);
}

const mark = (w: StoreWorld, id: unknown, body: unknown, auth: string | undefined = AUTH) => markOwnerOrder(auth, id, body, w.deps);
const refund = (w: StoreWorld, id: unknown, body: unknown, auth: string | undefined = AUTH) => refundOwnerOrder(auth, id, body, w.deps);
const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

describe('owner auth and scoping', () => {
  it('401 without a token or with a bad one, 404 no-shop for a user without a shop', async () => {
    const w = storeWorld();
    const o = await place(w);
    expect(await markOwnerOrder(undefined, o.id, { action: 'done' }, w.deps)).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(await refund(w, o.id, {}, 'Bearer nope')).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(await refundOwnerOrder(undefined, o.id, {}, w.deps)).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(await mark(w, o.id, { action: 'done' }, 'Bearer noshop-jwt')).toEqual({ status: 404, body: { error: 'no-shop' } });
  });

  it("404 for another shop's order, an unknown id or a non-uuid", async () => {
    const w = storeWorld();
    const o = await place(w);
    expect(await mark(w, o.id, { action: 'done' }, 'Bearer other-jwt')).toEqual({ status: 404, body: { error: 'not-found' } });
    expect(await refund(w, o.id, {}, 'Bearer other-jwt')).toEqual({ status: 404, body: { error: 'not-found' } });
    expect((await mark(w, randomUUID(), { action: 'done' })).status).toBe(404);
    expect((await mark(w, 'abc', { action: 'done' })).status).toBe(404);
    expect(w.order(o.id).status).toBe('new');
  });

  it('every action on an unpaid card hold returns 404', async () => {
    const w = storeWorld();
    const o = await place(w, { pay: 'card' });
    for (const action of ['paid', 'ready', 'shipped', 'done', 'cancel']) {
      expect(await mark(w, o.id, { action }), action).toEqual({ status: 404, body: { error: 'not-found' } });
    }
    expect(await refund(w, o.id, {})).toEqual({ status: 404, body: { error: 'not-found' } });
    expect(w.order(o.id)).toMatchObject({ status: 'new', payment_status: 'awaiting' });
  });

  it('owner actions are never gated by the store', async () => {
    const w = storeWorld();
    const o = await place(w);
    w.state.shops[0].store_enabled = false;
    expect((await mark(w, o.id, { action: 'ready' })).status).toBe(200);
  });

  it('400 invalid body/action', async () => {
    const w = storeWorld();
    const o = await place(w);
    expect(await mark(w, o.id, undefined)).toEqual({ status: 400, body: { error: 'invalid', field: 'body' } });
    expect(await mark(w, o.id, { action: 'explode' })).toEqual({ status: 400, body: { error: 'invalid', field: 'action' } });
  });
});

describe('mark: paid', () => {
  it('a manual order moves new -> paid with amount_paid = total, and the full OwnerOrder comes back', async () => {
    const w = storeWorld();
    const o = await place(w, { note: 'Hi' });
    const r = await mark(w, o.id, { action: 'paid' });
    expect(r.status).toBe(200);
    expect(w.order(o.id)).toMatchObject({ status: 'paid', payment_status: 'paid', amount_paid_cents: 3000, payment_method: 'cashapp' });
    expect(r.body).toEqual({
      order: {
        id: o.id, number: 1001, status: 'paid', fulfilment: 'pickup', createdAt: '2026-11-02T12:00:00.000Z',
        customer: { name: 'Sam Lee', phone: '5551234567', email: 'sam@example.com' }, note: 'Hi', shippingAddress: null,
        items: [{ productId: w.ids.oil, name: 'Beard oil', unitPriceCents: 1500, quantity: 2 }],
        subtotalCents: 3000, shippingCents: 0, totalCents: 3000,
        paymentStatus: 'paid', paymentMethod: 'cashapp', amountPaidCents: 3000, amountRefundedCents: 0, refundPending: false, refundStuck: false,
        trackingNumber: null, trackingUrl: null, customerSaysPaidAt: null, readyAt: null, shippedAt: null, doneAt: null, cancelledAt: null,
      },
    });
  });

  it('an in-shop order (payment none) can be marked paid', async () => {
    const w = storeWorld();
    const o = await place(w, { pay: 'shop' });
    expect((await mark(w, o.id, { action: 'paid' })).status).toBe(200);
    expect(w.order(o.id)).toMatchObject({ status: 'paid', payment_status: 'paid', amount_paid_cents: 3000, payment_method: 'shop' });
  });

  it('a ready pickup order marked paid stays ready', async () => {
    const w = storeWorld();
    const o = await place(w);
    await mark(w, o.id, { action: 'ready' });
    expect((await mark(w, o.id, { action: 'paid' })).status).toBe(200);
    expect(w.order(o.id)).toMatchObject({ status: 'ready', payment_status: 'paid', amount_paid_cents: 3000 });
  });

  it('a card order returns 409 card-payment', async () => {
    const w = storeWorld();
    const o = await paidCard(w);
    expect(await mark(w, o.id, { action: 'paid' })).toEqual({ status: 409, body: { error: 'card-payment' } });
  });

  it('a repeat is 200 and unchanged', async () => {
    const w = storeWorld();
    const o = await place(w);
    await mark(w, o.id, { action: 'paid' });
    const before = { ...w.order(o.id) };
    w.setNow('2026-11-02T13:00:00Z');
    const r = await mark(w, o.id, { action: 'paid' });
    expect(r.status).toBe(200);
    expect(w.order(o.id)).toEqual(before);
  });

  it('a cancelled order is 409 not-markable', async () => {
    const w = storeWorld();
    const o = await place(w);
    await mark(w, o.id, { action: 'cancel' });
    expect(await mark(w, o.id, { action: 'paid' })).toEqual({ status: 409, body: { error: 'not-markable' } });
  });
});

describe('mark: ready / shipped / done', () => {
  it('ready works on pickup only and emails once; a repeat is 200 with no second email', async () => {
    const w = storeWorld();
    const o = await place(w);
    const r = await mark(w, o.id, { action: 'ready' });
    expect(r.status).toBe(200);
    expect(w.order(o.id)).toMatchObject({ status: 'ready', ready_at: '2026-11-02T12:00:00.000Z' });
    expect(w.notified).toEqual([{ kind: 'order_ready', orderId: o.id }]);
    expect((await mark(w, o.id, { action: 'ready' })).status).toBe(200);
    expect(w.notified).toHaveLength(1);
    const s = await place(w, shipping);
    expect(await mark(w, s.id, { action: 'ready' })).toEqual({ status: 409, body: { error: 'wrong-fulfilment' } });
  });

  it('ready from paid works; ready from done is 409 not-markable', async () => {
    const w = storeWorld();
    const o = await paidCard(w);
    expect((await mark(w, o.id, { action: 'ready' })).status).toBe(200);
    const d = await place(w);
    await mark(w, d.id, { action: 'done' });
    expect(await mark(w, d.id, { action: 'ready' })).toEqual({ status: 409, body: { error: 'not-markable' } });
  });

  it('shipped works on shipping only, stores tracking and emails', async () => {
    const w = storeWorld();
    const s = await place(w, shipping);
    const r = await mark(w, s.id, { action: 'shipped', trackingNumber: ' 1Z999 ', trackingUrl: 'https://ups.example/1Z999' });
    expect(r.status).toBe(200);
    expect(w.order(s.id)).toMatchObject({
      status: 'shipped', shipped_at: '2026-11-02T12:00:00.000Z', tracking_number: '1Z999', tracking_url: 'https://ups.example/1Z999',
    });
    expect((r.body as any).order).toMatchObject({ trackingNumber: '1Z999', shippedAt: '2026-11-02T12:00:00.000Z' });
    expect(w.notified).toEqual([{ kind: 'order_shipped', orderId: s.id }]);
    const p = await place(w);
    expect(await mark(w, p.id, { action: 'shipped' })).toEqual({ status: 409, body: { error: 'wrong-fulfilment' } });
  });

  it('shipped without tracking is fine', async () => {
    const w = storeWorld();
    const s = await place(w, shipping);
    expect((await mark(w, s.id, { action: 'shipped' })).status).toBe(200);
    expect(w.order(s.id)).toMatchObject({ status: 'shipped', tracking_number: null, tracking_url: null });
  });

  it('tracking: an http:// URL, a long URL or number, or tracking on another action is 400', async () => {
    const w = storeWorld();
    const s = await place(w, shipping);
    expect(await mark(w, s.id, { action: 'shipped', trackingUrl: 'http://ups.example/1' })).toEqual({ status: 400, body: { error: 'invalid', field: 'trackingUrl' } });
    expect(await mark(w, s.id, { action: 'shipped', trackingUrl: `https://u/${'x'.repeat(500)}` })).toEqual({ status: 400, body: { error: 'invalid', field: 'trackingUrl' } });
    expect(await mark(w, s.id, { action: 'shipped', trackingNumber: 'x'.repeat(65) })).toEqual({ status: 400, body: { error: 'invalid', field: 'trackingNumber' } });
    expect(await mark(w, s.id, { action: 'done', trackingNumber: '1Z' })).toEqual({ status: 400, body: { error: 'invalid', field: 'trackingNumber' } });
    expect(await mark(w, s.id, { action: 'done', trackingUrl: 'https://u/1' })).toEqual({ status: 400, body: { error: 'invalid', field: 'trackingUrl' } });
    expect(w.order(s.id).status).toBe('new');
    expect(w.notified).toEqual([]);
  });

  it('done works from new, paid, ready and shipped, with no email; 409 from cancelled', async () => {
    const w = storeWorld();
    const n = await place(w);
    const p = await place(w); await mark(w, p.id, { action: 'paid' });
    const r = await place(w); await mark(w, r.id, { action: 'ready' });
    const s = await place(w, shipping); await mark(w, s.id, { action: 'shipped' });
    w.notified.length = 0;
    for (const o of [n, p, r, s]) {
      expect((await mark(w, o.id, { action: 'done' })).status).toBe(200);
      expect(w.order(o.id)).toMatchObject({ status: 'done', done_at: '2026-11-02T12:00:00.000Z' });
    }
    expect(w.notified).toEqual([]);
    expect((await mark(w, n.id, { action: 'done' })).status).toBe(200); // repeat
    const c = await place(w); await mark(w, c.id, { action: 'cancel' });
    expect(await mark(w, c.id, { action: 'done' })).toEqual({ status: 409, body: { error: 'not-markable' } });
  });
});

describe('mark: cancel', () => {
  it('an unpaid manual order is cancelled (shop), payment none, and emailed', async () => {
    const w = storeWorld();
    const o = await place(w);
    const r = await mark(w, o.id, { action: 'cancel' });
    expect(r.status).toBe(200);
    expect(w.order(o.id)).toMatchObject({ status: 'cancelled', cancelled_by: 'shop', cancelled_at: '2026-11-02T12:00:00.000Z', payment_status: 'none' });
    expect(w.notified).toEqual([{ kind: 'order_cancelled', orderId: o.id }]);
    expect((await mark(w, o.id, { action: 'cancel' })).status).toBe(200); // repeat: unchanged, no second email
    expect(w.notified).toHaveLength(1);
  });

  it('a card-paid order returns 409 has-payment, unchanged', async () => {
    const w = storeWorld();
    const c = await paidCard(w);
    const before = { ...w.order(c.id) };
    expect(await mark(w, c.id, { action: 'cancel' })).toEqual({ status: 409, body: { error: 'has-payment' } });
    expect(w.order(c.id)).toEqual(before);
    expect(w.notified).toEqual([]);
  });

  it('a marked-paid manual order can be cancelled: 200, no money moves, one email without a refund amount', async () => {
    const w = storeWorld();
    const m = await place(w);
    await mark(w, m.id, { action: 'paid' });
    const upd = vi.spyOn(w.deps.repo, 'updateOrder');
    const r = await mark(w, m.id, { action: 'cancel' });
    expect(r.status).toBe(200);
    expect(w.order(m.id)).toMatchObject({
      status: 'cancelled', cancelled_by: 'shop', cancelled_at: '2026-11-02T12:00:00.000Z',
      payment_status: 'paid', amount_paid_cents: 3000, amount_refunded_cents: 0,
    });
    expect(upd.mock.calls[0][2]).toEqual({ status: 'paid', paidCents: 3000, refundedEq: 0, paymentStatusIn: ['paid'] });
    expect(w.payments.refundOrder).not.toHaveBeenCalled();
    expect(w.notified).toEqual([{ kind: 'order_cancelled', orderId: m.id }]);
    expect((await mark(w, m.id, { action: 'cancel' })).status).toBe(200); // repeat: no second email
    expect(w.notified).toHaveLength(1);
  });

  it('an in-shop order marked paid can be cancelled too', async () => {
    const w = storeWorld();
    const o = await place(w, { pay: 'shop' });
    await mark(w, o.id, { action: 'paid' });
    expect((await mark(w, o.id, { action: 'cancel' })).status).toBe(200);
    expect(w.order(o.id)).toMatchObject({ status: 'cancelled', payment_status: 'paid' });
  });

  it('a manual cancel whose payment status changed after the read misses the compare-and-set (409)', async () => {
    const w = storeWorld();
    const o = await place(w);
    const orig = w.deps.repo.orderById;
    let first = true;
    w.deps.repo.orderById = async (id) => {
      const r = await orig(id);
      if (first) { first = false; Object.assign(w.order(o.id), { payment_status: 'paid', amount_paid_cents: 3000, status: 'paid' }); }
      return r;
    };
    expect(await mark(w, o.id, { action: 'cancel' })).toEqual({ status: 409, body: { error: 'not-markable' } });
    expect(w.order(o.id).status).toBe('paid');
  });

  it('a fully refunded card order (refunded outside the app) can be cancelled; payment status stays refunded', async () => {
    const w = storeWorld();
    const c = await paidCard(w);
    Object.assign(w.order(c.id), { amount_refunded_cents: 3000, refund_due_cents: 0, payment_status: 'refunded' });
    expect((await mark(w, c.id, { action: 'cancel' })).status).toBe(200);
    expect(w.order(c.id)).toMatchObject({ status: 'cancelled', cancelled_by: 'shop', payment_status: 'refunded' });
  });

  it('ready, shipped or done orders are 409 not-markable', async () => {
    const w = storeWorld();
    const o = await place(w);
    await mark(w, o.id, { action: 'ready' });
    expect(await mark(w, o.id, { action: 'cancel' })).toEqual({ status: 409, body: { error: 'not-markable' } });
  });
});

describe('mark: concurrency', () => {
  it('a stale compare-and-set returns 409 not-markable', async () => {
    const w = storeWorld();
    const o = await place(w);
    const orig = w.deps.repo.orderById;
    let first = true;
    w.deps.repo.orderById = async (id) => {
      const r = await orig(id);
      if (first) { first = false; w.order(o.id).status = 'done'; } // a concurrent "done" lands after our read
      return r;
    };
    expect(await mark(w, o.id, { action: 'ready' })).toEqual({ status: 409, body: { error: 'not-markable' } });
    expect(w.order(o.id).status).toBe('done');
    expect(w.notified).toEqual([]);
  });

  it('a concurrent identical action resolves to 200 with no second email', async () => {
    const w = storeWorld();
    const o = await place(w);
    const orig = w.deps.repo.orderById;
    let first = true;
    w.deps.repo.orderById = async (id) => {
      const r = await orig(id);
      if (first) { first = false; Object.assign(w.order(o.id), { status: 'ready', ready_at: '2026-11-02T11:59:00.000Z' }); }
      return r;
    };
    expect((await mark(w, o.id, { action: 'ready' })).status).toBe(200);
    expect(w.notified).toEqual([]);
  });

  it('mark paid uses literal guards (not card, unpaid, status and paid as read)', async () => {
    const w = storeWorld();
    const o = await place(w);
    const upd = vi.spyOn(w.deps.repo, 'updateOrder');
    await mark(w, o.id, { action: 'paid' });
    expect(upd.mock.calls[0][2]).toEqual({ notCard: true, paymentStatusIn: ['none', 'awaiting'], status: 'new', paidCents: 0 });
  });
});

describe('refund', () => {
  it('full: claims refund_due = paid, refunds under refund-order-{id}-{paid}-{paid}-0, writes the absolute total, paid -> cancelled', async () => {
    const w = storeWorld();
    const o = await paidCard(w);
    const upd = vi.spyOn(w.deps.repo, 'updateOrder');
    const r = await refund(w, o.id, {});
    expect(r.status).toBe(200);
    expect(upd.mock.calls[0][1]).toEqual({ refund_due_cents: 3000, refund_requested_at: '2026-11-02T12:00:00.000Z' });
    expect(upd.mock.calls[0][2]).toEqual({ paymentMethod: 'card', refundDue: 0, refundedEq: 0, paidCents: 3000 });
    expect(w.payments.refundOrder).toHaveBeenCalledTimes(1);
    expect(w.payments.refundOrder.mock.calls[0][2]).toBe(3000);
    expect(w.payments.refundOrder.mock.calls[0][3]).toEqual({ idempotencyKey: `refund-order-${o.id}-3000-3000-0` });
    expect(upd.mock.calls[1][1]).toEqual({ amount_refunded_cents: 3000, payment_status: 'refunded' });
    expect(upd.mock.calls[1][2]).toEqual({ refundedLte: 3000 });
    expect(w.order(o.id)).toMatchObject({
      status: 'cancelled', cancelled_by: 'shop', amount_refunded_cents: 3000, refund_due_cents: 3000, payment_status: 'refunded',
    });
    expect(r.body).toMatchObject({ refundedCents: 3000, pending: false, order: { status: 'cancelled', amountRefundedCents: 3000, refundPending: false } });
    expect(w.notified).toEqual([{ kind: 'order_cancelled', orderId: o.id, refundedCents: 3000 }]);
  });

  it('a full refund of a ready or shipped order keeps its status', async () => {
    const w = storeWorld();
    const o = await paidCard(w);
    await mark(w, o.id, { action: 'ready' });
    w.notified.length = 0;
    await refund(w, o.id, {});
    expect(w.order(o.id)).toMatchObject({ status: 'ready', payment_status: 'refunded', amount_refunded_cents: 3000 });
    expect(w.notified).toEqual([]);
  });

  it('partial 500 of 3000: key target 500, status unchanged; a second 500 uses target 1000', async () => {
    const w = storeWorld();
    const o = await paidCard(w);
    const r1 = await refund(w, o.id, { amountCents: 500 });
    expect(r1.body).toMatchObject({ refundedCents: 500, pending: false });
    expect(w.payments.refundOrder.mock.calls[0][3]).toEqual({ idempotencyKey: `refund-order-${o.id}-500-500-0` });
    expect(w.order(o.id)).toMatchObject({ status: 'paid', payment_status: 'partially_refunded', amount_refunded_cents: 500, refund_due_cents: 500 });
    await refund(w, o.id, { amountCents: 500 });
    expect(w.payments.refundOrder.mock.calls[1][2]).toBe(500);
    expect(w.payments.refundOrder.mock.calls[1][3]).toEqual({ idempotencyKey: `refund-order-${o.id}-1000-500-500` });
    expect(w.order(o.id)).toMatchObject({ amount_refunded_cents: 1000, refund_due_cents: 1000, status: 'paid' });
    // the rest: refundable is 2000
    const r3 = await refund(w, o.id, {});
    expect(r3.body).toMatchObject({ refundedCents: 2000 });
    expect(w.order(o.id)).toMatchObject({ status: 'cancelled', payment_status: 'refunded', amount_refunded_cents: 3000 });
  });

  it('409 refund-pending while one is owed (checked in TypeScript before any write)', async () => {
    const w = storeWorld();
    const o = await paidCard(w);
    w.order(o.id).refund_due_cents = 1000; // owed, not yet refunded
    const upd = vi.spyOn(w.deps.repo, 'updateOrder');
    expect(await refund(w, o.id, { amountCents: 100 })).toEqual({ status: 409, body: { error: 'refund-pending' } });
    expect(upd).not.toHaveBeenCalled();
    expect(w.payments.refundOrder).not.toHaveBeenCalled();
  });

  it('a claim that misses re-reads: refund-pending when one is now owed, else not-markable', async () => {
    const w = storeWorld();
    const o = await paidCard(w);
    const orig = w.deps.repo.orderById;
    let n = 0;
    w.deps.repo.orderById = async (id) => {
      const r = await orig(id);
      if (n++ === 0) w.order(o.id).refund_due_cents = 3000; // a concurrent refund claimed first
      return r;
    };
    expect(await refund(w, o.id, {})).toEqual({ status: 409, body: { error: 'refund-pending' } });
    const w2 = storeWorld();
    const o2 = await paidCard(w2);
    const orig2 = w2.deps.repo.orderById;
    let m = 0;
    w2.deps.repo.orderById = async (id) => {
      const r = await orig2(id);
      if (m++ === 0) Object.assign(w2.order(o2.id), { amount_refunded_cents: 3000, payment_status: 'refunded' }); // refunded in Stripe meanwhile
      return r;
    };
    expect(await refund(w2, o2.id, {})).toEqual({ status: 409, body: { error: 'not-markable' } });
    expect(w2.payments.refundOrder).not.toHaveBeenCalled();
  });

  it('409 not-card for a manual order, nothing-to-refund when fully refunded or never paid', async () => {
    const w = storeWorld();
    const m = await place(w);
    await mark(w, m.id, { action: 'paid' });
    expect(await refund(w, m.id, {})).toEqual({ status: 409, body: { error: 'not-card' } });
    const c = await paidCard(w);
    Object.assign(w.order(c.id), { amount_refunded_cents: 3000, refund_due_cents: 3000, payment_status: 'refunded' });
    expect(await refund(w, c.id, {})).toEqual({ status: 409, body: { error: 'nothing-to-refund' } });
    const expired = await place(w, { pay: 'card' });
    Object.assign(w.order(expired.id), { status: 'cancelled', cancelled_by: 'customer', payment_status: 'none' });
    expect(await refund(w, expired.id, {})).toEqual({ status: 409, body: { error: 'nothing-to-refund' } });
  });

  it('400 for an amount above refundable, 0, negative, fractional or non-number; 400 body for a missing body', async () => {
    const w = storeWorld();
    const o = await paidCard(w);
    for (const amountCents of [3001, 0, -5, 1.5, '500', null]) {
      expect(await refund(w, o.id, { amountCents }), String(amountCents)).toEqual({ status: 400, body: { error: 'invalid', field: 'amountCents' } });
    }
    expect(await refund(w, o.id, undefined)).toEqual({ status: 400, body: { error: 'invalid', field: 'body' } });
    expect(w.payments.refundOrder).not.toHaveBeenCalled();
    expect(w.order(o.id).refund_due_cents).toBe(0);
  });

  it('Stripe throws: 200 pending, the row stays owed, one order_refund_failed event', async () => {
    const w = storeWorld();
    const o = await paidCard(w);
    w.payments.refundOrder.mockRejectedValueOnce(new Error('timeout'));
    const e = quiet();
    const r = await refund(w, o.id, { amountCents: 1200 });
    e.mockRestore();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ refundedCents: 0, pending: true, order: { refundPending: true, amountRefundedCents: 0 } });
    expect(w.order(o.id)).toMatchObject({ refund_due_cents: 1200, amount_refunded_cents: 0, status: 'paid', refund_requested_at: '2026-11-02T12:00:00.000Z' });
    expect(w.state.events).toEqual([{ shop_id: w.ids.shopId, kind: 'order_refund_failed', payload: expect.objectContaining({ orderId: o.id, amountCents: 1200 }) }]);
    // and a second owner refund is refused while it is owed
    expect(await refund(w, o.id, {})).toEqual({ status: 409, body: { error: 'refund-pending' } });
  });

  it('a stuck refund: 409 refund-pending (no new claim), and the order shows refundStuck', async () => {
    const w = storeWorld();
    const o = await paidCard(w);
    Object.assign(w.order(o.id), { refund_due_cents: 3000, refund_stuck_at: '2026-11-03T11:00:00.000Z' });
    const upd = vi.spyOn(w.deps.repo, 'updateOrder');
    expect(await refund(w, o.id, {})).toEqual({ status: 409, body: { error: 'refund-pending' } });
    expect(upd).not.toHaveBeenCalled();
    const r = await mark(w, o.id, { action: 'ready' });
    expect((r.body as any).order).toMatchObject({ refundStuck: true, refundPending: false });
  });

  it('a paid-after-cancel order (cancelled, no paid_at, money in): 409 not-markable, the webhook owns that refund', async () => {
    const w = storeWorld();
    const o = await place(w, { pay: 'card' });
    Object.assign(w.order(o.id), {
      status: 'cancelled', cancelled_by: 'customer', payment_status: 'paid', amount_paid_cents: 3000, stripe_payment_intent_id: 'pi_late', paid_at: null,
    });
    expect(await refund(w, o.id, {})).toEqual({ status: 409, body: { error: 'not-markable' } });
    expect(w.payments.refundOrder).not.toHaveBeenCalled();
    expect(w.order(o.id).refund_due_cents).toBe(0);
  });

  it('a shipping card order refunds the shipping too (total includes it)', async () => {
    const w = storeWorld();
    const o = await paidCard(w, { fulfilment: 'shipping', expectedTotalCents: 3500 });
    const r = await refund(w, o.id, {});
    expect(r.body).toMatchObject({ refundedCents: 3500 });
  });
});
