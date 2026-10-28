/**
 * PAYMENT-FAILED LOCK. paymentLockOf: which server plan / per-site status means "block" (the subscription ended or was
 * revoked), "retry" (Apple is still retrying the payment: a banner) or "none". Every uncertain answer is "none".
 * PaymentBlock: the Apple button and "check again" (re-reads the plan and the per-site status).
 */
import React from 'react';
import { act, render } from '../store/render';

jest.mock('@/constants/theme', () => require('../store/themeMock'));
const mockOpen = jest.fn(async () => {});
jest.mock('@/lib/manageSubscription', () => ({ openManageSubscription: () => mockOpen() }));
const mockGetPlan = jest.fn((..._a: unknown[]): Promise<unknown> => Promise.resolve(null));
const mockRefresh = jest.fn(async (..._a: unknown[]) => {});
jest.mock('@/lib/plan', () => ({
  ...jest.requireActual('@/lib/plan'),
  getPlan: (...a: unknown[]) => mockGetPlan(...a),
  refreshPlanQuietly: (...a: unknown[]) => mockRefresh(...a),
}));
const mockRecheck = jest.fn((..._a: unknown[]) => {});
jest.mock('@/lib/subscriptionStatus', () => ({
  ...jest.requireActual('@/lib/subscriptionStatus'),
  recheckSubscriptionStatus: (...a: unknown[]) => mockRecheck(...a),
}));
jest.mock('@/lib/paywall', () => ({ useLatestTransactionId: () => async () => 'tx-9' }));

import { PaymentBanner, PaymentBlock } from '@/components/PaymentLock';
import { paymentLockOf, RETRY_AFTER_MS } from '@/lib/paymentLock';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 3600_000;
const site = { deployedUrl: 'https://fade-lab.aibarber.org' };
const plan = (o: Record<string, unknown> = {}): any => ({
  linked: true, tier: 'bookings', entitlements: { hosting: true, bookings: true, store: false }, active: true, expiresAt: null, takenDownAt: null,
  revoked: false, purchaseAccount: 'self', purchaseHint: null, capabilities: { memberProfile: false }, ...o,
});
const ended = (o: Record<string, unknown> = {}) => plan({ entitlements: { hosting: false, bookings: false, store: false }, active: false, ...o });

describe('paymentLockOf', () => {
  it.each([
    ['active, no expiry', plan(), 'none'],
    ['active, renews in the future', plan({ expiresAt: new Date(NOW + 5 * H).toISOString() }), 'none'],
    ['active, expiry passed 10 minutes ago (late renewal notice)', plan({ expiresAt: ago(10 * 60_000) }), 'none'],
    ['active, expiry passed 3 hours ago: Apple billing retry', plan({ expiresAt: ago(3 * H) }), 'retry'],
    ['active, expiry passed 5 days ago: still in Apple billing grace', plan({ expiresAt: ago(5 * 24 * H) }), 'retry'],
    ['ended 2 hours ago, not renewed', ended({ expiresAt: ago(2 * H) }), 'failed'],
    ['ended 45 days ago', ended({ expiresAt: ago(45 * 24 * H) }), 'failed'],
    ['the server took the site down', ended({ takenDownAt: ago(H), expiresAt: ago(2 * H) }), 'failed'],
    ['taken down, no date', ended({ takenDownAt: ago(H) }), 'failed'],
    ['revoked / refunded', ended({ revoked: true, expiresAt: ago(H) }), 'revoked'],
    ['revoked flag on a plan that still says active', plan({ revoked: true }), 'revoked'],
    ['no plan loaded yet', null, 'none'],
    ['signed in, no shop / never subscribed (no date)', ended({ linked: false }), 'none'],
    ["another account's purchase (Move card)", ended({ purchaseAccount: 'other', expiresAt: ago(H) }), 'none'],
    ['no purchase of this account', ended({ purchaseAccount: null, expiresAt: ago(H) }), 'none'],
  ])('%s -> %s', (_n, p, want) => {
    expect(paymentLockOf(p as any, site, 'unknown', NOW)).toBe(want);
  });

  it('a site that was never published is never locked', () => {
    expect(paymentLockOf(ended({ expiresAt: ago(H) }), { deployedUrl: null }, 'lapsed', NOW)).toBe('none');
    expect(paymentLockOf(ended({ expiresAt: ago(H) }), null, 'lapsed', NOW)).toBe('none');
  });

  it("this iPhone's Superwall saying paid never blocks on an older server answer", () => {
    expect(paymentLockOf(ended({ expiresAt: ago(2 * H) }), site, 'unknown', NOW, true)).toBe('none');
    expect(paymentLockOf(ended({ revoked: true }), site, 'unknown', NOW, true)).toBe('none');
    expect(paymentLockOf(plan({ expiresAt: ago(3 * H) }), site, 'unknown', NOW, true)).toBe('retry');
  });

  it('the per-site check keeps its meaning: confirmed lapsed blocks, unknown / active never', () => {
    expect(paymentLockOf(null, site, 'lapsed', NOW)).toBe('failed');
    expect(paymentLockOf(null, site, 'unknown', NOW)).toBe('none');
    expect(paymentLockOf(null, site, 'active', NOW)).toBe('none');
    expect(paymentLockOf(ended({ purchaseAccount: 'other' }), site, 'lapsed', NOW)).toBe('none');
    expect(paymentLockOf(plan(), site, 'lapsed', NOW)).toBe('none'); // the server says paid
  });

  it('retry waits the same hour the server waits', () => {
    expect(RETRY_AFTER_MS).toBe(H);
  });
});

describe('PaymentBlock / PaymentBanner', () => {
  beforeEach(() => {
    mockOpen.mockClear();
    mockGetPlan.mockReset().mockResolvedValue(plan());
    mockRefresh.mockClear();
    mockRecheck.mockClear();
  });
  const texts = (t: any) => t.root.findAll((n: any) => n.type === 'Text').map((n: any) => (n.children ?? []).join(''));
  const press = async (t: any, label: string) => {
    const b = t.root.find((n: any) => n.props?.accessibilityRole === 'button' && texts({ root: { findAll: (f: any) => n.findAll(f) } }).includes(label));
    await act(async () => { await b.props.onPress(); });
  };

  it('failed: the title, the body, the Apple button opens Apple, check again re-reads plan and status', async () => {
    const onRestore = jest.fn();
    const t = await render(<PaymentBlock kind="failed" screen="edit" onRestore={onRestore} />);
    const all = texts(t);
    expect(all).toEqual(expect.arrayContaining(['Payment failed', 'Please renew your payment to keep editing your site. Your subscription could not be renewed.', 'Update payment method', "I've renewed: check again", 'Restore purchases']));
    await press(t, 'Update payment method');
    expect(mockOpen).toHaveBeenCalledTimes(1);
    await press(t, "I've renewed: check again");
    expect(mockRefresh).toHaveBeenCalledWith('tx-9');
    expect(mockGetPlan).toHaveBeenCalled();
    expect(mockRecheck).toHaveBeenCalledWith(true);
    await press(t, 'Restore purchases');
    expect(onRestore).toHaveBeenCalled();
  });

  it('a pushed screen gets Back; revoked has its own words', async () => {
    const onBack = jest.fn();
    const t = await render(<PaymentBlock kind="revoked" screen="team" onBack={onBack} />);
    expect(texts(t)).toEqual(expect.arrayContaining(['Subscription ended', 'Update payment method', 'Back']));
    await press(t, 'Back');
    expect(onBack).toHaveBeenCalled();
  });

  it('banner: the notice and the same Apple button', async () => {
    const t = await render(<PaymentBanner screen="bookings" />);
    expect(texts(t)).toEqual(expect.arrayContaining(['Payment failed. Update your payment method to keep your site.', 'Update payment method']));
    await press(t, 'Update payment method');
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });
});
