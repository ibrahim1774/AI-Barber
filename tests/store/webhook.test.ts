import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  handleConnectEvent, StripeApiError, type WebhookDeps, type WebhookAppointment,
} from '../../lib/bookings/payments.js';
import { isStoreSession, liveOrderWebhookDeps, type OrderWebhookDeps, type WebhookOrder } from '../../lib/store/webhook.js';
import { handleWebhook } from '../../api/stripe/connect-webhook.js';

const ORDER_ID = '11111111-2222-4333-8444-555555555555';
const APPT_ID = '99999999-8888-4777-8666-555555555555';
const NOW = Date.UTC(2026, 9, 21, 12);
const NOW_ISO = new Date(NOW).toISOString();
const shop = { id: 'shop-1', slug: 'fade-factory', name: 'Fade Factory', currency: 'usd', stripe_account_id: 'acct_123', platform_fee_bps: 200 };

const baseOrder: WebhookOrder = {
  id: ORDER_ID, shop_id: 'shop-1', order_no: 1001, manage_token: 'tok_order', customer_email: 'sam@example.com',
  fulfilment: 'pickup', shipping_cents: 0, total_cents: 4500,
  status: 'new', payment_status: 'awaiting', payment_method: 'card',
  amount_paid_cents: 0, amount_refunded_cents: 0,
  stripe_payment_intent_id: null, stripe_checkout_session_id: 'cs_o1', paid_at: null, cancelled_at: null,
};

const baseAppt: WebhookAppointment = {
  id: APPT_ID, shop_id: 'shop-1', service_name: 'Fade', price_cents: 3000, manage_token: 'tok_appt', customer_email: 'a@example.com',
  status: 'booked', payment_status: 'awaiting', payment_method: 'card', stripe_checkout_session_id: 'cs_a1',
  stripe_payment_intent_id: null, amount_paid_cents: 0, amount_refunded_cents: 0, cancelled_at: null, paid_at: null,
};

/** Stateful single-row model of ab_appointments + the shared event log. */
function mkApptDeps(initial: WebhookAppointment | null = null, over: Partial<WebhookDeps> = {}) {
  const seen = new Set<string>();
  const state = { row: initial ? { ...initial } : null as WebhookAppointment | null };
  const d = {
    state,
    eventProcessed: vi.fn(async (id: string) => seen.has(id)),
    recordEvent: vi.fn(async (id: string) => { seen.add(id); }),
    appointmentBySession: vi.fn(async (sid: string) => (state.row?.stripe_checkout_session_id === sid ? { ...state.row } : null)),
    appointmentByPaymentIntent: vi.fn(async (pi: string) => (state.row && state.row.stripe_payment_intent_id === pi ? { ...state.row } : null)),
    appointmentById: vi.fn(async (id: string) => (state.row?.id === id ? { ...state.row } : null)),
    shop: vi.fn(async () => shop),
    markPaid: vi.fn(async (_id: string, f: any) => {
      const r = state.row;
      if (!r || r.status === 'cancelled' || r.stripe_payment_intent_id) return false;
      state.row = { ...r, payment_status: f.paymentStatus, amount_paid_cents: f.amountPaidCents, stripe_payment_intent_id: f.paymentIntentId, paid_at: 'T' };
      return true;
    }),
    recordPaidAfterCancel: vi.fn(async () => false),
    expireHold: vi.fn(async () => {
      const r = state.row;
      if (!r || r.status !== 'booked' || r.payment_status !== 'awaiting') return false;
      state.row = { ...r, status: 'cancelled', payment_status: 'none' };
      return true;
    }),
    setRefunded: vi.fn(async (_id: string, total: number, ps: string) => {
      if (state.row && (state.row.amount_refunded_cents ?? 0) <= total) state.row = { ...state.row, amount_refunded_cents: total, payment_status: ps };
    }),
    setChargesEnabledForAccount: vi.fn(async () => {}),
    disconnectAccount: vi.fn(async () => true),
    refund: vi.fn(async (_s: any, _a: any, amt: number) => ({ refundedCents: amt })),
    notify: vi.fn(async () => {}),
    now: () => NOW,
  };
  Object.assign(d, over);
  return d as typeof d & WebhookDeps;
}

/** Stateful single-row model of ab_orders with the live deps' literal compare-and-set guards. */
function mkOrderDeps(initial: WebhookOrder | null = baseOrder, over: Partial<OrderWebhookDeps> = {}) {
  const state = { row: initial ? { ...initial } : null as WebhookOrder | null };
  const d = {
    state,
    orderBySession: vi.fn(async (sid: string) => (state.row?.stripe_checkout_session_id === sid ? { ...state.row } : null)),
    orderById: vi.fn(async (id: string) => (state.row?.id === id ? { ...state.row } : null)),
    orderByPaymentIntent: vi.fn(async (pi: string) => (state.row && state.row.stripe_payment_intent_id === pi ? { ...state.row } : null)),
    shop: vi.fn(async () => shop),
    markOrderPaid: vi.fn(async (_id: string, f: any) => {
      const r = state.row;
      if (!r || r.status !== 'new' || r.stripe_payment_intent_id) return false;
      state.row = {
        ...r, status: 'paid', payment_status: 'paid', payment_method: 'card', amount_paid_cents: f.amountPaidCents,
        stripe_payment_intent_id: f.paymentIntentId, paid_at: f.paidAt,
        ...(f.shippingAddress ? { shipping_address: f.shippingAddress } : {}),
      } as WebhookOrder;
      return true;
    }),
    recordOrderPaidAfterCancel: vi.fn(async (_id: string, f: any) => {
      const r = state.row;
      if (!r || r.status !== 'cancelled' || r.paid_at || r.stripe_payment_intent_id) return false;
      state.row = { ...r, payment_method: 'card', amount_paid_cents: f.amountPaidCents, stripe_payment_intent_id: f.paymentIntentId };
      return true;
    }),
    expireOrderHold: vi.fn(async (_id: string, at: string) => {
      const r = state.row;
      if (!r || r.status !== 'new' || r.payment_method !== 'card' || r.payment_status !== 'awaiting' || r.amount_paid_cents !== 0) return false;
      state.row = { ...r, status: 'cancelled', cancelled_at: at, payment_status: 'none' };
      return true;
    }),
    setOrderRefunded: vi.fn(async (_id: string, total: number, ps: string) => {
      if (state.row && state.row.amount_refunded_cents <= total) state.row = { ...state.row, amount_refunded_cents: total, payment_status: ps };
    }),
    cancelRefundedOrder: vi.fn(async (_id: string, from: string, at: string) => {
      const r = state.row;
      if (!r || r.status !== from) return false;
      state.row = { ...r, status: 'cancelled', cancelled_at: at };
      return true;
    }),
    refund: vi.fn(async (_s: any, _o: any, amt: number, _key: string) => ({ refundedCents: amt })),
    notify: vi.fn(async (_e: any) => {}),
    now: () => NOW,
  };
  Object.assign(d, over);
  return d as typeof d & OrderWebhookDeps;
}

const META = { app: 'aibarber-store', order_id: ORDER_ID, shop_id: 'shop-1' };
const storeEvent = (type: string, over: any = {}, account: string | null = 'acct_123', id = 'evt_o1') => ({
  id, type, account,
  data: { object: { id: 'cs_o1', payment_status: 'paid', amount_total: 4500, payment_intent: 'pi_o1', client_reference_id: ORDER_ID, metadata: META, ...over } },
});
const completed = (over: any = {}, account: string | null = 'acct_123', id = 'evt_o1') => storeEvent('checkout.session.completed', over, account, id);
const expired = (over: any = {}, id = 'evt_x1') => storeEvent('checkout.session.expired', { payment_status: 'unpaid', payment_intent: null, ...over }, 'acct_123', id);
const refunded = (pi: string, amount_refunded: number, id: string) => ({
  id, type: 'charge.refunded', account: 'acct_123', data: { object: { id: `ch_${id}`, payment_intent: pi, amount_refunded, amount_captured: 4500 } },
});

const APPT_LOOKUPS = ['appointmentBySession', 'appointmentById', 'appointmentByPaymentIntent', 'markPaid', 'recordPaidAfterCancel', 'expireHold', 'setRefunded'] as const;
const ORDER_FNS = ['orderBySession', 'orderById', 'orderByPaymentIntent', 'markOrderPaid', 'recordOrderPaidAfterCancel', 'expireOrderHold', 'setOrderRefunded', 'cancelRefundedOrder', 'refund', 'notify'] as const;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('isStoreSession', () => {
  it('true only for metadata.app = aibarber-store', () => {
    expect(isStoreSession({ metadata: { app: 'aibarber-store' } })).toBe(true);
    expect(isStoreSession({ metadata: { app: 'aibarber-bookings' } })).toBe(false);
    expect(isStoreSession({})).toBe(false);
    expect(isStoreSession(null)).toBe(false);
  });
});

describe('store routing', () => {
  it('a completed store session never calls the appointment deps', async () => {
    const a = mkApptDeps(baseAppt);
    const o = mkOrderDeps();
    expect(await handleConnectEvent(completed(), a, o)).toBe('order:paid');
    for (const fn of APPT_LOOKUPS) expect(a[fn]).not.toHaveBeenCalled();
    expect(a.notify).not.toHaveBeenCalled();
    expect(a.recordEvent).toHaveBeenCalledWith('evt_o1', 'checkout.session.completed', 'acct_123');
  });

  it('an appointment session (no store metadata) never calls the order deps', async () => {
    const a = mkApptDeps(baseAppt);
    const o = mkOrderDeps();
    const ev = { id: 'evt_a1', type: 'checkout.session.completed', account: 'acct_123', data: { object: { id: 'cs_a1', payment_status: 'paid', amount_total: 3000, payment_intent: 'pi_a1', client_reference_id: APPT_ID, metadata: { app: 'aibarber-bookings', appointment_id: APPT_ID } } } };
    expect(await handleConnectEvent(ev, a, o)).toBe('paid:paid');
    for (const fn of ORDER_FNS) expect(o[fn]).not.toHaveBeenCalled();
    expect(a.notify).toHaveBeenCalledWith({ kind: 'booking_created', appointmentId: APPT_ID });
  });

  it('an appointment expiry and refund never touch the order deps either', async () => {
    const a = mkApptDeps({ ...baseAppt, stripe_payment_intent_id: 'pi_a1', amount_paid_cents: 3000, payment_status: 'paid', paid_at: 'T' });
    const o = mkOrderDeps();
    expect(await handleConnectEvent(refunded('pi_a1', 1000, 'r_a'), a, o)).toBe('refund:recorded');
    expect(a.setRefunded).toHaveBeenCalledWith(APPT_ID, 1000, 'partially_refunded');
    for (const fn of ORDER_FNS) expect(o[fn]).not.toHaveBeenCalled();
  });

  it('an order paid WITHOUT metadata but matched by session id is still recorded (the fallback)', async () => {
    const a = mkApptDeps(null);
    const o = mkOrderDeps();
    const ev = completed({ metadata: {}, client_reference_id: null });
    expect(await handleConnectEvent(ev, a, o)).toBe('order:paid');
    expect(a.appointmentBySession).toHaveBeenCalledWith('cs_o1'); // the appointment branch looked first
    expect(o.markOrderPaid).toHaveBeenCalledTimes(1);
    expect(o.state.row?.status).toBe('paid');
    expect(o.notify).toHaveBeenCalledWith({ kind: 'order_created', orderId: ORDER_ID });
  });

  it('the expired fallback: no appointment, no metadata → the order hold is expired by session id', async () => {
    const a = mkApptDeps(null);
    const o = mkOrderDeps();
    expect(await handleConnectEvent(expired({ metadata: {} }), a, o)).toBe('order:cancelled:expired');
    expect(o.state.row?.status).toBe('cancelled');
  });

  it('nothing matches anywhere → the unchanged ignored:no-appointment', async () => {
    const a = mkApptDeps(null);
    const o = mkOrderDeps(null);
    expect(await handleConnectEvent(completed({ metadata: {} }), a, o)).toBe('ignored:no-appointment');
    expect(await handleConnectEvent(expired({ metadata: {} }), a, o)).toBe('ignored:no-appointment');
    expect(await handleConnectEvent(refunded('pi_none', 100, 'r_n'), a, o)).toBe('ignored:no-appointment');
  });

  it('without order deps the appointment branch is byte-for-byte the old one', async () => {
    const a = mkApptDeps(null);
    expect(await handleConnectEvent(completed({ metadata: {} }), a)).toBe('ignored:no-appointment');
  });

  it('a store session with no order deps throws (not recorded, so Stripe retries)', async () => {
    const a = mkApptDeps(null);
    await expect(handleConnectEvent(completed(), a)).rejects.toThrow(/order deps/);
    expect(a.recordEvent).not.toHaveBeenCalled();
  });
});

describe('order paid', () => {
  it('markOrderPaid with paid_at + the PI; one order_created notify; the event is recorded after the work and before the notify', async () => {
    const a = mkApptDeps();
    const o = mkOrderDeps();
    expect(await handleConnectEvent(completed(), a, o)).toBe('order:paid');
    expect(o.markOrderPaid).toHaveBeenCalledWith(ORDER_ID, { amountPaidCents: 4500, paymentIntentId: 'pi_o1', paidAt: NOW_ISO });
    expect(o.state.row).toMatchObject({ status: 'paid', payment_status: 'paid', paid_at: NOW_ISO, stripe_payment_intent_id: 'pi_o1', amount_paid_cents: 4500 });
    expect(o.notify).toHaveBeenCalledTimes(1);
    expect(o.notify).toHaveBeenCalledWith({ kind: 'order_created', orderId: ORDER_ID });
    const paidAt = o.markOrderPaid.mock.invocationCallOrder[0];
    const recAt = a.recordEvent.mock.invocationCallOrder[0];
    expect(recAt).toBeGreaterThan(paidAt);
    expect(o.notify.mock.invocationCallOrder[0]).toBeGreaterThan(recAt);
    // a recorded duplicate is a no-op
    expect(await handleConnectEvent(completed(), a, o)).toBe('duplicate');
    expect(o.markOrderPaid).toHaveBeenCalledTimes(1);
  });

  it('shipping order: the Stripe address is written (collected_information first)', async () => {
    const o = mkOrderDeps({ ...baseOrder, fulfilment: 'shipping', shipping_cents: 800, total_cents: 5300 });
    const addr = { line1: '9 Elm St', line2: null, city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' };
    await handleConnectEvent(completed({ amount_total: 5300, collected_information: { shipping_details: { name: 'Sam Lee', address: addr } } }), mkApptDeps(), o);
    expect(o.markOrderPaid).toHaveBeenCalledWith(ORDER_ID, {
      amountPaidCents: 5300, paymentIntentId: 'pi_o1', paidAt: NOW_ISO,
      shippingAddress: { name: 'Sam Lee', line1: '9 Elm St', line2: null, city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' },
    });
  });

  it('shipping order with no address on the session: no shippingAddress key (never null)', async () => {
    const o = mkOrderDeps({ ...baseOrder, fulfilment: 'shipping' });
    await handleConnectEvent(completed(), mkApptDeps(), o);
    expect(o.markOrderPaid.mock.calls[0][1]).not.toHaveProperty('shippingAddress');
  });

  it('amount_total different from the order total: logged with order id, expected and actual, and still recorded', async () => {
    const o = mkOrderDeps();
    expect(await handleConnectEvent(completed({ amount_total: 4400, currency: 'usd' }), mkApptDeps(), o)).toBe('order:paid');
    expect(o.markOrderPaid.mock.calls[0][1]).toMatchObject({ amountPaidCents: 4400 });
    const line = (console.error as any).mock.calls.map((c: any[]) => c.join(' ')).find((l: string) => l.includes('mismatch'));
    expect(line).toBeDefined();
    expect(line).toContain(ORDER_ID);
    expect(line).toContain('"expectedTotal":4500');
    expect(line).toContain('"actualTotal":4400');
  });

  it('currency different from the shop currency: logged, still recorded', async () => {
    const o = mkOrderDeps();
    expect(await handleConnectEvent(completed({ currency: 'eur' }), mkApptDeps(), o)).toBe('order:paid');
    const line = (console.error as any).mock.calls.map((c: any[]) => c.join(' ')).find((l: string) => l.includes('mismatch'));
    expect(line).toContain(ORDER_ID);
    expect(line).toContain('"expectedCurrency":"usd"');
    expect(line).toContain('"actualCurrency":"eur"');
  });

  it('matching amount and currency: no mismatch log', async () => {
    const o = mkOrderDeps();
    await handleConnectEvent(completed({ currency: 'usd' }), mkApptDeps(), o);
    expect((console.error as any).mock.calls.some((c: any[]) => c.join(' ').includes('mismatch'))).toBe(false);
  });

  it('an unpaid completed session is ignored', async () => {
    const o = mkOrderDeps();
    expect(await handleConnectEvent(completed({ payment_status: 'unpaid' }), mkApptDeps(), o)).toBe('order:ignored:unpaid');
    expect(o.markOrderPaid).not.toHaveBeenCalled();
  });

  it('async_payment_succeeded takes the same path', async () => {
    const o = mkOrderDeps();
    expect(await handleConnectEvent(storeEvent('checkout.session.async_payment_succeeded'), mkApptDeps(), o)).toBe('order:paid');
  });

  it('lookup by metadata.order_id, then client_reference_id, when the session id was never stored', async () => {
    const o = mkOrderDeps({ ...baseOrder, stripe_checkout_session_id: null });
    expect(await handleConnectEvent(completed(), mkApptDeps(), o)).toBe('order:paid');
    expect(o.orderById).toHaveBeenCalledWith(ORDER_ID);

    const o2 = mkOrderDeps({ ...baseOrder, stripe_checkout_session_id: null });
    expect(await handleConnectEvent(completed({ metadata: { app: 'aibarber-store' } }), mkApptDeps(), o2)).toBe('order:paid');
    expect(o2.orderById).toHaveBeenCalledWith(ORDER_ID);
  });
});

describe('redelivery', () => {
  it('after the work landed but the record failed: no second markOrderPaid, the notify is resent', async () => {
    const a = mkApptDeps();
    a.recordEvent.mockRejectedValueOnce(new Error('killed'));
    const o = mkOrderDeps();
    await expect(handleConnectEvent(completed(), a, o)).rejects.toThrow('killed');
    expect(o.notify).not.toHaveBeenCalled(); // never before the record
    expect(await handleConnectEvent(completed(), a, o)).toBe('order:noop:already-recorded');
    expect(o.markOrderPaid).toHaveBeenCalledTimes(1);
    expect(o.notify).toHaveBeenCalledTimes(1);
    expect(o.notify).toHaveBeenCalledWith({ kind: 'order_created', orderId: ORDER_ID });
    expect(o.refund).not.toHaveBeenCalled();
  });

  it('no notify when the order was cancelled since (the owner refund path owns the money)', async () => {
    const o = mkOrderDeps({ ...baseOrder, status: 'cancelled', payment_status: 'paid', stripe_payment_intent_id: 'pi_o1', amount_paid_cents: 4500, paid_at: 'T_PAID' });
    expect(await handleConnectEvent(completed(), mkApptDeps(), o)).toBe('order:noop:cancel-owns-refund');
    expect(o.markOrderPaid).not.toHaveBeenCalled();
    expect(o.notify).not.toHaveBeenCalled();
    expect(o.refund).not.toHaveBeenCalled();
  });
});

describe('paid after cancel', () => {
  it('recorded WITHOUT paid_at, refunded in full with refund-pac-{pi}, setOrderRefunded absolute', async () => {
    const o = mkOrderDeps({ ...baseOrder, status: 'cancelled', payment_status: 'none', cancelled_at: 'T_CANCEL' });
    expect(await handleConnectEvent(completed(), mkApptDeps(), o)).toBe('order:refunded:cancelled-before-payment');
    expect(o.markOrderPaid).not.toHaveBeenCalled();
    expect(o.recordOrderPaidAfterCancel).toHaveBeenCalledWith(ORDER_ID, { amountPaidCents: 4500, paymentIntentId: 'pi_o1' });
    expect(o.state.row?.paid_at).toBeNull();
    expect(o.refund).toHaveBeenCalledTimes(1);
    const [s, row, amt, key] = o.refund.mock.calls[0];
    expect(s).toEqual(shop);
    expect(row).toMatchObject({ id: ORDER_ID, stripe_payment_intent_id: 'pi_o1', amount_paid_cents: 4500, amount_refunded_cents: 0 });
    expect(amt).toBe(4500);
    expect(key).toBe('refund-pac-pi_o1');
    expect(o.setOrderRefunded).toHaveBeenCalledWith(ORDER_ID, 4500, 'refunded');
    expect(o.notify).not.toHaveBeenCalled();
  });

  it('a partial refund already recorded: refunds the rest under the same key and writes the cumulative total', async () => {
    const o = mkOrderDeps({ ...baseOrder, status: 'cancelled', stripe_payment_intent_id: 'pi_o1', amount_paid_cents: 4500, amount_refunded_cents: 1000, payment_status: 'partially_refunded' });
    expect(await handleConnectEvent(completed(), mkApptDeps(), o)).toBe('order:refunded:cancelled-before-payment');
    expect(o.recordOrderPaidAfterCancel).not.toHaveBeenCalled();
    expect(o.refund.mock.calls[0][2]).toBe(3500);
    expect(o.refund.mock.calls[0][3]).toBe('refund-pac-pi_o1');
    expect(o.setOrderRefunded).toHaveBeenCalledWith(ORDER_ID, 4500, 'refunded');
  });

  it('already refunded in full → no-op', async () => {
    const o = mkOrderDeps({ ...baseOrder, status: 'cancelled', stripe_payment_intent_id: 'pi_o1', amount_paid_cents: 4500, amount_refunded_cents: 4500, payment_status: 'refunded' });
    expect(await handleConnectEvent(completed(), mkApptDeps(), o)).toBe('order:noop:already-refunded');
    expect(o.refund).not.toHaveBeenCalled();
  });

  it("Stripe's charge_already_refunded counts as done", async () => {
    const o = mkOrderDeps({ ...baseOrder, status: 'cancelled' }, {
      refund: vi.fn(async () => { throw new StripeApiError('already', 400, 'charge_already_refunded'); }),
    });
    expect(await handleConnectEvent(completed(), mkApptDeps(), o)).toBe('order:refunded:cancelled-before-payment');
    expect(o.setOrderRefunded).toHaveBeenCalledWith(ORDER_ID, 4500, 'refunded');
  });
});

describe('duplicate and superseded payments', () => {
  it('duplicate PI: a second payment on a paid order is refunded with refund-dup-{pi}, against that payment', async () => {
    const o = mkOrderDeps({ ...baseOrder, status: 'paid', payment_status: 'paid', stripe_payment_intent_id: 'pi_first', amount_paid_cents: 4500, amount_refunded_cents: 500, paid_at: 'T' });
    expect(await handleConnectEvent(completed({ payment_intent: 'pi_second' }), mkApptDeps(), o)).toBe('order:refunded:duplicate-payment');
    expect(o.markOrderPaid).not.toHaveBeenCalled();
    const [, row, amt, key] = o.refund.mock.calls[0];
    expect(row).toMatchObject({ stripe_payment_intent_id: 'pi_second', amount_paid_cents: 4500, amount_refunded_cents: 0 });
    expect(amt).toBe(4500);
    expect(key).toBe('refund-dup-pi_second');
    expect(o.state.row).toMatchObject({ stripe_payment_intent_id: 'pi_first', amount_refunded_cents: 500 }); // the order's own payment untouched
    expect(o.setOrderRefunded).not.toHaveBeenCalled();
    expect(o.notify).not.toHaveBeenCalled();
  });

  it('superseded session: found by metadata.order_id on an order holding a DIFFERENT session id → refunded, never ignored or recorded', async () => {
    const o = mkOrderDeps({ ...baseOrder, stripe_checkout_session_id: 'cs_new' });
    const ev = completed({ id: 'cs_old', payment_intent: 'pi_old' });
    expect(await handleConnectEvent(ev, mkApptDeps(), o)).toBe('order:refunded:duplicate-payment');
    expect(o.markOrderPaid).not.toHaveBeenCalled();
    expect(o.recordOrderPaidAfterCancel).not.toHaveBeenCalled();
    const [, row, amt, key] = o.refund.mock.calls[0];
    expect(row).toMatchObject({ id: ORDER_ID, stripe_payment_intent_id: 'pi_old', amount_paid_cents: 4500, amount_refunded_cents: 0 });
    expect(amt).toBe(4500);
    expect(key).toBe('refund-dup-pi_old');
    expect(o.state.row).toMatchObject({ status: 'new', stripe_payment_intent_id: null, amount_paid_cents: 0 });
    expect(o.notify).not.toHaveBeenCalled();
  });

  it('superseded session found by client_reference_id is refunded the same way', async () => {
    const o = mkOrderDeps({ ...baseOrder, stripe_checkout_session_id: 'cs_new' });
    expect(await handleConnectEvent(completed({ id: 'cs_old', payment_intent: 'pi_old', metadata: { app: 'aibarber-store' } }), mkApptDeps(), o)).toBe('order:refunded:duplicate-payment');
    expect(o.refund.mock.calls[0][3]).toBe('refund-dup-pi_old');
  });

  it("a superseded session's expiry never cancels the order", async () => {
    const o = mkOrderDeps({ ...baseOrder, stripe_checkout_session_id: 'cs_new' });
    expect(await handleConnectEvent(expired({ id: 'cs_old' }), mkApptDeps(), o)).toBe('order:noop:superseded-session');
    expect(o.expireOrderHold).not.toHaveBeenCalled();
  });
});

describe('account mismatch', () => {
  it('ignored: nothing written, nothing refunded', async () => {
    const o = mkOrderDeps();
    expect(await handleConnectEvent(completed({}, 'acct_evil'), mkApptDeps(), o)).toBe('order:ignored:account-mismatch');
    expect(await handleConnectEvent(completed({}, null, 'evt_o2'), mkApptDeps(), o)).toBe('order:ignored:account-mismatch');
    expect(await handleConnectEvent({ ...expired(), account: 'acct_evil' }, mkApptDeps(), o)).toBe('order:ignored:account-mismatch');
    expect(await handleConnectEvent({ ...refunded('pi_o1', 100, 'r_e'), account: 'acct_evil' }, mkApptDeps(), mkOrderDeps({ ...baseOrder, stripe_payment_intent_id: 'pi_o1' }))).toBe('order:ignored:account-mismatch');
    expect(o.markOrderPaid).not.toHaveBeenCalled();
    expect(o.expireOrderHold).not.toHaveBeenCalled();
    expect(o.refund).not.toHaveBeenCalled();
  });

  it('a shop with no connected account → ignored', async () => {
    const o = mkOrderDeps(baseOrder, { shop: vi.fn(async () => ({ ...shop, stripe_account_id: null })) });
    expect(await handleConnectEvent(completed(), mkApptDeps(), o)).toBe('order:ignored:account-mismatch');
  });

  it('no order found and a paid session → logged, ignored', async () => {
    const o = mkOrderDeps(null);
    expect(await handleConnectEvent(completed(), mkApptDeps(), o)).toBe('order:ignored:no-order');
    expect(console.error).toHaveBeenCalled();
  });
});

describe('expired', () => {
  it('expireOrderHold compare-and-set; nothing sent', async () => {
    const o = mkOrderDeps();
    expect(await handleConnectEvent(expired(), mkApptDeps(), o)).toBe('order:cancelled:expired');
    expect(o.expireOrderHold).toHaveBeenCalledWith(ORDER_ID, NOW_ISO);
    expect(o.state.row).toMatchObject({ status: 'cancelled', payment_status: 'none' });
    expect(o.notify).not.toHaveBeenCalled();
  });

  it('a no-op when already paid', async () => {
    const o = mkOrderDeps({ ...baseOrder, status: 'paid', payment_status: 'paid', stripe_payment_intent_id: 'pi_o1', amount_paid_cents: 4500, paid_at: 'T' });
    expect(await handleConnectEvent(expired(), mkApptDeps(), o)).toBe('order:noop:not-held');
    expect(o.state.row?.status).toBe('paid');
  });

  it('any other checkout.session.* subtype on a store session is ignored (never expires the hold)', async () => {
    const o = mkOrderDeps();
    expect(await handleConnectEvent(storeEvent('checkout.session.something_new', { payment_status: 'unpaid' }), mkApptDeps(), o)).toBe('order:ignored:event');
    expect(o.expireOrderHold).not.toHaveBeenCalled();
    expect(o.markOrderPaid).not.toHaveBeenCalled();
    expect(o.state.row?.status).toBe('new');
  });

  it('async_payment_failed takes the same path', async () => {
    const o = mkOrderDeps();
    expect(await handleConnectEvent(storeEvent('checkout.session.async_payment_failed', { payment_status: 'unpaid' }), mkApptDeps(), o)).toBe('order:cancelled:expired');
  });
});

describe('charge.refunded', () => {
  it('an order PI → setOrderRefunded(amount_refunded); a lower total arriving late never lowers it', async () => {
    const a = mkApptDeps(null);
    const o = mkOrderDeps({ ...baseOrder, status: 'paid', payment_status: 'paid', stripe_payment_intent_id: 'pi_o1', amount_paid_cents: 4500, paid_at: 'T' });
    expect(await handleConnectEvent(refunded('pi_o1', 1000, 'r1'), a, o)).toBe('order:refund:recorded');
    expect(a.appointmentByPaymentIntent).toHaveBeenCalledWith('pi_o1'); // appointment first, then order
    expect(o.setOrderRefunded).toHaveBeenCalledWith(ORDER_ID, 1000, 'partially_refunded');
    expect(await handleConnectEvent(refunded('pi_o1', 4500, 'r2'), a, o)).toBe('order:refund:recorded:cancelled');
    expect(o.setOrderRefunded).toHaveBeenLastCalledWith(ORDER_ID, 4500, 'refunded');
    expect(await handleConnectEvent(refunded('pi_o1', 1000, 'r3'), a, o)).toBe('order:refund:recorded'); // late, out of order
    expect(o.state.row).toMatchObject({ amount_refunded_cents: 4500, payment_status: 'refunded', status: 'cancelled' });
    expect(o.cancelRefundedOrder).toHaveBeenCalledTimes(1);
  });

  const paidRow = { ...baseOrder, status: 'paid' as const, payment_status: 'paid', stripe_payment_intent_id: 'pi_o1', amount_paid_cents: 4500, paid_at: 'T' };

  it('owner refund timed out but Stripe refunded in full: the webhook finalizes (cancel CAS) and emails once, after the record', async () => {
    const a = mkApptDeps(null);
    const o = mkOrderDeps({ ...paidRow }); // S3a claimed refund_due = 4500, the call timed out: amount_refunded still 0
    expect(await handleConnectEvent(refunded('pi_o1', 4500, 'r_full'), a, o)).toBe('order:refund:recorded:cancelled');
    expect(o.setOrderRefunded).toHaveBeenCalledWith(ORDER_ID, 4500, 'refunded');
    expect(o.cancelRefundedOrder).toHaveBeenCalledWith(ORDER_ID, 'paid', NOW_ISO);
    expect(o.state.row).toMatchObject({ status: 'cancelled', cancelled_at: NOW_ISO, amount_refunded_cents: 4500, payment_status: 'refunded' });
    expect(o.notify).toHaveBeenCalledTimes(1);
    expect(o.notify).toHaveBeenCalledWith({ kind: 'order_cancelled', orderId: ORDER_ID, refundedCents: 4500 });
    expect(o.notify.mock.invocationCallOrder[0]).toBeGreaterThan(a.recordEvent.mock.invocationCallOrder[0]);
    // redelivery / a second event for the same refund: the row is cancelled → no CAS, no email
    expect(await handleConnectEvent(refunded('pi_o1', 4500, 'r_full2'), a, o)).toBe('order:refund:recorded');
    expect(o.cancelRefundedOrder).toHaveBeenCalledTimes(1);
    expect(o.notify).toHaveBeenCalledTimes(1);
  });

  it('the same on a new order', async () => {
    const o = mkOrderDeps({ ...paidRow, status: 'new' });
    expect(await handleConnectEvent(refunded('pi_o1', 4500, 'r_new'), mkApptDeps(null), o)).toBe('order:refund:recorded:cancelled');
    expect(o.cancelRefundedOrder).toHaveBeenCalledWith(ORDER_ID, 'new', NOW_ISO);
    expect(o.notify).toHaveBeenCalledTimes(1);
  });

  it('the in-request path already cancelled the order: no CAS, no email', async () => {
    const o = mkOrderDeps({ ...paidRow, status: 'cancelled', amount_refunded_cents: 4500, payment_status: 'refunded', cancelled_at: 'T_C' });
    expect(await handleConnectEvent(refunded('pi_o1', 4500, 'r_late'), mkApptDeps(null), o)).toBe('order:refund:recorded');
    expect(o.cancelRefundedOrder).not.toHaveBeenCalled();
    expect(o.notify).not.toHaveBeenCalled();
  });

  it('the CAS misses (the in-request path won the race): no email', async () => {
    const o = mkOrderDeps({ ...paidRow }, { cancelRefundedOrder: vi.fn(async () => false) });
    expect(await handleConnectEvent(refunded('pi_o1', 4500, 'r_race'), mkApptDeps(null), o)).toBe('order:refund:recorded');
    expect(o.notify).not.toHaveBeenCalled();
  });

  it('a partial refund never cancels', async () => {
    const o = mkOrderDeps({ ...paidRow });
    expect(await handleConnectEvent(refunded('pi_o1', 4400, 'r_part'), mkApptDeps(null), o)).toBe('order:refund:recorded');
    expect(o.cancelRefundedOrder).not.toHaveBeenCalled();
    expect(o.notify).not.toHaveBeenCalled();
  });

  it('a full refund on a ready or shipped order keeps its status', async () => {
    for (const status of ['ready', 'shipped', 'done'] as const) {
      const o = mkOrderDeps({ ...paidRow, status });
      expect(await handleConnectEvent(refunded('pi_o1', 4500, `r_${status}`), mkApptDeps(null), o)).toBe('order:refund:recorded');
      expect(o.cancelRefundedOrder).not.toHaveBeenCalled();
      expect(o.state.row?.status).toBe(status);
      expect(o.notify).not.toHaveBeenCalled();
    }
  });

  it('a cancel CAS failure throws: the event is not recorded and the retry finishes it', async () => {
    const a = mkApptDeps(null);
    const o = mkOrderDeps({ ...paidRow });
    o.cancelRefundedOrder.mockRejectedValueOnce(new Error('db down'));
    await expect(handleConnectEvent(refunded('pi_o1', 4500, 'r_fail'), a, o)).rejects.toThrow('db down');
    expect(a.recordEvent).not.toHaveBeenCalled();
    expect(await handleConnectEvent(refunded('pi_o1', 4500, 'r_fail'), a, o)).toBe('order:refund:recorded:cancelled');
    expect(o.notify).toHaveBeenCalledTimes(1);
  });

  it('an appointment PI goes to the appointment path, unchanged', async () => {
    const a = mkApptDeps({ ...baseAppt, stripe_payment_intent_id: 'pi_a1', amount_paid_cents: 3000, payment_status: 'paid', paid_at: 'T' });
    const o = mkOrderDeps();
    expect(await handleConnectEvent(refunded('pi_a1', 3000, 'r4'), a, o)).toBe('refund:recorded');
    expect(a.setRefunded).toHaveBeenCalledWith(APPT_ID, 3000, 'refunded');
    expect(o.orderByPaymentIntent).not.toHaveBeenCalled();
  });
});

describe('failures', () => {
  it('a handler throw means the event is not recorded; the retry finishes the work', async () => {
    const a = mkApptDeps();
    const o = mkOrderDeps();
    o.markOrderPaid.mockRejectedValueOnce(new Error('db down'));
    await expect(handleConnectEvent(completed(), a, o)).rejects.toThrow('db down');
    expect(a.recordEvent).not.toHaveBeenCalled();
    expect(o.notify).not.toHaveBeenCalled();
    expect(await handleConnectEvent(completed(), a, o)).toBe('order:paid');
  });

  it('a refund failure throws and is not recorded', async () => {
    const a = mkApptDeps();
    const o = mkOrderDeps({ ...baseOrder, status: 'cancelled' }, { refund: vi.fn(async () => { throw new StripeApiError('stripe 500', 500); }) });
    await expect(handleConnectEvent(completed(), a, o)).rejects.toThrow('stripe 500');
    expect(a.recordEvent).not.toHaveBeenCalled();
  });

  it('a notify failure (async or sync) never fails the event', async () => {
    const o1 = mkOrderDeps(baseOrder, { notify: vi.fn(async () => { throw new Error('smtp'); }) });
    expect(await handleConnectEvent(completed(), mkApptDeps(), o1)).toBe('order:paid');
    const o2 = mkOrderDeps(baseOrder, { notify: vi.fn(() => { throw new Error('sync'); }) as any });
    expect(await handleConnectEvent(completed(), mkApptDeps(), o2)).toBe('order:paid');
  });
});

describe('liveOrderWebhookDeps (query shape)', () => {
  function recorder(result: any = { data: [], error: null }) {
    const calls: Array<[string, any[]]> = [];
    const chain: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') return (res: any) => res(result);
        return (...args: any[]) => { calls.push([prop, args]); return chain; };
      },
    });
    return { db: { from: (t: string) => { calls.push(['from', [t]]); return chain; } } as any, calls };
  }
  const update = (calls: Array<[string, any[]]>) => calls.find((c) => c[0] === 'update')?.[1][0];

  it("markOrderPaid: literal guards status = 'new' and no PI; sets paid_at, status/payment paid, card, the address only when given", async () => {
    const { db, calls } = recorder();
    const d = liveOrderWebhookDeps(db);
    await d.markOrderPaid('o', { amountPaidCents: 4500, paymentIntentId: 'pi', paidAt: NOW_ISO });
    expect(calls).toContainEqual(['from', ['ab_orders']]);
    expect(calls).toContainEqual(['eq', ['id', 'o']]);
    expect(calls).toContainEqual(['eq', ['status', 'new']]);
    expect(calls).toContainEqual(['is', ['stripe_payment_intent_id', null]]);
    expect(update(calls)).toEqual({
      status: 'paid', payment_status: 'paid', payment_method: 'card', amount_paid_cents: 4500, stripe_payment_intent_id: 'pi', paid_at: NOW_ISO,
    });
    calls.length = 0;
    const addr = { name: 'S', line1: 'l1', line2: null, city: 'c', state: 'TX', postal_code: '78701', country: 'US' };
    await d.markOrderPaid('o', { amountPaidCents: 1, paymentIntentId: 'pi', paidAt: NOW_ISO, shippingAddress: addr });
    expect(update(calls)).toMatchObject({ shipping_address: addr });
  });

  it("recordOrderPaidAfterCancel: cancelled, paid_at null, no PI; never sets paid_at", async () => {
    const { db, calls } = recorder();
    await liveOrderWebhookDeps(db).recordOrderPaidAfterCancel('o', { amountPaidCents: 1, paymentIntentId: 'pi' });
    expect(update(calls)).not.toHaveProperty('paid_at');
    expect(update(calls)).toMatchObject({ amount_paid_cents: 1, stripe_payment_intent_id: 'pi' });
    expect(calls).toContainEqual(['eq', ['status', 'cancelled']]);
    expect(calls).toContainEqual(['is', ['paid_at', null]]);
    expect(calls).toContainEqual(['is', ['stripe_payment_intent_id', null]]);
  });

  it('expireOrderHold: the compare-and-set on new + card + awaiting + nothing paid', async () => {
    const { db, calls } = recorder();
    await liveOrderWebhookDeps(db).expireOrderHold('o', NOW_ISO);
    expect(calls).toContainEqual(['eq', ['status', 'new']]);
    expect(calls).toContainEqual(['eq', ['payment_method', 'card']]);
    expect(calls).toContainEqual(['eq', ['payment_status', 'awaiting']]);
    expect(calls).toContainEqual(['eq', ['amount_paid_cents', 0]]);
    expect(update(calls)).toEqual({ status: 'cancelled', cancelled_by: 'customer', cancelled_at: NOW_ISO, payment_status: 'none' });
  });

  it("cancelRefundedOrder: one CAS on id + the status read; cancelled by 'shop' with cancelled_at", async () => {
    const { db, calls } = recorder({ data: [{ id: 'o' }], error: null });
    expect(await liveOrderWebhookDeps(db).cancelRefundedOrder('o', 'paid', NOW_ISO)).toBe(true);
    expect(calls).toContainEqual(['from', ['ab_orders']]);
    expect(calls).toContainEqual(['eq', ['id', 'o']]);
    expect(calls).toContainEqual(['eq', ['status', 'paid']]);
    expect(update(calls)).toEqual({ status: 'cancelled', cancelled_by: 'shop', cancelled_at: NOW_ISO });
    const miss = recorder({ data: [], error: null });
    expect(await liveOrderWebhookDeps(miss.db).cancelRefundedOrder('o', 'new', NOW_ISO)).toBe(false);
  });

  it('setOrderRefunded: absolute value under the monotonic lte guard', async () => {
    const { db, calls } = recorder();
    await liveOrderWebhookDeps(db).setOrderRefunded('o', 1000, 'partially_refunded');
    expect(calls).toContainEqual(['lte', ['amount_refunded_cents', 1000]]);
    expect(update(calls)).toEqual({ amount_refunded_cents: 1000, payment_status: 'partially_refunded' });
  });

  it('lookups by session, id and PI on ab_orders', async () => {
    const { db, calls } = recorder({ data: null, error: null });
    const d = liveOrderWebhookDeps(db);
    await d.orderBySession('cs');
    await d.orderById('id');
    await d.orderByPaymentIntent('pi');
    expect(calls).toContainEqual(['eq', ['stripe_checkout_session_id', 'cs']]);
    expect(calls).toContainEqual(['eq', ['id', 'id']]);
    expect(calls).toContainEqual(['eq', ['stripe_payment_intent_id', 'pi']]);
  });

  it('a db error throws (so the event is retried)', async () => {
    const { db } = recorder({ data: null, error: { message: 'boom' } });
    await expect(liveOrderWebhookDeps(db).markOrderPaid('o', { amountPaidCents: 1, paymentIntentId: 'pi', paidAt: NOW_ISO })).rejects.toThrow('boom');
  });
});

describe('api/stripe/connect-webhook with order deps', () => {
  function rawReq(body: string, headers: Record<string, string>) {
    const req: any = new EventEmitter();
    req.method = 'POST';
    req.headers = headers;
    setTimeout(() => { req.emit('data', Buffer.from(body)); req.emit('end'); }, 0);
    return req;
  }
  const sign = (body: string, secret: string, t = Math.floor(Date.now() / 1000)) =>
    `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('passes the order deps through to handleConnectEvent', async () => {
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect';
    const body = JSON.stringify(completed());
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const a = mkApptDeps();
    const o = mkOrderDeps();
    await handleWebhook(rawReq(body, { 'stripe-signature': sign(body, 'whsec_connect') }), res, () => a, () => o);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true, outcome: 'order:paid' });
    expect(o.markOrderPaid).toHaveBeenCalled();
  });
});
