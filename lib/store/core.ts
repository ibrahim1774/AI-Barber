// Shared pieces of the store API flows: the store gate, cart parsing and pricing, address
// validation, response views, and the money paths shared by the owner refund and the sweeps.
import type { GetUser } from '../bookings/auth.js';
import { isObj, isUuid, iso, text, type FlowResult } from '../bookings/core.js';
import { MANUAL_METHODS } from '../bookings/repo.js';
import { entitlementActive } from '../ios/lapse.js';
import { orderRefundKey, type CheckoutCloseResult, type NotifyOrder, type StorePayments } from './deps.js';
import { REFUND_5XX_EVENT, isStripe5xx, withRefundAttempt } from '../bookings/payments.js';
import type { OrderGuard, StoreRepo } from './repo.js';
import type { Fulfilment, OrderItemRow, OrderRow, ProductRow, ShippingAddress, ShopStoreRow, StoreNotifyEvent } from './types.js';

export interface StoreLimits {
  /** Count one order create for the shop; false when over its hourly cap. Never throws. */
  shopOrder(shopId: string): Promise<boolean>;
}

export interface StoreDeps {
  repo: StoreRepo;
  payments: StorePayments;
  notify: NotifyOrder;
  now(): number;
  /** Origin of the shop pages, e.g. 'https://www.aibarber.org'. */
  baseUrl: string;
  /** Cross-instance limits checked inside flows (absent = none). */
  limits?: StoreLimits;
  /** Wait (a resubmit polling an in-flight Checkout); default setTimeout. Tests inject it. */
  sleep?(ms: number): Promise<void>;
}

export interface StoreOwnerDeps extends StoreDeps {
  getUser: GetUser;
}

export type { FlowResult };

const MIN = 60_000;
/** Stripe's card minimum; also the lowest product price (009 ab_products_price_min). */
export const MIN_PRICE_CENTS = 50;
export const MAX_CART_LINES = 20;
export const MAX_LINE_QTY = 10;
export const MAX_PHOTOS = 5;

// ---------------------------------------------------------------------------
// Store gate (Phase 3: store_enabled + a live iOS purchase; Phase 4: on the Store tier)
// ---------------------------------------------------------------------------
export async function storeOpen(repo: Pick<StoreRepo, 'purchase'>, shop: ShopStoreRow): Promise<boolean> {
  // Live, and the plan includes the store. Owner order actions are never gated.
  return storeGate(repo, shop, 'store');
}

/**
 * A customer's follow-up on an EXISTING order ("I've sent it"): the Phase 3 rule only. It
 * survives a downgrade, so a customer who already paid is never stuck; only a full lapse
 * (revoked, taken down, or an unswept purchase past expiry) refuses it.
 */
export async function storeFollowUpOpen(repo: Pick<StoreRepo, 'purchase'>, shop: ShopStoreRow): Promise<boolean> {
  // e2e P2: not store_enabled either (the owner switching the store off is the same as a
  // downgrade for an order that already exists).
  if (!shop.ios_otid) return false;
  return entitlementActive(await repo.purchase(shop.ios_otid), 'hosting');
}

async function storeGate(repo: Pick<StoreRepo, 'purchase'>, shop: ShopStoreRow, ent: 'store' | 'hosting'): Promise<boolean> {
  if (!shop.store_enabled) return false;
  if (!shop.ios_otid) return false;
  return entitlementActive(await repo.purchase(shop.ios_otid), ent);
}

/** One predicate for the page (GET /shop) and the server (POST /orders). */
export const shippingEnabled = (shop: ShopStoreRow) => !!shop.store_shipping && shop.shipping_flat_cents != null;
export const pickupEnabled = (shop: ShopStoreRow) => !!shop.store_pickup;

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------
export interface CartLine {
  productId: string;
  quantity: number;
}

/** 1–20 lines of { productId: uuid, quantity: 1–10 }, merged by productId (merged qty ≤ 10). Null = invalid. */
export function parseCart(items: unknown): CartLine[] | null {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_CART_LINES) return null;
  const merged = new Map<string, number>();
  for (const it of items) {
    if (!isObj(it) || !isUuid(it.productId)) return null;
    const q = it.quantity;
    if (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > MAX_LINE_QTY) return null;
    const id = it.productId.toLowerCase();
    merged.set(id, (merged.get(id) ?? 0) + q);
  }
  const out: CartLine[] = [];
  for (const [productId, quantity] of merged) {
    if (quantity > MAX_LINE_QTY) return null;
    out.push({ productId, quantity });
  }
  return out;
}

/** An order line as stored (ab_order_items snapshot) plus the cover photo for Checkout. */
export interface PricedLine {
  product_id: string;
  name: string;
  unit_price_cents: number;
  quantity: number;
  photo_url: string | null;
}

export type PricedCart =
  | { lines: PricedLine[]; subtotal: number; shipping: number; total: number }
  | { soldOut: string[] }
  | { invalid: 'items' };

const httpsPhotos = (p: ProductRow) =>
  (Array.isArray(p.photos) ? p.photos : []).filter((u) => typeof u === 'string' && /^https:\/\//i.test(u)).slice(0, MAX_PHOTOS);

/**
 * Server-side totals. Every line must be an active product of this shop priced at least 50¢
 * (else `invalid`); then any sold-out line gives `soldOut`. Name and price are snapshotted from
 * the rows read in this request.
 */
export function priceCart(shop: ShopStoreRow, products: ProductRow[], lines: CartLine[], fulfilment: Fulfilment): PricedCart {
  const byId = new Map(products.filter((p) => p.shop_id === shop.id).map((p) => [p.id.toLowerCase(), p]));
  const found: ProductRow[] = [];
  for (const l of lines) {
    const p = byId.get(l.productId.toLowerCase());
    if (!p || !p.active || !Number.isInteger(p.price_cents) || p.price_cents < MIN_PRICE_CENTS) return { invalid: 'items' };
    found.push(p);
  }
  const soldOut = found.filter((p) => p.sold_out).map((p) => p.id);
  if (soldOut.length) return { soldOut };
  const priced = lines.map((l, i) => ({
    product_id: found[i].id,
    name: found[i].name,
    unit_price_cents: found[i].price_cents,
    quantity: l.quantity,
    photo_url: httpsPhotos(found[i])[0] ?? null,
  }));
  const subtotal = priced.reduce((s, l) => s + l.unit_price_cents * l.quantity, 0);
  const shipping = fulfilment === 'shipping' ? shop.shipping_flat_cents ?? 0 : 0;
  return { lines: priced, subtotal, shipping, total: subtotal + shipping };
}

// ---------------------------------------------------------------------------
// Address (US only)
// ---------------------------------------------------------------------------
const STATE_RE = /^[A-Za-z]{2}$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;

/** { name, line1, line2?, city, state, postalCode } → the stored shape, or null when invalid. */
export function parseUsAddress(v: unknown): ShippingAddress | null {
  if (!isObj(v)) return null;
  const name = text(v.name, 100);
  const line1 = text(v.line1, 100);
  const line2 = text(v.line2, 100, true);
  const city = text(v.city, 100);
  const state = typeof v.state === 'string' ? v.state.trim() : '';
  const postal = typeof v.postalCode === 'string' ? v.postalCode.trim() : '';
  if (!name || !line1 || line2 === undefined || !city) return null;
  if (!STATE_RE.test(state) || !ZIP_RE.test(postal)) return null;
  return { name, line1, line2, city, state: state.toUpperCase(), postal_code: postal, country: 'US' };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
export const statusUrl = (baseUrl: string, token: string) =>
  `${baseUrl.replace(/\/+$/, '')}/shop/manage/${encodeURIComponent(token)}`;

export function publicProductView(p: ProductRow) {
  return {
    id: p.id,
    name: p.name,
    priceCents: p.price_cents,
    description: p.description ?? null,
    photos: httpsPhotos(p),
    soldOut: !!p.sold_out,
  };
}

const addressOrNull = (a: unknown) => (isObj(a) && Object.keys(a).length > 0 ? a : null);
const isManual = (m: unknown) => typeof m === 'string' && (MANUAL_METHODS as readonly string[]).includes(m);
const refundPending = (o: OrderRow) => o.refund_due_cents > o.amount_refunded_cents && o.refund_stuck_at == null;

/** canSayPaid: a manual-rail order, unpaid, not cancelled, a method set, not said yet. */
export const canSayPaid = (o: OrderRow) =>
  isManual(o.payment_method)
  && (o.payment_status === 'none' || o.payment_status === 'awaiting')
  && o.status !== 'cancelled'
  && !o.customer_says_paid_at;

export function publicOrderView(o: OrderRow, items: OrderItemRow[], shop: ShopStoreRow, manual: Record<string, string>) {
  return {
    order: {
      id: o.id,
      number: o.order_no,
      status: o.status,
      fulfilment: o.fulfilment,
      createdAt: iso(Date.parse(o.created_at)),
      items: items.map((i) => ({ name: i.name, unitPriceCents: i.unit_price_cents, quantity: i.quantity })),
      subtotalCents: o.subtotal_cents,
      shippingCents: o.shipping_cents,
      totalCents: o.total_cents,
      paymentStatus: o.payment_status,
      paymentMethod: o.payment_method,
      amountPaidCents: o.amount_paid_cents,
      amountRefundedCents: o.amount_refunded_cents,
      trackingNumber: o.tracking_number ?? null,
      trackingUrl: o.tracking_url ?? null,
      shippingAddress: addressOrNull(o.shipping_address),
      customerSaysPaid: !!o.customer_says_paid_at,
    },
    shop: {
      name: shop.name,
      slug: shop.slug,
      address: shop.address ?? null,
      phone: shop.phone ?? null,
      accent: shop.accent ?? null,
      pickupNote: shop.store_pickup_note ?? null,
      shipsWithinDays: shop.ships_within_days ?? null,
      manual,
    },
    canSayPaid: canSayPaid(o),
  };
}

const isoOrNull = (v: string | null | undefined) => (v ? iso(Date.parse(v)) : null);

export function ownerOrderView(o: OrderRow, items: OrderItemRow[]) {
  return {
    id: o.id,
    number: o.order_no,
    status: o.status,
    fulfilment: o.fulfilment,
    createdAt: iso(Date.parse(o.created_at)),
    customer: { name: o.customer_name, phone: o.customer_phone, email: o.customer_email },
    note: o.note ?? null,
    shippingAddress: addressOrNull(o.shipping_address),
    items: items.map((i) => ({ productId: i.product_id ?? null, name: i.name, unitPriceCents: i.unit_price_cents, quantity: i.quantity })),
    subtotalCents: o.subtotal_cents,
    shippingCents: o.shipping_cents,
    totalCents: o.total_cents,
    paymentStatus: o.payment_status,
    paymentMethod: o.payment_method,
    amountPaidCents: o.amount_paid_cents,
    amountRefundedCents: o.amount_refunded_cents,
    refundPending: refundPending(o),
    /** The retry sweep gave up on an owed refund (23 h): the app says to email support. */
    refundStuck: o.refund_stuck_at != null && o.refund_due_cents > o.amount_refunded_cents,
    trackingNumber: o.tracking_number ?? null,
    trackingUrl: o.tracking_url ?? null,
    customerSaysPaidAt: isoOrNull(o.customer_says_paid_at),
    readyAt: isoOrNull(o.ready_at),
    shippedAt: isoOrNull(o.shipped_at),
    doneAt: isoOrNull(o.done_at),
    cancelledAt: isoOrNull(o.cancelled_at),
  };
}

// ---------------------------------------------------------------------------
// Card holds
// ---------------------------------------------------------------------------
/** A card order whose Checkout has not been paid (a ~30-minute hold, invisible to the owner). */
export const isUnpaidCardHold = (o: OrderRow) =>
  o.payment_method === 'card' && o.payment_status === 'awaiting' && o.amount_paid_cents === 0;

/** The guard of a live, unpaid card hold (expireOrderHold in the contract). */
export const LIVE_HOLD: OrderGuard = { status: 'new', paymentMethod: 'card', paymentStatusIn: ['awaiting'], paidCents: 0 };

export const expiredHoldPatch = (nowMs: number) => ({
  status: 'cancelled' as const, cancelled_by: 'customer' as const, cancelled_at: iso(nowMs), payment_status: 'none' as const,
});

export async function safeNotify(deps: { notify?: NotifyOrder }, event: StoreNotifyEvent): Promise<void> {
  if (!deps.notify) return;
  try {
    await deps.notify(event);
  } catch (e: any) {
    console.error('[store] notify failed:', e?.message || e);
  }
}

export async function safeLog(deps: { repo: Pick<StoreRepo, 'logEvent'> }, shopId: string, kind: string, payload: Record<string, unknown>) {
  try {
    await deps.repo.logEvent(shopId, kind, payload);
  } catch (e: any) {
    console.error('[store] logEvent failed:', e?.message || e);
  }
}

// ---------------------------------------------------------------------------
// Owed refunds (owner refund + retry sweep)
// ---------------------------------------------------------------------------
export interface RefundDeps {
  repo: StoreRepo;
  payments: Pick<StorePayments, 'refundOrder'>;
  now(): number;
  notify?: NotifyOrder;
}

/**
 * Refund `amount` of an order whose refund_due_cents is already claimed, under the one key for
 * that target total (refundKey.order(id, refund_due_cents)), so a retry after a lost response
 * returns the same Stripe refund. On success writes amount_refunded_cents as an absolute total
 * under the monotonic lte guard (never an increment); a refund to zero on a 'new' or 'paid'
 * order also cancels it (its own compare-and-set) and, only when that lands, sends
 * order_cancelled. On failure the row stays owed; 'order_refund_failed' goes to ab_events only
 * when `logFailure` (the first attempt).
 */
export async function refundOrderOwed(
  deps: RefundDeps,
  shop: ShopStoreRow,
  row: OrderRow,
  amount: number,
  logFailure: boolean,
): Promise<{ refunded: number; row: OrderRow; failed: boolean }> {
  let refunded = 0;
  // Order + target + amount + the refunded total it was computed from (stored state only): the
  // same attempt (a double tap, a lost response, the retry sweep) always sends the same key.
  const baseKey = orderRefundKey(row.id, row.refund_due_cents, amount, row.amount_refunded_cents);
  // Review fix 13: after a definite Stripe 5xx on this attempt, a new suffix (Stripe replays a
  // saved 500 for the same key for 24 h).
  const attempt = deps.repo.refundAttempts ? await deps.repo.refundAttempts(baseKey).catch(() => 0) : 0;
  const key = withRefundAttempt(baseKey, attempt);
  try {
    const r = await deps.payments.refundOrder(shop, row, amount, { idempotencyKey: key });
    refunded = Math.max(0, Math.min(amount, Math.floor(Number(r?.refundedCents) || 0)));
  } catch (e: any) {
    console.error(`[store] refund failed for order ${row.id} (left owed for retry):`, e?.message || e);
    if (isStripe5xx(e)) await safeLog(deps, shop.id, REFUND_5XX_EVENT, { key: baseKey, attempt, orderId: row.id });
    if (logFailure) {
      await safeLog(deps, shop.id, 'order_refund_failed', {
        orderId: row.id, amountCents: amount, dueCents: row.refund_due_cents, error: String(e?.message || e),
      });
    }
    return { refunded: 0, row, failed: true };
  }
  if (refunded <= 0) return { refunded: 0, row, failed: false };

  const total = row.amount_refunded_cents + refunded;
  const full = total >= row.amount_paid_cents;
  try {
    // The charge.refunded webhook writes Stripe's cumulative total under the same guard, so
    // whichever lands last can't double count or lower it.
    const upd = await deps.repo.updateOrder(row.id, {
      amount_refunded_cents: total,
      payment_status: full ? 'refunded' : 'partially_refunded',
    }, { refundedLte: total });
    row = upd.ok ? upd.row : (await deps.repo.orderById(row.id)) ?? row;
  } catch (e: any) {
    console.error(`[store] refund bookkeeping failed for order ${row.id}:`, e?.message || e);
  }
  if (full && (row.status === 'new' || row.status === 'paid')) {
    try {
      const c = await deps.repo.updateOrder(
        row.id,
        { status: 'cancelled', cancelled_by: 'shop', cancelled_at: iso(deps.now()) },
        { status: row.status },
      );
      if (c.ok) {
        row = c.row;
        await safeNotify(deps, { kind: 'order_cancelled', orderId: row.id, refundedCents: row.amount_refunded_cents });
      }
    } catch (e: any) {
      console.error(`[store] cancelling refunded order ${row.id} failed:`, e?.message || e);
    }
  }
  return { refunded, row, failed: false };
}

export const ORDER_REFUND_RETRY_AFTER_MIN = 2;
/** Inside Stripe's 24 h idempotency window, so a retry can never become a second refund. */
export const ORDER_REFUND_GIVE_UP_HOURS = 23;
export const ORDER_REFUND_RETRY_BATCH = 25;

/** A wall-clock cut-off for a cron sweep: stop picking up new rows once `deadline` (epoch ms) has passed. */
export interface SweepBudget { deadline?: number; clock?: () => number }
const pastDeadline = (b: SweepBudget) => b.deadline != null && (b.clock ?? Date.now)() >= b.deadline;

/**
 * Retry owner refunds still owed: refund_pending rows with a payment intent, last touched more
 * than 2 minutes ago, oldest first, at most 25 per run. Each retry refunds due − refunded under
 * the same key as the first attempt (refundKey.order(id, due)). 23 h after refund_requested_at
 * the row gets refund_stuck_at and one 'order_refund_stuck' event; refund_due_cents is never
 * lowered. A failure touches the row so the others go first next time.
 */
export async function retryPendingOrderRefunds(
  deps: RefundDeps,
  nowMs: number = deps.now(),
  budget: SweepBudget = {},
): Promise<{ retried: number; refunded: number; failed: number; stuck: number }> {
  const out = { retried: 0, refunded: 0, failed: 0, stuck: 0 };
  const rows = await deps.repo.pendingOrderRefunds(iso(nowMs - ORDER_REFUND_RETRY_AFTER_MIN * MIN), ORDER_REFUND_RETRY_BATCH);
  for (const row of rows) {
    if (pastDeadline(budget)) break; // out of time: the rest wait for the next run
    try {
      const owed = row.refund_due_cents - row.amount_refunded_cents;
      if (owed <= 0 || row.refund_stuck_at || !row.stripe_payment_intent_id) continue;
      const since = Date.parse(row.refund_requested_at ?? row.updated_at ?? '');
      if (Number.isFinite(since) && nowMs - since >= ORDER_REFUND_GIVE_UP_HOURS * 60 * MIN) {
        const marked = await deps.repo.updateOrder(row.id, { refund_stuck_at: iso(nowMs) }, { refundPending: true, refundDue: row.refund_due_cents });
        if (marked.ok === false) continue; // another run marked it (or it was paid out meanwhile)
        await safeLog(deps, row.shop_id, 'order_refund_stuck', {
          orderId: row.id, dueCents: row.refund_due_cents, refundedCents: row.amount_refunded_cents, owedCents: owed,
          paymentIntent: row.stripe_payment_intent_id, requestedAt: row.refund_requested_at,
        });
        console.error(`[store] refund for order ${row.id} still owed ${ORDER_REFUND_GIVE_UP_HOURS} h after the request; giving up (order_refund_stuck)`);
        out.stuck++;
        continue;
      }
      const shop = await deps.repo.shopById(row.shop_id);
      if (!shop) continue;
      out.retried++;
      const r = await refundOrderOwed(deps, shop, row, owed, false);
      if (r.failed) {
        out.failed++;
        // Touch the row (updated_at) so the next run tries the others first.
        await deps.repo.updateOrder(row.id, { refund_due_cents: row.refund_due_cents }, { refundDue: row.refund_due_cents });
      } else if (r.refunded > 0) out.refunded++;
    } catch (e: any) {
      console.error(`[store] retrying refund for order ${row.id} failed:`, e?.message || e);
    }
  }
  return out;
}

/** A card hold older than this with nothing paid is expired (Checkout itself lasts ~32 min). */
export const ORDER_HOLD_EXPIRY_MIN = 35;
/** A hold whose session is 'complete' this long after creation means a payment the webhook never recorded. */
export const ORDER_HOLD_PAID_ALERT_MIN = 60;
/** A hold Stripe still can't answer about this long after creation is cancelled (Checkout lasts at most 24 h). */
export const ORDER_HOLD_GIVE_UP_MIN = 25 * 60;

/**
 * Expire orphaned card holds (new + card + awaiting + nothing paid, created more than 35 min
 * ago). Stripe is asked FIRST: the hold is cancelled only when its Checkout Session is expired
 * (expired now by this call, or already). A 'complete' session means the customer paid on time
 * and the completed webhook is still on its way, so the order is left for the webhook to mark
 * paid; an unanswered call leaves it for the next sweep. A hold with no session stored (the
 * request died before Checkout) is cancelled directly. The cancel is the same compare-and-set as
 * the webhook's expireOrderHold, so a payment that lands meanwhile is never overwritten. Never
 * refunds, never notifies.
 *
 * Unresolved holds are touched (a LIVE_HOLD-guarded no-op that bumps updated_at) and the sweep
 * reads holds by updated_at, so they rotate to the back instead of starving newer ones. A hold
 * still 'complete' an hour after it was created is a payment the webhook never recorded: it is
 * logged once (ab_events 'order_hold_paid_unrecorded', on the first run past the hour).
 */
export async function expireStaleOrderHolds(
  deps: { repo: StoreRepo; payments: Pick<StorePayments, 'closeCheckoutSession'>; now(): number },
  limit = 50,
  budget: SweepBudget = {},
): Promise<{ expired: number; paid: number; unresolved: number }> {
  const nowMs = deps.now();
  const holds = await deps.repo.staleOrderHolds(iso(nowMs - ORDER_HOLD_EXPIRY_MIN * MIN), limit);
  const out = { expired: 0, paid: 0, unresolved: 0 };
  for (const h of holds) {
    if (pastDeadline(budget)) break; // out of time: the rest wait for the next run
    try {
      if (h.stripe_checkout_session_id) {
        let closed: CheckoutCloseResult = 'unknown';
        try {
          const shop = await deps.repo.shopById(h.shop_id);
          if (shop) closed = await deps.payments.closeCheckoutSession(shop, h.stripe_checkout_session_id);
        } catch (e: any) {
          console.error(`[store] closing checkout for order hold ${h.id} failed:`, e?.message || e);
        }
        if (closed !== 'expired') {
          if (closed === 'complete') {
            out.paid++;
            const created = Date.parse(h.created_at);
            const alertAt = created + ORDER_HOLD_PAID_ALERT_MIN * MIN;
            if (nowMs >= alertAt && Date.parse(h.updated_at) < alertAt) {
              console.error(`[store] order ${h.id}: Checkout ${h.stripe_checkout_session_id} is complete but the payment was never recorded`);
              await safeLog(deps, h.shop_id, 'order_hold_paid_unrecorded', { orderId: h.id, sessionId: h.stripe_checkout_session_id });
            }
          } else if (nowMs - Date.parse(h.created_at) >= ORDER_HOLD_GIVE_UP_MIN * MIN) {
            // Review fix round 1 (finding 7): past any Checkout Session's life and Stripe still
            // can't answer (e.g. the shop disconnected Stripe): cancel the hold, logged.
            const upd = await deps.repo.updateOrder(h.id, expiredHoldPatch(deps.now()), LIVE_HOLD);
            if (upd.ok) {
              out.expired++;
              console.error(`[store] order hold ${h.id}: session state still unknown after ${ORDER_HOLD_GIVE_UP_MIN / 60} h; cancelled`);
              await safeLog(deps, h.shop_id, 'order_hold_given_up', { orderId: h.id, sessionId: h.stripe_checkout_session_id });
            }
            continue;
          } else {
            console.error(`[store] order hold ${h.id}: checkout session state unknown; left for the next sweep`);
            out.unresolved++;
          }
          // Rotate it behind newer holds (a miss means the webhook resolved it meanwhile).
          await deps.repo.updateOrder(h.id, { checkout_url: h.checkout_url }, LIVE_HOLD);
          continue;
        }
      }
      const upd = await deps.repo.updateOrder(h.id, expiredHoldPatch(deps.now()), LIVE_HOLD);
      if (upd.ok) out.expired++;
    } catch (e: any) {
      console.error(`[store] expiring order hold ${h.id} failed:`, e?.message || e);
    }
  }
  return out;
}

export { MIN };
