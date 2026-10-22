// A stateful fake of lib/ios/vercelDomains.ts. Never touches Vercel. A name can only be
// registered once (like the real registry), so a double buy is observable as a second buy() call.
import { vi } from 'vitest';
import { VercelApiError, type BuyResult, type VercelDomains } from '../../lib/ios/vercelDomains.js';

export type BuyMode =
  | 'ok'
  /** The order is placed and completes, but the response never arrives (timeout). */
  | 'lost-response'
  /** Network error, nothing placed. */
  | 'network'
  | { code: string; status?: number };

export function fakeRegistrar(opts: { now: () => number; taken?: string[]; prices?: Record<string, { purchasePrice: unknown; renewalPrice: unknown }> }) {
  const YEAR = 365 * 24 * 3600_000;
  const registered = new Map<string, { boughtAt: number; expiresAt: number; renew: boolean }>();
  const taken = new Set(opts.taken ?? []);
  const orders = new Map<string, { domain: string; status: 'purchasing' | 'completed' | 'failed'; errorCode: string | null }>();
  const projects = new Map<string, Map<string, { redirect: string | null }>>();
  const buyQueue: BuyMode[] = [];
  let orderMode: 'complete' | 'pending' | { failed: string } = 'complete';
  let attachFailures = 0;
  let n = 0;

  const register = (domain: string, renew: boolean) => {
    registered.set(domain, { boughtAt: opts.now(), expiresAt: opts.now() + YEAR, renew });
  };

  const api: VercelDomains = {
    availability: vi.fn(async (domains: string[]) => new Map(domains.map((d) => [d, !registered.has(d) && !taken.has(d) && !pendingOrder(d)]))),
    prices: vi.fn(async (domains: string[]) => new Map(domains.map((d) => [d, opts.prices?.[d] ?? { purchasePrice: 11.25, renewalPrice: 11.25 }]))),
    buy: vi.fn(async (domain: string, b: { expectedPrice: number; autoRenew: boolean }): Promise<BuyResult> => {
      const mode = buyQueue.shift() ?? 'ok';
      if (typeof mode === 'object') return { ok: false, code: mode.code, status: mode.status ?? 400, definite: (mode.status ?? 400) < 500 };
      if (mode === 'network') return { ok: false, code: 'network', status: 0, definite: false };
      if (registered.has(domain) || taken.has(domain) || pendingOrder(domain)) return { ok: false, code: 'domain_not_available', status: 400, definite: true };
      const price = opts.prices?.[domain]?.purchasePrice ?? 11.25;
      if (b.expectedPrice !== price) return { ok: false, code: 'expected_price_mismatch', status: 400, definite: true };
      const orderId = `ord_${++n}`;
      if (orderMode === 'complete' || mode === 'lost-response') {
        orders.set(orderId, { domain, status: 'completed', errorCode: null });
        register(domain, b.autoRenew);
      } else if (orderMode === 'pending') {
        orders.set(orderId, { domain, status: 'purchasing', errorCode: null });
      } else {
        orders.set(orderId, { domain, status: 'failed', errorCode: orderMode.failed });
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
      const r = registered.get(domain);
      return r ? { ...r } : null;
    }),
    setAutoRenew: vi.fn(async (domain: string, on: boolean) => {
      const r = registered.get(domain);
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

  function pendingOrder(domain: string) {
    return [...orders.values()].some((o) => o.domain === domain && o.status === 'purchasing');
  }

  return {
    api,
    registered,
    projects,
    orders,
    queueBuy: (...modes: BuyMode[]) => buyQueue.push(...modes),
    setOrderMode: (m: typeof orderMode) => { orderMode = m; },
    completeOrders: () => {
      for (const o of orders.values()) if (o.status === 'purchasing') { o.status = 'completed'; register(o.domain, true); }
    },
    failAttach: (times: number) => { attachFailures = times; },
    takeByStranger: (d: string) => taken.add(d),
  };
}
