import * as store from '@/lib/siteStore';
import { publishFlow, resumePendingPublish, type PublishDeps } from '@/lib/publish';
import { createClaimRunner } from '@/lib/claim';
import { upgradeAfterPublish } from '@/lib/publishRequest';
import type { SiteRecord } from '@/lib/siteStore';

const site = {
  draftId: 'd1', inputs: { shopName: 'Fade' },
  data: { shopName: 'Fade', area: 'Brooklyn, NY', phone: '555', hero: { heading: 'Sharp', tagline: 't', imageUrl: 'https://cdn.example/h.jpg' }, about: { heading: 'About', description: ['one'], imageUrl: '' }, services: [], gallery: [] },
  updatedAt: 1, slug: null, deployedUrl: null, transactionId: null,
} as unknown as SiteRecord;

const deps = (over: Partial<PublishDeps> = {}): PublishDeps => ({
  hasEntitlement: jest.fn(async () => false),
  showPaywall: jest.fn(async () => 'purchased' as const),
  latestTransactionId: jest.fn(async () => 'tx-1'),
  iosPublish: jest.fn(async () => ({ siteId: 's', deployedUrl: 'https://s.aibarber.org', republished: false })),
  store,
  accessToken: async () => null,
  claimStart: jest.fn(async () => ({ ok: true as const, state: 'unclaimed' as const, claimExpiresAt: '2026-11-25T00:00:00.000Z' })),
  ...over,
});

beforeEach(async () => {
  await store.saveSite(site);
  await store.savePendingPublish(null);
});

describe('publishFlow plan hint', () => {
  test.each(['website', 'bookings', 'store'] as const)('the %s hint reaches the publish paywall', async (hint) => {
    const d = deps();
    await publishFlow(site, d, hint);
    expect(d.showPaywall).toHaveBeenCalledWith(hint);
  });

  test('no hint: the paywall is asked for with none', async () => {
    const d = deps();
    await publishFlow(site, d);
    expect(d.showPaywall).toHaveBeenCalledWith(undefined);
  });

  test('an existing entitlement skips the paywall whatever the hint (Move, Restore, reinstall)', async () => {
    const d = deps({ hasEntitlement: jest.fn(async () => true), accessToken: async () => 'tok' });
    const out = await publishFlow(site, d, 'bookings');
    expect(d.showPaywall).not.toHaveBeenCalled();
    expect(out.kind).toBe('live');
  });

  test('paidBefore: bought Website, quit at Create account, taps Publish from Bookings -> no second paywall, back to Create account', async () => {
    await store.savePendingPublish({ transactionId: 'tx-1', data: site.data, createdAt: Date.now(), state: 'unclaimed' } as any);
    const d = deps({ hasEntitlement: jest.fn(async () => false) });
    const out = await publishFlow(site, d, 'bookings');
    expect(d.showPaywall).not.toHaveBeenCalled();
    expect(out).toEqual({ kind: 'claim-required' });
  });

  test('declined stays declined with a hint', async () => {
    const d = deps({ showPaywall: jest.fn(async () => 'declined' as const) });
    expect(await publishFlow(site, d, 'store')).toEqual({ kind: 'declined' });
  });
});

describe('upgradeAfterPublish (entitlement lower than the plan asked for)', () => {
  const e = (o: Record<string, boolean> = {}) => ({ known: true, hosting: true, bookings: false, store: false, ...o });
  test('Bookings asked, paywall skipped, entitlement is Website: the bookings upgrade', () => {
    expect(upgradeAfterPublish('bookings', e(), false)).toBe('bookings_upgrade');
  });
  test('Store asked, entitlement is Bookings: the store upgrade', () => {
    expect(upgradeAfterPublish('store', e({ bookings: true }), false)).toBe('store_upgrade');
  });
  test('already entitled to what was asked: nothing', () => {
    expect(upgradeAfterPublish('bookings', e({ bookings: true }), false)).toBeNull();
    expect(upgradeAfterPublish('store', e({ store: true }), false)).toBeNull();
  });
  test('the paywall was shown (they picked a plan there): never nagged', () => {
    expect(upgradeAfterPublish('store', e(), true)).toBeNull();
  });
  test('Website hint, no hint, or entitlements unknown: nothing', () => {
    expect(upgradeAfterPublish('website', e(), false)).toBeNull();
    expect(upgradeAfterPublish(undefined, e(), false)).toBeNull();
    expect(upgradeAfterPublish('bookings', { ...e(), known: false }, false)).toBeNull();
  });
});

describe('the plan hint survives Create account', () => {
  const paid = { transactionId: 'tx-1', data: site.data, createdAt: Date.now(), state: 'unclaimed' } as any;

  test('paidBefore: the new hint is saved with the pending publish', async () => {
    await store.savePendingPublish(paid);
    await publishFlow(site, deps(), 'bookings');
    expect(await store.loadPendingPublish()).toMatchObject({ state: 'unclaimed', planHint: 'bookings' });
  });

  test('paidBefore without a new hint keeps the earlier one', async () => {
    await store.savePendingPublish({ ...paid, planHint: 'store' });
    await publishFlow(site, deps());
    expect(await store.loadPendingPublish()).toMatchObject({ planHint: 'store' });
  });

  test('a hint chosen at the paywall this run is not stored (they picked a plan there)', async () => {
    await publishFlow(site, deps(), 'bookings');
    expect((await store.loadPendingPublish())?.planHint).toBeUndefined();
  });

  test('the claim publish going live reports the hint; a plain one does not', async () => {
    await store.savePendingPublish({ ...paid, planHint: 'bookings' });
    const out = await resumePendingPublish(deps({ accessToken: async () => 'tok' }));
    expect(out).toMatchObject({ kind: 'live', planHint: 'bookings' });
    await store.savePendingPublish(paid);
    expect(await resumePendingPublish(deps({ accessToken: async () => 'tok' }))).not.toHaveProperty('planHint');
  });

  test('the claim runner passes the hint through on live', async () => {
    const run = createClaimRunner({
      signup: jest.fn(), transactionId: async () => 'tx-1', signIn: jest.fn(),
      finish: async () => ({ kind: 'live', url: 'u', republished: false, planHint: 'store' }),
      dropSession: async () => {},
    } as any);
    expect(await run.finish()).toEqual({ kind: 'live', planHint: 'store' });
  });
});
