// The store's money paths wired end to end: the store fake repo (tests/store/fakeRepo.ts) with the
// LIVE payments (lib/store/payments.ts → stripeRequest → fake Stripe through the stubbed fetch),
// and the REAL Connect webhook handler (api/stripe/connect-webhook.ts handleWebhook, real HMAC
// signature check) over an OrderWebhookDeps adapter that applies the live deps' compare-and-set
// guards to the same rows. Appointment events share one processed-event log.
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { vi } from 'vitest';
import { handleWebhook } from '../../../api/stripe/connect-webhook.js';
import type { WebhookDeps } from '../../../lib/bookings/payments.js';
import { liveStorePayments } from '../../../lib/store/deps.js';
import { refundOrder } from '../../../lib/store/payments.js';
import { paymentRefundedCents } from '../../../lib/bookings/payments.js';
import type { OrderWebhookDeps, WebhookOrder } from '../../../lib/store/webhook.js';
import type { OrderRow, StoreNotifyEvent } from '../../../lib/store/types.js';
import { storeWorld, type StoreWorld } from '../../store/fakeRepo.js';

export const WEBHOOK_SECRET = 'whsec_e2e_fake';

export function sign(body: string, secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

export function webhookReq(body: string, sig: string | undefined) {
  const r: any = Readable.from([Buffer.from(body, 'utf8')]);
  r.method = 'POST';
  r.headers = sig === undefined ? {} : { 'stripe-signature': sig };
  return r;
}

export function moneyWorld(over: Parameters<typeof storeWorld>[0] = {}) {
  vi.stubEnv('STRIPE_CONNECT_WEBHOOK_SECRET', WEBHOOK_SECRET);
  const w = storeWorld(over);
  w.deps.payments = liveStorePayments;
  // Let an in-flight first submit make progress while a resubmit polls (setTimeout 0 per poll).
  w.deps.sleep = () => new Promise((r) => setTimeout(r, 0));
  // What the customer / barber actually receive: lib/store/notify.ts skips order_created for a card
  // hold still awaiting payment and for a cancelled order (it re-reads the order when sending).
  const notes: StoreNotifyEvent[] = [];
  const rawNotes: StoreNotifyEvent[] = [];
  const send = (e: StoreNotifyEvent) => {
    rawNotes.push(e);
    const o = w.state.orders.find((x) => x.id === e.orderId);
    if (e.kind === 'order_created' && o && ((o.payment_method === 'card' && o.payment_status === 'awaiting') || o.status === 'cancelled')) return;
    notes.push(e);
  };
  w.deps.notify = vi.fn(async (e: StoreNotifyEvent) => { send(e); });
  const processed = new Set<string>();
  const claims = new Set<string>();
  const outcomes: string[] = [];

  const nowIso = () => new Date(w.deps.now()).toISOString();
  const find = (pred: (o: OrderRow) => boolean) => {
    const o = w.state.orders.find(pred);
    return o ? (JSON.parse(JSON.stringify(o)) as WebhookOrder) : null;
  };
  const write = (id: string, patch: Partial<OrderRow>) => {
    const o = w.order(id);
    Object.assign(o, patch, { updated_at: nowIso() });
    o.refund_pending = o.refund_due_cents > o.amount_refunded_cents && o.refund_stuck_at == null;
  };

  const orderDeps: OrderWebhookDeps = {
    orderBySession: async (sid) => find((o) => o.stripe_checkout_session_id === sid),
    orderById: async (id) => find((o) => o.id === id),
    orderByPaymentIntent: async (pi) => find((o) => o.stripe_payment_intent_id === pi),
    shop: async (id) => w.state.shops.find((s) => s.id === id) ?? null,
    async markOrderPaid(id, f) {
      const o = w.order(id);
      if (!o || o.status !== 'new' || o.stripe_payment_intent_id) return false;
      write(id, {
        status: 'paid', payment_status: 'paid', payment_method: 'card', amount_paid_cents: f.amountPaidCents,
        stripe_payment_intent_id: f.paymentIntentId, paid_at: f.paidAt, ...(f.shippingAddress ? { shipping_address: f.shippingAddress as any } : {}),
      });
      return true;
    },
    async recordOrderPaidAfterCancel(id, f) {
      const o = w.order(id);
      if (!o || o.status !== 'cancelled' || o.paid_at || o.stripe_payment_intent_id) return false;
      write(id, { payment_method: 'card', amount_paid_cents: f.amountPaidCents, stripe_payment_intent_id: f.paymentIntentId });
      return true;
    },
    async expireOrderHold(id, at) {
      const o = w.order(id);
      if (!o || o.status !== 'new' || o.payment_method !== 'card' || o.payment_status !== 'awaiting' || o.amount_paid_cents !== 0) return false;
      write(id, { status: 'cancelled', cancelled_by: 'customer', cancelled_at: at, payment_status: 'none' });
      return true;
    },
    async cancelRefundedOrder(id, from, at) {
      const o = w.order(id);
      if (!o || o.status !== from) return false;
      write(id, { status: 'cancelled', cancelled_by: 'shop', cancelled_at: at });
      return true;
    },
    async setOrderRefunded(id, total, ps) {
      const o = w.order(id);
      if (o && o.amount_refunded_cents <= total) write(id, { amount_refunded_cents: total, payment_status: ps });
    },
    refund: (shop, order, amount, key) => refundOrder(shop, order, amount, { idempotencyKey: key }),
    notify: async (e) => { send(e); },
    now: () => w.deps.now(),
    // Live wiring: Stripe's refunded total on the charge (I5) and the once-only claim (M4, ab_events).
    refundedOnStripe: (shop, pi) => paymentRefundedCents(shop, pi),
    claimOnce: async (key) => { if (claims.has(key)) return false; claims.add(key); return true; },
  };

  const none = async () => null;
  const apptDeps: WebhookDeps = {
    eventProcessed: async (id) => processed.has(id),
    recordEvent: async (id) => { processed.add(id); },
    appointmentBySession: none, appointmentByPaymentIntent: none, appointmentById: none, shop: none,
    markPaid: async () => false, recordPaidAfterCancel: async () => false, expireHold: async () => false,
    setRefunded: async () => {}, setChargesEnabledForAccount: async () => {}, disconnectAccount: async () => false,
    refund: async () => ({ refundedCents: 0 }), notify: async () => {}, now: () => w.deps.now(),
  };

  /** Deliver one event through the real HTTP handler (signed). */
  async function deliver(event: Record<string, unknown>, opts: { sig?: string | null; raw?: string } = {}) {
    const body = opts.raw ?? JSON.stringify(event);
    const res: any = { statusCode: 0, body: null, status(c: number) { this.statusCode = c; return this; }, json(b: any) { this.body = b; return this; } };
    await handleWebhook(webhookReq(body, opts.sig === null ? undefined : opts.sig ?? sign(body)), res, () => apptDeps, () => orderDeps);
    if (res.body?.outcome) outcomes.push(res.body.outcome);
    return res as { statusCode: number; body: any };
  }

  let evtN = 0;
  const event = (type: string, object: unknown, over: Record<string, unknown> = {}) =>
    ({ id: `evt_${++evtN}_${type}`, type, account: 'acct_1', created: Math.floor(w.deps.now() / 1000), data: { object }, ...over });

  return { ...w, notes, rawNotes, processed, outcomes, orderDeps, apptDeps, deliver, event };
}

export type MoneyWorld = ReturnType<typeof moneyWorld>;
export type { StoreWorld };

export const CUSTOMER = { name: 'Sam Lee', phone: '5551234567', email: 'sam@example.com' };
export const ADDRESS = { name: 'Sam Lee', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701' };
