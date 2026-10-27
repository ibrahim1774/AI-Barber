import { describe, it, expect, vi } from 'vitest';
import { liveClosureEnv } from '../../lib/ios/closeShop.js';

const H = 3600_000;
const T0 = Date.parse('2026-10-20T12:00:00Z');

/** Just enough of the Supabase builder for the ab_events calls liveClosureEnv makes. */
function fakeEvents() {
  const rows = new Map<string, any>();
  let nextId = 1;
  const db: any = {
    from(table: string) {
      expect(table).toBe('ab_events');
      const filters: Array<[string, unknown]> = [];
      let op: 'select' | 'upsert' | 'update' | 'delete' = 'select';
      let row: any; let opts: any; let patch: any;
      const match = () => [...rows.values()].filter((r) => filters.every(([c, v]) => r[c] === v));
      const run = () => {
        if (op === 'upsert') {
          if (rows.has(row.dedupe_key)) return { data: opts?.ignoreDuplicates ? [] : [{ id: 0 }], error: null };
          rows.set(row.dedupe_key, { ...row, id: nextId++ });
          return { data: [{ id: nextId - 1 }], error: null };
        }
        if (op === 'update') { for (const r of match()) Object.assign(r, patch); return { data: null, error: null }; }
        if (op === 'delete') { for (const r of match()) rows.delete(r.dedupe_key); return { data: null, error: null }; }
        return { data: match(), error: null };
      };
      const b: any = {
        select: () => b, eq: (c: string, v: unknown) => { filters.push([c, v]); return b; },
        upsert: (r: any, o: any) => { op = 'upsert'; row = r; opts = o; return b; },
        update: (p: any) => { op = 'update'; patch = p; return b; },
        delete: () => { op = 'delete'; return b; },
        maybeSingle: async () => { const d = (run().data as any[]) ?? []; return { data: d[0] ?? null, error: null }; },
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      };
      return b;
    },
  };
  return { db, rows };
}

describe('closure_seen markers expire (round 2, finding 2)', () => {
  it('a marker is kept for 48 hours', async () => {
    const f = fakeEvents(); const clock = { t: T0 };
    const env = liveClosureEnv(f.db, 'shop1', () => clock.t);
    expect(await env.firstSeen('k')).toBe(T0);
    clock.t = T0 + 47 * H;
    expect(await env.firstSeen('k')).toBe(T0);
  });

  it('an older marker is treated as new and rewritten with the current time', async () => {
    const f = fakeEvents(); const clock = { t: T0 };
    const env = liveClosureEnv(f.db, 'shop1', () => clock.t);
    await env.firstSeen('k');
    clock.t = T0 + 3 * 24 * H;
    expect(await env.firstSeen('k')).toBe(clock.t);
    expect(f.rows.get('closure_seen:shop1:k').payload.at).toBe(clock.t);
    clock.t += 2 * H;
    expect(await env.firstSeen('k')).toBe(T0 + 3 * 24 * H); // and then it holds from the new start
  });

  it('resolveOwed deletes only the NULL-shop owed record', async () => {
    const f = fakeEvents();
    const env = liveClosureEnv(f.db, 'shop1', () => T0);
    const rec = { row_kind: 'order' as const, row_id: 'o1', shop_id: 'shop1', stripe_account_id: 'acct', payment_intent_id: 'pi', owed_cents: 5, reason: 'x' };
    expect(await env.recordOwed(rec)).toBe('new');
    await env.firstSeen('k');
    await env.resolveOwed(rec);
    expect([...f.rows.keys()]).toEqual(['closure_seen:shop1:k']);
  });
});

describe('abandoned, then retried days later: a quick refund failure does not give up', () => {
  it('the retry after 3 days starts a fresh window and holds the deletion', async () => {
    const f = fakeEvents(); const clock = { t: T0 };
    const env = liveClosureEnv(f.db, 'shop1', () => clock.t);
    // A card booking cancelled by the first attempt whose refund keeps failing.
    const row: any = {
      id: 'b1', shop_id: 'shop1', status: 'cancelled', cancelled_by: 'shop', cancelled_at: new Date(T0).toISOString(), payment_method: 'card',
      amount_paid_cents: 3000, amount_refunded_cents: 0, refund_due_cents: 3000, refund_stuck_at: null, stripe_payment_intent_id: 'pi_1',
    };
    const refundOwed = vi.fn(async () => ({ failed: true, row }));
    vi.doMock('../../lib/bookings/core.js', async (orig) => ({ ...(await orig() as object), refundOwed }));
    vi.resetModules();
    const m = await import('../../lib/ios/closeShop.js');
    const flow: any = {
      repo: { appointmentById: async () => row, shopById: async () => ({ id: 'shop1', stripe_account_id: 'acct' }) },
      notify: async () => {}, now: () => clock.t, payments: {},
    };
    const q: any = { upcomingIds: async () => [], recentCancelledIds: async (_s: string, since: string) => (row.cancelled_at >= since ? ['b1'] : []), owingCardIds: async () => ['b1'] };
    const go = () => m.closeShopForDeletion('u1', { now: () => clock.t, env, shopIdFor: async () => 'shop1', lanes: () => [m.bookingLane(flow, 'shop1', q, env)] });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await go()).ok).toBe(false); // attempt 1, then the user abandons
    clock.t = T0 + 3 * 24 * H;
    const r = await go(); // quick failure on the retry
    err.mockRestore();
    expect(r).toMatchObject({ ok: false, reason: 'refund-pending' });
    expect(f.rows.get('closure_seen:shop1:closure:shop1').payload.at).toBe(clock.t); // window start = the new attempt
    expect([...f.rows.values()].filter((x) => x.kind === 'closure_refund_owed')).toEqual([]);
    vi.doUnmock('../../lib/bookings/core.js');
  });
});
