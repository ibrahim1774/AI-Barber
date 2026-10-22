// Data access for the store API. Everything here runs with the Supabase SERVICE ROLE (bypasses
// RLS), so callers must already have decided which shop the caller may touch: public endpoints
// resolve the shop from its slug or an order's manage token, owner endpoints from the verified
// JWT's user id. Never pass an id from a request body straight through.
//
// Domain-level (createOrder reports `existing` instead of a Postgres error; updateOrder reports
// 'stale' when its compare-and-set misses) so the flows are testable with an in-memory fake.
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient, type PaymentStatus, type PurchaseGateRow } from '../bookings/repo.js';
import type { OrderItemRow, OrderPaymentMethod, OrderRow, OrderStatus, ProductRow, ShopStoreRow } from './types.js';

export type NewOrder = Pick<
  OrderRow,
  | 'shop_id' | 'customer_name' | 'customer_phone' | 'customer_email' | 'note' | 'fulfilment' | 'shipping_address'
  | 'shipping_cents' | 'subtotal_cents' | 'total_cents' | 'currency' | 'status' | 'payment_status' | 'payment_method'
  | 'client_key'
>;

export type NewOrderItem = Pick<OrderItemRow, 'product_id' | 'name' | 'unit_price_cents' | 'quantity'>;

export type OrderPatch = Partial<Pick<
  OrderRow,
  | 'status' | 'tracking_number' | 'tracking_url' | 'payment_status' | 'payment_method' | 'amount_paid_cents'
  | 'amount_refunded_cents' | 'stripe_checkout_session_id' | 'checkout_url' | 'customer_says_paid_at'
  | 'ready_at' | 'shipped_at' | 'done_at' | 'cancelled_at' | 'cancelled_by'
  | 'refund_due_cents' | 'refund_requested_at' | 'refund_stuck_at'
>>;

/**
 * Conditions an update applies under (compare-and-set). Literal comparisons only: PostgREST
 * can't compare two columns, so `refundPending` filters on the generated column.
 */
export interface OrderGuard {
  status?: OrderStatus;
  statusIn?: OrderStatus[];
  paymentMethod?: OrderPaymentMethod;
  /** payment_method is null or anything but 'card'. */
  notCard?: boolean;
  paymentStatusIn?: PaymentStatus[];
  /** amount_paid_cents equals this. */
  paidCents?: number;
  /** amount_refunded_cents equals this. */
  refundedEq?: number;
  /** Monotonic refund total: only while amount_refunded_cents <= this value. */
  refundedLte?: number;
  /** refund_due_cents equals this. */
  refundDue?: number;
  /** The generated refund_pending flag equals this. */
  refundPending?: boolean;
  /** refund_stuck_at is null. */
  notStuck?: boolean;
  /** customer_says_paid_at is null ("I've sent it" is recorded once). */
  saysPaidNull?: boolean;
  /** stripe_checkout_session_id is null (no Checkout stored on the hold yet). */
  sessionNull?: boolean;
}

export type OrderWrite = { ok: true; row: OrderRow } | { ok: false; reason: 'stale' };

export interface CreatedOrder {
  order: OrderRow;
  items: OrderItemRow[];
  /** The (shop_id, client_key) already had an order: nothing was inserted. */
  existing: boolean;
}

export interface StoreRepo {
  shopBySlug(slug: string): Promise<ShopStoreRow | null>;
  shopById(id: string): Promise<ShopStoreRow | null>;
  shopByOwner(userId: string): Promise<ShopStoreRow | null>;
  /** ios_purchases row behind the store gate (null when there is none). */
  purchase(otid: string): Promise<PurchaseGateRow | null>;

  /** Every product of the shop (active or not) in sort, then created_at, order. */
  products(shopId: string): Promise<ProductRow[]>;
  /** The shop's products among `ids` (a foreign or unknown id is simply absent). */
  productsByIds(shopId: string, ids: string[]): Promise<ProductRow[]>;

  /** RPC ab_create_order: atomic order + items, or the stored order for a repeated client_key. */
  createOrder(order: NewOrder, items: NewOrderItem[]): Promise<CreatedOrder>;
  /** The shop's order with this client_key (a resubmit), else null. */
  orderByClientKey(shopId: string, clientKey: string): Promise<OrderRow | null>;
  orderById(id: string): Promise<OrderRow | null>;
  orderByToken(token: string): Promise<OrderRow | null>;
  /** In the cart's line order. */
  orderItems(orderId: string): Promise<OrderItemRow[]>;
  updateOrder(id: string, patch: OrderPatch, guard?: OrderGuard): Promise<OrderWrite>;
  /**
   * Unpaid card holds (new, card, awaiting, nothing paid) created before `createdBeforeIso`, least
   * recently touched first (the sweep touches the ones it can't resolve, so they rotate).
   */
  staleOrderHolds(createdBeforeIso: string, limit: number): Promise<OrderRow[]>;
  /** Orders with refund_pending and a payment intent, last updated before `updatedBeforeIso`, oldest first. */
  pendingOrderRefunds(updatedBeforeIso: string, limit: number): Promise<OrderRow[]>;

  logEvent(shopId: string | null, kind: string, payload: Record<string, unknown>): Promise<void>;
}

const SHOP_COLS =
  'id, owner_id, site_id, slug, name, timezone, currency, lead_days, min_notice_min, buffer_min, cancel_cutoff_min, ' +
  'slot_step_min, pay_in_shop, manual_handles, stripe_account_id, stripe_charges_enabled, platform_fee_bps, ' +
  'bookings_enabled, ios_otid, address, phone, accent, daily_summary, ' +
  'store_enabled, store_pickup, store_pickup_note, store_shipping, shipping_flat_cents, ships_within_days';
const PRODUCT_COLS = 'id, shop_id, name, price_cents, description, photos, sold_out, active, sort, created_at, updated_at';
const ITEM_COLS = 'id, order_id, product_id, name, unit_price_cents, quantity, created_at';
const ORDER_COLS = '*';

type PgError = { code?: string; message?: string; details?: string } | null;

function fail(op: string, error: PgError): never {
  throw new Error(`store repo ${op} failed: ${error?.message ?? 'unknown'}`);
}

export function supabaseStoreRepo(client?: SupabaseClient): StoreRepo {
  let sb = client;
  const db = () => (sb ??= serviceClient());

  const one = async <T>(op: string, q: PromiseLike<{ data: unknown; error: PgError }>): Promise<T | null> => {
    const { data, error } = await q;
    if (error) fail(op, error);
    return (data as T) ?? null;
  };
  const many = async <T>(op: string, q: PromiseLike<{ data: unknown; error: PgError }>): Promise<T[]> => {
    const { data, error } = await q;
    if (error) fail(op, error);
    return (data as T[]) ?? [];
  };

  return {
    shopBySlug: (slug) => one('shopBySlug', db().from('ab_shops').select(SHOP_COLS).eq('slug', slug).maybeSingle()),
    shopById: (id) => one('shopById', db().from('ab_shops').select(SHOP_COLS).eq('id', id).maybeSingle()),
    shopByOwner: (userId) => one('shopByOwner', db().from('ab_shops').select(SHOP_COLS).eq('owner_id', userId).maybeSingle()),
    purchase: (otid) =>
      one('purchase', db().from('ios_purchases').select('user_id, product_id, revoked_at, taken_down_at, expires_at, site_slug, published_at, environment')
        .eq('original_transaction_id', otid).maybeSingle()),

    products: (shopId) =>
      many('products', db().from('ab_products').select(PRODUCT_COLS).eq('shop_id', shopId).order('sort').order('created_at')),
    async productsByIds(shopId, ids) {
      if (ids.length === 0) return [];
      return many('productsByIds', db().from('ab_products').select(PRODUCT_COLS).eq('shop_id', shopId).in('id', ids));
    },

    async createOrder(order, items) {
      const { data, error } = await db().rpc('ab_create_order', { p_order: order, p_items: items });
      if (error) fail('createOrder', error);
      const r = data as { order?: OrderRow; items?: OrderItemRow[]; existing?: boolean } | null;
      if (!r?.order) throw new Error('store repo createOrder failed: no order returned');
      return { order: r.order, items: r.items ?? [], existing: r.existing === true };
    },
    orderByClientKey: (shopId, clientKey) =>
      one('orderByClientKey', db().from('ab_orders').select(ORDER_COLS).eq('shop_id', shopId).eq('client_key', clientKey).maybeSingle()),
    orderById: (id) => one('orderById', db().from('ab_orders').select(ORDER_COLS).eq('id', id).maybeSingle()),
    orderByToken: (token) => one('orderByToken', db().from('ab_orders').select(ORDER_COLS).eq('manage_token', token).maybeSingle()),
    orderItems: (orderId) =>
      many('orderItems', db().from('ab_order_items').select(ITEM_COLS).eq('order_id', orderId).order('created_at').order('id')),

    async updateOrder(id, patch, g = {}) {
      let q = db().from('ab_orders').update(patch).eq('id', id);
      if (g.status) q = q.eq('status', g.status);
      if (g.statusIn) q = q.in('status', g.statusIn);
      if (g.paymentMethod) q = q.eq('payment_method', g.paymentMethod);
      if (g.notCard) q = q.or('payment_method.is.null,payment_method.neq.card');
      if (g.paymentStatusIn) q = q.in('payment_status', g.paymentStatusIn);
      if (g.paidCents != null) q = q.eq('amount_paid_cents', g.paidCents);
      if (g.refundedEq != null) q = q.eq('amount_refunded_cents', g.refundedEq);
      if (g.refundedLte != null) q = q.lte('amount_refunded_cents', g.refundedLte);
      if (g.refundDue != null) q = q.eq('refund_due_cents', g.refundDue);
      if (g.refundPending != null) q = q.eq('refund_pending', g.refundPending);
      if (g.notStuck) q = q.is('refund_stuck_at', null);
      if (g.saysPaidNull) q = q.is('customer_says_paid_at', null);
      if (g.sessionNull) q = q.is('stripe_checkout_session_id', null);
      const { data, error } = await q.select(ORDER_COLS);
      if (error) fail('updateOrder', error);
      const rows = (data as OrderRow[]) ?? [];
      return rows.length ? { ok: true, row: rows[0] } : { ok: false, reason: 'stale' };
    },
    staleOrderHolds: (createdBeforeIso, limit) =>
      many('staleOrderHolds', db().from('ab_orders').select(ORDER_COLS)
        .eq('status', 'new').eq('payment_method', 'card').eq('payment_status', 'awaiting').eq('amount_paid_cents', 0)
        .lt('created_at', createdBeforeIso).order('updated_at').limit(limit)),
    pendingOrderRefunds: (updatedBeforeIso, limit) =>
      many('pendingOrderRefunds', db().from('ab_orders').select(ORDER_COLS)
        .eq('refund_pending', true).not('stripe_payment_intent_id', 'is', null)
        .lt('updated_at', updatedBeforeIso).order('updated_at').limit(limit)),

    async logEvent(shopId, kind, payload) {
      const { error } = await db().from('ab_events').insert({ shop_id: shopId, kind, payload });
      if (error) fail('logEvent', error);
    },
  };
}
