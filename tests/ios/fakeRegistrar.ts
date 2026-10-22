// A stateful fake of lib/ios/vercelDomains.ts. Never touches Vercel. Like the real registrar:
// - a name can only be registered once (a double buy is observable as a second buy() call),
// - registrations expire, and Vercel AUTO-RENEWS one with renew=true when it reaches its expiry
//   (charging Ibrahim; see `charges`), lazily on any call after the clock passes it,
// - `years` on a buy registers for that many years,
// - owned() is null for a name that isn't ours or has expired.
import { vi } from 'vitest';
import { VercelApiError, type BuyResult, type VercelDomains } from '../../lib/ios/vercelDomains.js';

export type BuyMode =
  | 'ok'
  /** The order is placed and completes, but the response never arrives (timeout). */
  | 'lost-response'
  /** Network error, nothing placed. */
  | 'network'
  | { code: string; status?: number };

export const YEAR_MS = 365 * 24 * 3600_000;

export function fakeRegistrar(opts: { now: () => number; taken?: string[]; prices?: Record<string, { purchasePrice: unknown; renewalPrice: unknown }> }) {
  const registered = new Map<string, { boughtAt: number; expiresAt: number; renew: boolean }>();
  const taken = new Set(opts.taken ?? []);
  const orders = new Map<string, { domain: string; status: 'purchasing' | 'completed' | 'failed'; errorCode: string | null; years: number; renew: boolean }>();
  const projects = new Map<string, Map<string, { redirect: string | null }>>();
  const charges: { domain: string; kind: 'purchase' | 'renewal'; at: number }[] = [];
  const buyQueue: BuyMode[] = [];
  let orderMode: 'complete' | 'pending' | { failed: string } = 'complete';
  let attachFailures = 0;
  let n = 0;

  /** Vercel's own auto-renewal: every due registration with renew on gets another year. */
  function renewDue() {
    const t = opts.now();
    for (const [domain, r] of registered) {
      while (r.renew && r.expiresAt <= t) {
        r.expiresAt += YEAR_MS;
        charges.push({ domain, kind: 'renewal', at: t });
      }
    }
  }
  const live = (d: string) => {
    renewDue();
    const r = registered.get(d);
    return r && r.expiresAt > opts.now() ? r : null;
  };
  const register = (domain: string, years: number, renew: boolean) => {
    registered.set(domain, { boughtAt: opts.now(), expiresAt: opts.now() + years * YEAR_MS, renew });
    charges.push({ domain, kind: 'purchase', at: opts.now() });
  };
  const pendingOrder = (domain: string) => [...orders.values()].some((o) => o.domain === domain && o.status === 'purchasing');

  const api: VercelDomains = {
    availability: vi.fn(async (domains: string[]) => new Map(domains.map((d) => [d, !live(d) && !taken.has(d) && !pendingOrder(d)]))),
    prices: vi.fn(async (domains: string[]) => new Map(domains.map((d) => [d, opts.prices?.[d] ?? { purchasePrice: 11.25, renewalPrice: 11.25 }]))),
    buy: vi.fn(async (domain: string, b: { expectedPrice: number; autoRenew: boolean; years?: number }): Promise<BuyResult> => {
      const mode = buyQueue.shift() ?? 'ok';
      if (typeof mode === 'object') return { ok: false, code: mode.code, status: mode.status ?? 400, definite: (mode.status ?? 400) < 500 };
      if (mode === 'network') return { ok: false, code: 'network', status: 0, definite: false };
      if (live(domain) || taken.has(domain) || pendingOrder(domain)) return { ok: false, code: 'domain_not_available', status: 400, definite: true };
      const price = opts.prices?.[domain]?.purchasePrice ?? 11.25;
      if (b.expectedPrice !== price) return { ok: false, code: 'expected_price_mismatch', status: 400, definite: true };
      const orderId = `ord_${++n}`;
      const years = b.years ?? 1;
      if (orderMode === 'complete' || mode === 'lost-response') {
        orders.set(orderId, { domain, status: 'completed', errorCode: null, years, renew: b.autoRenew });
        register(domain, years, b.autoRenew);
      } else if (orderMode === 'pending') {
        orders.set(orderId, { domain, status: 'purchasing', errorCode: null, years, renew: b.autoRenew });
      } else {
        orders.set(orderId, { domain, status: 'failed', errorCode: orderMode.failed, years, renew: b.autoRenew });
      }
      if (mode === 'lost-response') return { ok: false, code: 'timeout', status: 0, definite: false };
      return { ok: true, orderId };
    }),
    order: vi.fn(async (orderId: string) => {
      const o = orders.get(orderId);
      if (!o) throw new VercelApiError(404, 'not_found');
      return { status: o.status, domainStatus: o.status === 'completed' ? 'completed' : o.status === 'failed' ? 'failed' : 'pending', errorCode: o.errorCode };
    }),
    owned: vi.fn(async (domain: string) => {
      const r = live(domain);
      return r ? { ...r } : null;
    }),
    listDomains: vi.fn(async () => {
      renewDue();
      return [...registered.entries()].map(([name, r]) => ({ name, boughtAt: r.boughtAt, expiresAt: r.expiresAt, renew: r.renew, serviceType: 'zeit.world' }));
    }),
    setAutoRenew: vi.fn(async (domain: string, on: boolean) => {
      const r = live(domain);
      if (!r) throw new VercelApiError(404, 'domain_not_found');
      r.renew = on;
    }),
    addProjectDomain: vi.fn(async (project: string, name: string, redirectTo?: string) => {
      if (attachFailures > 0) {
        attachFailures--;
        throw new VercelApiError(500, 'internal_server_error');
      }
      const p = projects.get(project) ?? new Map();
      projects.set(project, p);
      if (p.has(name)) return 'exists' as const;
      p.set(name, { redirect: redirectTo ?? null });
      return 'added' as const;
    }),
    removeProjectDomain: vi.fn(async (project: string, name: string) => (projects.get(project)?.delete(name) ? 'removed' as const : 'absent' as const)),
    projectDomain: vi.fn(async (project: string, name: string) => {
      const d = projects.get(project)?.get(name);
      return d ? { verified: true, redirect: d.redirect } : null;
    }),
    domainConfig: vi.fn(async () => ({ misconfigured: false })),
  };

  return {
    api,
    registered,
    projects,
    orders,
    charges,
    renewals: (domain: string) => charges.filter((c) => c.domain === domain && c.kind === 'renewal').length,
    queueBuy: (...modes: BuyMode[]) => buyQueue.push(...modes),
    setOrderMode: (m: typeof orderMode) => { orderMode = m; },
    completeOrders: () => {
      for (const o of orders.values()) if (o.status === 'purchasing') { o.status = 'completed'; register(o.domain, o.years, o.renew); }
    },
    failAttach: (times: number) => { attachFailures = times; },
    takeByStranger: (d: string) => taken.add(d),
    /** Seed a registration we already own (e.g. bought earlier, multi-year). */
    seed: (domain: string, years: number, renew: boolean) => register(domain, years, renew),
  };
}
