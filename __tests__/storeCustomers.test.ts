import { filterStoreCustomers, groupStoreCustomers } from '@/lib/store/customers';
import { order } from './store/fixtures';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const o = (n: number, p: Parameters<typeof order>[0] = {}) =>
  order({ id: U(n), number: 1000 + n, createdAt: `2026-10-0${n}T15:00:00Z`, ...p });
const who = (name: string, phone = '', email = '') => ({ customer: { name, phone, email } });
const paid = (cents: number) => ({ paymentStatus: 'paid' as const, paymentMethod: 'card' as const, amountPaidCents: cents, totalCents: cents });

describe('groupStoreCustomers', () => {
  it('groups by shared phone across formats', () => {
    const r = groupStoreCustomers([o(1, who('Sam', '(555) 010-2030')), o(2, who('Samuel', '+1 555.010.2030'))]);
    expect(r).toHaveLength(1);
    expect(r[0].orders).toBe(2);
    expect(r[0].names).toEqual(['Sam', 'Samuel']);
  });
  it('groups by shared email, case-insensitively', () => {
    expect(groupStoreCustomers([o(1, who('A', '', 'Sam@X.com')), o(2, who('A', '', ' sam@x.com '))])).toHaveLength(1);
  });
  it('joins a phone-only and an email-only order through a third that has both', () => {
    const r = groupStoreCustomers([o(1, who('A', '5550102030')), o(2, who('A', '', 'a@x.com')), o(3, who('A', '5550102030', 'a@x.com'))]);
    expect(r).toHaveLength(1);
    expect(r[0].orderIds).toHaveLength(3);
  });
  it('keeps different people apart', () => {
    expect(groupStoreCustomers([o(1, who('A', '5550102030')), o(2, who('B', '5550109999'))])).toHaveLength(2);
  });
  it('drops an order with no phone or email', () => {
    expect(groupStoreCustomers([o(1, who('Ghost'))])).toEqual([]);
  });
  it('aggregates items by name and sums totals', () => {
    const r = groupStoreCustomers([
      o(1, { ...who('A', '5550102030'), ...paid(2400), items: [{ productId: 'p1', name: 'Beard oil', unitPriceCents: 1200, quantity: 2 }] }),
      o(2, { ...who('A', '5550102030'), ...paid(1200), items: [{ productId: 'p1', name: 'Beard oil', unitPriceCents: 1200, quantity: 1 }, { productId: 'p2', name: 'Pomade', unitPriceCents: 900, quantity: 1 }] }),
    ])[0];
    expect(r.items).toEqual([{ name: 'Beard oil', quantity: 3 }, { name: 'Pomade', quantity: 1 }]);
    expect(r.totalCents).toBe(3600);
    expect(r.paidCents).toBe(3600);
    expect(r.unpaidOrders).toBe(0);
    expect(r.firstAt).toBe('2026-10-01T15:00:00Z');
    expect(r.lastAt).toBe('2026-10-02T15:00:00Z');
  });
  it('never counts a refunded amount as revenue and floors at 0', () => {
    const r = groupStoreCustomers([
      o(1, { ...who('A', '5550102030'), ...paid(2000), amountRefundedCents: 500, paymentStatus: 'partially_refunded' }),
      o(2, { ...who('A', '5550102030'), ...paid(1000), amountRefundedCents: 1500, paymentStatus: 'refunded' }),
    ])[0];
    expect(r.paidCents).toBe(1500);
  });
  it('counts unpaid orders (not paid or refunded)', () => {
    const r = groupStoreCustomers([o(1, who('A', '5550102030')), o(2, { ...who('A', '5550102030'), ...paid(500) })])[0];
    expect(r.unpaidOrders).toBe(1);
  });
  it('leaves out abandoned card holds and cancelled orders', () => {
    const hold = o(1, { ...who('A', '5550102030'), paymentMethod: 'card', paymentStatus: 'awaiting', amountPaidCents: 0 });
    const cancelled = o(2, { ...who('B', '5550109999'), status: 'cancelled' });
    expect(groupStoreCustomers([hold, cancelled])).toEqual([]);
  });
  it('id is the earliest order uuid and never contact data', () => {
    const r = groupStoreCustomers([o(2, who('A', '5550102030', 'a@x.com')), o(1, who('A', '5550102030', 'a@x.com'))])[0];
    expect(r.id).toBe(U(1));
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.id).not.toContain('@');
  });
});

describe('filterStoreCustomers', () => {
  const list = groupStoreCustomers([
    o(1, { ...who('Zed', '(555) 010-2030', 'zed@x.com'), ...paid(500) }),
    o(2, { ...who('Amy', '(555) 999-8888', 'amy@y.com'), ...paid(9000) }),
    o(3, { ...who('Amy', '(555) 999-8888', 'amy@y.com'), ...paid(100) }),
  ]);
  it('finds by digits-only phone, name and email', () => {
    expect(filterStoreCustomers(list, '5550102030', 'recent').map((c) => c.names[0])).toEqual(['Zed']);
    expect(filterStoreCustomers(list, 'amy', 'recent')).toHaveLength(1);
    expect(filterStoreCustomers(list, 'zed@x', 'recent')).toHaveLength(1);
  });
  it('sorts', () => {
    expect(filterStoreCustomers(list, '', 'recent')[0].names[0]).toBe('Amy');
    expect(filterStoreCustomers(list, '', 'orders')[0].names[0]).toBe('Amy');
    expect(filterStoreCustomers(list, '', 'name')[0].names[0]).toBe('Amy');
    expect(filterStoreCustomers(list, '', 'spent')[0].names[0]).toBe('Amy');
  });
});
