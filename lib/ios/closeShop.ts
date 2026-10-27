// Closing a shop for account deletion (App Store 5.1.1(v)). Deleting the account cascades the shop,
// its bookings and its orders away, so before ANYTHING is deleted every upcoming booking and every
// open store order is cancelled through the shop's existing cancel paths (customer email included,
// worded "the business closed its account"), and card money goes back through the existing refund
// paths. Nothing here moves money on its own.
//
//   - Cancel + notify FIRST. If any cancel fails (or a fresh refund could not be sent, or more work
//     remains than one call's cap) the result is { ok: false } and the caller deletes nothing; the
//     app retries.
//   - Idempotent: the cancel is a compare-and-set on status 'booked'/'new'/'paid', so a retry skips
//     what is already cancelled and never emails twice.
//   - A refund that failed on an earlier call is retried once on the next call; if it fails again it
//     is reported in needsRefund and the deletion goes on (a Stripe outage must not make the account
//     undeletable). Payments with no automatic refund path (manual rails: Cash App, Venmo, Zelle,
//     PayPal) are cancelled and reported in needsRefund too.
//   - Logs carry ids only, never names or emails.
import { cancelAppointment, refundOwed } from '../bookings/core.js';
import type { FlowDeps } from '../bookings/core.js';
import type { AppointmentRow } from '../bookings/repo.js';
import { serviceClient } from '../bookings/repo.js';
import { markOwnerOrder, refundOwnerOrder } from '../store/ownerFlow.js';
import { expiredHoldPatch, isUnpaidCardHold, LIVE_HOLD, refundOrderOwed, type StoreOwnerDeps } from '../store/core.js';

/** Bookings or orders handled per lane per call. The rest wait for the next (retried) call. */
export const CLOSE_CAP = 40;
/** How far back a previous attempt's cancellations are re-checked for money still owed. */
const CARRIED_WINDOW_MS = 24 * 3600_000;

export interface LaneOutcome {
  /** This call cancelled it (a repeat or an already final row is false). */
  cancelled: boolean;
  /** Money is owed to the customer and no automatic path settled it: report it. */
  needsRefund?: boolean;
  /** A fresh refund failed: stop the deletion and retry on the next call. */
  retryLater?: boolean;
}

export interface Lane {
  label: 'booking' | 'order';
  /** Ids still to cancel (at most `limit`). */
  open(limit: number): Promise<string[]>;
  /** Cancel one through the existing path. Throws when it cannot be cancelled. */
  process(id: string): Promise<LaneOutcome>;
  /** Ids cancelled by an earlier attempt that may still be owed money. */
  carried?(sinceIso: string, limit: number): Promise<string[]>;
  /** Retry the refund of a carried id once; needsRefund when it is still owed. */
  processCarried?(id: string): Promise<{ needsRefund: boolean }>;
  /** Ids this lane cannot cancel through the existing path (left as they are, reported). */
  notCancelled?(): Promise<string[]>;
}

export interface ClosureOk {
  ok: true;
  bookingsCancelled: number;
  ordersCancelled: number;
  needsRefund: string[];
  notCancelled: string[];
}
export interface ClosureFail extends Omit<ClosureOk, 'ok'> {
  ok: false;
  reason: 'cancel-failed' | 'refund-pending' | 'more-remaining' | 'lookup-failed';
}
export type ClosureResult = ClosureOk | ClosureFail;

export interface ClosureDeps {
  shopIdFor(userId: string): Promise<string | null>;
  lanes(shopId: string, userId: string): Lane[];
  now(): number;
}

export async function closeShopForDeletion(userId: string, deps: ClosureDeps, opts: { cap?: number } = {}): Promise<ClosureResult> {
  const cap = opts.cap ?? CLOSE_CAP;
  const out = { bookingsCancelled: 0, ordersCancelled: 0, needsRefund: [] as string[], notCancelled: [] as string[] };
  const flag = (kind: string, id: string) => { const k = `${kind}:${id}`; if (!out.needsRefund.includes(k)) out.needsRefund.push(k); };
  let shopId: string | null;
  try {
    shopId = await deps.shopIdFor(userId);
  } catch (e: any) {
    console.error('[ios/delete-account] shop lookup failed:', e?.message || e);
    return { ok: false, reason: 'lookup-failed', ...out };
  }
  if (!shopId) return { ok: true, ...out };

  let failure: ClosureFail['reason'] | null = null;
  const sinceIso = new Date(deps.now() - CARRIED_WINDOW_MS).toISOString();
  for (const lane of deps.lanes(shopId, userId)) {
    try {
      // 1. Money an earlier attempt left owed: retry once, else report.
      if (lane.carried && lane.processCarried) {
        for (const id of await lane.carried(sinceIso, cap)) {
          const r = await lane.processCarried(id);
          if (r.needsRefund) flag(lane.label, id);
        }
      }
      // 2. Cancel what is still open.
      const ids = await lane.open(cap + 1);
      for (const id of ids.slice(0, cap)) {
        try {
          const r = await lane.process(id);
          if (r.cancelled) lane.label === 'booking' ? out.bookingsCancelled++ : out.ordersCancelled++;
          if (r.needsRefund) flag(lane.label, id);
          if (r.retryLater) failure ??= 'refund-pending';
        } catch (e: any) {
          console.error(`[ios/delete-account] cancelling ${lane.label} ${id} failed:`, e?.message || e);
          failure = 'cancel-failed';
        }
      }
      if (ids.length > cap) failure ??= 'more-remaining';
      if (lane.notCancelled) for (const id of await lane.notCancelled()) out.notCancelled.push(`${lane.label}:${id}`);
    } catch (e: any) {
      console.error(`[ios/delete-account] closing ${lane.label} lane failed:`, e?.message || e);
      failure = 'cancel-failed';
    }
  }
  if (out.needsRefund.length) console.warn(`[ios/delete-account] needs refund: ${out.needsRefund.join(',')}`);
  if (out.notCancelled.length) console.warn(`[ios/delete-account] not cancelled: ${out.notCancelled.join(',')}`);
  return failure ? { ok: false, reason: failure, ...out } : { ok: true, ...out };
}

// ---------------------------------------------------------------------------
// Bookings lane: the shop's own cancel path (core.cancelAppointment, by 'shop')
// ---------------------------------------------------------------------------
export interface BookingQueries {
  upcomingIds(shopId: string, nowIso: string, limit: number): Promise<string[]>;
  recentCancelledIds(shopId: string, sinceIso: string, limit: number): Promise<string[]>;
}

const owedCents = (a: AppointmentRow) => Math.max(0, (a.amount_paid_cents ?? 0) - (a.amount_refunded_cents ?? 0));
const cardRefundOwed = (a: AppointmentRow) => a.payment_method === 'card' && a.refund_due_cents > a.amount_refunded_cents && a.refund_stuck_at == null;

export function bookingLane(flow: FlowDeps, shopId: string, q: BookingQueries): Lane {
  // The same notifications the shop's cancel sends, worded for a closed business.
  const closing: FlowDeps = { ...flow, notify: (e) => flow.notify(e.kind === 'booking_cancelled' ? { ...e, closed: true } : e) };
  return {
    label: 'booking',
    open: (limit) => q.upcomingIds(shopId, new Date(flow.now()).toISOString(), limit),
    async process(id) {
      const appt = await flow.repo.appointmentById(id);
      const shop = appt && appt.shop_id === shopId ? await flow.repo.shopById(shopId) : null;
      if (!appt || !shop) throw new Error('booking or shop not found');
      const r = await cancelAppointment(closing, shop, appt, 'shop');
      if (r.alreadyFinal) {
        if (r.appt.status === 'booked') throw new Error('booking could not be cancelled'); // lost a race to something else: try again
        return { cancelled: false };
      }
      if (cardRefundOwed(r.appt)) return { cancelled: true, retryLater: true };
      return { cancelled: true, needsRefund: owedCents(r.appt) > 0 }; // manual rails: no automatic money movement
    },
    async carried(sinceIso, limit) {
      return q.recentCancelledIds(shopId, sinceIso, limit);
    },
    async processCarried(id) {
      const appt = await flow.repo.appointmentById(id);
      if (!appt || appt.shop_id !== shopId || appt.status !== 'cancelled') return { needsRefund: false };
      if (!cardRefundOwed(appt)) return { needsRefund: owedCents(appt) > 0 };
      const shop = await flow.repo.shopById(shopId);
      if (!shop) return { needsRefund: true };
      const r = await refundOwed(flow, shop, appt, appt.refund_due_cents - appt.amount_refunded_cents, { closure: true }, false);
      return { needsRefund: r.failed || cardRefundOwed(r.row) };
    },
  };
}

export function liveBookingQueries(): BookingQueries {
  const db = serviceClient();
  const ids = async (q: PromiseLike<{ data: unknown; error: { message?: string } | null }>): Promise<string[]> => {
    const { data, error } = await q;
    if (error) throw new Error(`closure query failed: ${error.message ?? 'unknown'}`);
    return ((data as Array<{ id: string }>) ?? []).map((r) => r.id);
  };
  return {
    upcomingIds: (shopId, nowIso, limit) =>
      ids(db.from('ab_appointments').select('id').eq('shop_id', shopId).eq('status', 'booked').gt('start_at', nowIso).order('start_at').limit(limit)),
    recentCancelledIds: (shopId, sinceIso, limit) =>
      ids(db.from('ab_appointments').select('id').eq('shop_id', shopId).eq('status', 'cancelled').eq('cancelled_by', 'shop').gte('cancelled_at', sinceIso).gt('amount_paid_cents', 0).limit(limit)),
  };
}

// ---------------------------------------------------------------------------
// Orders lane: the owner's existing order paths (refund -> cancels at zero, or mark cancel)
// ---------------------------------------------------------------------------
export interface OrderQueries {
  /** Orders in status new or paid (the states the owner can cancel), unpaid card holds included. */
  openIds(shopId: string, limit: number): Promise<string[]>;
  /** Orders packed for pickup: the existing path cannot cancel them. */
  readyIds(shopId: string): Promise<string[]>;
}

export function orderLane(deps: StoreOwnerDeps, userId: string, shopId: string, q: OrderQueries): Lane {
  const closing: StoreOwnerDeps = {
    ...deps,
    // Only this account's own shop can be reached: the owner path resolves the shop from this user.
    getUser: async () => ({ id: userId, email: null, fullName: null }),
    notify: (e) => deps.notify(e.kind === 'order_cancelled' ? { ...e, closed: true } : e),
  };
  const auth = 'Bearer closure';
  return {
    label: 'order',
    open: (limit) => q.openIds(shopId, limit),
    notCancelled: () => q.readyIds(shopId),
    async process(id) {
      const o = await deps.repo.orderById(id);
      const shop = o && o.shop_id === shopId ? await deps.repo.shopById(shopId) : null;
      if (!o || !shop) throw new Error('order or shop not found');
      if (o.status === 'cancelled') return { cancelled: false };

      // An unpaid card hold is not an order the customer has: close its Checkout and cancel it, no email.
      if (isUnpaidCardHold(o)) {
        if (o.stripe_checkout_session_id) {
          const s = await deps.payments.closeCheckoutSession(shop, o.stripe_checkout_session_id);
          if (s === 'complete') throw new Error('hold was paid; the payment is not recorded yet'); // the webhook will mark it paid; the retry refunds it
        }
        const upd = await deps.repo.updateOrder(id, expiredHoldPatch(deps.now()), LIVE_HOLD);
        return { cancelled: upd.ok };
      }

      // A refund an earlier call (or the owner) left owed: retry once; still failing is reported, not blocking.
      if (o.payment_method === 'card' && o.refund_due_cents > o.amount_refunded_cents) {
        if (o.refund_stuck_at != null) return { cancelled: false, needsRefund: true };
        const r = await refundOrderOwed(closing, shop, o, o.refund_due_cents - o.amount_refunded_cents, false);
        const cancelled = r.row.status === 'cancelled';
        return { cancelled, needsRefund: !cancelled };
      }

      if (o.payment_method === 'card' && o.amount_paid_cents - o.amount_refunded_cents > 0) {
        const res = await refundOwnerOrder(auth, id, {}, closing);
        if (res.status !== 200) throw new Error(`order refund answered ${res.status}`);
        const body = res.body as { order?: { status?: string }; pending?: boolean };
        if (body.pending) return { cancelled: false, retryLater: true };
        return { cancelled: body.order?.status === 'cancelled' };
      }

      const res = await markOwnerOrder(auth, id, { action: 'cancel' }, closing);
      if (res.status !== 200) throw new Error(`order cancel answered ${res.status}`);
      // Manual rails and pay-at-pickup: the shop would have refunded by hand. We move no money: report it.
      return { cancelled: true, needsRefund: o.payment_method !== 'card' && o.amount_paid_cents - o.amount_refunded_cents > 0 };
    },
  };
}

export function liveOrderQueries(): OrderQueries {
  const db = serviceClient();
  const ids = async (q: PromiseLike<{ data: unknown; error: { message?: string } | null }>): Promise<string[]> => {
    const { data, error } = await q;
    if (error) throw new Error(`closure query failed: ${error.message ?? 'unknown'}`);
    return ((data as Array<{ id: string }>) ?? []).map((r) => r.id);
  };
  return {
    openIds: (shopId, limit) => ids(db.from('ab_orders').select('id').eq('shop_id', shopId).in('status', ['new', 'paid']).order('created_at').limit(limit)),
    readyIds: (shopId) => ids(db.from('ab_orders').select('id').eq('shop_id', shopId).eq('status', 'ready').limit(200)),
  };
}

/** Live wiring for deleteAccount. Only the caller's own shop (resolved from their user id) is ever touched. */
export function liveCloseShop(): (userId: string) => Promise<ClosureResult> {
  return async (userId) => {
    const [{ liveDeps }, { liveStoreDeps }] = await Promise.all([import('../bookings/live.js'), import('../store/live.js')]);
    const flow = liveDeps();
    const store = liveStoreDeps();
    const bq = liveBookingQueries();
    const oq = liveOrderQueries();
    return closeShopForDeletion(userId, {
      now: Date.now,
      shopIdFor: async (uid) => (await flow.repo.shopByOwner(uid))?.id ?? null,
      lanes: (shopId, uid) => [bookingLane(flow, shopId, bq), orderLane(store, uid, shopId, oq)],
    });
  };
}
