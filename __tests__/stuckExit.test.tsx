// The locked account step as the user meets it.
import fs from 'fs';
import path from 'path';
import React from 'react';
import { BackHandler } from 'react-native';
import { act, allText, hasButton, press, render, type as typeIn } from './store/render';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), canGoBack: () => true, back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('@/components/Icons', () => ({ InfoIcon: () => null, ChevronLeftIcon: () => null, ArrowRight: () => null }));
const mockResetTo = jest.fn();
jest.mock('@/lib/nav', () => ({ resetTo: (...a: unknown[]) => mockResetTo(...a), homeRoute: (s: unknown) => (s ? '/edit' : '/start') }));
const mockRestore = jest.fn();
jest.mock('@/lib/restoreFlow', () => ({ useRestoreFlow: () => ({ restore: (...a: unknown[]) => mockRestore(...a), busy: false }) }));
let mockDeps: any;
jest.mock('@/lib/paywall', () => ({ usePublishDeps: () => mockDeps, useLatestTransactionId: () => async () => 'tx-1' }));

import Claim from '@/app/claim';
import * as store from '@/lib/siteStore';
import type { SiteRecord } from '@/lib/siteStore';
import { ApiError, api } from '@/lib/api';
import { accessToken } from '@/lib/accessToken';
import { OFFLINE } from '@/lib/auth';
import { conflictMessage } from '@/lib/claimCopy';
import { WAITING_MESSAGE } from '@/lib/claim';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sb, supabase } = require('@/lib/supabase');

const data: any = {
  shopName: 'Fade Lab', area: 'Brooklyn', phone: '(555) 010-2030', bookingUrl: 'https://booksy.com/x',
  hero: {}, about: {}, services: [], gallery: [],
};
const draft = { draftId: 'd1', inputs: { shopName: 'Fade Lab', phone: '(555) 010-2030' }, data, updatedAt: 1, slug: null, deployedUrl: null, transactionId: null } as unknown as SiteRecord;
const LIVE = { siteId: 'fade', deployedUrl: 'https://fade.aibarber.org', republished: false };
const A = { id: 'user-a', email: 'a@example.com' };

const FIELDS = ['Full Name', 'Email', 'Phone Number', 'Password (min 8 characters)'];
const inputs = (tree: any, label: string) =>
  tree.root.findAll((n: any) => n.type === 'TextInput' && n.props?.accessibilityLabel === label && typeof n.props.onChangeText === 'function');
const textOf = (n: any): string => (n.children ?? []).map((c: any) => (typeof c === 'string' ? c : textOf(c))).join('');
/** Links ("Sign in", "Create an account", "Forgot password?") carry accessibilityRole link, not button. */
async function pressLink(tree: any, title: string) {
  const l = tree.root.findAll((n: any) => n.props?.accessibilityRole === 'link' && typeof n.props.onPress === 'function' && textOf(n) === title)[0];
  if (!l) throw new Error(`No link "${title}". Text: ${text(tree)}`);
  await act(async () => { await l.props.onPress(); });
}
const valueOf = (tree: any, label: string) => inputs(tree, label)[0]?.props.value;
const text = (tree: any) => allText(tree).join(' | ');

async function fill(tree: any, over: Record<string, string> = {}) {
  const v: Record<string, string> = {
    'Full Name': 'Jo Barber', Email: 'jo@example.com', 'Phone Number': '5125550142',
    'Password (min 8 characters)': 'hunter22!', ...over,
  };
  for (const [k, val] of Object.entries(v)) await typeIn(tree, k, val);
}

let iosPublish: jest.Mock;
let signup: jest.SpyInstance;

beforeEach(async () => {
  jest.restoreAllMocks();
  mockResetTo.mockClear();
  mockPush.mockClear();
  sb.reset();
  supabase.auth.signInWithPassword.mockImplementation(async ({ email }: { email: string }) => {
    const session = { access_token: `tok-${email}`, user: { id: `id-${email}`, email } };
    sb.setSession(session);
    return { data: { user: session.user, session }, error: null };
  });
  iosPublish = jest.fn(async () => LIVE);
  mockDeps = {
    hasEntitlement: async () => false, showPaywall: async () => 'purchased', latestTransactionId: async () => 'tx-1',
    iosPublish, claimStart: async () => ({ ok: true, state: 'unclaimed', claimExpiresAt: 'x' }), accessToken, store,
  };
  signup = jest.spyOn(api, 'signup').mockImplementation((async (b: { email: string }) => ({ ok: true, email: b.email })) as never);
  await store.saveSite(draft);
  await store.savePendingPublish({ transactionId: 'tx-1', data, createdAt: Date.now(), state: 'unclaimed' });
});


import { Linking } from 'react-native';
import { shouldLockToClaim, claimLocked } from '@/lib/claimGuard';
import { publishFlow } from '@/lib/publish';
import { SUPPORT_URL } from '@/components/SupportLink';

const supportLinks = (tree: any) =>
  tree.root.findAll((n: any) => n.props?.accessibilityRole === 'link' && typeof n.props.onPress === 'function' && textOf(n) === 'Need help? Contact support');

describe('stuck exit: inactive purchase', () => {
  test('402 at sign up parks the record: the guard no longer locks and Back to the editor lands in the editor', async () => {
    signup.mockRejectedValueOnce(new ApiError(402, 'subscription-inactive', 'x'));
    const tree = await render(<Claim />);
    await fill(tree);
    await press(tree, 'Create Account & Publish');
    expect(text(tree)).toContain('Subscription inactive');
    expect(await store.loadPendingPublish()).toBeNull();
    expect(await claimLocked()).toBe(false);
    expect(supportLinks(tree)).toHaveLength(1);
    mockResetTo.mockClear();
    await press(tree, 'Back to the editor');
    expect(mockResetTo).toHaveBeenCalledWith('/edit');
    expect(await claimLocked()).toBe(false);
    expect((await store.loadSite())?.draftId).toBe('d1'); // what the user typed stays
  });

  test('the publish outcome inactive (402) does not lock either', async () => {
    await store.savePendingPublish({ transactionId: 'tx-1', data, createdAt: Date.now(), state: 'claiming' });
    sb.setSession({ access_token: 't', user: { id: 'u', email: 'a@b.c' } });
    iosPublish.mockRejectedValueOnce(new ApiError(402, 'subscription-inactive', 'x'));
    const tree = await render(<Claim />);
    expect(text(tree)).toContain('Not published');
    expect(await claimLocked()).toBe(false);
    expect(supportLinks(tree)).toHaveLength(1);
  });

  test('a new payment replaces a stale record: no old transactionId reused', async () => {
    const deps: any = {
      store, accessToken: async () => null, hasEntitlement: async () => false, showPaywall: jest.fn(async () => 'purchased'),
      latestTransactionId: async () => 'tx-NEW', claimStart: async () => ({ ok: true }), iosPublish: jest.fn(),
    };
    await store.savePendingPublish(null);
    const out = await publishFlow(draft, deps);
    expect(out.kind).toBe('claim-required');
    expect(deps.showPaywall).toHaveBeenCalledTimes(1);
    expect((await store.loadPendingPublish())?.transactionId).toBe('tx-NEW');
  });
});

describe('stuck exit: Back from the account step', () => {
  test('keeps the record with its transactionId, paused, and unlocks the app', async () => {
    const tree = await render(<Claim />);
    expect(await claimLocked()).toBe(true);
    await press(tree, 'Back');
    const p = await store.loadPendingPublish();
    expect(p?.state).toBe('paused');
    expect(p?.transactionId).toBe('tx-1');
    expect(await claimLocked()).toBe(false);
    expect(shouldLockToClaim(p, false)).toBe(false);
    expect(mockResetTo).toHaveBeenCalledWith('/edit');
    expect(signup).not.toHaveBeenCalled();
  });

  const flowDeps = (over: any = {}): any => ({
    store, accessToken: async () => null, hasEntitlement: async () => false, showPaywall: jest.fn(async () => 'purchased'),
    latestTransactionId: async () => 'tx-NEW', claimStart: async () => ({ ok: true }), iosPublish: jest.fn(), ...over,
  });

  test('Publish with a paused paid record goes to /claim, no paywall, same transaction', async () => {
    await store.savePendingPublish({ transactionId: 'tx-1', data, createdAt: 1, state: 'paused' });
    const deps = flowDeps();
    const out = await publishFlow(draft, deps);
    expect(out.kind).toBe('claim-required');
    expect(deps.showPaywall).not.toHaveBeenCalled();
    const p = await store.loadPendingPublish();
    expect(p?.state).toBe('unclaimed');
    expect(p?.transactionId).toBe('tx-1');
    expect(deps.iosPublish).not.toHaveBeenCalled();
  });

  test('Publish with a parked (inactive) record shows the paywall again', async () => {
    await store.savePendingPublish(null); // 402 parks by dropping the record
    const deps = flowDeps();
    await publishFlow(draft, deps);
    expect(deps.showPaywall).toHaveBeenCalledTimes(1);
  });

  test('Publish with a paused record the server says is inactive (402) is parked and nothing is published', async () => {
    await store.savePendingPublish({ transactionId: 'tx-1', data, createdAt: 1, state: 'paused' });
    const deps = flowDeps({ claimStart: async () => { throw new ApiError(402, 'subscription-inactive', 'x'); } });
    const out = await publishFlow(draft, deps);
    expect(out.kind).toBe('inactive');
    expect(await store.loadPendingPublish()).toBeNull();
    const deps2 = flowDeps();
    await publishFlow(draft, deps2);
    expect(deps2.showPaywall).toHaveBeenCalledTimes(1);
  });

  test('Publish with no record shows the paywall', async () => {
    await store.savePendingPublish(null);
    const deps = flowDeps();
    await publishFlow(draft, deps);
    expect(deps.showPaywall).toHaveBeenCalledTimes(1);
  });
});

describe('stuck exit: every state has an exit', () => {
  test('form: support link (mailto + subject), Sign in, Back, Restore purchases', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    const tree = await render(<Claim />);
    expect(supportLinks(tree)).toHaveLength(1);
    await act(async () => { await supportLinks(tree)[0].props.onPress(); });
    expect(open).toHaveBeenCalledWith(SUPPORT_URL);
    expect(SUPPORT_URL).toBe('mailto:support@davoxa.com?subject=Prime%20Barber%20account%20help');
    expect(text(tree)).toContain('Restore purchases');
    await pressLink(tree, 'Sign in');
    expect(text(tree)).toContain('Forgot password?');
    expect(supportLinks(tree)).toHaveLength(1);
  });

  test('error banner and waiting banner keep the support link and a retry', async () => {
    signup.mockRejectedValueOnce(new ApiError(503, 'temporarily-unavailable', 'x'));
    let tree = await render(<Claim />);
    await fill(tree);
    await press(tree, 'Create Account & Publish');
    expect(text(tree)).toContain('We couldn’t create your account just now');
    expect(supportLinks(tree)).toHaveLength(1);
    expect(hasButton(tree, 'Create Account & Publish')).toBe(true);
    signup.mockRejectedValueOnce(new ApiError(0, 'network', 'offline'));
    await press(tree, 'Create Account & Publish');
    expect(text(tree)).toContain(WAITING_MESSAGE);
    expect(hasButton(tree, 'Try again')).toBe(true);
    expect(supportLinks(tree)).toHaveLength(1);
  });

  test('blocked: support link, Use a different account, and Move when movable', async () => {
    await store.savePendingPublish({
      transactionId: 'tx-1', data, createdAt: 1, state: 'conflict', conflict: { code: 'purchase-other-account', hint: 'a***@x.com' },
    });
    const tree = await render(<Claim />);
    expect(hasButton(tree, 'Use a different account')).toBe(true);
    expect(supportLinks(tree)).toHaveLength(1);
    expect(text(tree)).toMatch(/Move/);
  });

  test('blocked, not movable (existing site): still support link and a different account', async () => {
    await store.savePendingPublish({
      transactionId: 'tx-1', data, createdAt: 1, state: 'conflict', conflict: { code: 'account-has-site', slug: 'fade' },
    });
    const tree = await render(<Claim />);
    expect(hasButton(tree, 'Use a different account')).toBe(true);
    expect(supportLinks(tree)).toHaveLength(1);
  });
});
