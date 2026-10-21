import { supabase } from '@/lib/supabase';

/**
 * STAND-IN for A3a's src/lib/store/data.ts (same exported names and types, from the
 * Phase 3 plan). The controller deletes this file at merge and points the imports of
 * `@/lib/store/data.stub-a3b` at `@/lib/store/data`. Only what Orders and Store setup
 * need is real here; the products functions are not used by A3b.
 */

export type Product = {
  id: string; shopId: string; name: string; priceCents: number; description: string;
  photos: string[]; soldOut: boolean; sort: number;
};
export type StoreSettings = {
  storeEnabled: boolean; pickup: boolean; pickupNote: string; shipping: boolean;
  shippingFlatCents: number | null; shipsWithinDays: number | null;
};
export type OrderStatus = 'new' | 'paid' | 'ready' | 'shipped' | 'done' | 'cancelled';
export type OrderItem = { productId: string | null; name: string; unitPriceCents: number; quantity: number };
export type Order = {
  id: string; number: number; status: OrderStatus; fulfilment: 'pickup' | 'shipping'; createdAt: string;
  customer: { name: string; phone: string; email: string }; note: string | null;
  shippingAddress: Record<string, string> | null;
  items: OrderItem[]; subtotalCents: number; shippingCents: number; totalCents: number;
  paymentStatus: 'none' | 'awaiting' | 'deposit' | 'paid' | 'refunded' | 'partially_refunded';
  paymentMethod: 'shop' | 'cashapp' | 'venmo' | 'zelle' | 'paypal' | 'card' | null;
  amountPaidCents: number; amountRefundedCents: number; refundPending: boolean;
  trackingNumber: string | null; trackingUrl: string | null; customerSaysPaidAt: string | null;
};

const SHOP_BASE = 'https://www.aibarber.org/shop';
export const shopUrl = (shop: { slug: string }): string => `${SHOP_BASE}/${shop.slug}`;

const fail = (error: { message?: string } | null): never => {
  throw new Error(error?.message || 'Something went wrong. Please try again.');
};

export async function loadStoreSettings(shopId: string): Promise<StoreSettings> {
  const { data, error } = await (supabase.from('ab_shops') as any)
    .select('store_enabled, store_pickup, store_pickup_note, store_shipping, shipping_flat_cents, ships_within_days')
    .eq('id', shopId)
    .maybeSingle();
  if (error) fail(error);
  const r = (data ?? {}) as Record<string, any>;
  return {
    storeEnabled: !!r.store_enabled,
    pickup: !!r.store_pickup,
    pickupNote: r.store_pickup_note ?? '',
    shipping: !!r.store_shipping,
    shippingFlatCents: r.shipping_flat_cents ?? null,
    shipsWithinDays: r.ships_within_days ?? null,
  };
}

export async function updateStoreSettings(shopId: string, s: Partial<StoreSettings>): Promise<void> {
  const o: Record<string, unknown> = {};
  if (s.storeEnabled !== undefined) o.store_enabled = s.storeEnabled;
  if (s.pickup !== undefined) o.store_pickup = s.pickup;
  if (s.pickupNote !== undefined) o.store_pickup_note = s.pickupNote || null;
  if (s.shipping !== undefined) o.store_shipping = s.shipping;
  if (s.shippingFlatCents !== undefined) o.shipping_flat_cents = s.shippingFlatCents;
  if (s.shipsWithinDays !== undefined) o.ships_within_days = s.shipsWithinDays;
  if (!Object.keys(o).length) return;
  const { error } = await (supabase.from('ab_shops') as any).update(o).eq('id', shopId);
  if (error) fail(error);
}

const ORDER_COLUMNS =
  'id, order_no, status, fulfilment, created_at, customer_name, customer_phone, customer_email, note, ' +
  'shipping_address, subtotal_cents, shipping_cents, total_cents, payment_status, payment_method, ' +
  'amount_paid_cents, amount_refunded_cents, refund_pending, tracking_number, tracking_url, customer_says_paid_at';

export function toOrder(r: Record<string, any>, items: Record<string, any>[]): Order {
  return {
    id: r.id,
    number: r.order_no ?? 0,
    status: r.status,
    fulfilment: r.fulfilment,
    createdAt: r.created_at,
    customer: { name: r.customer_name ?? '', phone: r.customer_phone ?? '', email: r.customer_email ?? '' },
    note: r.note ?? null,
    shippingAddress: r.shipping_address && typeof r.shipping_address === 'object' ? r.shipping_address : null,
    items: items.map((i) => ({
      productId: i.product_id ?? null, name: i.name ?? '', unitPriceCents: i.unit_price_cents ?? 0, quantity: i.quantity ?? 1,
    })),
    subtotalCents: r.subtotal_cents ?? 0,
    shippingCents: r.shipping_cents ?? 0,
    totalCents: r.total_cents ?? 0,
    paymentStatus: r.payment_status ?? 'none',
    paymentMethod: r.payment_method ?? null,
    amountPaidCents: r.amount_paid_cents ?? 0,
    amountRefundedCents: r.amount_refunded_cents ?? 0,
    refundPending: !!r.refund_pending,
    trackingNumber: r.tracking_number ?? null,
    trackingUrl: r.tracking_url ?? null,
    customerSaysPaidAt: r.customer_says_paid_at ?? null,
  };
}

async function withItems(rows: Record<string, any>[]): Promise<Order[]> {
  if (!rows.length) return [];
  const { data, error } = await (supabase.from('ab_order_items') as any)
    .select('order_id, product_id, name, unit_price_cents, quantity')
    .in('order_id', rows.map((r) => r.id));
  if (error) fail(error);
  const byOrder = new Map<string, Record<string, any>[]>();
  for (const i of (data ?? []) as Record<string, any>[]) {
    const list = byOrder.get(i.order_id) ?? [];
    list.push(i);
    byOrder.set(i.order_id, list);
  }
  return rows.map((r) => toOrder(r, byOrder.get(r.id) ?? []));
}

/** An unpaid card hold (card + awaiting + nothing paid) is invisible to the owner: keep every other row. */
const NOT_A_HOLD = 'payment_method.is.null,payment_method.neq.card,payment_status.neq.awaiting,amount_paid_cents.gt.0';

export async function listOrders(shopId: string, opts: { limit?: number; before?: string } = {}): Promise<Order[]> {
  let q = (supabase.from('ab_orders') as any)
    .select(ORDER_COLUMNS)
    .eq('shop_id', shopId)
    .or(NOT_A_HOLD)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 30);
  if (opts.before) q = q.lt('created_at', opts.before);
  const { data, error } = await q;
  if (error) fail(error);
  return withItems((data ?? []) as Record<string, any>[]);
}

export async function getOrder(id: string): Promise<Order | null> {
  const { data, error } = await (supabase.from('ab_orders') as any).select(ORDER_COLUMNS).eq('id', id).maybeSingle();
  if (error) fail(error);
  if (!data) return null;
  return (await withItems([data as Record<string, any>]))[0] ?? null;
}

export async function countNewOrders(shopId: string): Promise<number> {
  const { count, error } = await (supabase.from('ab_orders') as any)
    .select('id', { count: 'exact', head: true })
    .eq('shop_id', shopId)
    .eq('status', 'new')
    .or(NOT_A_HOLD);
  if (error) fail(error);
  return count ?? 0;
}

const notMine = (): never => {
  throw new Error('not-built: products live in A3a data.ts');
};
export const listProducts = async (_shopId: string): Promise<Product[]> => notMine();
export const addProduct = async (_shopId: string, _p: Omit<Product, 'id' | 'shopId' | 'sort'>): Promise<Product> => notMine();
export const updateProduct = async (_id: string, _p: Partial<Omit<Product, 'id' | 'shopId'>>): Promise<void> => notMine();
export const removeProduct = async (_id: string): Promise<void> => notMine();
export const reorderProducts = async (_ids: string[]): Promise<void> => notMine();
