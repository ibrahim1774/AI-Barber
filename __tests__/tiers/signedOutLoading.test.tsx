/**
 * Build 26 report: a user who started from scratch (no payment, no account yet) saw the Bookings and Store tabs on an
 * endless loading screen. The plan call answers 401 unauthorized, the hook noted it (signedOut) but kept returning
 * 'loading' for the inactive-hosting case. Signed out must settle as ready + locked.
 */
import React from 'react';
import { act, render as baseRender } from '../store/render';

const mounted: any[] = [];
const render = async (el: React.ReactElement) => { const t = await baseRender(el); mounted.push(t); return t; };
afterEach(() => { mounted.splice(0).forEach((t) => act(() => t.unmount())); });

jest.mock('@/constants/theme', () => require('../store/themeMock'));
const mockCall = jest.fn();
jest.mock('@/lib/setup/ownerApi', () => {
  const actual = jest.requireActual('@/lib/setup/ownerApi');
  return { ...actual, call: (...a: unknown[]) => mockCall(...a) };
});
jest.mock('@/lib/paywall', () => ({
  usePaywall: () => jest.fn(async () => 'declined'),
  useLatestTransactionId: () => async () => null,
  useSuperwallSettled: () => true,
}));
jest.mock('@/lib/auth', () => ({ currentUserId: () => null, useSession: () => ({ session: null, ready: true }) }));

import { OwnerApiError } from '@/lib/setup/ownerApi';
import { resetSharedPlan } from '@/lib/plan';
import { resetEntitlementsForTests, setEntitlementsFromStatus } from '@/lib/entitlements';
import { useTierAccess, type TierAccess } from '@/lib/tierAccess';

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
let seen: TierAccess | null = null;
function Probe({ need }: { need: 'bookings' | 'store' }) {
  seen = useTierAccess(need);
  return null;
}

beforeEach(() => {
  resetEntitlementsForTests();
  resetSharedPlan();
  mockCall.mockReset();
  seen = null;
  // Superwall answered: nothing is subscribed.
  setEntitlementsFromStatus({ status: 'INACTIVE', entitlements: [] });
});

describe.each(['bookings', 'store'] as const)('signed out, nothing paid: %s tab', (need) => {
  it('settles as ready and locked after the 401, never an endless loading screen', async () => {
    mockCall.mockRejectedValue(new OwnerApiError(401, 'unauthorized', 'sign in'));
    await render(<Probe need={need} />);
    await flush();
    expect(seen!.status).toBe('ready');
    expect(seen!.entitled).toBe(false);
    expect(seen!.otherAccount).toBeNull();
  });

  it('a network failure is locked too, never an endless loading screen', async () => {
    mockCall.mockRejectedValue(new OwnerApiError(0, 'network', 'offline'));
    await render(<Probe need={need} />);
    await flush();
    expect(seen!.status).not.toBe('loading');
    expect(seen!.entitled).toBe(false);
  });
});

describe('the plan card says a plan is needed', () => {
  it.each([['bookings', /You need a plan to use Bookings/], ['store', /You need a plan to use the Store/]] as const)('%s', async (kind, re) => {
    const { UpgradeCard } = require('@/components/UpgradeCard');
    const t = await render(<UpgradeCard kind={kind} onUpgrade={() => {}} />);
    expect(JSON.stringify(t.toJSON())).toMatch(re);
  });
});
