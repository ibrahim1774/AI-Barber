/**
 * Superwall purchase events → SubscriptionSync → the real analytics module →
 * AppsFlyer. jest.config maps '@/lib/analytics' to a no-op mock; this file
 * swaps the real one back in (relative path, which the mapper doesn't touch)
 * and mocks only the native SDKs.
 */
import React from 'react';

const mockAf = {
  init: jest.fn(async () => {}),
  registerSessionReadyListener: jest.fn(async (cb: () => void) => {
    mockAf.sessionReady = cb;
  }),
  enableDebug: jest.fn(async () => {}),
  start: jest.fn(async () => {}),
  logEvent: jest.fn(async () => {}),
  getAppsFlyerUID: jest.fn(async (): Promise<string | null> => 'af-uid-1'),
  sessionReady: null as null | (() => void),
};
jest.mock('react-native-appsflyer', () => ({ __esModule: true, default: mockAf, AppsFlyer: mockAf }));
const mockPh = { capture: jest.fn(), identify: jest.fn(), reset: jest.fn(), screen: jest.fn() };
jest.mock('posthog-react-native', () => ({
  __esModule: true,
  default: function PostHog() {
    return mockPh;
  },
}));
jest.mock('expo-tracking-transparency', () => ({
  getTrackingPermissionsAsync: async () => ({ status: 'denied' }),
  requestTrackingPermissionsAsync: async () => ({ status: 'denied' }),
}));
jest.mock('@/lib/analytics', () => jest.requireActual('../src/lib/analytics'));

process.env.EXPO_PUBLIC_SUPERWALL_API_KEY = 'pk_test';
process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY = 'devkey';
process.env.EXPO_PUBLIC_APPLE_APP_ID = '6825001790';
process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test';
/* eslint-disable @typescript-eslint/no-require-imports */
const { sw } = require('expo-superwall');
const { SubscriptionSync } = require('@/lib/paywall');
const analytics = require('@/lib/analytics');
const { act, create } = require('react-test-renderer') as {
  act(fn: () => void | Promise<void>): Promise<void> | void;
  create(el: React.ReactElement): { unmount(): void };
};
/* eslint-enable @typescript-eslint/no-require-imports */

const PRODUCT = { productIdentifier: 'aibarber_monthly', price: 19.99, currencyCode: 'USD' };
let renderer: { unmount(): void };

beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  await analytics.initAttribution();
  mockAf.sessionReady?.();
  await analytics.requestTrackingThenStart();
  await act(async () => {
    renderer = create(React.createElement(SubscriptionSync));
  });
});
afterAll(() => renderer.unmount());
beforeEach(() => {
  mockAf.logEvent.mockClear();
  mockPh.capture.mockClear();
});

test('the analytics under test is the real module, already started', () => {
  expect(analytics.pendingAttributionEvents()).toBe(0);
  expect(mockAf.start).toHaveBeenCalledTimes(1);
  expect(typeof sw.events.onSuperwallEvent).toBe('function');
});

test('Superwall subscriptionStart sends af_subscribe with price, currency and product', () => {
  sw.events.onSuperwallEvent!({ event: { event: 'subscriptionStart', product: PRODUCT } });
  expect(mockAf.logEvent).toHaveBeenCalledTimes(1);
  expect(mockAf.logEvent).toHaveBeenCalledWith({
    eventName: 'af_subscribe',
    eventValues: { af_revenue: 19.99, af_currency: 'USD', af_content_id: 'aibarber_monthly' },
  });
});

test('Superwall freeTrialStart sends nothing to AppsFlyer', () => {
  sw.events.onSuperwallEvent!({ event: { event: 'freeTrialStart', product: PRODUCT } });
  expect(mockAf.logEvent).not.toHaveBeenCalled();
  expect(mockPh.capture).toHaveBeenCalledWith('trial_started', { product: 'aibarber_monthly', price: 19.99, currency: 'USD' });
});

test('other Superwall events send nothing to AppsFlyer', () => {
  sw.events.onSuperwallEvent!({ event: { event: 'transactionStart', product: PRODUCT } });
  expect(mockAf.logEvent).not.toHaveBeenCalled();
});
