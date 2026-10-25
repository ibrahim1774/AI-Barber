/**
 * Customers are derived, not stored: a booking is the only place a customer exists. This file groups a shop's
 * appointment rows into people. Pure: no React, no logging, nothing leaves the device.
 */

export interface CustomerAppt {
  id: string; start: string; end: string; serviceName: string; priceCents: number | null; memberId: string;
  name: string | null; phone: string | null; email: string | null;
  status: 'booked' | 'done' | 'no_show' | 'cancelled'; cancelledBy: 'customer' | 'shop' | null;
  paymentStatus: string; paymentMethod: string | null;
  amountPaidCents: number; amountRefundedCents: number; source: 'online' | 'walk_in'; createdAt: string;
}

export interface Customer {
  /** Id of the customer's EARLIEST appointment (stable, opaque, non-PII). */
  id: string;
  /** Name on the most recently created booking. */
  name: string;
  /** Distinct other names, case-insensitive. */
  otherNames: string[];
  /** As typed, deduped by normalized key, most recent first. */
  emails: string[];
  phones: string[];
  /** Non-cancelled appointments (booked + done + no_show). */
  bookings: number;
  firstAt: string | null;
  lastAt: string | null;
  nextAt: string | null;
  paidCents: number;
  cancelled: number;
  noShows: number;
  /** All kept rows, start desc. */
  history: CustomerAppt[];
}

export function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length < 7 ? null : d;
}

export function normalizeEmail(raw: string | null): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  return e.includes('@') ? e : null;
}

/** A card checkout the customer walked away from (written by expireHold): not a real booking or cancellation. */
export function isAbandonedHold(a: CustomerAppt): boolean {
  return a.status === 'cancelled' && a.cancelledBy === 'customer' && a.paymentMethod === 'card' && a.amountPaidCents === 0;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function groupCustomers(rows: CustomerAppt[], nowIso: string): Customer[] {
  const kept = rows.filter((r) => !isAbandonedHold(r) && (normalizeEmail(r.email) || normalizePhone(r.phone)));
  const parent = kept.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const seen = new Map<string, number>();
  kept.forEach((r, i) => {
    const e = normalizeEmail(r.email);
    const p = normalizePhone(r.phone);
    for (const key of [e && `e:${e}`, p && `p:${p}`]) {
      if (!key) continue;
      const first = seen.get(key);
      if (first === undefined) seen.set(key, i);
      else parent[find(i)] = find(first);
    }
  });
  const groups = new Map<number, CustomerAppt[]>();
  kept.forEach((r, i) => {
    const g = find(i);
    groups.set(g, [...(groups.get(g) ?? []), r]);
  });

  const now = Date.parse(nowIso);
  const out: Customer[] = [];
  for (const g of groups.values()) {
    const byCreated = [...g].sort((a, b) => cmp(b.createdAt, a.createdAt));
    const live = g.filter((r) => r.status !== 'cancelled');
    const starts = live.map((r) => r.start).sort();
    const past = starts.filter((s) => Date.parse(s) <= now);
    const upcoming = g.filter((r) => r.status === 'booked' && Date.parse(r.start) > now).map((r) => r.start).sort();
    const name = byCreated.find((r) => r.name?.trim())?.name?.trim() ?? 'Customer';
    const names = new Set([name.toLowerCase()]);
    const otherNames: string[] = [];
    for (const r of byCreated) {
      const t = r.name?.trim();
      if (t && !names.has(t.toLowerCase())) { names.add(t.toLowerCase()); otherNames.push(t); }
    }
    const dedupe = (pick: (r: CustomerAppt) => string | null, norm: (s: string | null) => string | null) => {
      const keys = new Set<string>();
      const res: string[] = [];
      for (const r of byCreated) {
        const raw = pick(r);
        const k = norm(raw);
        if (raw && k && !keys.has(k)) { keys.add(k); res.push(raw.trim()); }
      }
      return res;
    };
    out.push({
      id: [...g].sort((a, b) => cmp(a.start, b.start) || cmp(a.id, b.id))[0].id,
      name,
      otherNames,
      emails: dedupe((r) => r.email, normalizeEmail),
      phones: dedupe((r) => r.phone, normalizePhone),
      bookings: live.length,
      firstAt: starts[0] ?? null,
      lastAt: past.length ? past[past.length - 1] : null,
      nextAt: upcoming[0] ?? null,
      paidCents: g.reduce((s, r) => s + Math.max(0, r.amountPaidCents - r.amountRefundedCents), 0),
      cancelled: g.filter((r) => r.status === 'cancelled').length,
      noShows: g.filter((r) => r.status === 'no_show').length,
      history: [...g].sort((a, b) => cmp(b.start, a.start)),
    });
  }
  return out.sort((a, b) => {
    if (a.lastAt && b.lastAt) return cmp(b.lastAt, a.lastAt) || cmp(a.id, b.id);
    if (a.lastAt) return -1;
    if (b.lastAt) return 1;
    return cmp(a.id, b.id);
  });
}

export type CustomerSort = 'recent' | 'bookings' | 'name' | 'paid';

export function filterCustomers(list: Customer[], query: string, sort: CustomerSort): Customer[] {
  const q = query.trim().toLowerCase();
  const qd = q.replace(/\D/g, '');
  const hit = (c: Customer) =>
    !q ||
    [c.name, ...c.otherNames, ...c.emails].some((s) => s.toLowerCase().includes(q)) ||
    (qd.length > 0 && c.phones.some((p) => p.replace(/\D/g, '').includes(qd)));
  const recent = (a: Customer, b: Customer) => cmp(b.lastAt ?? '', a.lastAt ?? '');
  const res = list.filter(hit);
  switch (sort) {
    case 'name': return res.sort((a, b) => a.name.localeCompare(b.name));
    case 'bookings': return res.sort((a, b) => b.bookings - a.bookings || recent(a, b));
    case 'paid': return res.sort((a, b) => b.paidCents - a.paidCents || recent(a, b));
    default: return res;
  }
}
