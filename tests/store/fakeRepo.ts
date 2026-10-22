// In-memory StoreRepo for the store API tests. Emulates the database rules the API relies on:
// the per-shop order counter (starts at 1000, bumped before it is assigned, like 009's trigger),
// ab_create_order's look-first on (shop_id, client_key), the generated refund_pending flag, the
// 009 checks the flows could trip (cancelled_by needs status 'cancelled', client_key format,
// shipping needs an address object), compare-and-set guards and updated_at on every update.
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import type { PurchaseGateRow } from '../../lib/bookings/repo.js';
import type { StoreOwnerDeps } from '../../lib/store/core.js';
import type { NewOrder, NewOrderItem, OrderGuard, StoreRepo } from '../../lib/store/repo.js';
import type { OrderItemRow, OrderRow, ProductRow, ShopStoreRow, StoreNotifyEvent } from '../../lib/store/types.js';

export interface StoreState {
  shops: ShopStoreRow[];
  products: ProductRow[];
  orders: OrderRow[];
  items: OrderItemRow[];
  purchases: Record<string, PurchaseGateRow>;
  events: { shop_id: string | null; kind: string; payload: Record<string, unknown> }[];
  seq: Record<string, number>;
}

const tok = () => randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
const clone = <T>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)));
const gen = (o: OrderRow): OrderRow => ({ ...o, refund_pending: o.refund_due_cents > o.amount_refunded_cents && o.refund_stuck_at == null });
const CLIENT_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function matchesGuard(cur: OrderRow, g: OrderGuard): boolean {
  const c = gen(cur);
  return (!g.status || c.status === g.status)
    && (!g.statusIn || g.statusIn.includes(c.status))
    && (!g.paymentMethod || c.payment_method === g.paymentMethod)
    && (!g.notCard || c.payment_method !== 'card')
    && (!g.paymentStatusIn || g.paymentStatusIn.includes(c.payment_status))
    && (g.paidCents == null || c.amount_paid_cents === g.paidCents)
    && (g.refundedEq == null || c.amount_refunded_cents === g.refundedEq)
    && (g.refundedLte == null || c.amount_refunded_cents <= g.refundedLte)
    && (g.refundDue == null || c.refund_due_cents === g.refundDue)
    && (g.refundPending == null || c.refund_pending === g.refundPending)
    && (!g.notStuck || c.refund_stuck_at == null)
    && (!g.saysPaidNull || c.customer_says_paid_at == null)
    && (!g.sessionNull || c.stripe_checkout_session_id == null);
}

export function fakeStoreRepo(state: StoreState, nowFn: () => number = Date.now): StoreRepo {
  const nowIso = () => new Date(nowFn()).toISOString();
  const itemsOf = (orderId: string) => state.items.filter((i) => i.order_id === orderId);

  return {
    shopBySlug: async (slug) => clone(state.shops.find((s) => s.slug === slug) ?? null),
    shopById: async (id) => clone(state.shops.find((s) => s.id === id) ?? null),
    shopByOwner: async (id) => clone(state.shops.find((s) => s.owner_id === id) ?? null),
    purchase: async (otid) => clone(state.purchases[otid] ?? null),

    products: async (shopId) =>
      clone(state.products.filter((p) => p.shop_id === shopId)
        .sort((a, b) => a.sort - b.sort || Date.parse(a.created_at!) - Date.parse(b.created_at!))),
    productsByIds: async (shopId, ids) => clone(state.products.filter((p) => p.shop_id === shopId && ids.includes(p.id))),

    async createOrder(order: NewOrder, items: NewOrderItem[]) {
      if (items.length === 0) throw new Error('ab_create_order: invalid arguments');
      if (order.client_key != null) {
        const ex = state.orders.find((o) => o.shop_id === order.shop_id && o.client_key === order.client_key);
        if (ex) return { order: clone(gen(ex)), items: clone(itemsOf(ex.id)), existing: true };
        if (!CLIENT_KEY_RE.test(order.client_key)) throw new Error('check: ab_orders_client_key_fmt');
      }
      if (order.fulfilment === 'shipping' && (order.shipping_address == null || typeof order.shipping_address !== 'object')) {
        throw new Error('check: shipping needs an address');
      }
      if (items.some((i) => i.quantity < 1 || i.quantity > 10)) throw new Error('check: ab_order_items_qty_max');
      const n = (state.seq[order.shop_id] ?? 1000) + 1;
      state.seq[order.shop_id] = n;
      const t = nowIso();
      const row: OrderRow = gen({
        id: randomUUID(), tracking_number: null, tracking_url: null, amount_paid_cents: 0, amount_refunded_cents: 0,
        stripe_payment_intent_id: null, stripe_checkout_session_id: null, manage_token: tok(), created_at: t, updated_at: t,
        order_no: n, customer_says_paid_at: null, paid_at: null, ready_at: null, shipped_at: null, done_at: null,
        cancelled_at: null, cancelled_by: null, refund_due_cents: 0, refund_requested_at: null, refund_stuck_at: null,
        refund_pending: false, checkout_url: null, ...clone(order),
      });
      state.orders.push(row);
      for (const it of items) state.items.push({ id: randomUUID(), order_id: row.id, created_at: t, ...clone(it) });
      return { order: clone(row), items: clone(itemsOf(row.id)), existing: false };
    },
    orderByClientKey: async (shopId, key) =>
      clone(state.orders.find((o) => o.shop_id === shopId && o.client_key === key) ?? null),
    orderById: async (id) => clone(state.orders.find((o) => o.id === id) ?? null),
    orderByToken: async (t) => clone(state.orders.find((o) => o.manage_token === t) ?? null),
    orderItems: async (orderId) => clone(itemsOf(orderId)),

    async updateOrder(id, patch, g = {}) {
      const cur = state.orders.find((o) => o.id === id);
      if (!cur || !matchesGuard(cur, g)) return { ok: false, reason: 'stale' };
      const next = gen({ ...cur, ...patch } as OrderRow);
      if (next.cancelled_by != null && next.status !== 'cancelled') throw new Error('check: ab_orders_cancelled_by');
      if (next.refund_due_cents < 0) throw new Error('check: ab_orders_refund_due_nonneg');
      Object.assign(cur, next, { updated_at: nowIso() });
      return { ok: true, row: clone(cur) };
    },
    staleOrderHolds: async (before, limit) =>
      clone(state.orders.filter((o) => o.status === 'new' && o.payment_method === 'card' && o.payment_status === 'awaiting'
        && o.amount_paid_cents === 0 && Date.parse(o.created_at) < Date.parse(before))
        .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at)).slice(0, limit)),
    pendingOrderRefunds: async (before, limit) =>
      clone(state.orders.map(gen).filter((o) => o.refund_pending && o.stripe_payment_intent_id != null
        && Date.parse(o.updated_at) < Date.parse(before))
        .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at)).slice(0, limit)),

    refundAttempts: async (key: string) => state.events.filter((e) => e.kind === 'refund_5xx' && e.payload.key === key).length,
    async logEvent(shopId, kind, payload) {
      state.events.push({ shop_id: shopId, kind, payload });
    },
  };
}

export const OWNER_USER = '11111111-1111-4111-8111-111111111111';
export const OTHER_USER = '22222222-2222-4222-8222-222222222222';
export const OTID = '2000000123456789';

export function makeStoreShop(p: Partial<ShopStoreRow> & { id: string }): ShopStoreRow {
  return {
    owner_id: randomUUID(), site_id: null, slug: 'fresh-cuts', name: 'Fresh Cuts', timezone: 'America/New_York',
    currency: 'usd', lead_days: 30, min_notice_min: 120, buffer_min: 0, cancel_cutoff_min: 120, slot_step_min: null,
    pay_in_shop: true, manual_handles: { cashapp: '$freshcuts' }, stripe_account_id: 'acct_1', stripe_charges_enabled: true,
    platform_fee_bps: 200, bookings_enabled: false, ios_otid: null, address: '1 Main St', phone: '555-0100', accent: '#112233',
    daily_summary: false,
    store_enabled: true, store_pickup: true, store_pickup_note: 'Ring the bell', store_shipping: true,
    shipping_flat_cents: 500, ships_within_days: 3,
    ...p,
  };
}

let created = Date.parse('2026-10-01T00:00:00Z');
export function makeProduct(p: Partial<ProductRow> & { id: string; shop_id: string }): ProductRow {
  created += 1000;
  return {
    name: 'Beard oil', price_cents: 1500, description: null, photos: [], sold_out: false, active: true, sort: 0,
    created_at: new Date(created).toISOString(), updated_at: new Date(created).toISOString(), ...p,
  };
}

/**
 * A live store: Fresh Cuts (pickup + $5 flat shipping, Cash App, card, in-shop pay) with Beard oil
 * $15, Balm $20, a sold-out Pomade $10 and an inactive Comb $5, plus another shop with its own
 * product. "Now" is 2026-11-02 12:00Z.
 */
export function storeWorld(over: { shop?: Partial<ShopStoreRow> } = {}) {
  const shopId = randomUUID();
  const otherShopId = randomUUID();
  const ids = {
    shopId, otherShopId,
    oil: randomUUID(), balm: randomUUID(), pomade: randomUUID(), comb: randomUUID(), foreign: randomUUID(),
  };
  const state: StoreState = {
    shops: [
      makeStoreShop({ id: shopId, owner_id: OWNER_USER, ios_otid: OTID, ...over.shop }),
      makeStoreShop({ id: otherShopId, owner_id: OTHER_USER, slug: 'other-shop', name: 'Other', ios_otid: '2000000999' }),
    ],
    products: [
      makeProduct({ id: ids.oil, shop_id: shopId, name: 'Beard oil', price_cents: 1500, sort: 0, photos: ['https://img/oil-1.jpg', 'http://img/insecure.jpg', 'https://img/oil-2.jpg'] }),
      makeProduct({ id: ids.balm, shop_id: shopId, name: 'Balm', price_cents: 2000, sort: 1, description: 'Soft hold' }),
      makeProduct({ id: ids.pomade, shop_id: shopId, name: 'Pomade', price_cents: 1000, sort: 2, sold_out: true }),
      makeProduct({ id: ids.comb, shop_id: shopId, name: 'Comb', price_cents: 500, sort: 3, active: false }),
      makeProduct({ id: ids.foreign, shop_id: otherShopId, name: 'Theirs', price_cents: 900 }),
    ],
    orders: [],
    items: [],
    purchases: {
      [OTID]: { user_id: OWNER_USER, product_id: 'com.ibrahim1774.aibarber.store.monthly', revoked_at: null, taken_down_at: null },
      '2000000999': { user_id: OTHER_USER, product_id: 'com.ibrahim1774.aibarber.store.monthly', revoked_at: null, taken_down_at: null },
    },
    events: [],
    seq: {},
  };
  let nowMs = Date.parse('2026-11-02T12:00:00Z');
  const notified: StoreNotifyEvent[] = [];
  const payments = {
    createOrderCheckout: vi.fn(async (_s: any, o: { id: string }, _i: any[]) => ({ url: `https://checkout.stripe.test/${o.id}`, sessionId: `cs_${o.id}` })),
    refundOrder: vi.fn(async (_s: any, _o: any, c: number, _opts: { idempotencyKey: string }) => ({ refundedCents: c })),
    expireCheckoutSession: vi.fn(async (_s: any, _id: string) => true),
    closeCheckoutSession: vi.fn(async (_s: any, _id: string): Promise<'expired' | 'complete' | 'unknown'> => 'expired'),
  };
  const limits = { shopOrder: vi.fn(async (_shopId: string) => true) };
  const users: Record<string, { id: string; email: string | null; fullName: string | null }> = {
    'owner-jwt': { id: OWNER_USER, email: 'mike@example.com', fullName: 'Mike Fade' },
    'other-jwt': { id: OTHER_USER, email: 'o@example.com', fullName: 'Other' },
    'noshop-jwt': { id: randomUUID(), email: 'n@example.com', fullName: null },
  };
  const deps: StoreOwnerDeps = {
    repo: fakeStoreRepo(state, () => nowMs),
    payments,
    notify: vi.fn(async (e: StoreNotifyEvent) => { notified.push(e); }),
    now: () => nowMs,
    baseUrl: 'https://www.aibarber.org',
    limits,
    getUser: async (jwt) => users[jwt] ?? null,
    sleep: vi.fn(async (_ms: number) => {}),
  };
  return {
    state, deps, payments, notified, limits, ids,
    setNow: (iso: string) => { nowMs = Date.parse(iso); },
    shop: () => state.shops[0],
    order: (id: string) => state.orders.find((o) => o.id === id)!,
  };
}

export type StoreWorld = ReturnType<typeof storeWorld>;
