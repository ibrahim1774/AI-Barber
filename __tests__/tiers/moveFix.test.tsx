/**
 * The move bug (build 24): account A paid, moved the subscription here, owns the purchase, has NO shop row yet.
 * The shared plan cached before the move said purchaseAccount null ('other'), and the post-move refresh was a POST that
 * answers 404 no-shop for a shop-less account, swallowed silently: the lock card stayed and the Move button did nothing.
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
  useLatestTransactionId: () => async () => 'tx-1',
  useSuperwallSettled: () => true,
}));
jest.mock('@/lib/auth', () => ({ currentUserId: () => 'u-a', useSession: () => ({ session: { user: { id: 'u-a' } }, ready: true }) }));
const mockRecheck = jest.fn();
jest.mock('@/lib/subscriptionStatus', () => ({ recheckSubscriptionStatus: (...a: unknown[]) => mockRecheck(...a) }));
const mockTransfer = jest.fn();
jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), api: { transfer: (...a: unknown[]) => mockTransfer(...a) } }));

import { OwnerApiError } from '@/lib/setup/ownerApi';
import { getSharedPlan, refreshPlanAfterTransfer, resetSharedPlan, setSharedPlan, type Plan } from '@/lib/plan';
import { getEntitlements, resetEntitlementsForTests, setEntitlementsFromStatus } from '@/lib/entitlements';
import { useTierAccess, type TierAccess } from '@/lib/tierAccess';
import { PlanSync } from '@/lib/planSync';
import { useMoveSubscription } from '@/lib/useMoveSubscription';
import { MOVE_ERROR } from '@/lib/moveSubscription';
import { setupPrompt } from '@/lib/setupPrompt';
import { stripLapsedLinks } from '@/lib/tierLinks';
import { OWN_PLAN } from '../../test/ownPlan';

const ALL = { status: 'ACTIVE', entitlements: [{ id: 'hosting' }, { id: 'bookings' }, { id: 'store' }] };
// What GET/POST /api/shop/plan answer for A now: its own purchase, no shop (linked false).
const A_PLAN: Plan = { ...OWN_PLAN, linked: false };
// What A's cache held before the move: no purchase of its own.
const PRE_MOVE: Plan = { ...OWN_PLAN, linked: false, purchaseAccount: null, entitlements: { hosting: false, bookings: false, store: false }, active: false };
const NO_SHOP = new OwnerApiError(404, 'no-shop', 'no shop');
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  resetEntitlementsForTests();
  resetSharedPlan();
  mockCall.mockReset();
  mockTransfer.mockReset();
  mockRecheck.mockReset();
  setEntitlementsFromStatus(ALL);
});

describe('(a) an account that owns the purchase but has no shop is unlocked', () => {
  it('reproduces: the pre-move cached plan locks Bookings and Store as another account', () => {
    setSharedPlan(PRE_MOVE);
    expect(getEntitlements()).toMatchObject({ account: 'other', bookings: false, store: false });
  });

  describe.each(['bookings', 'store'] as const)('%s tab / setup gate', (need) => {
    let latest: TierAccess;
    const Probe = () => { latest = useTierAccess(need); return null; };
    it('a stale "other" plan is re-read on mount and unlocks (no shop)', async () => {
      setSharedPlan(PRE_MOVE);
      mockCall.mockResolvedValue(A_PLAN);
      await render(<Probe />);
      await flush();
      expect(mockCall).toHaveBeenCalledWith('GET', '/api/shop/plan');
      expect(latest).toMatchObject({ status: 'ready', entitled: true, otherAccount: null });
    });
    it('an already-fresh own plan is entitled with no shop', async () => {
      setSharedPlan(A_PLAN);
      await render(<Probe />);
      expect(latest).toMatchObject({ entitled: true, otherAccount: null });
    });
  });

  it('PlanSync re-reads a stale "other" plan once and the entitlements follow', async () => {
    setSharedPlan(PRE_MOVE);
    mockCall.mockResolvedValue(A_PLAN);
    await render(<PlanSync />);
    await flush();
    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(getEntitlements()).toMatchObject({ account: 'self', bookings: true, store: true });
  });

  it('a genuinely other account stays locked after the re-read (and is not polled in a loop)', async () => {
    const other: Plan = { ...PRE_MOVE, purchaseAccount: 'other', purchaseHint: 'a***@gmail.com' };
    setSharedPlan(other);
    mockCall.mockResolvedValue(other);
    await render(<PlanSync />);
    await flush();
    await flush();
    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(getEntitlements()).toMatchObject({ account: 'other', bookings: false });
  });

  describe('Edit-tab gates (setupPrompt, tierLinks/bookingChoice, ShareSheet and settings read the same entitlements)', () => {
    it('with the own plan and no shop, Add bookings / products is not stripped and the update prompt is offered', () => {
      setSharedPlan(A_PLAN);
      const ents = getEntitlements();
      expect(ents).toMatchObject({ known: true, hosting: true, bookings: true, store: true });
      const data = { bookingUrl: 'https://x.aibarber.org/book', shopUrl: 'https://x.aibarber.org/shop' } as any;
      expect(stripLapsedLinks(data, ents, undefined as any)).toMatchObject({ bookingUrl: data.bookingUrl, shopUrl: data.shopUrl });
      const prompt = setupPrompt({ published: true, ents, live: { bookingUrl: null, shopUrl: null }, next: { bookingUrl: data.bookingUrl, shopUrl: data.shopUrl } });
      expect(prompt?.title).toMatch(/Add the Book and Shop buttons/);
    });
    it('the stale plan would have blocked the same gates (the bug)', () => {
      setSharedPlan(PRE_MOVE);
      const ents = getEntitlements();
      const data = { bookingUrl: 'https://x.aibarber.org/book', shopUrl: 'https://x.aibarber.org/shop' } as any;
      expect(stripLapsedLinks(data, ents, undefined as any).shopUrl).toBeFalsy();
    });
  });
});

describe('(b)(c) the Move button always refreshes the plan and never silently does nothing', () => {
  let hook: ReturnType<typeof useMoveSubscription>;
  const onMoved = jest.fn();
  const Probe = () => { hook = useMoveSubscription({ onMoved }); return null; };
  beforeEach(() => { onMoved.mockReset(); setSharedPlan(PRE_MOVE); });

  it('"already yours" (moved:false) still refreshes the plan: locks clear immediately', async () => {
    mockTransfer.mockResolvedValue({ moved: false, linked: true });
    mockCall.mockResolvedValue(A_PLAN);
    await render(<Probe />);
    await act(async () => { await hook.run(); });
    expect(getSharedPlan()).toEqual(A_PLAN);
    expect(getEntitlements()).toMatchObject({ account: 'self', bookings: true, store: true });
    expect(mockRecheck).toHaveBeenCalledWith(true);
    expect(onMoved).toHaveBeenCalledTimes(1);
    expect(hook.error).toBeNull();
  });

  it('POST 404 no-shop (no shop row) falls back to GET and still refreshes', async () => {
    mockTransfer.mockResolvedValue({ moved: true, linked: true });
    mockCall.mockImplementation(async (method: string) => { if (method === 'POST') throw NO_SHOP; return A_PLAN; });
    await render(<Probe />);
    await act(async () => { await hook.run(); });
    expect(mockCall.mock.calls.map((c) => c[0])).toEqual(['POST', 'GET']);
    expect(getEntitlements()).toMatchObject({ account: 'self', bookings: true });
  });

  it('refresh fails: an error line shows, onMoved does not run', async () => {
    mockTransfer.mockResolvedValue({ moved: false, linked: true });
    mockCall.mockRejectedValue(new OwnerApiError(0, 'network', 'offline'));
    await render(<Probe />);
    await act(async () => { await hook.run(); });
    expect(hook.error).toBe(MOVE_ERROR.refresh);
    expect(onMoved).not.toHaveBeenCalled();
  });

  it('the server still does not call the purchase ours: an error line, not silence', async () => {
    mockTransfer.mockResolvedValue({ moved: false, linked: true });
    mockCall.mockResolvedValue(PRE_MOVE);
    await render(<Probe />);
    await act(async () => { await hook.run(); });
    expect(hook.error).toBe(MOVE_ERROR.refresh);
    expect(onMoved).not.toHaveBeenCalled();
  });

  it('a failed transfer shows its error line', async () => {
    const { ApiError } = jest.requireActual('@/lib/api');
    mockTransfer.mockRejectedValue(new ApiError(503, 'x', 'down'));
    await render(<Probe />);
    await act(async () => { await hook.run(); });
    expect(hook.error).toBe(MOVE_ERROR.offline);
  });

  it('refreshPlanAfterTransfer throws only when POST and GET both fail', async () => {
    mockCall.mockRejectedValue(new OwnerApiError(0, 'network', 'offline'));
    await expect(refreshPlanAfterTransfer('tx-1')).rejects.toBeTruthy();
  });
});
