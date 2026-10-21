import { describe, it, expect } from 'vitest';
import { supabaseStoreRepo, type OrderGuard } from '../../lib/store/repo.js';

/** Minimal chainable stand-in for supabase-js: every call is recorded, awaiting resolves `result`. */
function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: [string, unknown[]][] = [];
  const chain: any = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'then') return (res: any, rej: any) => Promise.resolve(result).then(res, rej);
      return (...args: unknown[]) => { calls.push([prop, args]); return chain; };
    },
  });
  const client = {
    from: (t: string) => { calls.push(['from', [t]]); return chain; },
    rpc: async (fn: string, args: unknown) => { calls.push(['rpc', [fn, args]]); return result; },
  } as any;
  return { client, calls };
}

describe('supabaseStoreRepo', () => {
  it('every OrderGuard key becomes a filter (a dropped guard would make the compare-and-set unconditional)', async () => {
    const { client, calls } = fakeClient({ data: [{ id: 'o1' }], error: null });
    const guard: Required<OrderGuard> = {
      status: 'new', statusIn: ['new', 'paid'], paymentMethod: 'card', notCard: true, paymentStatusIn: ['awaiting'],
      paidCents: 0, refundedEq: 100, refundedLte: 500, refundDue: 700, refundPending: true, notStuck: true, saysPaidNull: true,
    };
    const r = await supabaseStoreRepo(client).updateOrder('o1', { status: 'cancelled' }, guard);
    expect(r).toEqual({ ok: true, row: { id: 'o1' } });
    const expected: [string, unknown[]][] = [
      ['from', ['ab_orders']],
      ['update', [{ status: 'cancelled' }]],
      ['eq', ['id', 'o1']],
      ['eq', ['status', 'new']],
      ['in', ['status', ['new', 'paid']]],
      ['eq', ['payment_method', 'card']],
      ['or', ['payment_method.is.null,payment_method.neq.card']],
      ['in', ['payment_status', ['awaiting']]],
      ['eq', ['amount_paid_cents', 0]],
      ['eq', ['amount_refunded_cents', 100]],
      ['lte', ['amount_refunded_cents', 500]],
      ['eq', ['refund_due_cents', 700]],
      ['eq', ['refund_pending', true]],
      ['is', ['refund_stuck_at', null]],
      ['is', ['customer_says_paid_at', null]],
      ['select', ['*']],
    ];
    expect(calls).toEqual(expected);
    // one filter per guard key
    expect(Object.keys(guard)).toHaveLength(12);
  });

  it('a zero guard value still filters (paidCents 0, refundedEq 0, refundDue 0)', async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    expect(await supabaseStoreRepo(client).updateOrder('o1', { refund_due_cents: 5 }, { paidCents: 0, refundedEq: 0, refundDue: 0 }))
      .toEqual({ ok: false, reason: 'stale' });
    expect(calls).toEqual(expect.arrayContaining([
      ['eq', ['amount_paid_cents', 0]], ['eq', ['amount_refunded_cents', 0]], ['eq', ['refund_due_cents', 0]],
    ]));
  });

  it('createOrder calls ab_create_order and maps its jsonb', async () => {
    const { client, calls } = fakeClient({ data: { order: { id: 'o1', order_no: 1001 }, items: [{ id: 'i1' }], existing: true }, error: null });
    const r = await supabaseStoreRepo(client).createOrder({ shop_id: 's' } as any, [{ product_id: 'p', name: 'A', unit_price_cents: 100, quantity: 1 }]);
    expect(r).toEqual({ order: { id: 'o1', order_no: 1001 }, items: [{ id: 'i1' }], existing: true });
    expect(calls[0]).toEqual(['rpc', ['ab_create_order', { p_order: { shop_id: 's' }, p_items: [{ product_id: 'p', name: 'A', unit_price_cents: 100, quantity: 1 }] }]]);
  });

  it('errors throw', async () => {
    const { client } = fakeClient({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(supabaseStoreRepo(client).createOrder({} as any, [])).rejects.toThrow('permission denied');
    await expect(supabaseStoreRepo(client).updateOrder('o', {})).rejects.toThrow('permission denied');
  });

  it('the sweeps filter literally: holds and pending refunds', async () => {
    let f = fakeClient({ data: [], error: null });
    await supabaseStoreRepo(f.client).staleOrderHolds('2026-01-01T00:00:00Z', 50);
    expect(f.calls).toEqual(expect.arrayContaining([
      ['eq', ['status', 'new']], ['eq', ['payment_method', 'card']], ['eq', ['payment_status', 'awaiting']],
      ['eq', ['amount_paid_cents', 0]], ['lt', ['created_at', '2026-01-01T00:00:00Z']], ['order', ['updated_at']], ['limit', [50]],
    ]));
    f = fakeClient({ data: [], error: null });
    await supabaseStoreRepo(f.client).pendingOrderRefunds('2026-01-01T00:00:00Z', 25);
    expect(f.calls).toEqual(expect.arrayContaining([
      ['eq', ['refund_pending', true]], ['not', ['stripe_payment_intent_id', 'is', null]],
      ['lt', ['updated_at', '2026-01-01T00:00:00Z']], ['order', ['updated_at']], ['limit', [25]],
    ]));
  });

  it('orderItems keeps the cart order (created_at, then id); productsByIds with no ids reads nothing', async () => {
    const f = fakeClient({ data: [], error: null });
    await supabaseStoreRepo(f.client).orderItems('o1');
    expect(f.calls).toEqual(expect.arrayContaining([['order', ['created_at']], ['order', ['id']]]));
    const g = fakeClient({ data: [], error: null });
    expect(await supabaseStoreRepo(g.client).productsByIds('s', [])).toEqual([]);
    expect(g.calls).toEqual([]);
  });
});
