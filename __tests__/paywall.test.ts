// usePaywall's settle logic, driven through the expo-superwall mock's captured
// placement callbacks.
import React from 'react';
import { Alert } from 'react-native';
import { PRODUCT_IDS } from '@/lib/publish';

// The key must be set before paywall.tsx is loaded (superwallActive is fixed at load).
process.env.EXPO_PUBLIC_SUPERWALL_API_KEY = 'pk_test';
/* eslint-disable @typescript-eslint/no-require-imports */
const { sw } = require('expo-superwall');
const { usePaywall, superwallActive } = require('@/lib/paywall');
// No @types/react-test-renderer in the project: the two calls used here.
const { act, create } = require('react-test-renderer') as {
  act(fn: () => void): void;
  create(el: React.ReactElement): { unmount(): void };
};
/* eslint-enable @typescript-eslint/no-require-imports */

type Result = 'purchased' | 'restored' | 'declined';
let show: (placement: 'publish') => Promise<Result>;
let renderer: { unmount(): void };

function Harness() {
  show = usePaywall();
  return null;
}

const ACTIVE = {
  transactionId: 'tx-1', productId: PRODUCT_IDS[0], purchaseDate: '2026-10-20T00:00:00Z', isActive: true, isRevoked: false,
};
const hold = () => new Promise<void>(() => {});

/** Start a paywall and report whether it has settled yet. */
function open() {
  let result: Result | null = null;
  const p = show('publish').then((r) => (result = r));
  return { p, current: () => result };
}

beforeEach(() => {
  jest.useFakeTimers();
  sw.reset();
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

test('the Superwall path is under test', () => {
  expect(superwallActive).toBe(true);
});

test('a skip with no active subscription is declined', async () => {
  sw.register = hold;
  const run = open();
  sw.callbacks.onSkip?.({ type: 'Holdout' });
  await jest.advanceTimersByTimeAsync(5000);
  expect(run.current()).toBe('declined');
  expect(Alert.alert).toHaveBeenCalled();
});

test('a declined dismiss is declined', async () => {
  sw.register = hold;
  const run = open();
  sw.callbacks.onDismiss?.({ closeReason: 'manualClose' }, { type: 'declined' });
  await jest.advanceTimersByTimeAsync(5000);
  expect(run.current()).toBe('declined');
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('a purchased dismiss is purchased', async () => {
  sw.register = hold;
  const run = open();
  sw.callbacks.onDismiss?.({ closeReason: 'systemLogic' }, { type: 'purchased', productId: PRODUCT_IDS[0] });
  await jest.advanceTimersByTimeAsync(0);
  expect(run.current()).toBe('purchased');
});

test('feature first, then a skip, with no active subscription is declined', async () => {
  // register resolves at once, so the feature closure runs before the skip event.
  const run = open();
  await jest.advanceTimersByTimeAsync(0);
  sw.callbacks.onSkip?.({ type: 'NoAudienceMatch' });
  await jest.advanceTimersByTimeAsync(5000);
  expect(run.current()).toBe('declined');
  // No paywall ever showed: say why nothing happened.
  expect(Alert.alert).toHaveBeenCalled();
});

test('skip first, then feature, with no active subscription is declined with the Alert', async () => {
  let release!: () => void;
  sw.register = () => new Promise<void>((r) => { release = r; });
  const run = open();
  sw.callbacks.onSkip?.({ type: 'Holdout' });
  release();
  await jest.advanceTimersByTimeAsync(5000);
  expect(run.current()).toBe('declined');
  expect(Alert.alert).toHaveBeenCalledTimes(1);
});

test('a registerPlacement rejection is declined', async () => {
  sw.register = async () => { throw new Error('Superwall configure did not complete'); };
  const run = open();
  await jest.advanceTimersByTimeAsync(5000);
  expect(run.current()).toBe('declined');
  expect(Alert.alert).toHaveBeenCalled();
});

test('verify that never resolves settles declined after the timeout', async () => {
  sw.register = hold;
  sw.customerInfo = () => new Promise(() => {}); // no Superwall config: native never answers
  const run = open();
  sw.callbacks.onError?.('config fetch failed');
  await jest.advanceTimersByTimeAsync(5999);
  expect(run.current()).toBeNull();
  await jest.advanceTimersByTimeAsync(1);
  expect(run.current()).toBe('declined');
  expect(Alert.alert).toHaveBeenCalled();
});

test('a paywall the user saw and closed is declined quietly, even if feature came first', async () => {
  const run = open(); // feature runs at once (a non-gated paywall)
  sw.callbacks.onPresent?.({ name: 'AI Barber Publish' });
  sw.callbacks.onDismiss?.({ closeReason: 'manualClose' }, { type: 'declined' });
  await jest.advanceTimersByTimeAsync(5000);
  expect(run.current()).toBe('declined');
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('feature with an active subscription is purchased', async () => {
  sw.subscriptions = [ACTIVE];
  const run = open();
  await jest.advanceTimersByTimeAsync(0);
  expect(run.current()).toBe('purchased');
});

test('feature first, then the purchased dismiss while the transaction is still landing, is purchased', async () => {
  const run = open();
  await jest.advanceTimersByTimeAsync(500);
  expect(run.current()).toBeNull(); // still looking
  sw.callbacks.onDismiss?.({ closeReason: 'systemLogic' }, { type: 'purchased', productId: PRODUCT_IDS[1] });
  await jest.advanceTimersByTimeAsync(0);
  expect(run.current()).toBe('purchased');
});

test('a forNextPaywall dismiss is ignored', async () => {
  sw.register = hold;
  const run = open();
  sw.callbacks.onDismiss?.({ closeReason: 'forNextPaywall' }, { type: 'declined' });
  await jest.advanceTimersByTimeAsync(5000);
  expect(run.current()).toBeNull();
  sw.callbacks.onDismiss?.({ closeReason: 'systemLogic' }, { type: 'purchased', productId: PRODUCT_IDS[0] });
  await jest.advanceTimersByTimeAsync(0);
  expect(run.current()).toBe('purchased');
});

test('an error with no active subscription is declined', async () => {
  sw.register = hold;
  const run = open();
  sw.callbacks.onError?.('no network');
  await jest.advanceTimersByTimeAsync(5000);
  expect(run.current()).toBe('declined');
});
