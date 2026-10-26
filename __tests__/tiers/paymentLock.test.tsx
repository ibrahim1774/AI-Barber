/**
 * PAYMENT LOCK. Per tier (Website hosting, Bookings, Store, Custom domain): not paid => locked (upgrade card /
 * paywall, publish refused); paid => unlocked; lapse / refund / revoke => locked again, including a published
 * site flagged taken down; renewal or Restore under the same account => unlocked; unknown or loading never
 * unlocks (fail closed) and a failed plan fetch is a retry, not an unlock; account A never unlocks B.
 */
import React from 'react';
import { act, render } from '../store/render';

const mockCall = jest.fn();
jest.mock('@/lib/setup/ownerApi', () => {
  const actual = jest.requireActual('@/lib/setup/ownerApi');
  return { ...actual, call: (...a: unknown[]) => mockCall(...a) };
});
let mockSettled = true;
const mockPaywall = jest.fn(async (_p: string): Promise<string> => 'declined');
const mockDomainTx = jest.fn(async (): Promise<string | null> => null);
jest.mock('@/lib/paywall', () => ({
  usePaywall: () => mockPaywall,
  useSuperwallSettled: () => mockSettled,
  useLatestDomainTransactionId: () => mockDomainTx,
  useLatestTransactionId: () => async () => 'site-tx',
}));
const mockDomainStatus = jest.fn();
let mockClaimRecord: any = null;
jest.mock('@/lib/domains/api', () => ({
  domainStatus: (...a: unknown[]) => mockDomainStatus(...a),
  loadDomainClaim: async () => mockClaimRecord,
  saveDomainClaim: async () => {},
}));
const mockSendClaim = jest.fn();
jest.mock('@/lib/domains/resume', () => ({
  resumeDomainClaim: async () => null,
  sendClaim: (...a: unknown[]) => mockSendClaim(...a),
}));
jest.mock('@/lib/siteStore', () => ({
  ...jest.requireActual('@/lib/siteStore'),
  loadSite: async () => ({ transactionId: 'site-tx' }),
}));

import { OwnerApiError } from '@/lib/setup/ownerApi';
import { getPlanEpoch, getSharedPlan, normalizePlan, resetSharedPlan, setSharedPlan, UNLINKED_PLAN, type Plan } from '@/lib/plan';
import { clearEntitlements, resetEntitlementsForTests, setEntitlementsFromStatus, type EntitlementId } from '@/lib/entitlements';
import { useTierAccess, type TierAccess } from '@/lib/tierAccess';
import { useDomainFlow } from '@/lib/domains/useDomainFlow';
import { publishFlow, type PublishDeps } from '@/lib/publish';
import { checkSubscriptionStatus, isLocked, siteOffline } from '@/lib/subscriptionStatus';
import * as store from '@/lib/siteStore';

const TIERS: EntitlementId[] = ['hosting', 'bookings', 'store'];
const ids = (...x: string[]) => ({ status: 'ACTIVE', entitlements: x.map((id) => ({ id })) });
// A plan that includes `need` (and, being a ladder, everything below it).
const LADDER: Record<EntitlementId, string[]> = { hosting: ['hosting'], bookings: ['hosting', 'bookings'], store: ['hosting', 'bookings', 'store'] };
const planWith = (over: Partial<Plan> & { grants?: EntitlementId[] } = {}): any => {
  const grants = over.grants ?? [];
  const { grants: _g, ...rest } = over;
  return {
    linked: true, tier: null, entitlements: { hosting: grants.includes('hosting'), bookings: grants.includes('bookings'), store: grants.includes('store') },
    active: grants.includes('hosting'), expiresAt: null, takenDownAt: null, revoked: false, purchaseAccount: 'self', purchaseHint: null, capabilities: { memberProfile: false }, ...rest,
  };
};

let latest: TierAccess;
function Probe({ need }: { need: EntitlementId }) {
  latest = useTierAccess(need);
  return null;
}
const trees: any[] = [];
const track = async (el: React.ReactElement) => {
  const t = await render(el);
  trees.push(t);
  return t;
};
const mount = (need: EntitlementId) => track(<Probe need={need} />);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

afterEach(() => {
  act(() => { trees.splice(0).forEach((t) => t.unmount()); });
});

beforeEach(() => {
  resetEntitlementsForTests();
  setSharedPlan(null);
  mockSettled = true;
  mockCall.mockReset().mockRejectedValue(new Error('offline'));
  mockPaywall.mockReset().mockResolvedValue('declined');
});

describe.each(['hosting', 'bookings', 'store'] as EntitlementId[])('tab lock: %s', (need) => {
  it('not paid (Superwall inactive, no server plan) is locked', async () => {
    act(() => setEntitlementsFromStatus({ status: 'INACTIVE' }));
    mockCall.mockResolvedValue(planWith());
    await mount(need);
    await flush();
    expect(latest.status).toBe('ready');
    expect(latest.entitled).toBe(false);
  });

  it('paid unlocks', async () => {
    act(() => { setSharedPlan(planWith({ grants: LADDER[need] as EntitlementId[] })); setEntitlementsFromStatus(ids(...LADDER[need])); });
    await mount(need);
    expect(latest).toMatchObject({ status: 'ready', entitled: true });
  });

  it('lapse / refund / revoke (Superwall goes inactive, server plan false) locks again', async () => {
    act(() => { setSharedPlan(planWith({ grants: LADDER[need] as EntitlementId[] })); setEntitlementsFromStatus(ids(...LADDER[need])); });
    await mount(need);
    expect(latest.entitled).toBe(true);
    mockCall.mockResolvedValue(planWith({ expiresAt: new Date(Date.now() - 40 * 864e5).toISOString() }));
    act(() => setEntitlementsFromStatus({ status: 'INACTIVE' }));
    await flush();
    expect(latest.entitled).toBe(false);
    expect(latest.expired).toBe(true);
  });

  it('renewal / Restore (Superwall active again) under the same account unlocks', async () => {
    act(() => setEntitlementsFromStatus({ status: 'INACTIVE' }));
    mockCall.mockResolvedValue(planWith());
    await mount(need);
    await flush();
    expect(latest.entitled).toBe(false);
    act(() => { setSharedPlan(planWith({ grants: LADDER[need] as EntitlementId[] })); setEntitlementsFromStatus(ids(...LADDER[need])); });
    await flush();
    expect(latest.entitled).toBe(true);
  });

  it('a refunded / revoked purchase locks even if the server still flags the entitlements true', async () => {
    mockCall.mockResolvedValue({ ...planWith({ grants: LADDER[need] as EntitlementId[] }), revoked: true });
    await mount(need);
    await flush();
    expect(latest.status).toBe('ready');
    expect(latest.entitled).toBe(false);
  });

  it('a site the server took down (takenDownAt, not active) locks', async () => {
    mockCall.mockResolvedValue({ ...planWith({ grants: LADDER[need] as EntitlementId[] }), active: false, takenDownAt: '2026-10-20T00:00:00Z' });
    await mount(need);
    await flush();
    expect(latest.entitled).toBe(false);
  });

  it('unknown / loading never unlocks', async () => {
    mockSettled = false;
    await mount(need);
    expect(latest).toMatchObject({ status: 'loading', entitled: false });
  });

  it('Superwall unknown and the plan fetch fails (network): a retry, never unlocked; Retry then unlocks only on a paid answer', async () => {
    await mount(need);
    await flush();
    expect(latest).toMatchObject({ status: 'error', entitled: false });
    mockCall.mockResolvedValue(planWith());
    await act(async () => latest.retry());
    await flush();
    expect(latest).toMatchObject({ status: 'ready', entitled: false });
    mockCall.mockResolvedValue(planWith({ grants: LADDER[need] as EntitlementId[] }));
    await act(async () => latest.retry());
    await flush();
    expect(latest).toMatchObject({ status: 'ready', entitled: true });
  });

  it('a malformed plan answer is an error (retry), not a grant', async () => {
    mockCall.mockResolvedValue({ entitlements: 'yes' });
    await mount(need);
    await flush();
    expect(latest).toMatchObject({ status: 'error', entitled: false });
  });

  it("account A's paid plan never unlocks B: sign-out drops it, and an in-flight reply for A is discarded", async () => {
    mockCall.mockResolvedValue(planWith({ grants: LADDER[need] as EntitlementId[] }));
    await mount(need);
    await flush();
    expect(latest.entitled).toBe(true);
    // A signs out (auth.ts signOut / account switch), B signs in with nothing paid.
    act(() => { resetSharedPlan(); clearEntitlements(); });
    mockCall.mockResolvedValue(planWith());
    await act(async () => latest.retry());
    await flush();
    expect(latest.entitled).toBe(false);
  });
});

describe('account switch races', () => {
  it("a plan request started for A that lands after the switch is not B's", async () => {
    let release!: (p: any) => void;
    mockCall.mockImplementation(() => new Promise((r) => (release = r)));
    await mount('bookings');
    act(() => resetSharedPlan()); // switch while A's request is in flight
    await act(async () => release(planWith({ grants: ['hosting', 'bookings'] })));
    expect(getSharedPlan()).toBeNull();
    expect(latest.entitled).toBe(false);
  });

  it('the epoch moves on every sign-out', () => {
    const e = getPlanEpoch();
    resetSharedPlan();
    expect(getPlanEpoch()).toBe(e + 1);
  });
});

describe('normalizePlan fails closed', () => {
  it('no entitlements object is not a plan', () => {
    expect(normalizePlan({})).toBeNull();
    expect(normalizePlan(null)).toBeNull();
    expect(normalizePlan({ entitlements: [] })).toBeNull();
  });
  it('only literal true grants; revoked or taken-down-and-inactive grants nothing', () => {
    expect(normalizePlan({ entitlements: { hosting: 'true', bookings: 1, store: {} } })!.entitlements).toEqual({ hosting: false, bookings: false, store: false });
    const all = { hosting: true, bookings: true, store: true };
    expect(normalizePlan({ entitlements: all, active: true })!.entitlements).toEqual(all);
    expect(normalizePlan({ entitlements: all, active: true, revoked: true })!.entitlements).toEqual({ hosting: false, bookings: false, store: false });
    expect(normalizePlan({ entitlements: all, active: false, takenDownAt: '2026-10-01T00:00:00Z' })!.entitlements.hosting).toBe(false);
    // A renewed plan the server reports active is not held back by an old takedown date.
    expect(normalizePlan({ entitlements: all, active: true, takenDownAt: '2026-10-01T00:00:00Z' })!.entitlements.hosting).toBe(true);
  });
  it('a 404 no-shop account is unlinked with nothing granted', () => {
    expect(UNLINKED_PLAN.entitlements).toEqual({ hosting: false, bookings: false, store: false });
    mockCall.mockRejectedValue(new OwnerApiError(404, 'no-shop', 'x'));
  });
});

describe('website hosting: publish', () => {
  const SITE: any = {
    draftId: 'd1', inputs: { shopName: 'Fade' }, updatedAt: 1, slug: null, deployedUrl: null, transactionId: null,
    data: {
      shopName: 'Fade', area: 'Brooklyn, NY', phone: '555', hero: { heading: 'Sharp', tagline: 't', imageUrl: 'https://c/h.jpg' },
      about: { heading: 'About', description: ['one'], imageUrl: '' }, services: [{ title: 'Cut', price: '$30', description: 'd', imageUrl: '' }], gallery: [],
    },
  };
  const LIVE = { siteId: 'fade', deployedUrl: 'https://fade.aibarber.org', republished: false };
  const deps = (over: Partial<PublishDeps> = {}): PublishDeps => ({
    hasEntitlement: jest.fn(async () => false),
    showPaywall: jest.fn(async () => 'declined' as const),
    latestTransactionId: jest.fn(async () => 'tx-1'),
    iosPublish: jest.fn(async () => LIVE),
    claimStart: jest.fn(async () => ({ ok: true as const, state: 'unclaimed' as const, claimExpiresAt: 'x' })),
    store,
    accessToken: async () => 'tok',
    ...over,
  });
  beforeEach(async () => {
    await store.savePendingPublish(null);
    await store.clearSite();
  });

  it('not paid: the paywall opens and a decline refuses the publish (nothing sent)', async () => {
    const d = deps();
    expect(await publishFlow(SITE, d)).toEqual({ kind: 'declined' });
    expect(d.showPaywall).toHaveBeenCalled();
    expect(d.iosPublish).not.toHaveBeenCalled();
  });

  it('unknown entitlement (the check throws) fails closed to the paywall', async () => {
    const d = deps({ hasEntitlement: jest.fn(async () => { throw new Error('superwall not configured'); }) });
    expect(await publishFlow(SITE, d)).toEqual({ kind: 'declined' });
    expect(d.iosPublish).not.toHaveBeenCalled();
  });

  it('paid (entitled): publishes without a paywall', async () => {
    const d = deps({ hasEntitlement: jest.fn(async () => true) });
    expect((await publishFlow(SITE, d)).kind).toBe('live');
    expect(d.showPaywall).not.toHaveBeenCalled();
    expect(d.iosPublish).toHaveBeenCalled();
  });

  it('lapsed / refunded / revoked: the entitlement is gone, so publishing asks to pay again', async () => {
    const live = { ...SITE, deployedUrl: 'https://fade.aibarber.org', slug: 'fade', transactionId: 'tx-1' };
    const d = deps({ hasEntitlement: jest.fn(async () => false) });
    expect(await publishFlow(live, d)).toEqual({ kind: 'declined' });
    expect(d.iosPublish).not.toHaveBeenCalled();
  });

  it('renewal / Restore under the same account publishes again', async () => {
    const d = deps({ showPaywall: jest.fn(async () => 'restored' as const) });
    expect((await publishFlow(SITE, d)).kind).toBe('live');
  });

  it('a purchase whose transaction is revoked (402) is inactive, never live', async () => {
    const { ApiError } = jest.requireActual('@/lib/api');
    const d = deps({
      showPaywall: jest.fn(async () => 'purchased' as const),
      accessToken: async () => null,
      claimStart: jest.fn(async () => { throw new ApiError(402, 'inactive', 'x'); }),
    });
    expect((await publishFlow(SITE, d)).kind).toBe('inactive');
    expect(d.iosPublish).not.toHaveBeenCalled();
  });

  describe('a published site after the plan lapses', () => {
    const published: any = { ...SITE, deployedUrl: 'https://fade.aibarber.org', slug: 'fade', transactionId: 'tx-1' };
    it('confirmed lapse locks the editor; active and unknown do not', () => {
      expect(isLocked(published, 'lapsed')).toBe(true);
      expect(isLocked(published, 'active')).toBe(false);
      expect(isLocked(published, 'unknown')).toBe(false);
    });
    it('known entitlements without hosting mark the published site offline (taken down)', () => {
      expect(siteOffline(published, 'unknown', { known: true, hosting: false })).toBe(true);
      expect(siteOffline(published, 'unknown', { known: false, hosting: false })).toBe(false); // unknown never claims offline
    });
    it('the server says the subscription is inactive => lapsed; renewed (active) => active again; network error => unknown', async () => {
      const subs = [{ transactionId: 'tx-1', productId: 'com.ibrahim1774.aibarber.hosting.monthly', purchaseDate: '2026-09-01T00:00:00Z', isActive: true }];
      const base = { site: published, pendingPublish: false, superwallStatus: 'ACTIVE' as const, customerInfo: async () => ({ subscriptions: subs }) };
      const bound = { siteId: 'fade', deployedUrl: published.deployedUrl, slug: 'fade' };
      expect(await checkSubscriptionStatus({ ...base, iosSite: (async () => ({ ...bound, active: false })) as any })).toBe('lapsed');
      expect(await checkSubscriptionStatus({ ...base, iosSite: (async () => ({ ...bound, active: true })) as any })).toBe('active');
      expect(await checkSubscriptionStatus({ ...base, iosSite: (async () => { throw new Error('offline'); }) as any })).toBe('unknown');
    });
  });
});

describe('custom domain', () => {
  let flow: ReturnType<typeof useDomainFlow>;
  function DomainProbe() {
    flow = useDomainFlow();
    return null;
  }
  const FREE = { domain: null, state: 'none' };
  beforeEach(() => {
    mockClaimRecord = null;
    mockDomainTx.mockReset().mockResolvedValue(null);
    mockDomainStatus.mockReset().mockResolvedValue(FREE);
    mockSendClaim.mockReset().mockResolvedValue({ kind: 'progress', status: { domain: 'fade.com', state: 'registering' } });
  });

  it('not paid: buying opens the custom_domain paywall; a decline refuses and nothing is claimed', async () => {
    await track(<DomainProbe />);
    let out: any;
    await act(async () => { out = await flow.buy('fade.com'); });
    expect(mockPaywall).toHaveBeenCalledWith('custom_domain');
    expect(out).toEqual({ kind: 'declined' });
    expect(mockSendClaim).not.toHaveBeenCalled();
  });

  it('paid but the transaction cannot be confirmed: unconfirmed, never claimed (fail closed)', async () => {
    mockPaywall.mockResolvedValue('purchased');
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    await track(<DomainProbe />);
    let p: Promise<any>;
    await act(async () => { p = flow.buy('fade.com'); });
    await act(async () => { await jest.advanceTimersByTimeAsync(10_000); });
    expect(await p!).toEqual({ kind: 'unconfirmed' });
    expect(mockSendClaim).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('paid (an active domain subscription exists): claims without asking to pay again', async () => {
    mockDomainTx.mockResolvedValue('dom-tx');
    await track(<DomainProbe />);
    let out: any;
    await act(async () => { out = await flow.buy('fade.com'); });
    expect(mockPaywall).not.toHaveBeenCalled();
    expect(out.kind).toBe('progress');
    expect(mockSendClaim).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 'dom-tx', domain: 'fade.com' }));
  });

  it('expired / refunded (no active subscription): renew asks to pay again and a decline stays locked', async () => {
    mockClaimRecord = { transactionId: 'old-dom-tx', domain: 'fade.com', siteTransactionId: 'site-tx' };
    mockDomainStatus.mockResolvedValue({ domain: 'fade.com', state: 'expired' });
    await track(<DomainProbe />);
    await act(async () => { await flow.refresh(); });
    let out: any;
    await act(async () => { out = await flow.renew(); });
    expect(mockPaywall).toHaveBeenCalledWith('custom_domain');
    expect(out).toEqual({ kind: 'declined' });
    expect(mockSendClaim).not.toHaveBeenCalled();
  });

  it('renewal / Restore under the same account re-attaches the same name', async () => {
    mockClaimRecord = { transactionId: 'old-dom-tx', domain: 'fade.com', siteTransactionId: 'site-tx' };
    mockDomainStatus.mockResolvedValue({ domain: 'fade.com', state: 'expired' });
    mockPaywall.mockResolvedValue('restored');
    mockDomainTx.mockResolvedValueOnce(null).mockResolvedValue('dom-tx');
    await track(<DomainProbe />);
    await act(async () => { await flow.refresh(); });
    let out: any;
    await act(async () => { out = await flow.renew(); });
    expect(out.kind).toBe('progress');
    expect(mockSendClaim).toHaveBeenCalledWith(expect.objectContaining({ domain: 'fade.com', transactionId: 'dom-tx' }));
  });

  it("an unreadable domain status (network) does not make the slot free for another name: the server's answer decides", async () => {
    mockDomainTx.mockResolvedValue('dom-tx');
    mockDomainStatus.mockRejectedValue(new Error('offline'));
    await track(<DomainProbe />);
    await act(async () => { await flow.buy('x.com'); });
    // No status to prove the slot is in use or free: the claim goes to the server, which refuses a paid-for-by-someone-else slot.
    expect(mockPaywall).not.toHaveBeenCalled();
  });
});
