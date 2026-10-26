// The root guard: a paid publish waiting for its account means /claim, on every screen but the flow's own.
import React from 'react';
import { AppState } from 'react-native';
import { act, render } from './store/render';

let mockPath = '/edit';
let mockNavKey: string | undefined = 'k';
jest.mock('expo-router', () => ({ usePathname: () => mockPath, useRootNavigationState: () => ({ key: mockNavKey }) }));
const mockResetTo = jest.fn();
jest.mock('@/lib/nav', () => ({ resetTo: (...a: unknown[]) => mockResetTo(...a) }));
let mockLocked = false;
jest.mock('@/lib/claimGuard', () => ({
  CLAIM_ALLOWED_PATHS: ['/claim', '/publishing', '/forgot-password', '/reset-password'],
  claimLocked: async () => mockLocked,
}));

import { ClaimGuard } from '@/components/ClaimGuard';

beforeEach(() => {
  mockResetTo.mockClear();
  mockPath = '/edit';
  mockNavKey = 'k';
  mockLocked = false;
});

test('locked: any ordinary screen is sent to /claim', async () => {
  mockLocked = true;
  for (const p of ['/', '/edit', '/start', '/settings', '/live', '/sign-in', '/sign-up']) {
    mockResetTo.mockClear();
    mockPath = p;
    await render(<ClaimGuard />);
    expect(mockResetTo).toHaveBeenCalledWith('/claim');
  }
});

test('locked: the account step, the publish overlay and password reset are left alone', async () => {
  mockLocked = true;
  for (const p of ['/claim', '/publishing', '/forgot-password', '/reset-password']) {
    mockPath = p;
    await render(<ClaimGuard />);
  }
  expect(mockResetTo).not.toHaveBeenCalled();
});

test('not locked: nothing moves', async () => {
  await render(<ClaimGuard />);
  expect(mockResetTo).not.toHaveBeenCalled();
});

test('waits for the navigator before acting', async () => {
  mockLocked = true;
  mockNavKey = undefined;
  await render(<ClaimGuard />);
  expect(mockResetTo).not.toHaveBeenCalled();
});

test('coming back from the background while locked returns to /claim, and not when the step is already open', async () => {
  let handler: (s: string) => void = () => {};
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_e: string, h: (s: string) => void) => {
    handler = h;
    return { remove: jest.fn() };
  }) as never);
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  mockLocked = true;
  await render(<ClaimGuard />); // on /edit: sent once at mount
  mockResetTo.mockClear();
  await act(async () => { handler('background'); handler('active'); });
  expect(mockResetTo).toHaveBeenCalledWith('/claim');

  mockResetTo.mockClear();
  mockPath = '/claim';
  await render(<ClaimGuard />);
  await act(async () => { handler('background'); handler('active'); });
  expect(mockResetTo).not.toHaveBeenCalled();
});
