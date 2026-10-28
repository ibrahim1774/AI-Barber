// A plan reply for account A that lands after sign-out (or after switching to B) must not unlock anything.
jest.mock('@/lib/setup/ownerApi', () => {
  const actual = jest.requireActual('@/lib/setup/ownerApi');
  return { ...actual, call: jest.fn() };
});
let mockUid: string | null = 'user-a';
jest.mock('@/lib/auth', () => ({ currentUserId: () => mockUid, useSession: () => ({ session: null, ready: true }) }));

import { call } from '@/lib/setup/ownerApi';
import { getSharedPlan, refreshPlanAfterTransfer, refreshPlanQuietly, resetSharedPlan, setSharedPlan } from '@/lib/plan';
import { effectiveEntitlements, getEntitlements, resetEntitlementsForTests, setEntitlementsFromStatus } from '@/lib/entitlements';

const mockCall = call as jest.Mock;
const planBody = {
  linked: true, tier: 'store', active: true, expiresAt: null, takenDownAt: null, revoked: false,
  purchaseAccount: 'self', purchaseHint: null,
  entitlements: { hosting: true, bookings: true, store: true },
};
/** A request that answers only when released, so the reply can land after sign-out. */
function deferred() {
  let release!: () => void;
  const p = new Promise<unknown>((res) => { release = () => res(planBody); });
  return { p, release };
}

beforeEach(() => {
  mockUid = 'user-a';
  resetEntitlementsForTests();
  setSharedPlan(null);
  mockCall.mockReset();
});

describe('a late plan reply for the previous account', () => {
  it('refreshPlanQuietly: dropped after sign-out', async () => {
    const d = deferred();
    mockCall.mockReturnValue(d.p);
    const run = refreshPlanQuietly('tx-1');
    mockUid = null;
    resetSharedPlan();
    d.release();
    await run;
    expect(getSharedPlan()).toBeNull();
    expect(getEntitlements()).toMatchObject({ bookings: false, store: false });
  });

  it('refreshPlanQuietly: dropped after switching to account B, B keeps its own plan', async () => {
    const d = deferred();
    mockCall.mockReturnValue(d.p);
    const run = refreshPlanQuietly('tx-1');
    resetSharedPlan();
    mockUid = 'user-b';
    d.release();
    await run;
    expect(getSharedPlan()).toBeNull();
  });

  it('refreshPlanAfterTransfer: dropped after sign-out', async () => {
    const d = deferred();
    mockCall.mockReturnValue(d.p);
    const run = refreshPlanAfterTransfer('tx-1');
    mockUid = null;
    resetSharedPlan();
    d.release();
    await run;
    expect(getSharedPlan()).toBeNull();
    expect(getEntitlements().store).toBe(false);
  });

  it('refreshPlanQuietly still publishes when nothing changed', async () => {
    mockCall.mockResolvedValue(planBody);
    await refreshPlanQuietly('tx-1');
    expect(getSharedPlan()?.purchaseAccount).toBe('self');
    expect(getEntitlements()).toMatchObject({ known: true, store: true, account: 'self' });
  });
});

describe('a cached own-purchase plan is tied to the account it was read for', () => {
  const own = { ...planBody, tier: 'store' } as never;

  it('grants nothing once that account has signed out, even if the cache was not cleared', () => {
    setEntitlementsFromStatus({ status: 'INACTIVE' });
    setSharedPlan(own); // read while user-a was signed in
    expect(getEntitlements()).toMatchObject({ store: true, account: 'self' });
    mockUid = null;
    setEntitlementsFromStatus({ status: 'INACTIVE' }); // any recompute
    expect(getEntitlements()).toMatchObject({ bookings: false, store: false });
  });

  it('does not carry over to the next account', () => {
    setEntitlementsFromStatus({ status: 'INACTIVE' });
    setSharedPlan(own);
    mockUid = 'user-b';
    setEntitlementsFromStatus({ status: 'INACTIVE' });
    expect(getEntitlements().store).toBe(false);
  });

  it('still applies to the account it was read for', () => {
    setEntitlementsFromStatus({ status: 'INACTIVE' });
    setSharedPlan(own);
    setEntitlementsFromStatus({ status: 'INACTIVE' });
    expect(getEntitlements()).toMatchObject({ store: true, account: 'self' });
    expect(effectiveEntitlements({ known: true, hosting: false, bookings: false, store: false }, planBody as never).store).toBe(true);
  });
});
