import { normalizeEmail, normalizePhone } from '@/lib/bookings/customers';
import type { Order } from '@/lib/store/data';

/**
 * Store customers are derived, not stored: an order is the only place a buyer exists. Pure: no React, no logging,
 * nothing leaves the device. Abandoned card holds (card, nothing paid) and cancelled orders are left out.
 */
export interface StoreCustomer {
  /** The earliest order's UUID (opaque, never contact data). */
  id: string;
  /** First seen first; the rest show as "Also ordered as". */
  names: string[];
  emails: string[];
  phones: string[];
  orders: number;
  firstAt: string;
  lastAt: string;
  items: { name: string; quantity: number }[];
  totalCents: number;
  /** Sum of amountPaid - amountRefunded per order, floored at 0 per order. */
  paidCents: number;
  /** Orders whose payment is neither paid nor refunded. */
  unpaidOrders: number;
  orderIds: string[];
}

export type StoreCustomerSort = 'recent' | 'orders' | 'name' | 'spent';

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const SETTLED = new Set(['paid', 'refunded', 'partially_refunded', 'deposit']);

export const isAbandonedOrder = (o: Order): boolean => o.paymentMethod === 'card' && o.amountPaidCents === 0;

export function groupStoreCustomers(orders: Order[]): StoreCustomer[] {
  const kept = orders
    .filter((o) => o.status !== 'cancelled' && !isAbandonedOrder(o) && (normalizeEmail(o.customer.email) || normalizePhone(o.customer.phone)))
    .sort((a, b) => cmp(a.createdAt, b.createdAt) || cmp(a.id, b.id));
  const parent = kept.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const seen = new Map<string, number>();
  kept.forEach((o, i) => {
    const e = normalizeEmail(o.customer.email);
    const p = normalizePhone(o.customer.phone);
    for (const key of [e && `e:${e}`, p && `p:${p}`]) {
      if (!key) continue;
      const first = seen.get(key);
      if (first === undefined) seen.set(key, i);
      else parent[find(i)] = find(first);
    }
  });
  const groups = new Map<number, Order[]>();
  kept.forEach((o, i) => {
    const g = find(i);
    const arr = groups.get(g);
    if (arr) arr.push(o); else groups.set(g, [o]);
  });

  const out: StoreCustomer[] = [];
  for (const g of groups.values()) {
    const dedupe = (pick: (o: Order) => string, norm: (s: string | null) => string | null) => {
      const keys = new Set<string>();
      const res: string[] = [];
      for (const o of g) {
        const raw = pick(o);
        const k = norm(raw);
        if (k && !keys.has(k)) { keys.add(k); res.push(raw.trim()); }
      }
      return res;
    };
    const names: string[] = [];
    const nameKeys = new Set<string>();
    for (const o of g) {
      const n = o.customer.name.trim();
      if (n && !nameKeys.has(n.toLowerCase())) { nameKeys.add(n.toLowerCase()); names.push(n); }
    }
    const items = new Map<string, number>();
    for (const o of g) for (const i of o.items) items.set(i.name, (items.get(i.name) ?? 0) + i.quantity);
    out.push({
      id: g[0].id,
      names: names.length ? names : ['Customer'],
      emails: dedupe((o) => o.customer.email, normalizeEmail),
      phones: dedupe((o) => o.customer.phone, normalizePhone),
      orders: g.length,
      firstAt: g[0].createdAt,
      lastAt: g[g.length - 1].createdAt,
      items: [...items].map(([name, quantity]) => ({ name, quantity })),
      totalCents: g.reduce((s, o) => s + o.totalCents, 0),
      paidCents: g.reduce((s, o) => s + Math.max(0, o.amountPaidCents - o.amountRefundedCents), 0),
      unpaidOrders: g.filter((o) => !SETTLED.has(o.paymentStatus)).length,
      orderIds: g.map((o) => o.id),
    });
  }
  return out.sort((a, b) => cmp(b.lastAt, a.lastAt) || cmp(a.id, b.id));
}

export function filterStoreCustomers(list: StoreCustomer[], query: string, sort: StoreCustomerSort): StoreCustomer[] {
  const q = query.trim().toLowerCase();
  // Digits only match phones when the query itself looks like a phone number.
  const qd = /^[\d\s()+.-]+$/.test(q) ? q.replace(/\D/g, '') : '';
  const hit = (c: StoreCustomer) =>
    !q || [...c.names, ...c.emails].some((s) => s.toLowerCase().includes(q)) ||
    (qd.length >= 3 && c.phones.some((p) => p.replace(/\D/g, '').includes(qd)));
  const recent = (a: StoreCustomer, b: StoreCustomer) => cmp(b.lastAt, a.lastAt);
  const res = list.filter(hit);
  switch (sort) {
    case 'name': return res.sort((a, b) => a.names[0].localeCompare(b.names[0]));
    case 'orders': return res.sort((a, b) => b.orders - a.orders || recent(a, b));
    case 'spent': return res.sort((a, b) => b.paidCents - a.paidCents || recent(a, b));
    default: return res.sort(recent);
  }
}
