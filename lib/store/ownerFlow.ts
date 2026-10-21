// Owner order API (Authorization: Bearer <Supabase access token>):
// POST /api/shop/orders/:id/mark and POST /api/shop/orders/:id/refund.
// The caller is verified server-side and the shop is always the one they own. Owner actions are
// never gated by the store: a barber can always fulfil, mark paid or refund orders already placed.
// Owners can't write ab_orders directly (009), so status and money move only here, in the public
// flows, the sweeps and the Stripe webhook.
import { requireOwner } from '../bookings/auth.js';
import { err, invalid, isObj, isUuid, iso, notFound, ok, text, type FlowResult } from '../bookings/core.js';
import type { PaymentStatus } from '../bookings/repo.js';
import { isUnpaidCardHold, ownerOrderView, refundOrderOwed, safeNotify, type StoreOwnerDeps } from './core.js';
import type { OrderGuard, OrderPatch } from './repo.js';
import type { OrderRow, OrderStatus, ShopStoreRow, StoreNotifyEvent } from './types.js';

type Auth = string | string[] | undefined;

async function owner(auth: Auth, deps: StoreOwnerDeps): Promise<{ shop: ShopStoreRow } | FlowResult> {
  const o = await requireOwner(auth, deps.getUser, deps.repo);
  if (o.ok === false) return { status: o.status, body: o.body };
  return { shop: o.shop as ShopStoreRow }; // deps.repo is the store repo: the row has the store columns
}

/** The shop's order, else null. An unpaid card hold doesn't exist for the owner (404). */
async function ownedOrder(deps: StoreOwnerDeps, shop: ShopStoreRow, id: unknown): Promise<OrderRow | null> {
  if (!isUuid(id)) return null;
  const o = await deps.repo.orderById(id);
  if (!o || o.shop_id !== shop.id || isUnpaidCardHold(o)) return null;
  return o;
}

async function view(deps: StoreOwnerDeps, row: OrderRow) {
  return ownerOrderView(row, await deps.repo.orderItems(row.id));
}

const refundPending = (o: OrderRow) => o.refund_due_cents > o.amount_refunded_cents && o.refund_stuck_at == null;

// ---------------------------------------------------------------------------
// POST /api/shop/orders/:id/mark  { action, trackingNumber?, trackingUrl? }
// ---------------------------------------------------------------------------
type Action = 'paid' | 'ready' | 'shipped' | 'done' | 'cancel';
const ACTIONS: Action[] = ['paid', 'ready', 'shipped', 'done', 'cancel'];
const UNPAID: PaymentStatus[] = ['none', 'awaiting'];
const FULFIL_FROM: OrderStatus[] = ['new', 'paid'];
const DONE_FROM: OrderStatus[] = ['new', 'paid', 'ready', 'shipped'];

export async function markOwnerOrder(auth: Auth, id: unknown, body: unknown, deps: StoreOwnerDeps): Promise<FlowResult> {
  const own = await owner(auth, deps);
  if ('status' in own) return own;
  const { shop } = own;
  if (!isObj(body)) return invalid('body');
  const action = body.action as Action;
  if (!ACTIONS.includes(action)) return invalid('action');
  const trackingNumber = text(body.trackingNumber, 64, true);
  if (trackingNumber === undefined || (trackingNumber !== null && action !== 'shipped')) return invalid('trackingNumber');
  const trackingUrl = text(body.trackingUrl, 500, true);
  if (trackingUrl === undefined || (trackingUrl !== null && (action !== 'shipped' || !/^https:\/\/\S+$/i.test(trackingUrl)))) {
    return invalid('trackingUrl');
  }

  const o = await ownedOrder(deps, shop, id);
  if (!o) return notFound();
  const nowIso = iso(deps.now());
  const reply = async (row: OrderRow) => ok({ order: await view(deps, row) });

  /**
   * Compare-and-set on the state read. A miss re-reads: if the row is now in the state this
   * action produces (a concurrent identical tap), 200 unchanged; otherwise 409 not-markable.
   */
  const apply = async (patch: OrderPatch, guard: OrderGuard, reached: (r: OrderRow) => boolean, event?: StoreNotifyEvent) => {
    const upd = await deps.repo.updateOrder(o.id, patch, guard);
    if (upd.ok) {
      if (event) await safeNotify(deps, event);
      return reply(upd.row);
    }
    const cur = await deps.repo.orderById(o.id);
    return cur && cur.shop_id === shop.id && reached(cur) ? reply(cur) : err(409, 'not-markable');
  };

  switch (action) {
    case 'paid': {
      if (o.payment_method === 'card') return err(409, 'card-payment');
      if (o.payment_status === 'paid') return reply(o); // a repeated tap changes nothing
      if (o.status === 'cancelled' || !UNPAID.includes(o.payment_status)) return err(409, 'not-markable');
      const upd = await deps.repo.updateOrder(
        o.id,
        { payment_status: 'paid', amount_paid_cents: o.total_cents, ...(o.status === 'new' ? { status: 'paid' as const } : {}) },
        { notCard: true, paymentStatusIn: UNPAID, status: o.status, paidCents: o.amount_paid_cents },
      );
      if (upd.ok) return reply(upd.row);
      const cur = await deps.repo.orderById(o.id);
      if (cur?.payment_method === 'card') return err(409, 'card-payment');
      return cur && cur.payment_status === 'paid' ? reply(cur) : err(409, 'not-markable');
    }
    case 'ready': {
      if (o.fulfilment !== 'pickup') return err(409, 'wrong-fulfilment');
      if (o.status === 'ready') return reply(o);
      if (!FULFIL_FROM.includes(o.status)) return err(409, 'not-markable');
      return apply({ status: 'ready', ready_at: nowIso }, { status: o.status }, (r) => r.status === 'ready', { kind: 'order_ready', orderId: o.id });
    }
    case 'shipped': {
      if (o.fulfilment !== 'shipping') return err(409, 'wrong-fulfilment');
      if (o.status === 'shipped') return reply(o);
      if (!FULFIL_FROM.includes(o.status)) return err(409, 'not-markable');
      return apply(
        { status: 'shipped', shipped_at: nowIso, tracking_number: trackingNumber, tracking_url: trackingUrl },
        { status: o.status },
        (r) => r.status === 'shipped',
        { kind: 'order_shipped', orderId: o.id },
      );
    }
    case 'done': {
      if (o.status === 'done') return reply(o);
      if (!DONE_FROM.includes(o.status)) return err(409, 'not-markable');
      return apply({ status: 'done', done_at: nowIso }, { status: o.status }, (r) => r.status === 'done');
    }
    case 'cancel': {
      if (o.status === 'cancelled') return reply(o);
      if (!FULFIL_FROM.includes(o.status)) return err(409, 'not-markable');
      // Card: nothing may be held; a paid card order is refunded first (which cancels it at zero).
      // Manual rails and in-shop (controller ruling 2026-10-21): the owner may cancel even after
      // marking it paid. No money moves here (the barber refunds the customer themselves), so an
      // unpaid order goes to payment 'none' and a paid one keeps its payment record.
      const isCard = o.payment_method === 'card';
      if (isCard && o.amount_paid_cents - o.amount_refunded_cents !== 0) return err(409, 'has-payment');
      const unpaid = UNPAID.includes(o.payment_status);
      return apply(
        {
          status: 'cancelled', cancelled_by: 'shop', cancelled_at: nowIso,
          ...(!isCard && unpaid ? { payment_status: 'none' as const } : {}),
        },
        { status: o.status, paidCents: o.amount_paid_cents, refundedEq: o.amount_refunded_cents, paymentStatusIn: [o.payment_status] },
        (r) => r.status === 'cancelled',
        { kind: 'order_cancelled', orderId: o.id },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// POST /api/shop/orders/:id/refund  { amountCents? }
// ---------------------------------------------------------------------------
export async function refundOwnerOrder(auth: Auth, id: unknown, body: unknown, deps: StoreOwnerDeps): Promise<FlowResult> {
  const own = await owner(auth, deps);
  if ('status' in own) return own;
  const { shop } = own;
  // A missing or unparseable body is never "refund everything": only an object without amountCents is.
  if (!isObj(body)) return invalid('body');
  const asked = body.amountCents;
  if (asked !== undefined && !(typeof asked === 'number' && Number.isInteger(asked) && asked >= 1)) return invalid('amountCents');

  const o = await ownedOrder(deps, shop, id);
  if (!o) return notFound();
  if (o.payment_method !== 'card') return err(409, 'not-card');

  // 1. Pre-check in TypeScript on the row just read (PostgREST can't compare two columns).
  const readDue = o.refund_due_cents;
  const readRefunded = o.amount_refunded_cents;
  const readPaid = o.amount_paid_cents;
  if (readDue > readRefunded) return err(409, 'refund-pending');
  const refundable = readPaid - readRefunded;
  if (!o.stripe_payment_intent_id || refundable <= 0) return err(409, 'nothing-to-refund');
  const amount = (asked as number | undefined) ?? refundable;
  if (amount > refundable) return invalid('amountCents');
  const target = readRefunded + amount;

  // 2. Claim: the absolute target, under literal guards on everything read.
  const claim = await deps.repo.updateOrder(
    o.id,
    { refund_due_cents: target, refund_requested_at: iso(deps.now()) },
    { paymentMethod: 'card', refundDue: readDue, refundedEq: readRefunded, paidCents: readPaid },
  );
  if (claim.ok === false) {
    const cur = await deps.repo.orderById(o.id);
    return cur && refundPending(cur) ? err(409, 'refund-pending') : err(409, 'not-markable');
  }

  // 3–5. Refund under refundKey.order(id, target); bookkeeping or "owed" on failure.
  const r = await refundOrderOwed(deps, shop, claim.row, amount, true);
  return ok({ order: await view(deps, r.row), refundedCents: r.refunded, pending: refundPending(r.row) });
}
