/**
 * H2: Bookings / Store unlock only for the account that owns the Apple purchase. Superwall's status belongs to the
 * Apple ID, so a second account on the same Apple ID (server purchaseAccount 'other' or null) stays LOCKED, with the
 * "belongs to another Prime Barber account" copy (and the server's masked hint). Signed out or plan not loaded is
 * known:false (locked); a network error is a retry card, never unlocked. Every gated entry point reads the one helper
 * (getEntitlements / useEntitlements / useTierAccess), so each is checked here at its decision.
 */
import React from 'react';
import { act, allText, render } from '../store/render';

jest.mock('@/constants/theme', () => require('../store/themeMock'));
const mockCall = jest.fn();
jest.mock('@/lib/setup/ownerApi', () => {
  const actual = jest.requireActual('@/lib/setup/ownerApi');
  return { ...actual, call: (...a: unknown[]) => mockCall(...a) };
});
jest.mock('@/lib/paywall', () => ({
  usePaywall: () => jest.fn(async () => 'declined'),
  useLatestTransactionId: () => async () => null,
  useSuperwallSettled: () => true,
}));
let mockShop: any = null;
jest.mock('@/lib/shop', () => ({ ...jest.requireActual('@/lib/shop'), loadMyShop: async () => mockShop }));
jest.mock('@/lib/store/data', () => ({ ...jest.requireActual('@/lib/store/data'), loadStoreSettings: async () => ({ storeEnabled: true }) }));
jest.mock('expo-router', () => {
  const R = require('react');
  return { useFocusEffect: (cb: () => void) => R.useEffect(cb, []) };
});
jest.mock('@/lib/auth', () => ({ currentUserId: () => 'u-b', useSession: () => ({ session: { user: { id: 'u-b' } }, ready: true }) }));

import { OwnerApiError } from '@/lib/setup/ownerApi';
import { resetSharedPlan, setSharedPlan, type Plan } from '@/lib/plan';
import {
  clearEntitlements, effectiveEntitlements, getEntitlements, resetEntitlementsForTests, setEntitlementsFromStatus,
  useEntitlements, type Entitlements,
} from '@/lib/entitlements';
import { useTierAccess, type TierAccess } from '@/lib/tierAccess';
import { UpgradeCard } from '@/components/UpgradeCard';
import { PausedBanner } from '@/components/PausedBanner';
import { otherAccountPlanMessage } from '@/lib/claimCopy';
import { loadLinkContext } from '@/lib/linkContext';
import { linksToSend } from '@/lib/bookingChoice';
import { setupPrompt } from '@/lib/setupPrompt';
import { OWN_PLAN } from '../../test/ownPlan';

const COPY = "This Apple ID's subscription belongs to another Prime Barber account";
const ALL = { status: 'ACTIVE', entitlements: [{ id: 'hosting' }, { id: 'bookings' }, { id: 'store' }] };
const plan = (over: Partial<Plan> = {}): Plan => ({ ...OWN_PLAN, ...over });
const OTHER = plan({ purchaseAccount: 'other', purchaseHint: 'a***@gmail.com' });
const NULL_ACCOUNT = plan({ purchaseAccount: null });
const hasText = (tree: any, re: RegExp) => allText(tree).some((t) => re.test(t));
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  resetEntitlementsForTests();
  resetSharedPlan();
  mockCall.mockReset().mockRejectedValue(new OwnerApiError(0, 'network', 'offline'));
  mockShop = { id: 's', slug: 'fade', purchaseLinked: true, bookingsEnabled: true };
});

describe('effectiveEntitlements: Superwall AND the server plan', () => {
  const raw = (b: boolean, s: boolean): Entitlements => ({ known: true, hosting: true, bookings: b, store: s });
  it('own account (self + active): unlocked', () => {
    expect(effectiveEntitlements(raw(true, true), plan())).toMatchObject({ known: true, bookings: true, store: true, account: 'self' });
  });
  it('second account on the same Apple ID (other, or null): locked, hint kept, hosting untouched', () => {
    expect(effectiveEntitlements(raw(true, true), OTHER)).toMatchObject({ known: true, hosting: true, bookings: false, store: false, account: 'other', hint: 'a***@gmail.com' });
    expect(effectiveEntitlements(raw(true, true), NULL_ACCOUNT)).toMatchObject({ known: true, bookings: false, store: false, account: 'other' });
  });
  it('own account but the plan is not active: locked', () => {
    expect(effectiveEntitlements(raw(true, true), plan({ active: false }))).toMatchObject({ bookings: false, store: false });
  });
  it('plan not loaded / signed out: known false (fail closed)', () => {
    expect(effectiveEntitlements(raw(true, false), null)).toMatchObject({ known: false, bookings: false, store: false, account: 'unknown' });
  });
  it('a Website plan or no plan has nothing to gate', () => {
    expect(effectiveEntitlements({ known: true, hosting: true, bookings: false, store: false }, null)).toMatchObject({ known: true, hosting: true });
    expect(effectiveEntitlements({ known: true, hosting: false, bookings: false, store: false }, null).known).toBe(true);
  });
  it('the live mirror follows the plan as it loads, changes and clears', () => {
    setEntitlementsFromStatus(ALL);
    expect(getEntitlements()).toMatchObject({ known: false, bookings: false });
    setSharedPlan(OTHER);
    expect(getEntitlements()).toMatchObject({ known: true, bookings: false, store: false, account: 'other' });
    setSharedPlan(plan());
    expect(getEntitlements()).toMatchObject({ bookings: true, store: true });
    act(() => { resetSharedPlan(); clearEntitlements(); });
    expect(getEntitlements()).toMatchObject({ known: false, bookings: false });
  });
});

describe.each(['bookings', 'store'] as const)('%s gate (tab, setup screen: useTierAccess)', (need) => {
  let latest: TierAccess;
  const Probe = () => { latest = useTierAccess(need); return null; };

  it('second account on the same Apple ID: LOCKED, with the other-account hint', async () => {
    setEntitlementsFromStatus(ALL);
    setSharedPlan(OTHER);
    await render(<Probe />);
    expect(latest).toMatchObject({ status: 'ready', entitled: false, otherAccount: { hint: 'a***@gmail.com' } });
  });

  it('purchaseAccount null (no purchase of its own): LOCKED', async () => {
    setEntitlementsFromStatus(ALL);
    setSharedPlan(NULL_ACCOUNT);
    await render(<Probe />);
    expect(latest).toMatchObject({ status: 'ready', entitled: false });
  });

  it('the plan fetched later says "other": still locked', async () => {
    setEntitlementsFromStatus(ALL);
    mockCall.mockResolvedValue({ ...OTHER, purchaseHint: 'a***@gmail.com' });
    await render(<Probe />);
    await flush();
    expect(latest).toMatchObject({ status: 'ready', entitled: false, otherAccount: { hint: 'a***@gmail.com' } });
  });

  it('own account: unlocked', async () => {
    setEntitlementsFromStatus(ALL);
    setSharedPlan(plan());
    await render(<Probe />);
    expect(latest).toMatchObject({ status: 'ready', entitled: true, otherAccount: null });
  });

  it('plan not loaded: never unlocked on Superwall alone; the fetch decides', async () => {
    setEntitlementsFromStatus(ALL);
    let land!: (p: Plan) => void;
    mockCall.mockImplementation(() => new Promise((r) => (land = r)));
    await render(<Probe />);
    expect(latest.entitled).toBe(false); // Superwall says paid, the server has not answered: locked
    await act(async () => land(plan()));
    expect(latest).toMatchObject({ status: 'ready', entitled: true });
  });

  it('signed out: locked, not a retry card', async () => {
    setEntitlementsFromStatus(ALL);
    mockCall.mockRejectedValue(new OwnerApiError(401, 'unauthorized', 'Sign in to continue.'));
    await render(<Probe />);
    await flush();
    expect(latest).toMatchObject({ status: 'ready', entitled: false });
  });

  it('network error: a retry card, never unlocked; Retry unlocks only on the owner\'s answer', async () => {
    setEntitlementsFromStatus(ALL);
    await render(<Probe />);
    await flush();
    expect(latest).toMatchObject({ status: 'error', entitled: false });
    mockCall.mockResolvedValue(OTHER);
    await act(async () => latest.retry());
    await flush();
    expect(latest).toMatchObject({ status: 'ready', entitled: false });
    mockCall.mockResolvedValue(plan());
    await act(async () => latest.retry());
    await flush();
    expect(latest).toMatchObject({ status: 'ready', entitled: true });
  });
});

describe('the locked copy (UpgradeCard on the tabs and setup screens, PausedBanner on a tab with a shop)', () => {
  it.each([['bookings'], ['store']] as const)('%s UpgradeCard names the other account, with the masked hint, and has no buy button', async (kind) => {
    setEntitlementsFromStatus(ALL);
    setSharedPlan(OTHER);
    const tree = await render(<UpgradeCard kind={kind} onUpgrade={() => {}} />);
    expect(hasText(tree, new RegExp(COPY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBe(true);
    expect(hasText(tree, /a\*\*\*@gmail\.com/)).toBe(true);
    expect(hasText(tree, /See the (Bookings|Store) plan/)).toBe(false);
  });
  it('without a hint the same sentence, no parentheses', async () => {
    setEntitlementsFromStatus(ALL);
    setSharedPlan(NULL_ACCOUNT);
    const tree = await render(<PausedBanner kind="bookings" onUpgrade={() => {}} />);
    expect(hasText(tree, new RegExp(COPY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBe(true);
    expect(allText(tree).join(' ')).not.toMatch(/\(/);
    expect(otherAccountPlanMessage(null)).toContain(COPY);
  });
  it('the owner still sees the ordinary upgrade card', async () => {
    setEntitlementsFromStatus({ status: 'ACTIVE', entitlements: [{ id: 'hosting' }] });
    const tree = await render(<UpgradeCard kind="bookings" onUpgrade={() => {}} />);
    expect(hasText(tree, /See the Bookings plan/)).toBe(true);
  });
});

describe('the other consumers (Edit preview, Live, Settings, ShareSheet, setup prompt, link context, publish links)', () => {
  let seen: Entitlements;
  const Probe = () => { seen = useEntitlements(); return null; };

  it('useEntitlements (edit.tsx, live.tsx, settings, ShareSheet, useLinkContext): locked for another account, unlocked for the owner', async () => {
    setEntitlementsFromStatus(ALL);
    setSharedPlan(OTHER);
    await render(<Probe />);
    expect(seen).toMatchObject({ known: true, bookings: false, store: false });
    act(() => setSharedPlan(plan()));
    expect(seen).toMatchObject({ known: true, bookings: true, store: true });
  });

  it('linkContext (setup prompt / publish) carries the locked entitlements for another account', async () => {
    setEntitlementsFromStatus(ALL);
    setSharedPlan(OTHER);
    const ctx = await loadLinkContext();
    expect(ctx?.ents).toMatchObject({ bookings: false, store: false });
    setSharedPlan(plan());
    expect((await loadLinkContext())?.ents).toMatchObject({ bookings: true, store: true });
  });

  it('bookingChoice.linksToSend (publish, no shop facts) strips /book and /shop for another account, keeps them for the owner', () => {
    const data: any = { shopName: 'F', bookingUrl: '/book', shopUrl: '/shop' };
    setEntitlementsFromStatus(ALL);
    setSharedPlan(OTHER);
    const locked = linksToSend(data, undefined, null) as any;
    expect(locked.bookingUrl).toBeUndefined();
    expect(locked.shopUrl).toBeUndefined();
    setSharedPlan(plan());
    expect(linksToSend(data, undefined, null)).toMatchObject({ bookingUrl: '/book', shopUrl: '/shop' });
  });

  it('setupPrompt (setupPrompt.ts) offers nothing while the account is unknown or another\'s', () => {
    const input = (ents: Entitlements) => ({ published: true, ents, live: { bookingUrl: null, shopUrl: null }, next: { bookingUrl: '/book', shopUrl: null } });
    setEntitlementsFromStatus(ALL);
    expect(setupPrompt(input(getEntitlements()) as never)).toBeNull(); // plan not loaded: known false
    setSharedPlan(OTHER);
    expect(getEntitlements().bookings).toBe(false);
    setSharedPlan(plan());
    expect(getEntitlements().bookings).toBe(true);
  });
});
