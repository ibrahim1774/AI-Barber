// The upgrade placements settle on the target entitlement, not on a transaction.
import React from 'react';
import { Alert } from 'react-native';

process.env.EXPO_PUBLIC_SUPERWALL_API_KEY = 'pk_test';
const mockRefreshPlan = jest.fn(async (_id: string) => ({}));
const mockSetShared = jest.fn();
jest.mock('@/lib/plan', () => ({ getSharedPlan: () => null, getPlanEpoch: () => 0, subscribePlan: () => () => {}, refreshPlan: (id: string) => mockRefreshPlan(id), setSharedPlan: (p: unknown) => mockSetShared(p) }));
const mockRelink = jest.fn(async (_o: unknown) => false);
jest.mock('@/lib/setup/relink', () => ({ relinkShopPurchase: (o: unknown) => mockRelink(o) }));
/* eslint-disable @typescript-eslint/no-require-imports */
const { sw } = require('expo-superwall');
const { usePaywall } = require('@/lib/paywall');
const { setEntitlementsFromStatus, resetEntitlementsForTests } = require('@/lib/entitlements');
const analytics = require('@/lib/analytics');
const { PRODUCT_IDS } = require('@/lib/publish');
const { act, create } = require('react-test-renderer') as {
  act(fn: () => void): void;
  create(el: React.ReactElement): { unmount(): void };
};
/* eslint-enable @typescript-eslint/no-require-imports */

type Result = 'purchased' | 'restored' | 'declined';
type P = 'publish' | 'bookings_upgrade' | 'store_upgrade';
let show: (p: P) => Promise<Result>;
let renderer: { unmount(): void };
function Harness() {
  show = usePaywall();
  return null;
}
const SUB = (productId: string) => ({
  transactionId: 'tx-1', productId, purchaseDate: '2026-10-20T00:00:00Z', isActive: true, isRevoked: false,
});
const ents = (...ids: string[]) => setEntitlementsFromStatus({ status: 'ACTIVE', entitlements: ids.map((id) => ({ id })) });

function open(p: P) {
  let result: Result | null = null;
  const done = show(p).then((r) => (result = r));
  return { done, current: () => result };
}

beforeEach(() => {
  jest.useFakeTimers();
  sw.reset();
  resetEntitlementsForTests();
  mockRefreshPlan.mockClear();
  mockSetShared.mockClear();
  mockRelink.mockClear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  act(() => {
    renderer = create(React.createElement(Harness));
  });
});
afterEach(() => {
  act(() => renderer.unmount());
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('bookings_upgrade', () => {
  it('stays declined when the entitlement never turns on, even though a transaction exists', async () => {
    ents('hosting');
    sw.subscriptions = [SUB(PRODUCT_IDS[0])];
    const run = open('bookings_upgrade'); // feature runs at once: the patient window starts
    await jest.advanceTimersByTimeAsync(9_000);
    expect(run.current()).toBeNull();
    await jest.advanceTimersByTimeAsync(3_000);
    expect(run.current()).toBe('declined');
    expect(mockRefreshPlan).not.toHaveBeenCalled();
  });

  it('is purchased when the entitlement turns on during the window, then refreshes the plan and relinks', async () => {
    ents('hosting');
    sw.subscriptions = [SUB(PRODUCT_IDS[2])];
    const track = jest.spyOn(analytics, 'track');
    const run = open('bookings_upgrade');
    await jest.advanceTimersByTimeAsync(2_000);
    expect(run.current()).toBeNull();
    ents('hosting', 'bookings');
    await jest.advanceTimersByTimeAsync(600);
    expect(run.current()).toBe('purchased');
    await jest.advanceTimersByTimeAsync(0);
    expect(mockRefreshPlan).toHaveBeenCalledWith('tx-1');
    expect(mockRelink).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('upgrade_result', { placement: 'bookings_upgrade', result: 'purchased' });
  });

  it('a dismiss without the entitlement is declined at once and quietly', async () => {
    ents('hosting');
    sw.register = () => new Promise<void>(() => {});
    const run = open('bookings_upgrade');
    sw.callbacks.onPresent?.({});
    sw.callbacks.onDismiss?.({ closeReason: 'manualClose' }, { type: 'declined' });
    await jest.advanceTimersByTimeAsync(100);
    expect(run.current()).toBe('declined');
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('a skip explains itself with an Upgrade alert', async () => {
    ents('hosting');
    sw.register = () => new Promise<void>(() => {});
    const run = open('bookings_upgrade');
    sw.callbacks.onSkip?.({ type: 'Holdout' });
    await jest.advanceTimersByTimeAsync(100);
    expect(run.current()).toBe('declined');
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('Upgrade');
  });
});

describe('a purchased or restored dismiss is verified against the target entitlement', () => {
  it('restored without the entitlement is declined', async () => {
    ents('hosting');
    sw.register = () => new Promise<void>(() => {});
    const run = open('bookings_upgrade');
    sw.callbacks.onDismiss?.({ closeReason: 'systemLogic' }, { type: 'restored', productId: PRODUCT_IDS[0] });
    await jest.advanceTimersByTimeAsync(12_000);
    expect(run.current()).toBe('declined');
    expect(mockRefreshPlan).not.toHaveBeenCalled();
  });

  it('purchased with the entitlement turning on is paid, and the refreshed plan is published', async () => {
    ents('hosting');
    sw.subscriptions = [SUB(PRODUCT_IDS[2])];
    mockRefreshPlan.mockResolvedValueOnce({ tier: 'bookings' });
    sw.register = () => new Promise<void>(() => {});
    const run = open('bookings_upgrade');
    sw.callbacks.onDismiss?.({ closeReason: 'systemLogic' }, { type: 'purchased', productId: PRODUCT_IDS[2] });
    await jest.advanceTimersByTimeAsync(1_000);
    expect(run.current()).toBeNull();
    ents('hosting', 'bookings');
    await jest.advanceTimersByTimeAsync(600);
    expect(run.current()).toBe('purchased');
    await jest.advanceTimersByTimeAsync(0);
    expect(mockRefreshPlan).toHaveBeenCalledWith('tx-1');
    expect(mockSetShared).toHaveBeenCalledWith({ tier: 'bookings' });
  });
});

describe('fix48: the plan read after a paid upgrade survives a dropped connection', () => {
  const paid = async () => {
    ents('hosting');
    sw.subscriptions = [SUB(PRODUCT_IDS[2])];
    const run = open('bookings_upgrade');
    ents('hosting', 'bookings');
    await jest.advanceTimersByTimeAsync(600);
    expect(run.current()).toBe('purchased');
    await jest.advanceTimersByTimeAsync(0);
  };
  const fail = (status: number) => Object.assign(new Error('x'), { status });

  it('offline, then a 503, then it lands: retried and the fresh plan is published', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockRefreshPlan
      .mockRejectedValueOnce(fail(0))
      .mockRejectedValueOnce(fail(503))
      .mockResolvedValueOnce({ tier: 'bookings' });
    await paid();
    expect(mockRefreshPlan).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(3_000);
    expect(mockRefreshPlan).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(mockRefreshPlan).toHaveBeenCalledTimes(3);
    expect(mockSetShared).toHaveBeenCalledWith({ tier: 'bookings' });
  });

  it.each([409, 429])('a final 4xx answer (%i) is not retried (429: the write limit is shared with setup)', async (status) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockRefreshPlan.mockRejectedValueOnce(fail(status));
    await paid();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(mockRefreshPlan).toHaveBeenCalledTimes(1);
    expect(mockSetShared).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[paywall] plan refresh failed:', expect.anything());
  });

  it('gives up after three retries (Apple\'s notification and the next launch still bring the plan)', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockRefreshPlan.mockRejectedValue(fail(0));
    await paid();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(mockRefreshPlan).toHaveBeenCalledTimes(4);
    mockRefreshPlan.mockReset();
    mockRefreshPlan.mockImplementation(async () => ({}));
  });

  it('the new transaction not listed yet: looked up again instead of skipping the refresh', async () => {
    ents('hosting');
    sw.subscriptions = [];
    const run = open('bookings_upgrade');
    ents('hosting', 'bookings');
    await jest.advanceTimersByTimeAsync(600);
    expect(run.current()).toBe('purchased');
    sw.subscriptions = [SUB(PRODUCT_IDS[2])];
    await jest.advanceTimersByTimeAsync(1_000);
    expect(mockRefreshPlan).toHaveBeenCalledWith('tx-1');
  });
});

describe('store_upgrade', () => {
  it('waits for the store entitlement, not bookings', async () => {
    ents('hosting', 'bookings');
    const run = open('store_upgrade');
    await jest.advanceTimersByTimeAsync(12_000);
    expect(run.current()).toBe('declined');
    ents('hosting', 'bookings', 'store');
    const again = open('store_upgrade');
    await jest.advanceTimersByTimeAsync(0);
    expect(again.current()).toBe('purchased');
  });
});

describe('publish keeps the transaction rule', () => {
  it('any of the six products counts as paid, with no hosting.* required', async () => {
    sw.subscriptions = [SUB('com.ibrahim1774.aibarber.store.yearly')];
    const run = open('publish');
    await jest.advanceTimersByTimeAsync(0);
    expect(run.current()).toBe('purchased');
    expect(mockRefreshPlan).not.toHaveBeenCalled();
  });
  it('without a transaction it is declined', async () => {
    const run = open('publish');
    await jest.advanceTimersByTimeAsync(10_000);
    expect(run.current()).toBe('declined');
  });
});
