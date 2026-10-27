import { describe, it, expect, vi } from 'vitest';

// A table of cancelled card bookings; the fake applies the filters the way PostgREST would, using the generated column from 006.
const rows: any[] = [];
const scanned: string[] = [];
vi.mock('../../lib/bookings/repo.js', () => ({
  serviceClient: () => ({
    from: () => {
      const eqs: Array<[string, unknown]> = []; let orExpr = ''; let from = 0; let to = 0;
      const b: any = {
        select: () => b, eq: (c: string, v: unknown) => { eqs.push([c, v]); return b; },
        or: (e: string) => { orExpr = e; return b; }, order: () => b,
        range: (f: number, t: number) => { from = f; to = t; return b; },
        then: (res: any, rej: any) => {
          const pending = (r: any) => r.refund_due_cents > r.amount_refunded_cents && r.refund_stuck_at == null; // generated refund_pending
          const ok = (r: any) => eqs.every(([c, v]) => r[c] === v) && orExpr.split(',').some((p) =>
            p === 'refund_pending.eq.true' ? pending(r)
              : p === 'refund_stuck_at.not.is.null' ? r.refund_stuck_at != null
                : p === 'refund_due_cents.gt.0' ? r.refund_due_cents > 0 : false);
          const page = rows.filter(ok).sort((a, z) => (a.id < z.id ? -1 : 1)).slice(from, to + 1);
          page.forEach((r) => scanned.push(r.id));
          return Promise.resolve({ data: page, error: null }).then(res, rej);
        },
      };
      return b;
    },
  }),
}));

import { liveBookingQueries } from '../../lib/ios/closeShop.js';

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, shop_id: 's1', status: 'cancelled', payment_method: 'card', refund_due_cents: 0, amount_refunded_cents: 0, refund_stuck_at: null, ...over,
});

describe('owingCardIds only looks at rows that can still owe (round 3, finding 2)', () => {
  it('fully refunded cancellations are not scanned; owing and stuck-owing rows are returned', async () => {
    for (let i = 0; i < 250; i++) rows.push(row(`done-${String(i).padStart(3, '0')}`, { refund_due_cents: 2000, amount_refunded_cents: 2000 }));
    rows.push(row('z-owing', { refund_due_cents: 2000, amount_refunded_cents: 500 }));
    rows.push(row('z-stuck', { refund_due_cents: 2000, amount_refunded_cents: 0, refund_stuck_at: '2026-10-01T00:00:00Z' }));
    rows.push(row('z-stuck-but-paid-back', { refund_due_cents: 2000, amount_refunded_cents: 2000, refund_stuck_at: '2026-10-01T00:00:00Z' }));
    const ids = await liveBookingQueries().owingCardIds('s1', 100);
    expect(ids).toEqual(['z-owing', 'z-stuck']);
    expect(scanned.filter((id) => id.startsWith('done-'))).toEqual([]);
  });
});
