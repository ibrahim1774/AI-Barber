import type { SupabaseClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';
import { refundKey, serviceDb, StripeApiError, type PayShop, type StripeEvent } from '../bookings/payments.js';
import { refundOrder, orderShippingFromSession, STORE_APP, type PayOrder, type OrderAddress } from './payments.js';
import type { StoreNotifyEvent } from './notify.js';

/**
 * The order branch of the Connect webhook (api/stripe/connect-webhook.ts → handleConnectEvent).
 * Same rules as the appointment branch: every step is idempotent on the row state, a throw means
 * the event is not recorded (Stripe retries), the event's account must equal the order's shop
 * stripe_account_id, and every refund carries a reason-scoped idempotency key.
 *
 * Handlers return null when no order matches, so the appointment branch's own "nothing matched"
 * handling stays exactly as it was.
 */

export interface WebhookOrder extends PayOrder {
  status: 'new' | 'paid' | 'ready' | 'shipped' | 'done' | 'cancelled';
  payment_status: string;
  payment_method: string | null;
  stripe_checkout_session_id: string | null;
  /** Set only by markOrderPaid, on a live (new) order. Decides who owns a refund. */
  paid_at: string | null;
  cancelled_at?: string | null;
}

export interface OrderWebhookDeps {
  orderBySession(sessionId: string): Promise<WebhookOrder | null>;
  orderById(id: string): Promise<WebhookOrder | null>;
  orderByPaymentIntent(pi: string): Promise<WebhookOrder | null>;
  shop(id: string): Promise<PayShop | null>;
  /** One update with literal guards: where status = 'new' and stripe_payment_intent_id is null.
   *  Sets status/payment 'paid', method 'card', amount, PI, paid_at and (shipping) the address.
   *  True when this call made the change. */
  markOrderPaid(orderId: string, f: { amountPaidCents: number; paymentIntentId: string; paidAt: string; shippingAddress?: OrderAddress }): Promise<boolean>;
  /** A payment that landed on an already cancelled order (never sets paid_at): where status =
   *  'cancelled', paid_at null and no PI stored. */
  recordOrderPaidAfterCancel(orderId: string, f: { amountPaidCents: number; paymentIntentId: string }): Promise<boolean>;
  /** where status = 'new' and payment_method = 'card' and payment_status = 'awaiting' and
   *  amount_paid_cents = 0 → cancelled by the customer, payment_status 'none'. */
  expireOrderHold(orderId: string, nowIso: string): Promise<boolean>;
  /** Absolute and monotonic: never lowers amount_refunded_cents. */
  setOrderRefunded(orderId: string, amountRefundedCents: number, paymentStatus: 'refunded' | 'partially_refunded'): Promise<void>;
  refund(shop: PayShop, order: PayOrder, amountCents: number, idempotencyKey: string): Promise<{ refundedCents: number }>;
  /** Fire-and-forget (live: waitUntil). Must not block or fail the webhook response. */
  notify(event: StoreNotifyEvent): Promise<void>;
  now(): number;
}

export interface OrderOutcome { outcome: string; orderNotify?: StoreNotifyEvent[] }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const piOf = (v: any): string | null => (typeof v === 'string' ? v : v?.id ?? null);
const LOG = '[stripe/connect-webhook:order]';

/** A Checkout Session created for a store order (metadata set by createOrderCheckout). */
export function isStoreSession(obj: any): boolean {
  return obj?.metadata?.app === STORE_APP;
}

type Found = { order: WebhookOrder; shop: PayShop; superseded: boolean };

async function withShop(order: WebhookOrder, superseded: boolean, account: string | null | undefined, deps: OrderWebhookDeps): Promise<Found | 'mismatch'> {
  const shop = await deps.shop(order.shop_id);
  // The event must come from the connected account that owns this order's shop.
  if (!shop || !shop.stripe_account_id || !account || shop.stripe_account_id !== account) {
    console.error(`${LOG} account mismatch:`, JSON.stringify({ order: order.id, account: account ?? null, shopAccount: shop?.stripe_account_id ?? null }));
    return 'mismatch';
  }
  return { order, shop, superseded };
}

/**
 * Lookup order: stripe_checkout_session_id, then metadata.order_id, then client_reference_id.
 * A row found the second or third way whose stored session id is set and different came from a
 * superseded session.
 */
async function orderForSession(obj: any, account: string | null | undefined, deps: OrderWebhookDeps): Promise<Found | 'mismatch' | null> {
  const bySession = obj?.id ? await deps.orderBySession(obj.id) : null;
  if (bySession) return withShop(bySession, false, account, deps);
  const ids = [...new Set([obj?.metadata?.order_id, obj?.client_reference_id].filter((v): v is string => typeof v === 'string' && UUID_RE.test(v)))];
  for (const id of ids) {
    const byId = await deps.orderById(id);
    if (!byId) continue;
    const superseded = byId.stripe_checkout_session_id != null && byId.stripe_checkout_session_id !== obj?.id;
    return withShop(byId, superseded, account, deps);
  }
  return null;
}

/** One refund under a reason-scoped key; Stripe's charge_already_refunded counts as done. */
async function refundOnce(deps: OrderWebhookDeps, shop: PayShop, order: PayOrder, amount: number, key: string): Promise<number> {
  try {
    return (await deps.refund(shop, order, amount, key)).refundedCents;
  } catch (e) {
    if (e instanceof StripeApiError && e.code === 'charge_already_refunded') return amount;
    throw e;
  }
}

/** checkout.session.completed / async_payment_succeeded for an order. Null: no order matches. */
export async function handleOrderSession(event: StripeEvent, obj: any, deps: OrderWebhookDeps): Promise<OrderOutcome | null> {
  if (obj?.payment_status !== 'paid') return { outcome: 'order:ignored:unpaid' };
  const amount = Math.max(0, Math.floor(Number(obj.amount_total) || 0));
  const pi = piOf(obj.payment_intent);
  const found = await orderForSession(obj, event.account, deps);
  if (!found) return null;
  if (found === 'mismatch') return { outcome: 'order:ignored:account-mismatch' };
  if (!pi) {
    console.error(`${LOG} paid session without a payment intent:`, JSON.stringify({ session: obj.id, order: found.order.id }));
    return { outcome: 'order:ignored:no-payment-intent' };
  }
  const { order: before, shop } = found;
  const dupRefund = async (row: WebhookOrder, why: string) => {
    console.error(`${LOG} ${why}, refunding it:`, JSON.stringify({ order: row.id, session: obj.id, stored: row.stripe_payment_intent_id, extra: pi, amount }));
    await refundOnce(deps, shop, { ...row, stripe_payment_intent_id: pi, amount_paid_cents: amount, amount_refunded_cents: 0 }, amount, refundKey.duplicate(pi));
    return { outcome: 'order:refunded:duplicate-payment' };
  };

  // A payment on a session the order no longer points at: give it back, never record it.
  if (found.superseded && before.stripe_payment_intent_id !== pi) return dupRefund(before, 'payment on a superseded session');

  // 1. The normal case: a live hold. Owners can't touch holds, so it is always still 'new'.
  let order = before;
  if (before.status === 'new' && !before.stripe_payment_intent_id) {
    const f: Parameters<OrderWebhookDeps['markOrderPaid']>[1] = {
      amountPaidCents: amount, paymentIntentId: pi, paidAt: new Date(deps.now()).toISOString(),
    };
    if (before.fulfilment === 'shipping') {
      const addr = orderShippingFromSession(obj);
      if (addr) f.shippingAddress = addr;
    }
    if (await deps.markOrderPaid(before.id, f)) {
      return { outcome: 'order:paid', orderNotify: [{ kind: 'order_created', orderId: before.id }] };
    }
    // 2. Not recorded by this call: decide on the CURRENT row.
    order = (await deps.orderById(before.id)) ?? before;
  }

  if (order.stripe_payment_intent_id && order.stripe_payment_intent_id !== pi) return dupRefund(order, 'second payment for one order');

  if (order.paid_at) {
    // Recorded on an earlier delivery. If cancelled since, the owner refund path owns the money.
    if (order.status === 'cancelled') return { outcome: 'order:noop:cancel-owns-refund' };
    // Redelivery of an event that was not recorded: the confirmation was not sent either.
    return { outcome: 'order:noop:already-recorded', orderNotify: [{ kind: 'order_created', orderId: order.id }] };
  }

  if (order.status === 'cancelled') {
    // "Cancelled, then paid" (an expired or abandoned hold): record it without paid_at and make
    // sure the full refund exists. One reason-scoped key per payment, safe on every redelivery.
    if (!order.stripe_payment_intent_id) {
      await deps.recordOrderPaidAfterCancel(order.id, { amountPaidCents: amount, paymentIntentId: pi });
      order = { ...order, stripe_payment_intent_id: pi, amount_paid_cents: amount };
    }
    const paid = Math.floor(order.amount_paid_cents ?? amount) || amount;
    const already = Math.max(0, Math.floor(order.amount_refunded_cents ?? 0));
    if (already >= paid) return { outcome: 'order:noop:already-refunded' };
    console.error(`${LOG} payment on a cancelled order, refunding in full:`, JSON.stringify({ order: order.id, paymentIntent: pi, amount: paid - already }));
    const refunded = await refundOnce(deps, shop, { ...order, stripe_payment_intent_id: pi, amount_paid_cents: paid, amount_refunded_cents: already }, paid - already, refundKey.pac(pi));
    const total = already + refunded;
    await deps.setOrderRefunded(order.id, total, total >= paid ? 'refunded' : 'partially_refunded');
    return { outcome: 'order:refunded:cancelled-before-payment' };
  }

  console.error(`${LOG} could not record payment:`, JSON.stringify({ order: order.id, status: order.status, paymentIntent: pi, stored: order.stripe_payment_intent_id ?? null }));
  return { outcome: 'order:noop:unrecordable' };
}

/** checkout.session.expired / async_payment_failed for an order. Null: no order matches. */
export async function handleOrderExpired(event: StripeEvent, obj: any, deps: OrderWebhookDeps): Promise<OrderOutcome | null> {
  const found = await orderForSession(obj, event.account, deps);
  if (!found) return null;
  if (found === 'mismatch') return { outcome: 'order:ignored:account-mismatch' };
  // The order points at a newer session: this one's expiry says nothing about it.
  if (found.superseded) return { outcome: 'order:noop:superseded-session' };
  const changed = await deps.expireOrderHold(found.order.id, new Date(deps.now()).toISOString());
  return { outcome: changed ? 'order:cancelled:expired' : 'order:noop:not-held' };
}

/** charge.refunded for an order. Null when no order has that payment intent. */
export async function handleOrderRefunded(event: StripeEvent, obj: any, deps: OrderWebhookDeps): Promise<OrderOutcome | null> {
  const pi = piOf(obj?.payment_intent);
  if (!pi) return null;
  const order = await deps.orderByPaymentIntent(pi);
  if (!order) return null;
  const found = await withShop(order, false, event.account, deps);
  if (found === 'mismatch') return { outcome: 'order:ignored:account-mismatch' };
  // Stripe's cumulative total, never an increment: idempotent with the owner refund's own write.
  const refunded = Math.max(0, Math.floor(Number(obj.amount_refunded) || 0));
  const paid = Math.max(0, Math.floor(order.amount_paid_cents ?? 0)) || Math.floor(Number(obj.amount_captured) || 0);
  await deps.setOrderRefunded(order.id, refunded, refunded >= paid ? 'refunded' : 'partially_refunded');
  return { outcome: 'order:refund:recorded' };
}

/** A checkout.session.* event tagged app=aibarber-store: the order branch only. */
export async function handleStoreSessionEvent(event: StripeEvent, obj: any, deps: OrderWebhookDeps): Promise<OrderOutcome> {
  const paidEvent = event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded';
  const r = paidEvent ? await handleOrderSession(event, obj, deps) : await handleOrderExpired(event, obj, deps);
  if (r) return r;
  if (paidEvent) {
    // Real money with nothing to attach it to (row deleted, ids never stored).
    console.error(`${LOG} paid session without a matching order:`, JSON.stringify({
      session: obj?.id, paymentIntent: piOf(obj?.payment_intent), account: event.account ?? null,
      amountTotal: obj?.amount_total ?? null, orderId: obj?.metadata?.order_id ?? null,
    }));
  }
  return { outcome: 'order:ignored:no-order' };
}

// ---------------------------------------------------------------------------
// Live (Supabase service role) dependencies
// ---------------------------------------------------------------------------

function dbFail(op: string, error: { message?: string } | null): never {
  throw new Error(`store/webhook ${op} failed: ${error?.message ?? 'unknown'}`);
}

const ORDER_COLS = 'id, shop_id, order_no, manage_token, customer_email, fulfilment, shipping_cents, total_cents, status, payment_status, payment_method, amount_paid_cents, amount_refunded_cents, stripe_payment_intent_id, stripe_checkout_session_id, paid_at, cancelled_at';

export function liveOrderWebhookDeps(db: SupabaseClient = serviceDb()): OrderWebhookDeps {
  const one = async (op: string, col: string, value: string) => {
    const { data, error } = await db.from('ab_orders').select(ORDER_COLS).eq(col, value).maybeSingle();
    if (error) dbFail(op, error);
    return (data as unknown as WebhookOrder) ?? null;
  };
  const changed = (data: unknown) => Array.isArray(data) && data.length > 0;
  return {
    orderBySession: (sid) => one('orderBySession', 'stripe_checkout_session_id', sid),
    orderById: (id) => one('orderById', 'id', id),
    orderByPaymentIntent: (pi) => one('orderByPaymentIntent', 'stripe_payment_intent_id', pi),
    async shop(id) {
      const { data, error } = await db.from('ab_shops').select('id, slug, name, currency, stripe_account_id, platform_fee_bps').eq('id', id).maybeSingle();
      if (error) dbFail('shop', error);
      return (data as PayShop) ?? null;
    },
    async markOrderPaid(orderId, f) {
      const { data, error } = await db.from('ab_orders').update({
        status: 'paid',
        payment_status: 'paid',
        payment_method: 'card',
        amount_paid_cents: f.amountPaidCents,
        stripe_payment_intent_id: f.paymentIntentId,
        paid_at: f.paidAt,
        ...(f.shippingAddress ? { shipping_address: f.shippingAddress } : {}),
      }).eq('id', orderId).eq('status', 'new').is('stripe_payment_intent_id', null).select('id');
      if (error) dbFail('markOrderPaid', error);
      return changed(data);
    },
    async recordOrderPaidAfterCancel(orderId, f) {
      const { data, error } = await db.from('ab_orders').update({
        payment_method: 'card',
        amount_paid_cents: f.amountPaidCents,
        stripe_payment_intent_id: f.paymentIntentId,
      }).eq('id', orderId).eq('status', 'cancelled').is('paid_at', null).is('stripe_payment_intent_id', null).select('id');
      if (error) dbFail('recordOrderPaidAfterCancel', error);
      return changed(data);
    },
    async expireOrderHold(orderId, nowIso) {
      const { data, error } = await db.from('ab_orders').update({
        status: 'cancelled', cancelled_by: 'customer', cancelled_at: nowIso, payment_status: 'none',
      }).eq('id', orderId).eq('status', 'new').eq('payment_method', 'card').eq('payment_status', 'awaiting')
        .eq('amount_paid_cents', 0).select('id');
      if (error) dbFail('expireOrderHold', error);
      return changed(data);
    },
    async setOrderRefunded(orderId, amountRefundedCents, paymentStatus) {
      const { error } = await db.from('ab_orders').update({
        amount_refunded_cents: amountRefundedCents, payment_status: paymentStatus,
      }).eq('id', orderId).lte('amount_refunded_cents', amountRefundedCents);
      if (error) dbFail('setOrderRefunded', error);
    },
    refund: (shop, order, amount, idempotencyKey) => refundOrder(shop, order, amount, { idempotencyKey }),
    // After the response, kept alive by waitUntil. Dynamic import, as the booking notify does.
    notify: async (e) => { waitUntil(import('./notify.js').then((m) => m.notifyOrder(e))); },
    now: () => Date.now(),
  };
}
