import {
  entitlementsFrom, getEntitlements, resetEntitlementsForTests, setEntitlementsFromStatus, subscribeEntitlements,
  tierFromEntitlements, PLAN_ENTITLEMENT,
} from '@/lib/entitlements';

const active = (...ids: string[]) => ({ status: 'ACTIVE', entitlements: ids.map((id) => ({ id })) });

beforeEach(resetEntitlementsForTests);

describe('entitlementsFrom', () => {
  it('ACTIVE with [hosting] has no bookings or store', () => {
    expect(entitlementsFrom(active('hosting'))).toEqual({ known: true, hosting: true, bookings: false, store: false });
  });
  it('ACTIVE with all three grants all three', () => {
    expect(entitlementsFrom(active('hosting', 'bookings', 'store'))).toEqual({ known: true, hosting: true, bookings: true, store: true });
  });
  it('INACTIVE is known and grants nothing', () => {
    expect(entitlementsFrom({ status: 'INACTIVE' })).toEqual({ known: true, hosting: false, bookings: false, store: false });
  });
  it('UNKNOWN or null is not known', () => {
    expect(entitlementsFrom({ status: 'UNKNOWN' }).known).toBe(false);
    expect(entitlementsFrom(null).known).toBe(false);
    expect(entitlementsFrom(undefined).known).toBe(false);
  });
});

describe('the mirror', () => {
  it('starts unknown', () => {
    expect(getEntitlements().known).toBe(false);
  });
  it('notifies subscribers on a change, not on a repeat', () => {
    const l = jest.fn();
    const off = subscribeEntitlements(l);
    setEntitlementsFromStatus(active('hosting'));
    expect(l).toHaveBeenCalledTimes(1);
    setEntitlementsFromStatus(active('hosting'));
    expect(l).toHaveBeenCalledTimes(1);
    setEntitlementsFromStatus(active('hosting', 'bookings'));
    expect(l).toHaveBeenCalledTimes(2);
    expect(getEntitlements().bookings).toBe(true);
    off();
    setEntitlementsFromStatus({ status: 'INACTIVE' });
    expect(l).toHaveBeenCalledTimes(2);
  });
});

it('tierFromEntitlements: store > bookings > hosting > none', () => {
  expect(tierFromEntitlements({ hosting: true, bookings: true, store: true })).toBe('store');
  expect(tierFromEntitlements({ hosting: true, bookings: true, store: false })).toBe('bookings');
  expect(tierFromEntitlements({ hosting: true, bookings: false, store: false })).toBe('website');
  expect(tierFromEntitlements({ hosting: false, bookings: false, store: false })).toBeNull();
});

it('maps each upgrade placement to its entitlement', () => {
  expect(PLAN_ENTITLEMENT).toEqual({ bookings_upgrade: 'bookings', store_upgrade: 'store' });
});
