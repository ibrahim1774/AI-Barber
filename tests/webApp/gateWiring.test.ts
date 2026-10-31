// WEB_APP_ENTITLEMENTS gate wiring: bookings, store and plan read a web subscription only for a
// shop with no iOS link, and only with the flag on.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bookingsFollowUpOpen, bookingsOpen, ownerBookingsAllowed } from '../../lib/bookings/core.js';
import { storeFollowUpOpen, storeOpen } from '../../lib/store/core.js';
import { getPlan, type PlanDeps } from '../../lib/ios/planFlow.js';
import { synthPurchaseRow, type WebEntitlementRecord } from '../../lib/webApp/entitlementGate.js';
import { world } from '../bookings/fakeRepo.js';
import { storeWorld } from '../store/fakeRepo.js';

afterEach(() => { vi.unstubAllEnvs(); });

const rec = (over: Partial<WebEntitlementRecord> = {}): WebEntitlementRecord => ({
  stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', user_id: 'u1', site_slug: null, tier: 'store', billing_interval: 'month',
  status: 'active', environment: 'live', current_period_end: new Date(Date.now() + 86400000).toISOString(), cancel_at_period_end: false,
  updated_at: '2026-10-30T00:00:00Z', ...over,
});

describe('bookings gates', () => {
  it('flag on, no iOS link: the web row opens the gates by tier; the iOS purchase is not asked', async () => {
    vi.stubEnv('WEB_APP_ENTITLEMENTS', '1');
    const w = world();
    const purchase = vi.fn(async () => null);
    const repo = { ...w.deps.repo, purchase, webEntitlementOf: async () => synthPurchaseRow(rec({ tier: 'bookings' }), null) };
    const shop = { ...w.shop(), ios_otid: null };
    expect(await bookingsOpen(repo, shop)).toBe(true);
    expect(await bookingsFollowUpOpen(repo, shop)).toBe(true);
    expect(await ownerBookingsAllowed(repo, shop)).toBe(true);
    expect(purchase).not.toHaveBeenCalled();
    const site = { ...repo, webEntitlementOf: async () => synthPurchaseRow(rec({ tier: 'website' }), null) };
    expect(await bookingsOpen(site, shop)).toBe(false);
    expect(await bookingsFollowUpOpen(site, shop)).toBe(true);
    const down = { ...repo, webEntitlementOf: async () => synthPurchaseRow(rec({ status: 'canceled', tier: 'bookings' }), null) };
    expect(await bookingsFollowUpOpen(down, shop)).toBe(false);
  });
  it('flag off: a web repo is never consulted and an unlinked shop stays closed', async () => {
    const w = world();
    const web = vi.fn(async () => synthPurchaseRow(rec({ tier: 'bookings' }), null));
    expect(await bookingsOpen({ ...w.deps.repo, webEntitlementOf: web }, { ...w.shop(), ios_otid: null })).toBe(false);
    expect(web).not.toHaveBeenCalled();
  });
  it('flag on but the shop has an iOS link: the web row is never consulted', async () => {
    vi.stubEnv('WEB_APP_ENTITLEMENTS', '1');
    const w = world();
    const web = vi.fn(async () => synthPurchaseRow(rec({ tier: 'store' }), null));
    expect(await bookingsOpen({ ...w.deps.repo, webEntitlementOf: web }, w.shop())).toBe(true);
    expect(web).not.toHaveBeenCalled();
  });
});

describe('store gates', () => {
  it('flag on, no iOS link: needs the Store tier', async () => {
    vi.stubEnv('WEB_APP_ENTITLEMENTS', '1');
    const w = storeWorld();
    const shop = { ...w.shop(), ios_otid: null };
    const open = { ...w.deps.repo, webEntitlementOf: async () => synthPurchaseRow(rec({ tier: 'store' }), null) };
    const mid = { ...w.deps.repo, webEntitlementOf: async () => synthPurchaseRow(rec({ tier: 'bookings' }), null) };
    expect(await storeOpen(open, shop)).toBe(true);
    expect(await storeOpen(mid, shop)).toBe(false);
    expect(await storeFollowUpOpen(mid, shop)).toBe(true);
  });
  it('flag off ignores the web row; an iOS link wins with the flag on', async () => {
    const w = storeWorld();
    const web = vi.fn(async () => synthPurchaseRow(rec({ tier: 'store' }), null));
    expect(await storeOpen({ ...w.deps.repo, webEntitlementOf: web }, { ...w.shop(), ios_otid: null })).toBe(false);
    vi.stubEnv('WEB_APP_ENTITLEMENTS', '1');
    await storeOpen({ ...w.deps.repo, webEntitlementOf: web }, w.shop());
    expect(web).not.toHaveBeenCalled();
  });
});

describe('getPlan', () => {
  const USER = '11111111-1111-4111-8111-111111111111';
  const mk = (shop: { id: string; ios_otid: string | null } | null, web: any) => {
    const webEntitlementOf = vi.fn(async () => web);
    const deps = {
      getUser: async () => ({ id: USER, email: null, fullName: null }),
      shopByOwner: async () => shop,
      purchase: vi.fn(async () => null),
      purchasesOfUser: async () => [],
      webEntitlementOf,
      now: () => Date.now(),
    } as unknown as PlanDeps;
    return { deps, webEntitlementOf };
  };
  const web = () => synthPurchaseRow(rec({ user_id: USER, tier: 'bookings' }), null);

  it('flag on, shop without iOS link: shows the web plan, linked false', async () => {
    vi.stubEnv('WEB_APP_ENTITLEMENTS', '1');
    const { deps } = mk({ id: 's', ios_otid: null }, web());
    const r = await getPlan('Bearer x', deps);
    expect(r.body).toMatchObject({ linked: false, tier: 'bookings', active: true, entitlements: { hosting: true, bookings: true, store: false } });
  });
  it('flag on, no shop and no iOS purchase: the web plan', async () => {
    vi.stubEnv('WEB_APP_ENTITLEMENTS', '1');
    const { deps } = mk(null, web());
    expect((await getPlan('Bearer x', deps)).body).toMatchObject({ linked: false, tier: 'bookings', active: true });
  });
  it('shop with an iOS link, or flag off: web never consulted', async () => {
    const a = mk({ id: 's', ios_otid: 'o1' }, web());
    vi.stubEnv('WEB_APP_ENTITLEMENTS', '1');
    await getPlan('Bearer x', a.deps);
    expect(a.webEntitlementOf).not.toHaveBeenCalled();
    vi.stubEnv('WEB_APP_ENTITLEMENTS', '');
    const b = mk(null, web());
    expect((await getPlan('Bearer x', b.deps)).body).toMatchObject({ tier: null, active: false });
    expect(b.webEntitlementOf).not.toHaveBeenCalled();
  });
});
