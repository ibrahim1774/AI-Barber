import {
  addProduct, countNewOrders, listOrders, listProducts, loadStoreSettings, removeProduct, reorderProducts, shopUrl,
  toOrder, updateProduct, updateStoreSettings, VISIBLE_ORDERS_FILTER,
} from '@/lib/store/data';

type Call = { table: string; ops: [string, ...unknown[]][] };
const mockCalls: Call[] = [];
let mockResults: Record<string, any>[] = [];

/** A thenable query builder that records every call and resolves with the next queued result. */
function mockBuilder(table: string) {
  const call: Call = { table, ops: [] };
  mockCalls.push(call);
  const res = () => mockResults.shift() ?? { data: null, error: null, count: 0 };
  const b: any = new Proxy({}, {
    get(_t, op: string) {
      if (op === 'then') return (ok: any, bad: any) => Promise.resolve(res()).then(ok, bad);
      return (...args: unknown[]) => {
        call.ops.push([op, ...args]);
        return b;
      };
    },
  });
  return b;
}
jest.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => mockBuilder(t) } }));

const ops = (i = 0) => mockCalls[i].ops;
const has = (i: number, ...op: unknown[]) => ops(i).some((o) => JSON.stringify(o) === JSON.stringify(op));

beforeEach(() => {
  mockCalls.length = 0;
  mockResults = [];
});

describe('store data layer', () => {
  it('builds the shop URL', () => {
    expect(shopUrl({ slug: 'fade-lab' })).toBe('https://www.aibarber.org/shop/fade-lab');
  });

  it('updateStoreSettings sends only the six granted columns', async () => {
    await updateStoreSettings('s1', {
      storeEnabled: true, pickup: true, pickupNote: 'Ask at the desk', shipping: true, shippingFlatCents: 500, shipsWithinDays: 3,
      // @ts-expect-error not a settable store setting
      slug: 'hack', order_seq: 9, platform_fee_bps: 0,
    });
    const update = ops().find((o) => o[0] === 'update')![1] as Record<string, unknown>;
    expect(Object.keys(update).sort()).toEqual([
      'ships_within_days', 'shipping_flat_cents', 'store_enabled', 'store_pickup', 'store_pickup_note', 'store_shipping',
    ].sort());
    expect(has(0, 'eq', 'id', 's1')).toBe(true);
  });

  it('updateStoreSettings with nothing to write makes no call', async () => {
    await updateStoreSettings('s1', {});
    expect(mockCalls).toHaveLength(0);
  });

  it('loadStoreSettings maps the shop row', async () => {
    mockResults = [{ data: { store_enabled: true, store_pickup: false, store_pickup_note: null, store_shipping: true, shipping_flat_cents: 700, ships_within_days: 2 }, error: null }];
    expect(await loadStoreSettings('s1')).toEqual({
      storeEnabled: true, pickup: false, pickupNote: '', shipping: true, shippingFlatCents: 700, shipsWithinDays: 2,
    });
  });

  it('listProducts filters active and orders by sort', async () => {
    mockResults = [{ data: [{ id: 'p1', shop_id: 's1', name: 'Pomade', price_cents: 1250, description: null, photos: ['a'], sold_out: true, sort: 0 }], error: null }];
    const list = await listProducts('s1');
    expect(mockCalls[0].table).toBe('ab_products');
    expect(has(0, 'eq', 'shop_id', 's1')).toBe(true);
    expect(has(0, 'eq', 'active', true)).toBe(true);
    expect(has(0, 'order', 'sort', { ascending: true })).toBe(true);
    expect(list).toEqual([{ id: 'p1', shopId: 's1', name: 'Pomade', priceCents: 1250, description: '', photos: ['a'], soldOut: true, sort: 0 }]);
  });

  it('addProduct inserts after the last sort', async () => {
    mockResults = [
      { data: [{ sort: 4 }], error: null },
      { data: { id: 'p9', shop_id: 's1', name: 'Oil', price_cents: 900, description: 'x', photos: ['a', 'b'], sold_out: false, sort: 5 }, error: null },
    ];
    const p = await addProduct('s1', { name: 'Oil', priceCents: 900, description: 'x', photos: ['a', 'b'], soldOut: false });
    const insert = mockCalls[1].ops.find((o) => o[0] === 'insert')![1];
    expect(insert).toEqual({ shop_id: 's1', name: 'Oil', price_cents: 900, description: 'x', photos: ['a', 'b'], sold_out: false, sort: 5 });
    expect(p.id).toBe('p9');
  });

  it('updateProduct maps fields to granted columns', async () => {
    await updateProduct('p1', { soldOut: true, priceCents: 100, description: '' });
    expect(ops().find((o) => o[0] === 'update')![1]).toEqual({ sold_out: true, price_cents: 100, description: null });
    expect(has(0, 'eq', 'id', 'p1')).toBe(true);
  });

  it('removeProduct soft-deletes', async () => {
    await removeProduct('p1');
    expect(ops().find((o) => o[0] === 'update')![1]).toEqual({ active: false });
    expect(ops().some((o) => o[0] === 'delete')).toBe(false);
  });

  it('reorderProducts writes sort = index', async () => {
    await reorderProducts(['b', 'a', 'c']);
    expect(mockCalls.map((c) => [c.ops.find((o) => o[0] === 'update')![1], c.ops.find((o) => o[0] === 'eq')![2]])).toEqual([
      [{ sort: 0 }, 'b'], [{ sort: 1 }, 'a'], [{ sort: 2 }, 'c'],
    ]);
  });

  it('listOrders excludes unpaid card holds, newest first', async () => {
    mockResults = [
      { data: [{ id: 'o1', order_no: 1001, status: 'new', fulfilment: 'pickup', created_at: 't', customer_name: 'A', customer_phone: '1', customer_email: 'a@b.c' }], error: null },
      { data: [{ order_id: 'o1', product_id: 'p1', name: 'Oil', unit_price_cents: 900, quantity: 2 }], error: null },
    ];
    const list = await listOrders('s1', { limit: 20, before: '2026-10-01T00:00:00Z' });
    expect(mockCalls[0].table).toBe('ab_orders');
    expect(has(0, 'order', 'created_at', { ascending: false })).toBe(true);
    expect(has(0, 'limit', 20)).toBe(true);
    expect(has(0, 'lt', 'created_at', '2026-10-01T00:00:00Z')).toBe(true);
    const or = ops(0).find((o) => o[0] === 'or')![1] as string;
    expect(or).toBe(VISIBLE_ORDERS_FILTER);
    expect(VISIBLE_ORDERS_FILTER).toBe(
      'payment_method.is.null,payment_method.neq.card,payment_status.neq.awaiting,amount_paid_cents.gt.0',
    );
    expect(or).toContain('payment_method.neq.card');
    expect(or).toContain('payment_status.neq.awaiting');
    expect(or).toContain('amount_paid_cents.gt.0');
    expect(mockCalls[1].table).toBe('ab_order_items');
    expect(list[0]).toMatchObject({ id: 'o1', number: 1001, items: [{ productId: 'p1', name: 'Oil', unitPriceCents: 900, quantity: 2 }] });
  });

  it('countNewOrders counts status new with the same exclusion', async () => {
    mockResults = [{ data: null, error: null, count: 3 }];
    expect(await countNewOrders('s1')).toBe(3);
    expect(has(0, 'eq', 'status', 'new')).toBe(true);
    expect((ops(0).find((o) => o[0] === 'or')![1] as string)).toContain('payment_status.neq.awaiting');
  });

  it('never surfaces the raw database error', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockResults = [{ data: null, error: { message: 'new row for relation "ab_products" violates check constraint' } }];
    await expect(removeProduct('p1')).rejects.toThrow("Couldn't save that. Check your connection and try again.");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('toOrder maps order_no, an empty address and the items', () => {
    const o = toOrder(
      { id: 'o1', order_no: 1002, status: 'paid', fulfilment: 'shipping', created_at: 't', customer_name: 'Sam', customer_phone: '5', customer_email: 's@x.y', note: null,
        shipping_address: {}, subtotal_cents: 1800, shipping_cents: 500, total_cents: 2300, payment_status: 'paid', payment_method: 'card',
        amount_paid_cents: 2300, amount_refunded_cents: 0, refund_pending: true, tracking_number: null, tracking_url: null, customer_says_paid_at: null },
      [{ product_id: null, name: 'Oil', unit_price_cents: 900, quantity: 2 }],
    );
    expect(o).toMatchObject({
      number: 1002, shippingAddress: null, customer: { name: 'Sam', phone: '5', email: 's@x.y' }, totalCents: 2300,
      paymentMethod: 'card', refundPending: true, items: [{ productId: null, name: 'Oil', unitPriceCents: 900, quantity: 2 }],
    });
    expect(toOrder({ id: 'o', shipping_address: { city: 'X' } }, []).shippingAddress).toEqual({ city: 'X' });
  });
});
