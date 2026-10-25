import { supabase } from '@/lib/supabase';
import { fetchAllPages } from '@/lib/bookings/api';

/**
 * Supabase data layer for the Store (ab_products, ab_orders, ab_order_items and
 * the store columns of ab_shops), under RLS. Products are written directly;
 * orders are READ-only here (owners have no write grant): every order change
 * goes through the /api/shop/orders/* endpoints. Shop updates send only the
 * columns `authenticated` may write, never slug, order_seq or platform_fee_bps.
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
  customer: { name: string; phone: string; email: string }; note: string | null; shippingAddress: Record<string, string> | null;
  items: OrderItem[]; subtotalCents: number; shippingCents: number; totalCents: number;
  paymentStatus: 'none' | 'awaiting' | 'deposit' | 'paid' | 'refunded' | 'partially_refunded';
  paymentMethod: 'shop' | 'cashapp' | 'venmo' | 'zelle' | 'paypal' | 'card' | null;
  amountPaidCents: number; amountRefundedCents: number; refundPending: boolean; refundStuck: boolean;
  trackingNumber: string | null; trackingUrl: string | null; customerSaysPaidAt: string | null;
};

const SHOP_BASE = 'https://www.aibarber.org/shop';

/** The public shop page: https://www.aibarber.org/shop/{slug}. */
export function shopUrl(shop: { slug: string }): string {
  return `${SHOP_BASE}/${shop.slug}`;
}

/** Logs the raw database error; the barber only ever sees the friendly line. */
function fail(error: { message?: string } | null): never {
  console.warn('[store] request failed', error);
  throw new Error("Couldn't save that. Check your connection and try again.");
}

// ---- settings ------------------------------------------------------------

const SETTINGS_COLUMNS = 'store_enabled, store_pickup, store_pickup_note, store_shipping, shipping_flat_cents, ships_within_days';

export async function loadStoreSettings(shopId: string): Promise<StoreSettings> {
  const { data, error } = await supabase.from('ab_shops').select(SETTINGS_COLUMNS).eq('id', shopId).maybeSingle();
  if (error) fail(error);
  const r = (data ?? {}) as Record<string, any>;
  return {
    storeEnabled: !!r.store_enabled,
    pickup: r.store_pickup !== false,
    pickupNote: r.store_pickup_note ?? '',
    shipping: !!r.store_shipping,
    shippingFlatCents: r.shipping_flat_cents ?? null,
    shipsWithinDays: r.ships_within_days ?? null,
  };
}

export function storeSettingsRow(s: Partial<StoreSettings>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (s.storeEnabled !== undefined) o.store_enabled = s.storeEnabled;
  if (s.pickup !== undefined) o.store_pickup = s.pickup;
  if (s.pickupNote !== undefined) o.store_pickup_note = s.pickupNote.trim() || null;
  if (s.shipping !== undefined) o.store_shipping = s.shipping;
  if (s.shippingFlatCents !== undefined) o.shipping_flat_cents = s.shippingFlatCents;
  if (s.shipsWithinDays !== undefined) o.ships_within_days = s.shipsWithinDays;
  return o;
}

export async function updateStoreSettings(shopId: string, s: Partial<StoreSettings>): Promise<void> {
  const row = storeSettingsRow(s);
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase.from('ab_shops').update(row).eq('id', shopId);
  if (error) fail(error);
}

// ---- products ------------------------------------------------------------

export function toProduct(r: Record<string, any>): Product {
  return {
    id: r.id,
    shopId: r.shop_id,
    name: r.name ?? '',
    priceCents: r.price_cents ?? 0,
    description: r.description ?? '',
    photos: Array.isArray(r.photos) ? r.photos : [],
    soldOut: !!r.sold_out,
    sort: r.sort ?? 0,
  };
}

const productRow = (p: Partial<Omit<Product, 'id' | 'shopId'>>) => {
  const o: Record<string, unknown> = {};
  if (p.name !== undefined) o.name = p.name;
  if (p.priceCents !== undefined) o.price_cents = p.priceCents;
  if (p.description !== undefined) o.description = p.description || null;
  if (p.photos !== undefined) o.photos = p.photos;
  if (p.soldOut !== undefined) o.sold_out = p.soldOut;
  if (p.sort !== undefined) o.sort = p.sort;
  return o;
};

/** Active products, in the barber's order. */
export async function listProducts(shopId: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from('ab_products').select('*').eq('shop_id', shopId).eq('active', true).order('sort', { ascending: true });
  if (error) fail(error);
  return ((data ?? []) as Record<string, any>[]).map(toProduct);
}

/** Appends after the last product. */
export async function addProduct(shopId: string, p: Omit<Product, 'id' | 'shopId' | 'sort'>): Promise<Product> {
  const last = await supabase
    .from('ab_products').select('sort').eq('shop_id', shopId).eq('active', true).order('sort', { ascending: false }).limit(1);
  if (last.error) fail(last.error);
  const top = ((last.data ?? []) as { sort: number }[])[0]?.sort;
  const { data, error } = await supabase
    .from('ab_products').insert({ shop_id: shopId, ...productRow(p), sort: top == null ? 0 : top + 1 }).select('*').single();
  if (error) fail(error);
  return toProduct(data as Record<string, any>);
}

export async function updateProduct(id: string, p: Partial<Omit<Product, 'id' | 'shopId'>>): Promise<void> {
  const row = productRow(p);
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase.from('ab_products').update(row).eq('id', id);
  if (error) fail(error);
}

/** Soft delete: past orders keep their item snapshot and the FK stays valid. */
export async function removeProduct(id: string): Promise<void> {
  const { error } = await supabase.from('ab_products').update({ active: false }).eq('id', id);
  if (error) fail(error);
}

export async function reorderProducts(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    const { error } = await supabase.from('ab_products').update({ sort: i }).eq('id', ids[i]);
    if (error) fail(error);
  }
}

// ---- orders (read only) ---------------------------------------------------

/**
 * Hides unpaid card holds (card + awaiting + nothing paid): the owner never
 * sees them. PostgREST can't express "not (a and b and c)" on nullable
 * columns any other way, so each term is spelled out with its NULL case.
 */
export const VISIBLE_ORDERS_FILTER =
  'payment_method.is.null,payment_method.neq.card,amount_paid_cents.gt.0';

export function toOrder(r: Record<string, any>, items: Record<string, any>[]): Order {
  const addr = r.shipping_address && typeof r.shipping_address === 'object' && Object.keys(r.shipping_address).length > 0
    ? (r.shipping_address as Record<string, string>)
    : null;
  return {
    id: r.id,
    number: r.order_no ?? 0,
    status: r.status ?? 'new',
    fulfilment: r.fulfilment === 'shipping' ? 'shipping' : 'pickup',
    createdAt: r.created_at ?? '',
    customer: { name: r.customer_name ?? '', phone: r.customer_phone ?? '', email: r.customer_email ?? '' },
    note: r.note ?? null,
    shippingAddress: addr,
    items: items.map((i) => ({
      productId: i.product_id ?? null,
      name: i.name ?? '',
      unitPriceCents: i.unit_price_cents ?? 0,
      quantity: i.quantity ?? 1,
    })),
    subtotalCents: r.subtotal_cents ?? 0,
    shippingCents: r.shipping_cents ?? 0,
    totalCents: r.total_cents ?? 0,
    paymentStatus: r.payment_status ?? 'none',
    paymentMethod: r.payment_method ?? null,
    amountPaidCents: r.amount_paid_cents ?? 0,
    amountRefundedCents: r.amount_refunded_cents ?? 0,
    refundPending: !!r.refund_pending,
    refundStuck: r.refund_stuck_at != null && (r.refund_due_cents ?? 0) > (r.amount_refunded_cents ?? 0),
    trackingNumber: r.tracking_number ?? null,
    trackingUrl: r.tracking_url ?? null,
    customerSaysPaidAt: r.customer_says_paid_at ?? null,
  };
}

async function itemsFor(orderIds: string[]): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = [];
  // Small batches, each read in full pages: PostgREST cuts a response at max_rows (1000) without an error.
  for (let i = 0; i < orderIds.length; i += 100) {
    const batch = orderIds.slice(i, i + 100);
    out.push(
      ...(await fetchAllPages(async (from, to) => {
        const { data, error } = await supabase
          .from('ab_order_items').select('*').in('order_id', batch).order('id', { ascending: true }).range(from, to);
        if (error) fail(error);
        return (data ?? []) as Record<string, any>[];
      })),
    );
  }
  return out;
}

/** Items grouped by order id (one pass, not a filter per order). */
function byOrder(items: Record<string, any>[]): Map<string, Record<string, any>[]> {
  const m = new Map<string, Record<string, any>[]>();
  for (const it of items) {
    const arr = m.get(it.order_id);
    if (arr) arr.push(it); else m.set(it.order_id, [it]);
  }
  return m;
}

/** Newest first; `before` is the createdAt of the last row already shown. */
export async function listOrders(shopId: string, opts: { limit?: number; before?: string } = {}): Promise<Order[]> {
  let q = supabase
    .from('ab_orders').select('*').eq('shop_id', shopId).or(VISIBLE_ORDERS_FILTER)
    .order('created_at', { ascending: false }).limit(opts.limit ?? 50);
  if (opts.before) q = q.lt('created_at', opts.before);
  const { data, error } = await q;
  if (error) fail(error);
  const rows = (data ?? []) as Record<string, any>[];
  const items = await itemsFor(rows.map((r) => r.id));
  const grouped = byOrder(items);
  return rows.map((r) => toOrder(r, grouped.get(r.id) ?? []));
}

/**
 * Whether the shop has any order row at all (one limit-1 read, deliberately without the visible
 * filter), so closing the shop or losing the plan never hides orders the barber must still handle.
 */
export async function hasAnyOrders(shopId: string): Promise<boolean> {
  const { data, error } = await supabase.from('ab_orders').select('id').eq('shop_id', shopId).limit(1);
  if (error) fail(error);
  return (data ?? []).length > 0;
}

export async function getOrder(id: string): Promise<Order | null> {
  const { data, error } = await supabase.from('ab_orders').select('*').eq('id', id).or(VISIBLE_ORDERS_FILTER).maybeSingle();
  if (error) fail(error);
  if (!data) return null;
  const items = await itemsFor([id]);
  return toOrder(data as Record<string, any>, items);
}

export async function countNewOrders(shopId: string): Promise<number> {
  const { count, error } = await supabase
    .from('ab_orders').select('id', { count: 'exact', head: true })
    .eq('shop_id', shopId).eq('status', 'new').or(VISIBLE_ORDERS_FILTER);
  if (error) fail(error);
  return count ?? 0;
}

/**
 * Every visible order of the shop (all pages, newest first) with its items, for the Customers tab.
 * Same visibility rule as listOrders, so abandoned card holds never arrive.
 */
export async function listAllOrders(shopId: string): Promise<Order[]> {
  const rows = await fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('ab_orders').select('*').eq('shop_id', shopId).or(VISIBLE_ORDERS_FILTER)
      .order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to);
    if (error) fail(error);
    return (data ?? []) as Record<string, any>[];
  });
  const grouped = byOrder(await itemsFor(rows.map((r) => r.id)));
  return rows.map((r) => toOrder(r, grouped.get(r.id) ?? []));
}
