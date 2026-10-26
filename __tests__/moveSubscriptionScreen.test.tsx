// The Move button in the places that used to be dead ends: the locked claim step, and the Bookings / Store lock.
import React from 'react';
import { Alert } from 'react-native';
import { act, allText, hasButton, press, render } from './store/render';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), canGoBack: () => true, back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('@/components/Icons', () => ({ InfoIcon: () => null, ChevronLeftIcon: () => null, ArrowRight: () => null }));
const mockResetTo = jest.fn();
jest.mock('@/lib/nav', () => ({ resetTo: (...a: unknown[]) => mockResetTo(...a), homeRoute: (s: unknown) => (s ? '/edit' : '/start') }));
const mockRestore = jest.fn();
jest.mock('@/lib/restoreFlow', () => ({ useRestoreFlow: () => ({ restore: (...a: unknown[]) => mockRestore(...a), busy: false }) }));
let mockDeps: any;
jest.mock('@/lib/paywall', () => ({ usePublishDeps: () => mockDeps, useLatestTransactionId: () => async () => 'tx-1' }));
const mockRecheck = jest.fn();
jest.mock('@/lib/subscriptionStatus', () => ({ recheckSubscriptionStatus: (...a: unknown[]) => mockRecheck(...a) }));
const mockPlanCall = jest.fn();
jest.mock('@/lib/setup/ownerApi', () => ({ call: (...a: unknown[]) => mockPlanCall(...a) }));

import Claim from '@/app/claim';
import { UpgradeCard } from '@/components/UpgradeCard';
import * as store from '@/lib/siteStore';
import type { SiteRecord } from '@/lib/siteStore';
import { ApiError, api } from '@/lib/api';
import { accessToken } from '@/lib/accessToken';
import { MOVE_BUTTON_TITLE, conflictMessage } from '@/lib/claimCopy';
import { MOVE_CONFIRM_OK, MOVE_ERROR } from '@/lib/moveSubscription';
import { getSharedPlan, resetSharedPlan } from '@/lib/plan';
import { resetEntitlementsForTests, setEntitlementsFromStatus } from '@/lib/entitlements';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sb } = require('@/lib/supabase');

const data: any = { shopName: 'Fade Lab', area: 'Brooklyn', phone: '(555) 010-2030', bookingUrl: 'https://booksy.com/x', hero: {}, about: {}, services: [], gallery: [] };
const draft = { draftId: 'd1', inputs: { shopName: 'Fade Lab', phone: '(555) 010-2030' }, data, updatedAt: 1, slug: null, deployedUrl: null, transactionId: null } as unknown as SiteRecord;
const LIVE = { siteId: 'fade', deployedUrl: 'https://fade.aibarber.org', republished: false };
const text = (tree: any) => allText(tree).join(' | ');
const confirmRequired = () => new ApiError(409, 'confirm-required', 'x', { ownerHint: 'a***@gmail.com', hasLiveSite: true, ownerToken: 'tok-1' });

let iosPublish: jest.Mock;
let transfer: jest.SpyInstance;
let alertSpy: jest.SpyInstance;
/** Taps a button of the last Alert. */
const tap = async (label: string) => {
  const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as { text: string; onPress?: () => void }[];
  const b = buttons.find((x) => x.text === label)!;
  await act(async () => { b.onPress?.(); await new Promise((r) => setTimeout(r, 0)); });
};

beforeEach(async () => {
  jest.restoreAllMocks();
  mockResetTo.mockClear();
  mockRecheck.mockClear();
  mockPlanCall.mockReset().mockResolvedValue({ linked: true, tier: 'website', entitlements: { hosting: true, bookings: false, store: false }, active: true, purchaseAccount: 'self' });
  resetSharedPlan();
  sb.reset();
  sb.setSession({ access_token: 't', user: { id: 'user-a', email: 'a@example.com' } });
  iosPublish = jest.fn(async () => LIVE);
  mockDeps = {
    hasEntitlement: async () => false, showPaywall: async () => 'purchased', latestTransactionId: async () => 'tx-1',
    iosPublish, claimStart: async () => ({ ok: true, state: 'unclaimed', claimExpiresAt: 'x' }), accessToken, store,
  };
  transfer = jest.spyOn(api, 'transfer');
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await store.saveSite(draft);
  await store.savePendingPublish({
    transactionId: 'tx-1', data, createdAt: Date.now(), state: 'conflict', conflict: { code: 'purchase-other-account', hint: 'a***@gmail.com' },
  });
});

describe('claim screen: purchase belongs to another account', () => {
  test('shows the Move button next to "Use a different account", and the clearer copy', async () => {
    const tree = await render(<Claim />);
    expect(hasButton(tree, MOVE_BUTTON_TITLE)).toBe(true);
    expect(hasButton(tree, 'Use a different account')).toBe(true);
    expect(text(tree)).toContain(conflictMessage({ code: 'purchase-other-account', hint: 'a***@gmail.com' }));
    expect(text(tree)).toMatch(/tied to the Apple ID/);
  });

  test('account-has-site cannot be fixed by moving: no Move button', async () => {
    await store.savePendingPublish({ transactionId: 'tx-1', data, createdAt: Date.now(), state: 'conflict', conflict: { code: 'account-has-site', slug: 'old-cuts' } });
    const tree = await render(<Claim />);
    expect(hasButton(tree, MOVE_BUTTON_TITLE)).toBe(false);
    expect(hasButton(tree, 'Use a different account')).toBe(true);
  });

  test('tap: confirm Alert with the masked owner; Cancel changes nothing', async () => {
    transfer.mockRejectedValueOnce(confirmRequired());
    const tree = await render(<Claim />);
    await press(tree, MOVE_BUTTON_TITLE);
    const [title, body, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe('Move this subscription?');
    expect(body).toBe("This subscription is on another account (a***@gmail.com). Moving it here takes that account's website offline.");
    expect(buttons.map((b: any) => b.text)).toEqual(['Cancel', 'Move here']);
    expect(buttons[0].style).toBe('cancel');
    await tap('Cancel');
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(iosPublish).not.toHaveBeenCalled();
    expect(text(tree)).toContain(conflictMessage({ code: 'purchase-other-account', hint: 'a***@gmail.com' }));
    expect(await store.loadPendingPublish()).toMatchObject({ state: 'conflict' });
  });

  test('Move here: transfer with confirm:true, plan refreshed, then the pending publish resumes and goes live', async () => {
    transfer.mockRejectedValueOnce(confirmRequired()).mockResolvedValueOnce({ moved: true, linked: true });
    const tree = await render(<Claim />);
    await press(tree, MOVE_BUTTON_TITLE);
    await tap(MOVE_CONFIRM_OK);
    expect(transfer.mock.calls).toEqual([['tx-1'], ['tx-1', true, 'tok-1']]);
    expect(mockPlanCall).toHaveBeenCalledWith('POST', '/api/shop/plan', { transactionId: 'tx-1' });
    expect(getSharedPlan()).toMatchObject({ purchaseAccount: 'self' });
    expect(mockRecheck).toHaveBeenCalled();
    expect(iosPublish).toHaveBeenCalledTimes(1);
    expect(mockResetTo).toHaveBeenCalledWith('/live');
  });

  test.each([
    ['account-has-site', new ApiError(409, 'account-has-site', 'x', { slug: 'old-cuts' }), MOVE_ERROR.accountHasSite],
    ['subscription-inactive', new ApiError(402, 'subscription-inactive', 'x'), MOVE_ERROR.inactive],
    ['offline', new ApiError(0, 'network', 'x'), MOVE_ERROR.offline],
  ])('%s: one sentence under the button, still locked, nothing published', async (_n, e, message) => {
    transfer.mockRejectedValueOnce(confirmRequired()).mockRejectedValueOnce(e);
    const tree = await render(<Claim />);
    await press(tree, MOVE_BUTTON_TITLE);
    await tap(MOVE_CONFIRM_OK);
    expect(text(tree)).toContain(message);
    expect(iosPublish).not.toHaveBeenCalled();
    expect(mockResetTo).not.toHaveBeenCalled();
    expect(await store.loadPendingPublish()).toMatchObject({ state: 'conflict' });
    expect(hasButton(tree, MOVE_BUTTON_TITLE)).toBe(true);
  });
});

describe('Bookings / Store lock (UpgradeCard)', () => {
  const lock = () => {
    setEntitlementsFromStatus({ status: 'ACTIVE', entitlements: [{ id: 'hosting' }, { id: 'bookings' }, { id: 'store' }] });
    // The server says another account owns it.
    const { setSharedPlan } = require('@/lib/plan');
    setSharedPlan({
      linked: true, tier: 'store', entitlements: { hosting: true, bookings: true, store: true }, active: true, expiresAt: null,
      takenDownAt: null, revoked: false, purchaseAccount: 'other', purchaseHint: 'a***@gmail.com', capabilities: { memberProfile: false },
    });
  };
  beforeEach(() => resetEntitlementsForTests());

  test('the dead end has the Move button; success refreshes the plan so the tab unlocks', async () => {
    lock();
    transfer.mockRejectedValueOnce(confirmRequired()).mockResolvedValueOnce({ moved: true, linked: true });
    const tree = await render(<UpgradeCard kind="bookings" onUpgrade={jest.fn()} />);
    expect(text(tree)).toMatch(/tied to the Apple ID/);
    expect(hasButton(tree, MOVE_BUTTON_TITLE)).toBe(true);
    expect(hasButton(tree, 'See the Bookings plan')).toBe(false);
    await press(tree, MOVE_BUTTON_TITLE);
    await tap(MOVE_CONFIRM_OK);
    expect(transfer).toHaveBeenLastCalledWith('tx-1', true, 'tok-1');
    expect(getSharedPlan()).toMatchObject({ purchaseAccount: 'self' });
  });
});
