// Cross-module tests written at integration (S3a store API + S3b payments/webhook). One shared
// StoreState backs both S3a's fake repo and an OrderWebhookDeps adapter that applies the live
// webhook deps' guards, so the owner endpoint, the retry sweep and the Connect webhook all see
// each other's writes. Notifications from both paths land in one sink.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { handleConnectEvent, type StripeEvent, type WebhookDeps } from '../../lib/bookings/payments.js';
import type { OrderWebhookDeps, WebhookOrder } from '../../lib/store/webhook.js';
import { STORE_APP } from '../../lib/store/constants.js';
import { createOrder } from '../../lib/store/publicFlow.js';
import { refundOwnerOrder } from '../../lib/store/ownerFlow.js';
import { retryPendingOrderRefunds } from '../../lib/store/core.js';
import { liveStorePayments } from '../../lib/store/deps.js';
import type { OrderRow, StoreNotifyEvent } from '../../lib/store/types.js';
import { storeWorld, type StoreWorld } from './fakeRepo.js';

const AUTH = 'Bearer owner-jwt';
const ADDRESS = { name: 'Sam Lee', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701' };
const CUSTOMER = { name: 'Sam Lee', phone: '5551234567', email: 'sam@example.com' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** OrderWebhookDeps over the world's own rows, with the live deps' compare-and-set guards. */
function orderWebhookDeps(w: StoreWorld, sink: StoreNotifyEvent[]): OrderWebhookDeps {
  const nowIso = () => new Date(w.deps.now()).toISOString();
  const find = (pred: (o: OrderRow) => boolean) => {
    const o = w.state.orders.find(pred);
    return o ? (JSON.parse(JSON.stringify(o)) as WebhookOrder) : null;
  };
  const write = (id: string, patch: Partial<OrderRow>) => {
    Object.assign(w.order(id), patch, { updated_at: nowIso() });
  };
  return {
    orderBySession: async (sid) => find((o) => o.stripe_checkout_session_id === sid),
    orderById: async (id) => find((o) => o.id === id),
    orderByPaymentIntent: async (pi) => find((o) => o.stripe_payment_intent_id === pi),
    shop: async (id) => w.state.shops.find((s) => s.id === id) ?? null,
    markOrderPaid: async (id, f) => {
      const o = w.order(id);
      if (!o || o.status !== 'new' || o.stripe_payment_intent_id) return false;
      write(id, {
        status: 'paid', payment_status: 'paid', payment_method: 'card', amount_paid_cents: f.amountPaidCents,
        stripe_payment_intent_id: f.paymentIntentId, paid_at: f.paidAt,
      } as Partial<OrderRow>);
      return true;
    },
    recordOrderPaidAfterCancel: async () => { throw new Error('unused in this test'); },
    expireOrderHold: async () => { throw new Error('unused in this test'); },
    cancelRefundedOrder: async (id, from, at) => {
      const o = w.order(id);
      if (!o || o.status !== from) return false;
      write(id, { status: 'cancelled', cancelled_by: 'shop', cancelled_at: at } as Partial<OrderRow>);
      return true;
    },
    setOrderRefunded: async (id, total, ps) => {
      const o = w.order(id);
      if (o && o.amount_refunded_cents <= total) write(id, { amount_refunded_cents: total, payment_status: ps } as Partial<OrderRow>);
    },
    refund: async () => { throw new Error('unused in this test'); },
    notify: async (e) => { sink.push(e); },
    now: () => w.deps.now(),
  };
}

/** Appointment side of the Connect webhook: no appointments, a Set-backed event log. */
function apptWebhookDeps(): WebhookDeps {
  const seen = new Set<string>();
  const no = async () => null;
  const unused = async () => { throw new Error('appointment path reached'); };
  return {
    eventProcessed: async (id) => seen.has(id),
    recordEvent: async (id) => { seen.add(id); },
    appointmentBySession: no, appointmentByPaymentIntent: no, appointmentById: no, shop: no,
    markPaid: unused, recordPaidAfterCancel: unused, expireHold: unused, setRefunded: unused,
    setChargesEnabledForAccount: unused, disconnectAccount: unused, refund: unused,
    notify: unused,
    now: () => Date.now(),
  } as unknown as WebhookDeps;
}

const paidSessionEvent = (o: OrderRow, pi: string): StripeEvent => ({
  id: `evt_paid_${o.id}`, type: 'checkout.session.completed', account: 'acct_1',
  data: { object: {
    id: o.stripe_checkout_session_id, payment_status: 'paid', amount_total: o.total_cents, currency: 'usd',
    payment_intent: pi, client_reference_id: o.id, metadata: { app: STORE_APP, order_id: o.id, shop_id: o.shop_id },
  } },
});

const chargeRefunded = (id: string, pi: string, cents: number): StripeEvent => ({
  id, type: 'charge.refunded', account: 'acct_1',
  data: { object: { id: 'ch_1', object: 'charge', payment_intent: pi, amount_captured: cents, amount_refunded: cents, refunded: true } },
});

/** A card pickup order (2 x Beard oil, $30) placed through S3a and marked paid by S3b's webhook. */
async function paidCardOrder(w: StoreWorld, sink: StoreNotifyEvent[], webhook: WebhookDeps) {
  const r = await createOrder({
    slug: 'fresh-cuts', clientKey: randomUUID(), items: [{ productId: w.ids.oil, quantity: 2 }],
    customer: CUSTOMER, fulfilment: 'pickup', pay: 'card', expectedTotalCents: 3000,
  }, w.deps);
  expect(r.status).toBe(201);
  const o = w.state.orders.at(-1)!;
  const pi = `pi_${o.id.slice(0, 8)}`;
  expect(await handleConnectEvent(paidSessionEvent(o, pi), webhook, orderWebhookDeps(w, sink))).toBe('order:paid');
  expect(w.order(o.id)).toMatchObject({ status: 'paid', payment_status: 'paid', amount_paid_cents: 3000, stripe_payment_intent_id: pi });
  return { id: o.id, pi };
}

describe('integration: a refund to zero whose Stripe call timed out', () => {
  it('the charge.refunded webhook cancels the order; one order_cancelled email across endpoint, webhook, redeliveries and the sweep', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = storeWorld();
    const sink: StoreNotifyEvent[] = [];
    w.deps.notify = vi.fn(async (e: StoreNotifyEvent) => { sink.push(e); });
    const webhook = apptWebhookDeps();
    const orderDeps = orderWebhookDeps(w, sink);
    const { id, pi } = await paidCardOrder(w, sink, webhook);
    const cancelled = () => sink.filter((e) => e.kind === 'order_cancelled');

    // 1. Owner refunds everything; the Stripe call times out (Stripe did refund).
    w.payments.refundOrder.mockRejectedValueOnce(new Error('The operation was aborted due to timeout'));
    const r = await refundOwnerOrder(AUTH, id, {}, w.deps);
    expect(r.status).toBe(200);
    expect(w.order(id)).toMatchObject({ status: 'paid', refund_due_cents: 3000, amount_refunded_cents: 0 });
    expect(cancelled()).toHaveLength(0);
    const key = w.payments.refundOrder.mock.calls[0][3].idempotencyKey;
    expect(key).toBe(`refund-order-${id}-3000`);

    // 2. charge.refunded: the webhook records the refund and finalizes the order.
    expect(await handleConnectEvent(chargeRefunded('evt_refund_1', pi, 3000), webhook, orderDeps)).toBe('order:refund:recorded:cancelled');
    expect(w.order(id)).toMatchObject({
      status: 'cancelled', cancelled_by: 'shop', payment_status: 'refunded', amount_refunded_cents: 3000, refund_due_cents: 3000,
    });
    expect(cancelled()).toEqual([{ kind: 'order_cancelled', orderId: id, refundedCents: 3000 }]);

    // 3. Stripe redelivers the same event: deduped by id.
    expect(await handleConnectEvent(chargeRefunded('evt_refund_1', pi, 3000), webhook, orderDeps)).toBe('duplicate');
    // 4. Same payload under a new event id (the event log was not written): the row-state guard holds.
    expect(await handleConnectEvent(chargeRefunded('evt_refund_2', pi, 3000), webhook, orderDeps)).toBe('order:refund:recorded');
    expect(cancelled()).toHaveLength(1);

    // 5. The retry sweep finds nothing owed and calls Stripe no more.
    w.setNow('2026-11-02T12:10:00Z');
    expect(await retryPendingOrderRefunds(w.deps)).toMatchObject({ retried: 0, refunded: 0 });
    // 6. The owner tries the refund again: nothing left to refund, no email.
    const again = await refundOwnerOrder(AUTH, id, {}, w.deps);
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(w.payments.refundOrder).toHaveBeenCalledTimes(1);
    expect(w.order(id).status).toBe('cancelled');
    expect(cancelled()).toHaveLength(1);
  });

  it('when the retry sweep lands first, it cancels and emails; the late webhook sends nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = storeWorld();
    const sink: StoreNotifyEvent[] = [];
    w.deps.notify = vi.fn(async (e: StoreNotifyEvent) => { sink.push(e); });
    const webhook = apptWebhookDeps();
    const orderDeps = orderWebhookDeps(w, sink);
    const { id, pi } = await paidCardOrder(w, sink, webhook);
    const cancelled = () => sink.filter((e) => e.kind === 'order_cancelled');

    w.payments.refundOrder.mockRejectedValueOnce(new Error('timeout'));
    expect((await refundOwnerOrder(AUTH, id, {}, w.deps)).status).toBe(200);
    expect(cancelled()).toHaveLength(0);

    // The sweep retries under the same key (Stripe answers with the refund it already made).
    w.setNow('2026-11-02T12:10:00Z');
    expect(await retryPendingOrderRefunds(w.deps)).toMatchObject({ retried: 1, refunded: 1, failed: 0 });
    const keys = w.payments.refundOrder.mock.calls.map((c) => c[3].idempotencyKey);
    expect(keys).toEqual([`refund-order-${id}-3000`, `refund-order-${id}-3000`]);
    expect(w.order(id)).toMatchObject({ status: 'cancelled', payment_status: 'refunded', amount_refunded_cents: 3000 });
    expect(cancelled()).toHaveLength(1);

    expect(await handleConnectEvent(chargeRefunded('evt_refund_late', pi, 3000), webhook, orderDeps)).toBe('order:refund:recorded');
    expect(await handleConnectEvent(chargeRefunded('evt_refund_late', pi, 3000), webhook, orderDeps)).toBe('duplicate');
    expect(cancelled()).toHaveLength(1);
  });
});

describe('integration: the full shop row reaches createOrderCheckout', () => {
  const placeShipping = (w: StoreWorld) => createOrder({
    slug: 'fresh-cuts', clientKey: randomUUID(), items: [{ productId: w.ids.oil, quantity: 2 }],
    customer: CUSTOMER, fulfilment: 'shipping', address: ADDRESS, pay: 'card', expectedTotalCents: 3500,
  }, w.deps);

  it('createOrder passes the shop row with ships_within_days', async () => {
    const w = storeWorld({ shop: { ships_within_days: 3 } });
    expect((await placeShipping(w)).status).toBe(201);
    const [shop, order] = w.payments.createOrderCheckout.mock.calls[0];
    expect(shop).toMatchObject({ id: w.shop().id, stripe_account_id: 'acct_1', ships_within_days: 3, platform_fee_bps: 200 });
    expect(order).toMatchObject({ fulfilment: 'shipping', shipping_cents: 500, total_cents: 3500 });
  });

  it("through the live payments, Stripe gets the shipping label and estimate from the row", async () => {
    vi.stubEnv('STRIPE_CONNECT_SECRET_KEY', 'sk_test_x');
    const bodies: URLSearchParams[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body?: string }) => {
      bodies.push(new URLSearchParams(init.body));
      return new Response(JSON.stringify({ id: 'cs_live', url: 'https://checkout.stripe.test/cs_live', amount_total: 3500 }), { status: 200 });
    }));
    const w = storeWorld({ shop: { ships_within_days: 3 } });
    w.deps.payments = liveStorePayments;
    expect((await placeShipping(w)).status).toBe(201);
    expect(bodies).toHaveLength(1);
    const b = bodies[0];
    expect(b.get('shipping_options[0][shipping_rate_data][display_name]')).toBe('Ships within 3 days');
    expect(b.get('shipping_options[0][shipping_rate_data][delivery_estimate][maximum][value]')).toBe('8');
    expect(b.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]')).toBe('500');
    expect(b.get('metadata[app]')).toBe(STORE_APP);
    expect(w.state.orders.at(-1)).toMatchObject({ stripe_checkout_session_id: 'cs_live' });
  });
});
