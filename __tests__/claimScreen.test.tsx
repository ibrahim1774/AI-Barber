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
let mockDeps: any;
jest.mock('@/lib/paywall', () => ({ usePublishDeps: () => mockDeps }));

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

const FIELDS = ['Full Name', 'Email', 'Phone Number', 'Password (min 8 characters)', 'Confirm Password'];
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
    'Password (min 8 characters)': 'hunter22!', 'Confirm Password': 'hunter22!', ...over,
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

describe('the locked step', () => {
  test('four required fields plus the confirmation, ALL empty: nothing from the site is prefilled', async () => {
    const tree = await render(<Claim />);
    for (const f of FIELDS) expect(inputs(tree, f)).toHaveLength(1);
    for (const f of FIELDS) expect(valueOf(tree, f)).toBe('');
    // not marked optional
    expect(text(tree)).not.toMatch(/optional/i);
  });

  test('no back control, no close, and the Android back button does nothing', async () => {
    let handler: (() => boolean) | undefined;
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((_e: string, h: () => boolean) => {
      handler = h;
      return { remove: jest.fn() };
    }) as never);
    const tree = await render(<Claim />);
    expect(tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Back')).toHaveLength(0);
    expect(tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Close' || n.props?.accessibilityLabel === 'Dismiss')).toHaveLength(0);
    expect(hasButton(tree, 'Back')).toBe(false);
    expect(handler?.()).toBe(true); // true = handled: the system does not leave the screen
  });

  test('the route cannot be swiped away: gestureEnabled is false and it lives outside the tabs', () => {
    const layout = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', '_layout.tsx'), 'utf8');
    expect(layout).toMatch(/<Stack\.Screen name="claim" options=\{\{[^}]*gestureEnabled: false/);
    expect(fs.existsSync(path.join(__dirname, '..', 'src', 'app', 'claim.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '..', 'src', 'app', '(tabs)', 'claim.tsx'))).toBe(false);
  });

  test('nothing is sent and all four errors show inline when the form is empty', async () => {
    const tree = await render(<Claim />);
    await press(tree, 'Create Account & Publish');
    const t = text(tree);
    expect(t).toContain('Enter your name.');
    expect(t).toContain('Enter your email address.');
    expect(t).toContain('Enter a phone number with at least 7 digits.');
    expect(t).toContain('Enter your password.');
    expect(signup).not.toHaveBeenCalled();
    expect(iosPublish).not.toHaveBeenCalled();
  });

  test.each([
    ['Email', 'jo@example', 'That email address doesn’t look right. Check it and try again.'],
    ['Phone Number', '12345', 'Enter a phone number with at least 7 digits.'],
    ['Password (min 8 characters)', 'short', 'Use at least 8 characters.'],
    ['Confirm Password', 'different', 'The passwords don’t match.'],
  ])('%s %s -> inline "%s"', async (label, value, message) => {
    const tree = await render(<Claim />);
    await fill(tree, { [label]: value });
    await press(tree, 'Create Account & Publish');
    expect(text(tree)).toContain(message);
    expect(signup).not.toHaveBeenCalled();
  });

  test('a good form creates the account (E.164 phone), signs in, publishes with the Bearer, and goes to /live', async () => {
    const tree = await render(<Claim />);
    await fill(tree);
    await press(tree, 'Create Account & Publish');
    expect(signup).toHaveBeenCalledWith({ name: 'Jo Barber', email: 'jo@example.com', phone: '+15125550142', password: 'hunter22!' });
    expect(iosPublish).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 'tx-1' }), 'tok-jo@example.com');
    expect(mockResetTo).toHaveBeenCalledWith('/live');
  });

  test('double tap: the account is created once', async () => {
    let release!: () => void;
    signup.mockImplementation(() => new Promise((r) => { release = () => r({ ok: true, email: 'jo@example.com' }); }) as never);
    const tree = await render(<Claim />);
    await fill(tree);
    const submit = tree.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && textOf(n) === 'Create Account & Publish')[0].props.onPress;
    await act(async () => {
      submit();
      submit();
    });
    await act(async () => { release(); });
    expect(signup).toHaveBeenCalledTimes(1);
    expect(iosPublish).toHaveBeenCalledTimes(1);
  });
});

describe('Already have an account? Sign in (same locked route)', () => {
  test('email exists -> "Sign in instead" keeps the email and swaps to the sign-in form', async () => {
    signup.mockImplementation((async () => { throw new ApiError(409, 'email-exists', 'x'); }) as never);
    const tree = await render(<Claim />);
    await fill(tree);
    await press(tree, 'Create Account & Publish');
    expect(text(tree)).toContain('An account with this email already exists.');
    expect(iosPublish).not.toHaveBeenCalled();
    await press(tree, 'Sign in instead');
    expect(valueOf(tree, 'Email')).toBe('jo@example.com');
    expect(valueOf(tree, 'Password')).toBe('');
    expect(inputs(tree, 'Full Name')).toHaveLength(0);
    expect(inputs(tree, 'Phone Number')).toHaveLength(0);
    // and there is still no way out
    expect(mockResetTo).not.toHaveBeenCalled();
  });

  test('the toggle swaps the form back and forth without leaving the screen', async () => {
    const tree = await render(<Claim />);
    await pressLink(tree, 'Sign in');
    expect(hasButton(tree, 'Sign In & Publish')).toBe(true);
    expect(inputs(tree, 'Full Name')).toHaveLength(0);
    await pressLink(tree, 'Create an account');
    expect(inputs(tree, 'Full Name')).toHaveLength(1);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockResetTo).not.toHaveBeenCalled();
  });

  test('sign in with an existing account publishes with its Bearer', async () => {
    const tree = await render(<Claim />);
    await pressLink(tree, 'Sign in');
    await typeIn(tree, 'Email', 'old@example.com');
    await typeIn(tree, 'Password', 'whatever1');
    await press(tree, 'Sign In & Publish');
    expect(signup).not.toHaveBeenCalled();
    expect(iosPublish).toHaveBeenCalledWith(expect.anything(), 'tok-old@example.com');
    expect(mockResetTo).toHaveBeenCalledWith('/live');
  });
});

describe('failures stay on the form', () => {
  test('offline: "waiting for connection", still locked; Try again finishes the same sign up', async () => {
    signup.mockRejectedValueOnce(new ApiError(0, 'network', 'offline'));
    const tree = await render(<Claim />);
    await fill(tree);
    await press(tree, 'Create Account & Publish');
    expect(text(tree)).toContain(WAITING_MESSAGE);
    expect(mockResetTo).not.toHaveBeenCalled();
    await press(tree, 'Try again');
    expect(signup).toHaveBeenCalledTimes(2);
    expect(mockResetTo).toHaveBeenCalledWith('/live');
  });

  test('signed in but the publish is offline: waiting; Try again re-sends WITHOUT signing up again', async () => {
    iosPublish.mockRejectedValueOnce(new ApiError(0, 'network', 'offline'));
    const tree = await render(<Claim />);
    await fill(tree);
    await press(tree, 'Create Account & Publish');
    expect(text(tree)).toContain(WAITING_MESSAGE);
    await press(tree, 'Try again');
    expect(signup).toHaveBeenCalledTimes(1);
    expect(iosPublish).toHaveBeenCalledTimes(2);
    expect(mockResetTo).toHaveBeenCalledWith('/live');
  });

  test('offline at sign-in after the account was created: the retry only signs in', async () => {
    supabase.auth.signInWithPassword.mockRejectedValueOnce(Object.assign(new Error('Network request failed'), { name: 'AuthRetryableFetchError' }));
    const tree = await render(<Claim />);
    await fill(tree);
    await press(tree, 'Create Account & Publish');
    expect(text(tree)).toContain(WAITING_MESSAGE);
    await press(tree, 'Try again');
    expect(signup).toHaveBeenCalledTimes(1);
    expect(mockResetTo).toHaveBeenCalledWith('/live');
    void OFFLINE;
  });

  test('a server error shows words and keeps the form', async () => {
    signup.mockRejectedValueOnce(new ApiError(503, 'temporarily-unavailable', 'x'));
    const tree = await render(<Claim />);
    await fill(tree);
    await press(tree, 'Create Account & Publish');
    expect(text(tree)).toContain('We couldn’t create your account just now. Try again in a moment.');
    expect(valueOf(tree, 'Email')).toBe('jo@example.com');
  });

  test('409 from publish: the refusal names the masked owner; only "Use a different account" is offered', async () => {
    iosPublish.mockRejectedValueOnce(new ApiError(409, 'purchase-other-account', 'x', { hint: 'o***@gmail.com' }));
    const tree = await render(<Claim />);
    await fill(tree);
    await press(tree, 'Create Account & Publish');
    expect(text(tree)).toContain(conflictMessage({ code: 'purchase-other-account', hint: 'o***@gmail.com' }));
    expect(text(tree)).toContain('o***@gmail.com');
    expect(inputs(tree, 'Email')).toHaveLength(0);
    expect(hasButton(tree, 'Use a different account')).toBe(true);
    expect(mockResetTo).not.toHaveBeenCalled();
    await press(tree, 'Use a different account');
    expect(sb.session).toBeNull();
    expect(valueOf(tree, 'Email')).toBe('');
    expect(hasButton(tree, 'Sign In & Publish')).toBe(true);
    expect(await store.loadPendingPublish()).toMatchObject({ state: 'unclaimed' });
  });
});

describe('arriving at the step', () => {
  test('a refusal on record is shown at once, with no form', async () => {
    await store.savePendingPublish({ transactionId: 'tx-1', data, createdAt: Date.now(), state: 'conflict', conflict: { code: 'account-has-site', slug: 'old-cuts' } });
    sb.setSession({ access_token: 't', user: A });
    const tree = await render(<Claim />);
    expect(text(tree)).toContain('old-cuts');
    expect(inputs(tree, 'Email')).toHaveLength(0);
    expect(iosPublish).not.toHaveBeenCalled();
  });

  test('a session already there (relaunch, password reset): the pending publish is sent by itself', async () => {
    sb.setSession({ access_token: 'tok-a', user: A });
    await render(<Claim />);
    expect(iosPublish).toHaveBeenCalledWith(expect.anything(), 'tok-a');
    expect(mockResetTo).toHaveBeenCalledWith('/live');
  });

  test('nothing to claim goes home instead of showing an empty step', async () => {
    await store.savePendingPublish(null);
    await render(<Claim />);
    expect(mockResetTo).toHaveBeenCalledWith('/edit');
  });

  test('"Forgot password?" is on the sign-in form and opens the reset flow', async () => {
    const tree = await render(<Claim />);
    await pressLink(tree, 'Sign in');
    await pressLink(tree, 'Forgot password?');
    expect(mockPush).toHaveBeenCalledWith('/forgot-password');
  });
});
