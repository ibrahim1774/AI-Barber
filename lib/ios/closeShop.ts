// Closing a shop for account deletion (App Store 5.1.1(v)). Deleting the account cascades the shop,
// its bookings and its orders away, so before ANYTHING is deleted every upcoming booking and every
// open store order is cancelled through the shop's existing cancel paths (customer email included,
// worded "the business closed its account"), and card money goes back through the existing refund
// paths. Nothing here moves money on its own.
//
//   - The shop is switched off FIRST (bookings_enabled and store_enabled false, before any id is
//     read) and stays off if a later step fails: a business being closed takes no new work. The open
//     ids are read again once after that to catch a booking/order that was mid-flight.
//   - Cancel + notify. If any cancel fails (or a refund could not be sent yet, or more work remains
//     than one call's cap) the result is { ok: false } and the caller deletes nothing; the app retries.
//   - Idempotent: the cancel is a compare-and-set on status 'booked'/'new'/'paid', so a retry skips
//     what is already cancelled and never emails twice.
//   - A card refund that fails is NOT given up on quickly: the call stays a retryable failure until the
//     retry sweep has marked the row stuck (refund_stuck_at) or GIVE_UP_MS (6 h) have passed since the
//     first failure (so two app retries seconds apart in a short Stripe blip delete nothing). The same
//     rule lets go of rows that can never succeed (a paid card order with no payment intent, a paid
//     Checkout the webhook never recorded, a booking whose cancel claim keeps failing).
//   - When letting go, every money still owed is first written to ab_events with shop_id NULL (the
//     shop's cascade cannot delete it): kind 'closure_refund_owed', payload { stripe_account_id,
//     payment_intent_id, owed_cents, row_id, ... } with no names or emails. If that write fails the
//     deletion is aborted (retryable) rather than lose the record. A card order is also cancelled and
//     the customer emailed (the refund is owed, contact the shop) before it is deleted.
//   - Payments with no automatic refund path (manual rails: Cash App, Venmo, Zelle, PayPal) are
//     cancelled and reported in needsRefund (and recorded) too.
//   - Logs carry ids only, never names or emails.
import { cancelAppointment, refundOwed, safeNotify as safeNotifyBooking } from '../bookings/core.js';
import type { FlowDeps } from '../bookings/core.js';
import type { AppointmentRow } from '../bookings/repo.js';
import { serviceClient } from '../bookings/repo.js';
import { markOwnerOrder, refundOwnerOrder } from '../store/ownerFlow.js';
import { expiredHoldPatch, isUnpaidCardHold, LIVE_HOLD, refundOrderOwed, safeNotify as safeNotifyOrder, type StoreOwnerDeps } from '../store/core.js';
import type { OrderRow } from '../store/types.js';

/** Bookings or orders handled per lane per call. The rest wait for the next (retried) call. */
export const CLOSE_CAP = 40;
/** Without a recorded run start: how far back a previous attempt's cancellations are re-checked. */
const CARRIED_WINDOW_MS = 24 * 3600_000;
/** A refund (or other blocker) that has failed for this long since it was first seen no longer holds the deletion. */
export const GIVE_UP_MS = 6 * 3600_000;
/** Page size and hard ceiling when re-reading earlier cancellations. */
const CARRIED_PAGE = 100;
const CARRIED_MAX = 2000;
/** A closure_seen marker older than this belongs to an abandoned deletion: it is rewritten as new. */
const MARKER_TTL_MS = 48 * 3600_000;

/** One refund (or unfinished row) that is still owed after the shop is gone. No names, no emails. */
export interface OwedRecord {
  row_kind: 'booking' | 'order';
  row_id: string;
  shop_id: string;
  stripe_account_id: string | null;
  payment_intent_id: string | null;
  owed_cents: number;
  reason: string;
}

/** Ports the lanes use that need a clock and the database (ab_events). */
export interface LaneEnv {
  now(): number;
  /** Epoch ms this key was first seen (recorded now when new). Survives between app retries. */
  firstSeen(key: string): Promise<number>;
  /** Persist a refund owed so it outlives the shop. 'existing' = already saved. Throws when it cannot be saved. */
  recordOwed(rec: OwedRecord): Promise<'new' | 'existing'>;
  /** Take back a record written for a row that turned out not to be owed after all (the cancel lost its compare-and-set). */
  resolveOwed(rec: OwedRecord): Promise<void>;
}

/** No persistence: nothing ever times out. Used only where a lane is built without an env. */
const NO_ENV: LaneEnv = { now: Date.now, firstSeen: async () => Date.now(), recordOwed: async () => 'new', resolveOwed: async () => {} };

/** Hold the deletion until the sweep marked the row stuck or GIVE_UP_MS have passed since first seen. */
async function giveUp(env: LaneEnv, key: string, stuck: boolean): Promise<boolean> {
  if (stuck) return true;
  const first = await env.firstSeen(key);
  return env.now() - first >= GIVE_UP_MS;
}

export interface LaneOutcome {
  /** This call cancelled it (a repeat or an already final row is false). */
  cancelled: boolean;
  /** Money is owed to the customer and no automatic path settled it: report it. */
  needsRefund?: boolean;
  /** A refund failed (or cannot be sent yet): stop the deletion and retry on the next call. */
  retryLater?: boolean;
  /** Left as it is and reported (deleted with the shop). */
  notCancelled?: boolean;
}

export interface Lane {
  label: 'booking' | 'order';
  /** Ids still to cancel (at most `limit`). */
  open(limit: number): Promise<string[]>;
  /** Cancel one through the existing path. Throws when it cannot be cancelled. */
  process(id: string): Promise<LaneOutcome>;
  /** Ids cancelled by an earlier attempt that may still be owed money. */
  carried?(sinceIso: string, limit: number): Promise<string[]>;
  /** Retry the refund of a carried id; needsRefund when it is still owed and let go, retryLater while it may yet succeed. */
  processCarried?(id: string): Promise<{ needsRefund: boolean; retryLater?: boolean }>;
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
  reason: 'cancel-failed' | 'refund-pending' | 'more-remaining' | 'lookup-failed' | 'pause-failed';
}
export type ClosureResult = ClosureOk | ClosureFail;

export interface ClosureDeps {
  shopIdFor(userId: string): Promise<string | null>;
  lanes(shopId: string, userId: string): Lane[];
  now(): number;
  /** Switch bookings and the store off. Called first, before any id is read; failure = retryable, nothing else is touched. */
  pauseShop?(shopId: string): Promise<void>;
  /** Records when this closure first started (the window for re-checking earlier cancellations). */
  env?: Pick<LaneEnv, 'firstSeen'>;
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

  // 1. Switch the shop off before anything is read, so nothing new arrives behind the cancellations.
  //    It stays off if a later step fails: the business is closing.
  if (deps.pauseShop) {
    try {
      await deps.pauseShop(shopId);
    } catch (e: any) {
      console.error('[ios/delete-account] switching the shop off failed:', e?.message || e);
      return { ok: false, reason: 'pause-failed', ...out };
    }
  }

  let failure: ClosureFail['reason'] | null = null;
  let startMs: number;
  try {
    startMs = deps.env ? await deps.env.firstSeen(`closure:${shopId}`) : deps.now() - CARRIED_WINDOW_MS;
  } catch (e: any) {
    console.error('[ios/delete-account] closure start lookup failed:', e?.message || e);
    return { ok: false, reason: 'lookup-failed', ...out };
  }
  const sinceIso = new Date(startMs).toISOString();
  for (const lane of deps.lanes(shopId, userId)) {
    const handled = new Set<string>();
    const handle = async (id: string) => {
      handled.add(id);
      try {
        const r = await lane.process(id);
        if (r.cancelled) lane.label === 'booking' ? out.bookingsCancelled++ : out.ordersCancelled++;
        if (r.needsRefund) flag(lane.label, id);
        if (r.notCancelled) { const k = `${lane.label}:${id}`; if (!out.notCancelled.includes(k)) out.notCancelled.push(k); }
        if (r.retryLater) failure ??= 'refund-pending';
      } catch (e: any) {
        console.error(`[ios/delete-account] cancelling ${lane.label} ${id} failed:`, e?.message || e);
        failure = 'cancel-failed';
      }
    };
    try {
      // 2. Money an earlier attempt left owed: retry; flag it once it is let go.
      if (lane.carried && lane.processCarried) {
        for (const id of await lane.carried(sinceIso, cap)) {
          try {
            const r = await lane.processCarried(id);
            if (r.needsRefund) flag(lane.label, id);
            if (r.retryLater) failure ??= 'refund-pending';
          } catch (e: any) {
            console.error(`[ios/delete-account] carried ${lane.label} ${id} failed:`, e?.message || e);
            failure = 'cancel-failed';
          }
        }
      }
      // 3. Cancel what is still open, then read once more for anything that slipped in meanwhile.
      for (const pass of [1, 2]) {
        const ids = (await lane.open(cap + 1)).filter((id) => !handled.has(id));
        for (const id of ids.slice(0, cap)) await handle(id);
        if (ids.length > cap) { failure ??= 'more-remaining'; break; } // the cap is reached: the next call continues
        if (pass === 2 && ids.length) console.warn(`[ios/delete-account] ${lane.label}: ${ids.length} arrived while closing`);
      }
      if (lane.notCancelled) for (const id of await lane.notCancelled()) { const k = `${lane.label}:${id}`; if (!out.notCancelled.includes(k)) out.notCancelled.push(k); }
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
  /** Shop-cancelled, something paid, cancelled at/after sinceIso; ordered by (cancelled_at, id); paged. */
  recentCancelledIds(shopId: string, sinceIso: string, limit: number, offset?: number): Promise<string[]>;
  /** Up to `max` cancelled CARD bookings of the shop still owing a refund (refund_due > refunded) or marked stuck: any date, any canceller. */
  owingCardIds(shopId: string, max: number): Promise<string[]>;
}

const owedCents = (a: AppointmentRow) => Math.max(0, (a.amount_paid_cents ?? 0) - (a.amount_refunded_cents ?? 0));
const cardRefundOwed = (a: AppointmentRow) => a.payment_method === 'card' && a.refund_due_cents > a.amount_refunded_cents && a.refund_stuck_at == null;

export function bookingLane(flow: FlowDeps, shopId: string, q: BookingQueries, env: LaneEnv = NO_ENV): Lane {
  // The same notifications the shop's cancel sends, worded for a closed business.
  const closing: FlowDeps = { ...flow, notify: (e) => flow.notify(e.kind === 'booking_cancelled' ? { ...e, closed: true } : e) };
  const record = (shop: { stripe_account_id: string | null }, a: AppointmentRow, cents: number, reason: string) =>
    env.recordOwed({
      row_kind: 'booking', row_id: a.id, shop_id: shopId, stripe_account_id: shop.stripe_account_id ?? null,
      payment_intent_id: a.stripe_payment_intent_id ?? null, owed_cents: cents, reason,
    });
  return {
    label: 'booking',
    open: (limit) => q.upcomingIds(shopId, new Date(flow.now()).toISOString(), limit),
    async process(id) {
      const appt = await flow.repo.appointmentById(id);
      const shop = appt && appt.shop_id === shopId ? await flow.repo.shopById(shopId) : null;
      if (!appt || !shop) throw new Error('booking or shop not found');
      const r = await cancelAppointment(closing, shop, appt, 'shop');
      if (r.alreadyFinal) {
        if (r.appt.status !== 'booked') return { cancelled: false };
        // Still booked after the claim failed: retry until it has been failing for GIVE_UP_MS, then flag, record, tell the customer and go on.
        if (!(await giveUp(env, `booking:${id}:cancel`, false))) throw new Error('booking could not be cancelled'); // lost a race to something else: try again
        const cents = owedCents(r.appt);
        const saved = await record(shop, r.appt, cents, 'not-cancelled');
        if (saved === 'new') await safeNotifyBooking(closing, { kind: 'booking_cancelled', appointmentId: id, by: 'shop', refundedCents: 0 });
        return { cancelled: false, notCancelled: true, needsRefund: cents > 0 };
      }
      if (cardRefundOwed(r.appt)) {
        if (!(await giveUp(env, `booking:${id}:refund`, false))) return { cancelled: true, retryLater: true };
        await record(shop, r.appt, r.appt.refund_due_cents - r.appt.amount_refunded_cents, 'refund-failed');
        return { cancelled: true, needsRefund: true };
      }
      const cents = owedCents(r.appt);
      if (cents > 0) await record(shop, r.appt, cents, r.appt.payment_method === 'card' ? 'refund-stuck' : 'manual-rail'); // manual rails: no automatic money movement
      return { cancelled: true, needsRefund: cents > 0 };
    },
    async carried(sinceIso) {
      const all = new Set<string>();
      for (let offset = 0; ; offset += CARRIED_PAGE) {
        if (offset >= CARRIED_MAX) throw new Error('too many earlier cancellations to re-check in one call');
        const page = await q.recentCancelledIds(shopId, sinceIso, CARRIED_PAGE, offset);
        page.forEach((id) => all.add(id));
        if (page.length < CARRIED_PAGE) break;
      }
      // Owed card refunds regardless of date or who cancelled (card only, so manual-rail cancels are not mis-flagged).
      const owing = await q.owingCardIds(shopId, CARRIED_MAX + 1);
      if (owing.length > CARRIED_MAX) throw new Error('too many owed refunds to re-check in one call');
      owing.forEach((id) => all.add(id));
      return [...all];
    },
    async processCarried(id) {
      const appt = await flow.repo.appointmentById(id);
      if (!appt || appt.shop_id !== shopId || appt.status !== 'cancelled') return { needsRefund: false };
      const shop = await flow.repo.shopById(shopId);
      if (!shop) throw new Error('shop not found');
      if (!cardRefundOwed(appt)) {
        const cents = owedCents(appt);
        if (cents <= 0) return { needsRefund: false };
        await record(shop, appt, cents, appt.payment_method === 'card' ? 'refund-stuck' : 'manual-rail');
        return { needsRefund: true };
      }
      const owing = appt.refund_due_cents - appt.amount_refunded_cents;
      const r = await refundOwed(flow, shop, appt, owing, { closure: true }, false);
      if (!(r.failed || cardRefundOwed(r.row))) return { needsRefund: false };
      if (!(await giveUp(env, `booking:${id}:refund`, r.row.refund_stuck_at != null))) return { needsRefund: false, retryLater: true };
      await record(shop, r.row, r.row.refund_due_cents - r.row.amount_refunded_cents, 'refund-failed');
      return { needsRefund: true };
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
    recentCancelledIds: (shopId, sinceIso, limit, offset = 0) =>
      ids(db.from('ab_appointments').select('id').eq('shop_id', shopId).eq('status', 'cancelled').eq('cancelled_by', 'shop')
        .gte('cancelled_at', sinceIso).gt('amount_paid_cents', 0)
        .order('cancelled_at').order('id').range(offset, offset + limit - 1)),
    // PostgREST cannot compare two columns, so narrow in the database and compare refund_due vs refunded here.
    owingCardIds: async (shopId, max) => {
      const out: string[] = [];
      for (let offset = 0; out.length < max; offset += CARRIED_PAGE) {
        const { data, error } = await db.from('ab_appointments')
          .select('id, refund_due_cents, amount_refunded_cents, refund_stuck_at')
          .eq('shop_id', shopId).eq('status', 'cancelled').eq('payment_method', 'card')
          .or('refund_due_cents.gt.0,refund_stuck_at.not.is.null')
          .order('id').range(offset, offset + CARRIED_PAGE - 1);
        if (error) throw new Error(`closure query failed: ${error.message ?? 'unknown'}`);
        const rows = (data as Array<{ id: string; refund_due_cents: number; amount_refunded_cents: number; refund_stuck_at: string | null }>) ?? [];
        for (const r of rows) if (r.refund_due_cents > r.amount_refunded_cents || r.refund_stuck_at != null) out.push(r.id);
        if (rows.length < CARRIED_PAGE) break;
      }
      return out.slice(0, max);
    },
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

/** What a card order still owes its customer: the recorded refund target if there is one, else everything unrefunded. */
const orderOwedCents = (o: OrderRow) =>
  Math.max(0, (o.refund_due_cents > o.amount_refunded_cents ? o.refund_due_cents : o.amount_paid_cents) - o.amount_refunded_cents);

export function orderLane(deps: StoreOwnerDeps, userId: string, shopId: string, q: OrderQueries, env: LaneEnv = NO_ENV): Lane {
  const closing: StoreOwnerDeps = {
    ...deps,
    // Only this account's own shop can be reached: the owner path resolves the shop from this user.
    getUser: async () => ({ id: userId, email: null, fullName: null }),
    notify: (e) => deps.notify(e.kind === 'order_cancelled' ? { ...e, closed: true } : e),
  };
  const auth = 'Bearer closure';

  /**
   * Let go of an order whose money cannot be sent: save the owed record FIRST (a failed save aborts and
   * nothing is cancelled), then cancel it and tell the customer the refund is owed and to contact the shop.
   */
  async function abandon(o: OrderRow, shop: { stripe_account_id: string | null }, cents: number, reason: string): Promise<LaneOutcome> {
    const rec: OwedRecord = {
      row_kind: 'order', row_id: o.id, shop_id: shopId, stripe_account_id: shop.stripe_account_id ?? null,
      payment_intent_id: o.stripe_payment_intent_id ?? null, owed_cents: cents, reason,
    };
    await env.recordOwed(rec);
    const hold = isUnpaidCardHold(o);
    const upd = await deps.repo.updateOrder(
      o.id,
      hold ? expiredHoldPatch(deps.now()) : { status: 'cancelled', cancelled_by: 'shop', cancelled_at: new Date(deps.now()).toISOString() },
      hold ? LIVE_HOLD : { status: o.status },
    );
    if (!upd.ok) {
      await env.resolveOwed(rec); // not owed after all (or not yet): do not leave a stale 'owed' record the dedupe key would keep forever
      return { cancelled: false, retryLater: true }; // changed under us (e.g. the webhook recorded it): look again next call
    }
    await safeNotifyOrder(closing, { kind: 'order_cancelled', orderId: o.id, refundedCents: 0, owedCents: cents });
    return { cancelled: true, needsRefund: true };
  }

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
          if (s === 'complete') {
            // Paid at Stripe but the webhook never recorded it: wait for it, then let go with the money flagged.
            if (await giveUp(env, `order:${id}:hold`, false)) return abandon(o, shop, o.total_cents, 'paid-hold-unrecorded');
            throw new Error('hold was paid; the payment is not recorded yet'); // the webhook will mark it paid; the retry refunds it
          }
        }
        const upd = await deps.repo.updateOrder(id, expiredHoldPatch(deps.now()), LIVE_HOLD);
        return { cancelled: upd.ok };
      }

      const card = o.payment_method === 'card';
      const owing = orderOwedCents(o);
      if (card && owing > 0) {
        const key = `order:${id}:refund`;
        // Nothing to refund against: no automatic path can ever settle it.
        if (!o.stripe_payment_intent_id) {
          if (await giveUp(env, key, false)) return abandon(o, shop, owing, 'no-payment-intent');
          return { cancelled: false, retryLater: true };
        }
        // The retry sweep already gave up on it.
        if (o.refund_stuck_at != null) return abandon(o, shop, owing, 'refund-stuck');
        let after: OrderRow = o;
        if (o.refund_due_cents > o.amount_refunded_cents) {
          // A refund an earlier call (or the owner) left owed: retry it.
          const r = await refundOrderOwed(closing, shop, o, o.refund_due_cents - o.amount_refunded_cents, false);
          after = r.row;
          if (after.status === 'cancelled') return { cancelled: true };
        } else {
          const res = await refundOwnerOrder(auth, id, {}, closing);
          if (res.status !== 200) throw new Error(`order refund answered ${res.status}`);
          const body = res.body as { order?: { status?: string }; pending?: boolean };
          if (!body.pending) return { cancelled: body.order?.status === 'cancelled' };
          after = (await deps.repo.orderById(id)) ?? o;
        }
        // The refund did not go through: keep the deletion on hold until the sweep or 6 h say it is time.
        if (after.status === 'cancelled') return { cancelled: true };
        if (await giveUp(env, key, after.refund_stuck_at != null)) return abandon(after, shop, orderOwedCents(after), 'refund-failed');
        return { cancelled: false, retryLater: true };
      }

      const res = await markOwnerOrder(auth, id, { action: 'cancel' }, closing);
      if (res.status !== 200) throw new Error(`order cancel answered ${res.status}`);
      // Manual rails and pay-at-pickup: the shop would have refunded by hand. We move no money: report it.
      const manualOwed = !card && o.amount_paid_cents - o.amount_refunded_cents > 0;
      if (manualOwed) await env.recordOwed({
        row_kind: 'order', row_id: id, shop_id: shopId, stripe_account_id: shop.stripe_account_id ?? null,
        payment_intent_id: o.stripe_payment_intent_id ?? null, owed_cents: o.amount_paid_cents - o.amount_refunded_cents, reason: 'manual-rail',
      });
      return { cancelled: true, needsRefund: manualOwed };
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

// ---------------------------------------------------------------------------
// Live wiring
// ---------------------------------------------------------------------------
type Db = ReturnType<typeof serviceClient>;

/**
 * The persistence behind LaneEnv, on ab_events (no migration):
 *  - firstSeen: a shop-scoped 'closure_seen' row (deleted with the shop), the app clock in its payload;
 *    a marker older than MARKER_TTL_MS (an abandoned deletion) is rewritten with the current time.
 *  - recordOwed: a 'closure_refund_owed' row with shop_id NULL (nullable column, 005), so the shop's
 *    ON DELETE CASCADE cannot take it; dedupe_key makes a repeat a no-op.
 */
export function liveClosureEnv(db: Db, shopId: string, now: () => number = Date.now): LaneEnv {
  const read = async (dedupeKey: string): Promise<number | null> => {
    const { data, error } = await db.from('ab_events').select('payload').eq('dedupe_key', dedupeKey).maybeSingle();
    if (error) throw new Error(`closure marker read failed: ${error.message ?? 'unknown'}`);
    const at = Number((data as { payload?: { at?: unknown } } | null)?.payload?.at);
    return Number.isFinite(at) ? at : null;
  };
  return {
    now,
    async firstSeen(key) {
      const dk = `closure_seen:${shopId}:${key}`;
      const have = await read(dk);
      if (have != null && now() - have < MARKER_TTL_MS) return have;
      if (have != null) {
        // Left over from an abandoned deletion: treat it as new and restart from this attempt.
        const { error: werr } = await db.from('ab_events').update({ payload: { at: now(), key } }).eq('dedupe_key', dk);
        if (werr) throw new Error(`closure marker write failed: ${werr.message ?? 'unknown'}`);
        return now();
      }
      const { error } = await db.from('ab_events')
        .upsert({ shop_id: shopId, kind: 'closure_seen', payload: { at: now(), key }, dedupe_key: dk }, { onConflict: 'dedupe_key', ignoreDuplicates: true });
      if (error) throw new Error(`closure marker write failed: ${error.message ?? 'unknown'}`);
      const again = await read(dk); // a racing call may have written first: its time wins
      if (again == null) throw new Error('closure marker missing after write');
      return again;
    },
    async recordOwed(rec) {
      const { data, error } = await db.from('ab_events')
        .upsert(
          { shop_id: null, kind: 'closure_refund_owed', payload: rec, dedupe_key: `closure_owed:${rec.row_kind}:${rec.row_id}` },
          { onConflict: 'dedupe_key', ignoreDuplicates: true },
        ).select('id');
      if (error) throw new Error(`recording the refund owed failed: ${error.message ?? 'unknown'}`);
      return Array.isArray(data) && data.length > 0 ? 'new' : 'existing';
    },
    async resolveOwed(rec) {
      const { error } = await db.from('ab_events').delete()
        .eq('dedupe_key', `closure_owed:${rec.row_kind}:${rec.row_id}`).eq('kind', 'closure_refund_owed');
      if (error) throw new Error(`removing the refund-owed record failed: ${error.message ?? 'unknown'}`);
    },
  };
}

/** Bookings and the store off (closed business). */
export async function pauseShopLive(db: Db, shopId: string): Promise<void> {
  const { error } = await db.from('ab_shops').update({ bookings_enabled: false, store_enabled: false }).eq('id', shopId);
  if (error) throw new Error(`pausing the shop failed: ${error.message ?? 'unknown'}`);
}

/** Live wiring for deleteAccount. Only the caller's own shop (resolved from their user id) is ever touched. */
export function liveCloseShop(): (userId: string) => Promise<ClosureResult> {
  return async (userId) => {
    const [{ liveDeps }, { liveStoreDeps }] = await Promise.all([import('../bookings/live.js'), import('../store/live.js')]);
    const flow = liveDeps();
    const store = liveStoreDeps();
    const bq = liveBookingQueries();
    const oq = liveOrderQueries();
    const db = serviceClient();
    const shopId = (await flow.repo.shopByOwner(userId))?.id ?? null;
    const env = shopId ? liveClosureEnv(db, shopId) : NO_ENV;
    return closeShopForDeletion(userId, {
      now: Date.now,
      env,
      shopIdFor: async () => shopId,
      pauseShop: (id) => pauseShopLive(db, id),
      lanes: (id, uid) => [bookingLane(flow, id, bq, env), orderLane(store, uid, id, oq, env)],
    });
  };
}
