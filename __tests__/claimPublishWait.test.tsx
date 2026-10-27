// After payment + account the user stays on "Publishing your site" and the app waits out transient answers by itself.
import React from 'react';
import { act, allText, hasButton, press, render, type as typeIn } from './store/render';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), canGoBack: () => true, back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('@/components/Icons', () => ({ InfoIcon: () => null, ChevronLeftIcon: () => null, ArrowRight: () => null }));
const mockResetTo = jest.fn();
jest.mock('@/lib/nav', () => ({ resetTo: (...a: unknown[]) => mockResetTo(...a), homeRoute: (s: unknown) => (s ? '/edit' : '/start') }));
jest.mock('@/lib/restoreFlow', () => ({ useRestoreFlow: () => ({ restore: jest.fn(), busy: false }) }));
let mockDeps: any;
jest.mock('@/lib/paywall', () => ({ usePaywall: () => jest.fn(async () => 'declined'), usePublishDeps: () => mockDeps, useLatestTransactionId: () => async () => 'tx-1' }));

import Claim from '@/app/claim';
import * as store from '@/lib/siteStore';
import type { SiteRecord } from '@/lib/siteStore';
import { ApiError, api } from '@/lib/api';
import { accessToken } from '@/lib/accessToken';
import { STILL_PUBLISHING_MESSAGE, waitConfig } from '@/lib/claim';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sb, supabase } = require('@/lib/supabase');

const data: any = { shopName: 'Fade Lab', area: 'Brooklyn', phone: '(555) 010-2030', bookingUrl: 'https://booksy.com/x', hero: {}, about: {}, services: [], gallery: [] };
const draft = { draftId: 'd1', inputs: { shopName: 'Fade Lab', phone: '(555) 010-2030' }, data, updatedAt: 1, slug: null, deployedUrl: null, transactionId: null } as unknown as SiteRecord;
const LIVE = { siteId: 'fade', deployedUrl: 'https://fade.aibarber.org', republished: false };
const text = (tree: any) => allText(tree).join(' | ');
const inputs = (tree: any, label: string) => tree.root.findAll((n: any) => n.type === 'TextInput' && n.props?.accessibilityLabel === label && typeof n.props.onChangeText === 'function');
const textOf = (n: any): string => (n.children ?? []).map((c: any) => (typeof c === 'string' ? c : textOf(c))).join('');
const noForm = (tree: any) => inputs(tree, 'Email').length === 0 && !hasButton(tree, 'Create Account & Publish');

const realWait = { ...waitConfig };
let clock = 0;
let iosPublish: jest.Mock;
let signup: jest.SpyInstance;

async function submit(tree: any) {
  for (const [k, v] of Object.entries({ 'Full Name': 'Jo Barber', Email: 'jo@example.com', 'Phone Number': '5125550142', 'Password (min 8 characters)': 'hunter22!' })) await typeIn(tree, k, v);
  await press(tree, 'Create Account & Publish');
}

beforeEach(async () => {
  jest.restoreAllMocks();
  mockResetTo.mockClear();
  sb.reset();
  clock = 0;
  waitConfig.now = () => clock;
  waitConfig.sleep = async (ms) => { clock += ms; };
  supabase.auth.signInWithPassword.mockImplementation(async ({ email }: { email: string }) => {
    const session = { access_token: `tok-${email}`, user: { id: `id-${email}`, email } };
    sb.setSession(session);
    return { data: { user: session.user, session }, error: null };
  });
  iosPublish = jest.fn(async () => LIVE);
  mockDeps = {
    hasEntitlement: async () => false, showPaywall: jest.fn(async () => 'purchased'), latestTransactionId: async () => 'tx-1',
    iosPublish, claimStart: async () => ({ ok: true, state: 'unclaimed', claimExpiresAt: 'x' }), accessToken, store,
  };
  signup = jest.spyOn(api, 'signup').mockImplementation((async (b: { email: string }) => ({ ok: true, email: b.email })) as never);
  await store.saveSite(draft);
  await store.savePendingPublish({ transactionId: 'tx-1', data, createdAt: Date.now(), state: 'unclaimed' });
});
afterEach(() => Object.assign(waitConfig, realWait));

describe('transient publish answers are waited out on the publishing screen', () => {
  test.each([
    ['404 while Apple catches up', () => new ApiError(404, 'not-found', 'x')],
    ['503 apple-unavailable', () => new ApiError(503, 'apple-unavailable', 'x')],
    ['502 publish-failed while a deploy settles', () => new ApiError(502, 'publish-failed', 'x')],
    ['429 rate limited', () => new ApiError(429, 'rate-limited', 'x')],
    ['a timeout (the server may still be deploying)', () => new ApiError(0, 'network', 'timeout')],
  ])('(a) %s then success: never the form, never red, ends live, one account', async (_n, mk) => {
    iosPublish.mockRejectedValueOnce(mk()).mockRejectedValueOnce(mk());
    const tree = await render(<Claim />);
    await submit(tree);
    expect(iosPublish).toHaveBeenCalledTimes(3);
    expect(signup).toHaveBeenCalledTimes(1);
    expect(mockDeps.showPaywall).not.toHaveBeenCalled();
    expect(mockResetTo).toHaveBeenCalledWith('/live');
    expect(text(tree)).not.toMatch(/wait a few minutes|live in a few minutes/i);
  });

  test('(a) while it waits the screen is "Publishing your site", not the form', async () => {
    let release!: (v: unknown) => void;
    iosPublish.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const tree = await render(<Claim />);
    await submit(tree);
    expect(text(tree)).toContain('Publishing your site…');
    expect(noForm(tree)).toBe(true);
    expect(hasButton(tree, 'Try again')).toBe(false);
    await act(async () => { release(LIVE); });
    expect(mockResetTo).toHaveBeenCalledWith('/live');
  });

  test('(b) still transient past the wait: one calm message and one Try again, session kept, no form', async () => {
    iosPublish.mockRejectedValue(new ApiError(404, 'not-found', 'x'));
    const tree = await render(<Claim />);
    await submit(tree);
    expect(text(tree)).toContain(STILL_PUBLISHING_MESSAGE);
    expect(noForm(tree)).toBe(true);
    expect(allText(tree).filter((t: string) => t === 'Try again')).toHaveLength(1);
    expect(sb.session).not.toBeNull();
    expect(await store.loadPendingPublish()).toMatchObject({ state: 'claiming' });
    expect(mockResetTo).not.toHaveBeenCalled();
    // bounded: far fewer than one per second for 3 minutes
    expect(iosPublish.mock.calls.length).toBeGreaterThan(5);
    expect(iosPublish.mock.calls.length).toBeLessThan(30);
    expect(clock).toBeLessThanOrEqual(waitConfig.budgetMs);
    // Try again resumes the same pending publish: no second account, no paywall
    iosPublish.mockResolvedValue(LIVE);
    await press(tree, 'Try again');
    expect(signup).toHaveBeenCalledTimes(1);
    expect(mockDeps.showPaywall).not.toHaveBeenCalled();
    expect(mockResetTo).toHaveBeenCalledWith('/live');
  });

  test('(c) signed in with a pending publish never renders the form, including while it waits', async () => {
    sb.setSession({ access_token: 'tok-a', user: { id: 'a', email: 'a@example.com' } });
    iosPublish.mockRejectedValueOnce(new ApiError(503, 'apple-unavailable', 'x'));
    const tree = await render(<Claim />);
    expect(noForm(tree)).toBe(true);
    expect(iosPublish).toHaveBeenCalledTimes(2);
    expect(mockResetTo).toHaveBeenCalledWith('/live');
    // and after the wait ran out
    mockResetTo.mockClear();
    await store.savePendingPublish({ transactionId: 'tx-1', data, createdAt: Date.now(), state: 'unclaimed' });
    iosPublish.mockRejectedValue(new ApiError(503, 'apple-unavailable', 'x'));
    const t2 = await render(<Claim />);
    expect(noForm(t2)).toBe(true);
    expect(text(t2)).toContain(STILL_PUBLISHING_MESSAGE);
  });

  test('(d) other-account is a hard stop with Move subscription, not retried', async () => {
    iosPublish.mockRejectedValue(new ApiError(409, 'purchase-other-account', 'x', { hint: 'o***@gmail.com' }));
    const tree = await render(<Claim />);
    await submit(tree);
    expect(iosPublish).toHaveBeenCalledTimes(1);
    expect(text(tree)).toContain('o***@gmail.com');
    expect(text(tree)).toContain('Move subscription');
    expect(noForm(tree)).toBe(true);
  });

  test('(d) an inactive subscription (402) is not retried', async () => {
    iosPublish.mockRejectedValue(new ApiError(402, 'subscription-inactive', 'x'));
    const tree = await render(<Claim />);
    await submit(tree);
    expect(iosPublish).toHaveBeenCalledTimes(1);
    expect(text(tree)).toContain('Not published');
  });

  test('(d) a purchase that changed accounts mid-publish is not auto-retried', async () => {
    iosPublish.mockRejectedValue(new ApiError(409, 'purchase-changed', 'x'));
    const tree = await render(<Claim />);
    await submit(tree);
    expect(iosPublish).toHaveBeenCalledTimes(1);
    expect(hasButton(tree, 'Try again')).toBe(true);
  });

  test('(e) overlapping triggers (double tap, foreground) never publish twice at once', async () => {
    let release!: (v: unknown) => void;
    let concurrent = 0; let max = 0;
    iosPublish.mockImplementation(() => { concurrent++; max = Math.max(max, concurrent); return new Promise((r) => { release = (v) => { concurrent--; r(v); }; }); });
    const tree = await render(<Claim />);
    for (const [k, v] of Object.entries({ 'Full Name': 'Jo Barber', Email: 'jo@example.com', 'Phone Number': '5125550142', 'Password (min 8 characters)': 'hunter22!' })) await typeIn(tree, k, v);
    const press1 = tree.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && textOf(n) === 'Create Account & Publish')[0]?.props.onPress
      ?? (() => { throw new Error('no submit'); })();
    await act(async () => { press1(); press1(); });
    await act(async () => { release(LIVE); });
    expect(iosPublish).toHaveBeenCalledTimes(1);
    expect(signup).toHaveBeenCalledTimes(1);
    expect(max).toBe(1);
  });
});
