// The plan hint rides on the `publish` placement as Superwall params ({ plan }); nothing else gets params.
import React from 'react';
import { Alert } from 'react-native';
import { PRODUCT_IDS } from '@/lib/publish';

process.env.EXPO_PUBLIC_SUPERWALL_API_KEY = 'pk_test';
/* eslint-disable @typescript-eslint/no-require-imports */
const { sw } = require('expo-superwall');
const { usePaywall, usePublishDeps, placementParams } = require('@/lib/paywall');
const { act, create } = require('react-test-renderer') as { act(fn: () => void): void; create(el: React.ReactElement): { unmount(): void } };
/* eslint-enable @typescript-eslint/no-require-imports */

let show: (placement: string, hint?: string) => Promise<string>;
let deps: { showPaywall(hint?: string): Promise<string> };
let renderer: { unmount(): void };
function Harness() {
  show = usePaywall();
  deps = usePublishDeps();
  return null;
}
const ACTIVE = { transactionId: 'tx-1', productId: PRODUCT_IDS[0], purchaseDate: '2026-10-20T00:00:00Z', isActive: true, isRevoked: false };

beforeEach(() => {
  jest.useFakeTimers();
  sw.reset();
  sw.subscriptions = [ACTIVE];
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  act(() => { renderer = create(React.createElement(Harness)); });
});
afterEach(() => {
  act(() => renderer.unmount());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('placementParams', () => {
  test('publish carries the plan', () => {
    expect(placementParams('publish', 'bookings')).toEqual({ plan: 'bookings' });
    expect(placementParams('publish', 'store')).toEqual({ plan: 'store' });
    expect(placementParams('publish', 'website')).toEqual({ plan: 'website' });
  });
  test('no hint, or any other placement: no params', () => {
    expect(placementParams('publish')).toBeUndefined();
    expect(placementParams('bookings_upgrade', 'bookings')).toBeUndefined();
    expect(placementParams('store_upgrade', 'store')).toBeUndefined();
    expect(placementParams('custom_domain', 'store')).toBeUndefined();
  });
});

describe('registerPlacement', () => {
  test('publish with a hint registers { plan }', async () => {
    const p = show('publish', 'store');
    await jest.advanceTimersByTimeAsync(10);
    expect(sw.placements).toEqual([{ placement: 'publish', params: { plan: 'store' } }]);
    sw.callbacks.onDismiss?.({ closeReason: 'ManualClose' }, { type: 'purchased' });
    await jest.advanceTimersByTimeAsync(5000);
    await p;
  });

  test('publish without a hint registers no params (the Website default)', async () => {
    const p = show('publish');
    await jest.advanceTimersByTimeAsync(10);
    expect(sw.placements).toEqual([{ placement: 'publish', params: undefined }]);
    sw.callbacks.onDismiss?.({ closeReason: 'ManualClose' }, { type: 'purchased' });
    await jest.advanceTimersByTimeAsync(5000);
    await p;
  });

  test('the publish deps (publishFlow) pass the hint through to the placement', async () => {
    const p = deps.showPaywall('bookings');
    await jest.advanceTimersByTimeAsync(10);
    expect(sw.placements[0]).toEqual({ placement: 'publish', params: { plan: 'bookings' } });
    sw.callbacks.onDismiss?.({ closeReason: 'ManualClose' }, { type: 'purchased' });
    await jest.advanceTimersByTimeAsync(5000);
    await p;
  });
});
