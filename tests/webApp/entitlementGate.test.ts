import { afterEach, describe, expect, it, vi } from 'vitest';
import { entitlementActive } from '../../lib/ios/lapse';
import { tierOf } from '../../lib/ios/tiers';
import { fetchWebEntitlementOf, gateRow, pickWebRow, synthPurchaseRow, webAppEntitlementsOn, webProductId, type WebEntitlementRecord } from '../../lib/webApp/entitlementGate';
import { INTERVALS, TIERS } from '../../lib/webApp/stripeCore';

const rec = (over: Partial<WebEntitlementRecord> = {}): WebEntitlementRecord => ({
  stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', user_id: 'u1', site_slug: null, tier: 'bookings', billing_interval: 'month',
  status: 'active', environment: 'live', current_period_end: new Date(Date.now() + 86400000).toISOString(), cancel_at_period_end: false,
  updated_at: '2026-10-30T00:00:00Z', ...over,
});

afterEach(() => { vi.unstubAllEnvs(); });

describe('webProductId', () => {
  it('maps to the iOS tier for all six combinations', () => {
    for (const t of TIERS) for (const i of INTERVALS) expect(tierOf(webProductId(t, i))).toBe(t);
  });
});

describe('synthPurchaseRow', () => {
  it('is live for active, trialing and past_due', () => {
    for (const status of ['active', 'trialing', 'past_due']) {
      const r = synthPurchaseRow(rec({ status }), null);
      expect(entitlementActive(r, 'bookings')).toBe(true);
      expect(r.original_transaction_id).toBe('web:sub_1');
      expect(r.site_slug).toBeNull();
      expect(r.published_at).toBeNull();
      expect(r.revoked_at).toBeNull();
    }
  });
  it('closes every gate for canceled, unpaid and invalid_price', () => {
    for (const status of ['canceled', 'unpaid', 'invalid_price']) {
      const r = synthPurchaseRow(rec({ status }), null);
      expect(r.taken_down_at).toBe('2026-10-30T00:00:00Z');
      for (const ent of ['hosting', 'bookings', 'store'] as const) expect(entitlementActive(r, ent)).toBe(false);
    }
  });
  it('closes when the bound site is taken down', () => {
    const r = synthPurchaseRow(rec(), { taken_down_at: '2026-10-31T00:00:00Z' });
    expect(r.taken_down_at).toBe('2026-10-31T00:00:00Z');
    expect(entitlementActive(r, 'hosting')).toBe(false);
  });
  it('a late webhook is backed up by the expiry check', () => {
    const r = synthPurchaseRow(rec({ current_period_end: new Date(Date.now() - 3 * 3600000).toISOString() }), null);
    expect(entitlementActive(r, 'hosting')).toBe(false);
  });
  it('grants by tier and maps the environment', () => {
    expect(entitlementActive(synthPurchaseRow(rec({ tier: 'website' }), null), 'bookings')).toBe(false);
    expect(entitlementActive(synthPurchaseRow(rec({ tier: 'store' }), null), 'store')).toBe(true);
    expect(synthPurchaseRow(rec({ environment: 'test' }), null).environment).toBe('Sandbox');
    expect(synthPurchaseRow(rec(), null).environment).toBe('Production');
  });
});

describe('pickWebRow', () => {
  it('ignores the other Stripe mode', () => {
    expect(pickWebRow([rec({ environment: 'test' })], 'live')).toBeNull();
    expect(pickWebRow([rec({ environment: 'test' })], null)).toBeNull();
  });
  it('prefers the newest entitled row, else the newest row', () => {
    const a = rec({ stripe_subscription_id: 'a', status: 'canceled', updated_at: '2026-10-30T00:00:00Z' });
    const b = rec({ stripe_subscription_id: 'b', status: 'active', updated_at: '2026-10-01T00:00:00Z' });
    const c = rec({ stripe_subscription_id: 'c', status: 'unpaid', updated_at: '2026-10-29T00:00:00Z' });
    expect(pickWebRow([a, b, c], 'live')?.stripe_subscription_id).toBe('b');
    expect(pickWebRow([c, a], 'live')?.stripe_subscription_id).toBe('a');
  });
});

function fakeDb(tables: Record<string, any[]>) {
  return {
    from(name: string) {
      const filters: [string, unknown][] = [];
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return q; },
        order: () => q,
        limit: () => q,
        then: (res: any) => res({ data: tables[name].filter((r) => filters.every(([c, v]) => r[c] === v)), error: null }),
        maybeSingle: async () => ({ data: tables[name].find((r) => filters.every(([c, v]) => r[c] === v)) ?? null, error: null }),
      };
      return q;
    },
  } as any;
}

describe('fetchWebEntitlementOf', () => {
  it('reads the user row of this key mode and joins the site', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_x');
    const db = fakeDb({
      web_app_entitlements: [rec(), rec({ stripe_subscription_id: 'sub_t', environment: 'test' }), rec({ stripe_subscription_id: 'sub_o', user_id: 'u2' })],
      web_app_sites: [{ stripe_subscription_id: 'sub_1', taken_down_at: '2026-10-31T00:00:00Z' }],
    });
    const r = await fetchWebEntitlementOf(db, 'u1');
    expect(r?.original_transaction_id).toBe('web:sub_1');
    expect(r?.taken_down_at).toBe('2026-10-31T00:00:00Z');
  });
  it('a test row is ignored under a live key, and no key means none', async () => {
    const db = fakeDb({ web_app_entitlements: [rec({ environment: 'test' })], web_app_sites: [], web_app_price_groups: [] });
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_x');
    expect(await fetchWebEntitlementOf(db, 'u1')).toBeNull();
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', '');
    expect(await fetchWebEntitlementOf(db, 'u1')).toBeNull();
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
    expect((await fetchWebEntitlementOf(db, 'u1'))?.environment).toBe('Sandbox');
  });
});

describe('fetchWebEntitlementOf for a free-group account', () => {
  it('no paid row + stored group free: a synthesized, entitled bookings gate row (open gates)', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
    const db = fakeDb({ web_app_entitlements: [], web_app_sites: [], web_app_price_groups: [{ user_id: 'u1', price_group: 'free' }] });
    const r = await fetchWebEntitlementOf(db, 'u1');
    expect(r?.original_transaction_id).toBe('web:free:u1');
    expect(r?.product_id).toBe('com.ibrahim1774.aibarber.bookings.yearly');
    expect(r?.taken_down_at).toBeNull();
    expect(r?.environment).toBe('Sandbox');
  });
  it('group base (or none) with no paid row stays null; a canceled paid row plus free still entitles', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
    expect(await fetchWebEntitlementOf(fakeDb({ web_app_entitlements: [], web_app_sites: [], web_app_price_groups: [{ user_id: 'u1', price_group: 'base' }] }), 'u1')).toBeNull();
    const db = fakeDb({ web_app_entitlements: [rec({ environment: 'test', status: 'canceled' })], web_app_sites: [], web_app_price_groups: [{ user_id: 'u1', price_group: 'free' }] });
    expect((await fetchWebEntitlementOf(db, 'u1'))?.taken_down_at).toBeNull();
  });
});

describe('gateRow', () => {
  const shop = { ios_otid: null as string | null, owner_id: 'u1' };
  const mk = () => ({ purchase: vi.fn(async (o: string) => ({ id: `ios:${o}` })), webEntitlementOf: vi.fn(async (u: string) => ({ id: `web:${u}` })) });
  it('flag off: iOS lookup only, never the web one', async () => {
    const repo = mk();
    expect(webAppEntitlementsOn()).toBe(false);
    expect(await gateRow(repo, shop)).toBeNull();
    expect(await gateRow(repo, { ...shop, ios_otid: 'o1' })).toEqual({ id: 'ios:o1' });
    expect(repo.webEntitlementOf).not.toHaveBeenCalled();
  });
  it('flag on, no iOS link: the web row', async () => {
    vi.stubEnv('WEB_APP_ENTITLEMENTS', '1');
    const repo = mk();
    expect(await gateRow(repo, shop)).toEqual({ id: 'web:u1' });
    expect(repo.purchase).not.toHaveBeenCalled();
  });
  it('flag on but an iOS link: the web row is never consulted', async () => {
    vi.stubEnv('WEB_APP_ENTITLEMENTS', '1');
    const repo = mk();
    expect(await gateRow(repo, { ...shop, ios_otid: 'o1' })).toEqual({ id: 'ios:o1' });
    expect(repo.webEntitlementOf).not.toHaveBeenCalled();
  });
  it('a repo without the optional method: null', async () => {
    vi.stubEnv('WEB_APP_ENTITLEMENTS', '1');
    expect(await gateRow({ purchase: async () => null }, shop)).toBeNull();
  });
});
