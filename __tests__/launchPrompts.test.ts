// The launch prompts (_layout's LaunchPrompts): notifications first, then ATT,
// never before Superwall has settled, each at most once.
import { createElement } from 'react';
import { AppState } from 'react-native';
import * as analytics from '@/lib/analytics';
// No @types for react-test-renderer here; require keeps it untyped.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');

let mockSettled = false;
jest.mock('@/lib/paywall', () => ({ useSuperwallSettled: () => mockSettled }));

const order: string[] = [];
let answerNotifications: (() => void) | null = null;
jest.mock('@/lib/reminders', () => ({
  askReminderPermissionOnce: jest.fn(
    () =>
      new Promise<boolean>((resolve) => {
        order.push('notifications');
        answerNotifications = () => resolve(true);
      }),
  ),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const reminders = require('@/lib/reminders');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LaunchPrompts, resetLaunchPromptsForTests } = require('@/lib/launchPrompts');

// Past the 600 ms beat before the ATT ask.
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 650)); });

let appState = 'active';
let listeners: ((s: string) => void)[] = [];

beforeEach(() => {
  resetLaunchPromptsForTests();
  mockSettled = false;
  order.length = 0;
  answerNotifications = null;
  reminders.askReminderPermissionOnce.mockClear();
  jest.restoreAllMocks();
  jest.spyOn(analytics, 'requestTrackingWhenActive').mockImplementation(() => {
    order.push('tracking');
  });
  appState = 'active';
  listeners = [];
  Object.defineProperty(AppState, 'currentState', { get: () => appState, configurable: true });
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, cb: (s: string) => void) => {
    listeners.push(cb);
    return { remove: () => (listeners = listeners.filter((l) => l !== cb)) };
  }) as never);
});

test('notification ask first; ATT only after it is answered', async () => {
  mockSettled = true;
  let r: any;
  await act(async () => {
    r = create(createElement(LaunchPrompts));
  });
  expect(order).toEqual(['notifications']);
  await act(async () => answerNotifications!());
  await flush();
  expect(order).toEqual(['notifications', 'tracking']);
  act(() => r.unmount());
});

test('neither ask before Superwall has settled', async () => {
  let r: any;
  await act(async () => {
    r = create(createElement(LaunchPrompts));
  });
  await flush();
  expect(order).toEqual([]);
  mockSettled = true;
  await act(async () => r.update(createElement(LaunchPrompts)));
  expect(order).toEqual(['notifications']);
  act(() => r.unmount());
});

test('each ask at most once (re-renders, remounts, a second component)', async () => {
  mockSettled = true;
  let a: any;
  let b: any;
  await act(async () => {
    a = create(createElement(LaunchPrompts));
    b = create(createElement(LaunchPrompts));
  });
  await act(async () => answerNotifications!());
  await act(async () => a.update(createElement(LaunchPrompts)));
  act(() => a.unmount());
  await act(async () => {
    a = create(createElement(LaunchPrompts));
  });
  await flush();
  expect(reminders.askReminderPermissionOnce).toHaveBeenCalledTimes(1);
  expect(analytics.requestTrackingWhenActive).toHaveBeenCalledTimes(1);
  expect(order).toEqual(['notifications', 'tracking']);
  act(() => a.unmount());
  act(() => b.unmount());
});

test('waits for the app to be active before asking', async () => {
  appState = 'inactive';
  mockSettled = true;
  let r: any;
  await act(async () => {
    r = create(createElement(LaunchPrompts));
  });
  expect(order).toEqual([]);
  appState = 'active';
  await act(async () => listeners.forEach((l) => l('active')));
  expect(order).toEqual(['notifications']);
  act(() => r.unmount());
});

test('a failing notification ask still leads to ATT', async () => {
  reminders.askReminderPermissionOnce.mockImplementationOnce(async () => {
    order.push('notifications');
    throw new Error('boom');
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockSettled = true;
  let r: any;
  await act(async () => {
    r = create(createElement(LaunchPrompts));
  });
  await flush();
  expect(order).toEqual(['notifications', 'tracking']);
  act(() => r.unmount());
});
