// An order batch with more than 1000 line items must not be cut off by PostgREST's max_rows.
const mockItemRanges: [number, number][] = [];
const mockInBatches: number[] = [];
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const state: { ids?: string[] } = {};
      const b: any = {
        select: () => b, eq: () => b, or: () => b, order: () => b,
        in: (_c: string, ids: string[]) => { state.ids = ids; mockInBatches.push(ids.length); return b; },
        range: (from: number, to: number) => {
          if (table === 'ab_orders') {
            const rows = from === 0 ? Array.from({ length: 150 }, (_, i) => ({ id: `o${i}`, shop_id: 's', number: i, status: 'new', created_at: '2026-10-01T00:00:00Z' })) : [];
            return Promise.resolve({ data: rows, error: null });
          }
          mockItemRanges.push([from, to]);
          // 1005 items for the first batch (o0..o99), served 1000 at a time; none for the second batch.
          const isFirst = state.ids?.[0] === 'o0';
          const all = isFirst ? Array.from({ length: 1005 }, (_, i) => ({ id: `i${i}`, order_id: `o${i % 100}`, name: 'x', quantity: 1, unit_price_cents: 100 })) : [];
          return Promise.resolve({ data: all.slice(from, to + 1), error: null });
        },
      };
      return b;
    },
  },
}));

import { listAllOrders } from '@/lib/store/data';

it('reads items in batches of 100 orders, each in full pages', async () => {
  const orders = await listAllOrders('s');
  expect(Math.max(...mockInBatches)).toBeLessThanOrEqual(100);
  expect(mockItemRanges).toContainEqual([1000, 1999]);
  const total = orders.reduce((s, x) => s + x.items.length, 0);
  expect(total).toBe(1005);
});
