/**
 * usePaymentLock: a block that rests only on "the server says active but the expiry passed" waits for ONE plan re-read.
 * Re-read still expired: blocked (failed, with the date). Re-read shows a renewal: never blocked. Re-read impossible
 * (offline): never blocked (uncertain answers are "none").
 */
import React from 'react';
import { Text } from 'react-native';
import { act, render } from '../store/render';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const H = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const mkPlan = (o: Record<string, unknown> = {}): any => ({
  linked: true, tier: 'bookings', entitlements: { hosting: true, bookings: true, store: false }, active: true,
  expiresAt: iso(NOW - 3 * H), takenDownAt: null, revoked: false, purchaseAccount: 'self', purchaseHint: null, capabilities: { memberProfile: false }, ...o,
});

let mockPlan: any = null;
const mockGetPlan = jest.fn((): Promise<any> => Promise.resolve(null));
const mockSet = jest.fn();
jest.mock('@/lib/entitlements', () => ({
  useAccountPlan: () => mockPlan,
  useSuperwallEntitlements: () => ({ known: true, hosting: false }),
}));
jest.mock('@/lib/auth', () => ({ useSession: () => ({ session: { user: { id: 'u1' } } }) }));
jest.mock('@/lib/subscriptionStatus', () => ({ useSubscriptionStatus: () => 'unknown' }));
jest.mock('@/lib/plan', () => ({
  getPlan: () => mockGetPlan(),
  getPlanEpoch: () => 1,
  setSharedPlan: (p: any) => { mockSet(p); mockPlan = p; },
}));

import { usePaymentLock } from '@/lib/paymentLock';

const site = { deployedUrl: 'https://fade-lab.aibarber.org' };
function Probe() {
  return <Text>{`lock=${usePaymentLock(site)}`}</Text>;
}
const text = (t: any) => t.root.findAll((n: any) => n.type === 'Text').map((n: any) => (n.children ?? []).join('')).join('|');

describe('usePaymentLock re-read', () => {
  beforeEach(() => { mockSet.mockClear(); mockGetPlan.mockReset(); jest.spyOn(Date, 'now').mockReturnValue(NOW); });
  afterEach(() => jest.restoreAllMocks());

  it('still expired after the re-read -> failed', async () => {
    mockPlan = mkPlan();
    mockGetPlan.mockResolvedValue(mkPlan());
    const t = await render(<Probe />);
    await act(async () => {});
    expect(mockGetPlan).toHaveBeenCalledTimes(1);
    expect(text(t)).toContain('lock=failed');
  });

  it('the re-read shows a renewal -> never blocked', async () => {
    mockPlan = mkPlan();
    mockGetPlan.mockResolvedValue(mkPlan({ expiresAt: iso(NOW + 30 * 24 * H) }));
    const t = await render(<Probe />);
    await act(async () => {});
    expect(text(t)).toContain('lock=none');
  });

  it('the re-read cannot be made (offline) -> not blocked', async () => {
    mockPlan = mkPlan();
    mockGetPlan.mockRejectedValue(new Error('offline'));
    const t = await render(<Probe />);
    await act(async () => {});
    expect(text(t)).toContain('lock=none');
  });

  it('not active (the server says so itself) blocks without a re-read', async () => {
    mockPlan = mkPlan({ active: false, entitlements: { hosting: false, bookings: false, store: false } });
    const t = await render(<Probe />);
    expect(mockGetPlan).not.toHaveBeenCalled();
    expect(text(t)).toContain('lock=failed');
  });
});
