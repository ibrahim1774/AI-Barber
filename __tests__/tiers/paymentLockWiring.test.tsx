/**
 * Review fixes for the payment lock: the usePaymentLock re-read and deviceActive wiring, a cached 'lapsed' with a paid
 * device, no leak across an account switch, plan cached while signed out, the 3 pushed routes gated.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, render } from '../store/render';

jest.mock('@/constants/theme', () => require('../store/themeMock'));
let mockUid: string | null = 'u1';
jest.mock('@/lib/auth', () => ({ useSession: () => ({ session: mockUid ? { user: { id: mockUid } } : null, ready: true }), currentUserId: () => mockUid }));
const mockGetPlan = jest.fn((..._a: unknown[]): Promise<unknown> => Promise.resolve(null));
jest.mock('@/lib/plan', () => ({ ...jest.requireActual('@/lib/plan'), getPlan: (...a: unknown[]) => mockGetPlan(...a) }));

import { getAccountPlan, setEntitlementsFromStatus, resetEntitlementsForTests } from '@/lib/entitlements';
import { paymentLockOf, usePaymentLock } from '@/lib/paymentLock';
import { resetSharedPlan, setSharedPlan } from '@/lib/plan';
import { getSubscriptionStatus, resetSubscriptionStatus, resetSubscriptionStatusForTests, setSubscriptionStatus } from '@/lib/subscriptionStatus';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const H = 3600_000;
const site = { deployedUrl: 'https://fade-lab.aibarber.org' };
const plan = (o: Record<string, unknown> = {}): any => ({
  linked: true, tier: 'bookings', entitlements: { hosting: true, bookings: true, store: false }, active: true, expiresAt: null, takenDownAt: null,
  revoked: false, purchaseAccount: 'self', purchaseHint: null, capabilities: { memberProfile: false }, ...o,
});
const ended = (o: Record<string, unknown> = {}) => plan({ entitlements: { hosting: false, bookings: false, store: false }, active: false, ...o });
const paidStatus: any = { status: 'ACTIVE', entitlements: [{ id: 'hosting' }, { id: 'bookings' }] };

beforeEach(() => {
  mockUid = 'u1';
  mockGetPlan.mockReset().mockResolvedValue(plan());
  resetSharedPlan();
  resetEntitlementsForTests();
  resetSubscriptionStatusForTests();
});

describe("per-site 'lapsed' fallback", () => {
  it('a paid device is never blocked by a cached lapsed status', () => {
    expect(paymentLockOf(null, site, 'lapsed', NOW, true)).toBe('none');
    expect(paymentLockOf(ended({ purchaseAccount: null }), site, 'lapsed', NOW, true)).toBe('none');
    expect(paymentLockOf(null, site, 'lapsed', NOW, false)).toBe('failed');
  });
});

describe('usePaymentLock wiring', () => {
  const Probe = ({ out }: { out: { lock?: string } }) => {
    out.lock = usePaymentLock(site);
    return null;
  };

  it("re-reads the server plan once when the device is paid but the cached plan says ended, and drops the lock", async () => {
    setEntitlementsFromStatus(paidStatus);
    setSharedPlan(ended({ expiresAt: new Date(Date.now() - 2 * H).toISOString() }));
    const out: { lock?: string } = {};
    await render(<Probe out={out} />);
    await act(async () => {});
    expect(mockGetPlan).toHaveBeenCalledTimes(1);
    expect(out.lock).toBe('none');
  });

  it('a cached lapsed status with a paid device is not blocking', async () => {
    setEntitlementsFromStatus(paidStatus);
    setSubscriptionStatus('lapsed');
    const out: { lock?: string } = {};
    await render(<Probe out={out} />);
    expect(out.lock).toBe('none');
  });

  it('without a paid device the same lapsed status blocks (the wiring is what unblocks it)', async () => {
    setSubscriptionStatus('lapsed');
    const out: { lock?: string } = {};
    await render(<Probe out={out} />);
    expect(out.lock).toBe('failed');
  });
});

describe('account switch', () => {
  it("resetSubscriptionStatus clears the previous account's lapsed status", () => {
    setSubscriptionStatus('lapsed');
    resetSubscriptionStatus();
    expect(getSubscriptionStatus()).toBe('unknown');
  });

  it('a check that started before the reset cannot write afterwards', () => {
    const { statusGeneration } = require('@/lib/subscriptionStatus');
    const gen = statusGeneration();
    resetSubscriptionStatus();
    setSubscriptionStatus('lapsed', Date.now(), gen);
    expect(getSubscriptionStatus()).toBe('unknown');
  });

  it("account B does not inherit A's lock through usePaymentLock", async () => {
    setSubscriptionStatus('lapsed');
    const out: { lock?: string } = {};
    const Probe = () => {
      out.lock = usePaymentLock(site);
      return null;
    };
    await render(<Probe />);
    expect(out.lock).toBe('failed');
    await act(async () => {
      resetSharedPlan();
      resetSubscriptionStatus();
    });
    expect(out.lock).toBe('none');
  });

  it('sign-out, the sign-in switch and the reinstall reset all call it', () => {
    const read = (f: string) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
    expect((read('src/lib/auth.ts').match(/resetSubscriptionStatus\(\)/g) ?? []).length).toBe(3);
    expect(read('src/lib/account.ts')).toMatch(/resetSubscriptionStatus\(\)/);
  });
});

describe('a plan cached while nobody was signed in', () => {
  it('is not an account plan for the lock decision', () => {
    mockUid = null;
    setSharedPlan(ended());
    mockUid = 'u1';
    expect(getAccountPlan()).toBeNull();
  });

  it('a plan read for the signed-in account is', () => {
    setSharedPlan(plan());
    expect(getAccountPlan()).not.toBeNull();
  });
});

describe('pushed routes behind the payment gate', () => {
  it.each([
    ['src/app/customers/[id].tsx', 'CustomerDetail'],
    ['src/app/store-customers/[id].tsx', 'StoreCustomerDetail'],
    ['src/app/domain.tsx', 'Domain'],
    ['src/app/customers/index.tsx', 'CustomersScreen'],
  ])('%s default-exports withPaymentGate(%s)', (file, name) => {
    const src = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
    expect(src).toMatch(new RegExp(`export default withPaymentGate\\(${name},`));
    expect(src).not.toMatch(/export default function/);
  });
});
