// Both publish paths take the account's one address row before they give out an address (lib/account/sites.ts), behind ONE_SITE_GUARD.
import { describe, expect, it, vi } from 'vitest';
import { runIosPublish, type PublishDeps } from '../../lib/ios/publishFlow.js';
import { runWebPublish, type WebPublishDeps, type WebSiteRow } from '../../lib/webApp/publishFlow.js';
import { supabasePurchases } from '../../lib/ios/purchases.js';
import type { VerifiedTx } from '../../lib/ios/appleVerify.js';
import type { EntitlementRow } from '../../lib/webApp/stripeCore.js';
import type { GuardMode, SitesDeps, AddressRow } from '../../lib/account/sites.js';
import type { SiteOwnerRow } from '../../lib/siteOwners.js';
import type { PendingSite } from '../../lib/publishSite.js';
import { reportBlocked } from '../../lib/account/blocked.js';
import { fakePurchasesDb } from '../ios/fakePurchasesDb.js';
import { fakeSites } from './fakes/sites.js';

vi.mock('../../lib/account/blocked.js', () => ({ reportBlocked: vi.fn(async () => {}) }));

const NOW = 1_800_000_000_000;
const USER = '3f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f';
const OTHER = '9a9a9a9a-5d4a-4b6f-9e2d-1a2b3c4d5e6f';
const OTID = '2000000123';
const PRODUCT = 'com.ibrahim1774.aibarber.hosting.monthly';
const EXPIRES = '2027-01-01T00:00:00.000Z';

const siteData = (shopName = 'Fresh Cuts') => ({
  shopName, area: 'Brooklyn', phone: '555-0100',
  hero: { heading: 'H', tagline: 'T', imageUrl: 'https://img.example/hero.jpg' },
  about: { heading: 'A', description: ['d'], imageUrl: '' },
  services: [{ title: 'Fade', name: 'Fade', price: '$30', imageUrl: '' }], gallery: [], craftImages: [], staff: [],
  contact: { address: '1 Main St', email: 'a@b.co' },
}) as any;

const throwing = (): SitesDeps => new Proxy({} as SitesDeps, { get: (_t, name) => () => { throw new Error(`the address table must not be touched with the guard off (${String(name)})`); } });

// ---------- iOS ----------
const TX: VerifiedTx = { originalTransactionId: OTID, transactionId: '2000000555', latestTransactionId: '2000000555', productId: PRODUCT, environment: 'Production', expiresAt: Date.parse(EXPIRES), revoked: false, status: 1, productPurchasedAt: NOW - 1000 };
const base = { original_transaction_id: OTID, product_id: PRODUCT, environment: 'Production', site_slug: null, user_id: USER, expires_at: EXPIRES, revoked_at: null, last_notification: null, published_at: null, taken_down_at: null, lapse_checked_at: null, removed_at: null };

function ios(rows: any[], mode: GuardMode, sites: SitesDeps | undefined, over: Partial<PublishDeps> = {}) {
  const db = fakePurchasesDb(rows);
  const repo = supabasePurchases(db.client);
  const deps: PublishDeps = {
    verify: vi.fn(async () => TX), repo, isTaken: vi.fn(async () => false), writePending: vi.fn(async () => {}),
    publish: vi.fn(async (slug: string) => ({ ok: true, siteId: slug, deployedUrl: `https://${slug}.vercel.app`, alreadyLive: false }) as any),
    readPending: vi.fn(async () => null), userOf: vi.fn(async (t: string) => (t === 'tok' ? { id: USER } : null)),
    now: () => NOW, guardMode: () => mode, sites, ...over,
  };
  return { db, deps, run: () => runIosPublish({ transactionId: '2000000555', siteData: siteData() } as any, deps, { authorization: 'Bearer tok' }) };
}

describe('iOS publish takes the address', () => {
  it('OFF: byte-for-byte today: same answer, the address table never touched', async () => {
    const a = ios([{ ...base }], 'off', throwing());
    const b = ios([{ ...base }], 'off', undefined);
    expect(await a.run()).toEqual(await b.run());
    const strip = (r: any) => ({ ...r, verified_at: null, published_at: null });
    expect(strip(a.db.row(OTID))).toEqual(strip(b.db.row(OTID)));
  });
  it('a first publish takes the row (holder apple) before binding, and marks it published once it is live', async () => {
    const f = fakeSites();
    const t = ios([{ ...base }], 'enforce', f.deps);
    const r = await t.run();
    expect(r.status).toBe(200);
    expect(f.rows).toMatchObject([{ user_id: USER, environment: 'Production', slug: 'fresh-cuts', holder: 'apple', published_once: true }]);
    expect(t.db.row(OTID)!.site_slug).toBe('fresh-cuts');
  });
  it('a republish of a bound slug never takes or releases anything', async () => {
    const f = fakeSites([{ user_id: USER, environment: 'Production', slug: 'fresh-cuts', holder: 'apple', published_once: true }]);
    const t = ios([{ ...base, site_slug: 'fresh-cuts', published_at: '2026-10-01T00:00:00Z' }], 'enforce', f.deps);
    expect((await t.run()).status).toBe(200);
    expect(f.calls).toEqual([]);
  });
  it('1: the account already holds another address: 409 account-has-site with it, nothing bound, nothing deployed', async () => {
    const f = fakeSites([{ user_id: USER, environment: 'Production', slug: 'my-web-site', holder: 'web', published_once: true }]);
    const t = ios([{ ...base }], 'enforce', f.deps);
    expect(await t.run()).toEqual({ status: 409, body: { error: 'account-has-site', slug: 'my-web-site' } });
    expect(t.db.row(OTID)!.site_slug).toBeNull();
    expect(t.deps.writePending).not.toHaveBeenCalled();
    expect(t.deps.publish).not.toHaveBeenCalled();
    expect(f.rows).toHaveLength(1);
    expect(reportBlocked).toHaveBeenCalledWith(expect.objectContaining({ reason: 'web-account', email: false }));
  });
  it('alert: the same refusal is recorded and alerted but the publish goes through as today', async () => {
    const f = fakeSites([{ user_id: USER, environment: 'Production', slug: 'my-web-site', holder: 'web', published_once: true }]);
    const t = ios([{ ...base }], 'alert', f.deps);
    expect((await t.run()).status).toBe(200);
    expect(t.db.row(OTID)!.site_slug).toBe('fresh-cuts');
    expect(f.rows).toHaveLength(1); // no second row
    expect(reportBlocked).toHaveBeenCalled();
  });
  it('a missing table behaves as off in both modes', async () => {
    for (const mode of ['alert', 'enforce'] as const) {
      const t = ios([{ ...base }], mode, fakeSites([], { missing: true }).deps);
      expect((await t.run()).status).toBe(200);
      expect(t.db.row(OTID)!.site_slug).toBe('fresh-cuts');
    }
  });
  it('another read error: alert goes on as today; 1 answers 503 before binding anything', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = ios([{ ...base }], 'alert', fakeSites([], { failGet: true }).deps);
    expect((await a.run()).status).toBe(200);
    const e = ios([{ ...base }], 'enforce', fakeSites([], { failGet: true }).deps);
    expect((await e.run()).status).toBe(503);
    expect(e.db.row(OTID)!.site_slug).toBeNull();
  });
  it('TWO FIRST PUBLISHES AT ONCE (same purchase) give one address and one bound slug', async () => {
    const f = fakeSites();
    const t = ios([{ ...base }], 'enforce', f.deps);
    const [a, b] = await Promise.all([t.run(), t.run()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0].slug).toBe(t.db.row(OTID)!.site_slug);
  });
  it('a lost bind gives back the row this request created', async () => {
    const f = fakeSites();
    const t = ios([{ ...base }], 'enforce', f.deps);
    const real = t.deps.repo.bindSlug.bind(t.deps.repo);
    let first = true;
    t.deps.repo.bindSlug = async (otid, slug) => { if (first) { first = false; return false; } return real(otid, slug); };
    t.deps.isTaken = vi.fn(async (s: string) => s === 'fresh-cuts' && !first ? true : false);
    const r: any = await t.run();
    expect(r.status).toBe(200);
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0].slug).toBe(r.body.siteId);
  });
  it('an accountless compat publish takes nothing (no account to hold a row)', async () => {
    const f = fakeSites();
    const t = ios([{ ...base, user_id: null }], 'enforce', f.deps, { allowAccountlessPublish: true });
    const r = await runIosPublish({ transactionId: '2000000555', siteData: siteData() } as any, t.deps, {});
    expect(r.status).toBe(200);
    expect(f.calls).toEqual([]);
  });
});

// ---------- web ----------
const ent = (): EntitlementRow => ({ stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', user_id: USER, site_slug: null, tier: 'website', billing_interval: 'month', status: 'active', environment: 'live', current_period_end: null, cancel_at_period_end: false });

function web(o: { mode: GuardMode; sites?: SitesDeps; webSites?: WebSiteRow[]; owners?: SiteOwnerRow[]; outcome?: any; user?: string } = { mode: 'enforce' }) {
  const sites = new Map<string, WebSiteRow>((o.webSites ?? []).map((s) => [s.slug, { ...s }]));
  const owners = new Map<string, SiteOwnerRow>((o.owners ?? []).map((s) => [s.slug, { ...s }]));
  const pending = new Map<string, PendingSite>();
  const uid = o.user ?? USER;
  const deps = {
    environment: 'live' as const, guardMode: () => o.mode, siteAddresses: o.sites,
    userOf: vi.fn(async () => ({ id: uid, email: 'Owner@Example.com' })),
    entitlementOf: vi.fn(async () => ({ ...ent(), user_id: uid })),
    sites: {
      byUser: vi.fn(async (u: string, e: string) => [...sites.values()].find((s) => s.user_id === u && s.environment === e) ?? null),
      get: vi.fn(async (s: string) => sites.get(s) ?? null),
      insertIfAbsent: vi.fn(async (r: any) => { if (sites.has(r.slug)) return false; if ([...sites.values()].some((s) => s.user_id === r.user_id && s.environment === r.environment && !s.removed_at)) throw new Error('22 unique'); sites.set(r.slug, { ...r, published_at: null, taken_down_at: null, removed_at: null }); return true; }),
      releaseUnpublished: vi.fn(async (s: string) => { if (!sites.get(s)?.published_at) sites.delete(s); }),
      markPublished: vi.fn(async (s: string, sub: string) => { const r = sites.get(s)!; r.published_at = new Date(NOW).toISOString(); r.stripe_subscription_id = sub; }),
    },
    owners: {
      get: vi.fn(async (s: string) => owners.get(s) ?? null),
      insertIfAbsent: vi.fn(async (r: any) => { if (owners.has(r.slug)) return false; owners.set(r.slug, r); return true; }),
    },
    isTaken: vi.fn(async () => false), readPending: vi.fn(async (s: string) => pending.get(s) ?? null), writePending: vi.fn(async (s: string, p: PendingSite) => { pending.set(s, p); }),
    publish: vi.fn(async (slug: string) => o.outcome ?? { ok: true, siteId: slug, deployedUrl: `https://${slug}.vercel.app` }),
    render: () => [], rememberSlug: vi.fn(async () => {}), now: () => NOW,
  } as unknown as WebPublishDeps;
  return { deps, sites, owners, run: (name = 'Fresh Cuts') => runWebPublish({ siteData: siteData(name) }, deps, { authorization: 'Bearer tok' }) };
}

describe('web publish takes the address', () => {
  it('OFF: byte-for-byte today: same answer, the address table never touched', async () => {
    const a = web({ mode: 'off', sites: throwing() });
    const b = web({ mode: 'off' });
    expect(await a.run()).toEqual(await b.run());
    expect([...a.sites.entries()]).toEqual([...b.sites.entries()]);
  });
  it('a first publish takes the row (holder web) and marks it published once it is live', async () => {
    const f = fakeSites();
    const t = web({ mode: 'enforce', sites: f.deps });
    expect((await t.run()).status).toBe(200);
    expect(f.rows).toMatchObject([{ user_id: USER, environment: 'Production', slug: 'fresh-cuts', holder: 'web', published_once: true }]);
  });
  it('a republish of a bound, published site touches nothing', async () => {
    const f = fakeSites([{ user_id: USER, environment: 'Production', slug: 'fresh-cuts', holder: 'web', published_once: true }]);
    const t = web({ mode: 'enforce', sites: f.deps, webSites: [{ slug: 'fresh-cuts', stripe_subscription_id: 'sub_1', user_id: USER, environment: 'live', published_at: '2026-10-01T00:00:00Z', taken_down_at: null, removed_at: null }], owners: [{ slug: 'fresh-cuts', user_id: USER, claim_email: null, owner_email: 'o@e.co', source: 'checkout', checkout_session_id: 'webapp:sub_1' }] });
    expect((await t.run()).status).toBe(200);
    expect(f.calls).toEqual([]);
  });
  it('TWO FIRST PUBLISHES AT ONCE by one account (two different names) give one address and one web site', async () => {
    const f = fakeSites();
    const t = web({ mode: 'enforce', sites: f.deps });
    const [a, b] = await Promise.all([t.run('Fresh Cuts'), t.run('Other Name')]);
    // As today (no guard), the publish that bound the slug fresh can lose the pending-copy race to its twin with 409 slug-owned; what the guard
    // promises is one address, one web site, and a row for the site that went live.
    const ok = [a, b].filter((r) => r.status === 200);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(f.rows).toHaveLength(1);
    expect([...t.sites.values()].filter((s) => s.user_id === USER).length).toBeLessThanOrEqual(1); // never two web sites (the loser's release of the shared binding is today's behaviour)
    expect(f.rows[0].slug).toBe((ok[0].body as any).siteId);
    expect(f.rows[0].published_once).toBe(true);
  });
  it('1: an account that holds an Apple address is refused: 409 slug-owned, no web site bound, nothing written', async () => {
    const f = fakeSites([{ user_id: USER, environment: 'Production', slug: 'apple-site', holder: 'apple', published_once: true }]);
    const t = web({ mode: 'enforce', sites: f.deps });
    expect(await t.run()).toEqual({ status: 409, body: { error: 'slug-owned' } });
    expect(t.sites.size).toBe(0);
    expect(t.deps.writePending).not.toHaveBeenCalled();
    expect(f.rows).toHaveLength(1);
    expect(reportBlocked).toHaveBeenCalledWith(expect.objectContaining({ otid: 'web-publish', reason: 'mixed', email: false }));
  });
  it('alert: the same account publishes as today and the row table is unchanged', async () => {
    const f = fakeSites([{ user_id: USER, environment: 'Production', slug: 'apple-site', holder: 'apple', published_once: true }]);
    const t = web({ mode: 'alert', sites: f.deps });
    expect((await t.run()).status).toBe(200);
    expect(t.sites.size).toBe(1);
    expect(f.rows).toHaveLength(1);
  });
  it('a missing table behaves as off; another read error: alert goes on, 1 answers 503 before binding', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const mode of ['alert', 'enforce'] as const) expect((await web({ mode, sites: fakeSites([], { missing: true }).deps }).run()).status).toBe(200);
    expect((await web({ mode: 'alert', sites: fakeSites([], { failGet: true }).deps }).run()).status).toBe(200);
    const e = web({ mode: 'enforce', sites: fakeSites([], { failGet: true }).deps });
    expect((await e.run()).status).toBe(503);
    expect(e.sites.size).toBe(0);
  });
  it('a failed deploy (502) does not release the row (the job retries onto the same slug)', async () => {
    const f = fakeSites();
    const t = web({ mode: 'enforce', sites: f.deps, outcome: { ok: false, siteId: 'x', reason: 'deploy-failed' } });
    expect((await t.run()).status).toBe(502);
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0].published_once).toBe(false);
  });
  it('slug-owned (another account\'s site_owners row) releases both the web binding and the address row', async () => {
    const f = fakeSites();
    const t = web({ mode: 'enforce', sites: f.deps, owners: [{ slug: 'fresh-cuts', user_id: OTHER, claim_email: null, owner_email: 'x@y.co', source: 'checkout', checkout_session_id: 'webapp:other' }] });
    expect(await t.run()).toEqual({ status: 409, body: { error: 'slug-owned' } });
    expect(t.sites.size).toBe(0);
    expect(f.rows).toHaveLength(0);
  });
});
