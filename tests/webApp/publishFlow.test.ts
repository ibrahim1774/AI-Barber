import { describe, it, expect, vi } from 'vitest';
import { runWebPublish, webProductId, type WebPublishDeps, type WebSiteRow } from '../../lib/webApp/publishFlow.js';
import { tierOf } from '../../lib/ios/tiers.js';
import type { EntitlementRow } from '../../lib/webApp/stripeCore.js';
import { renderPendingBundle, type PendingSite, type PublishOutcome } from '../../lib/publishSite.js';
import type { SiteOwnerRow } from '../../lib/siteOwners.js';
import type { WebsiteData } from '../../types.js';

const NOW = 1_800_000_000_000;
const USER = '3f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f';
const OTHER = '9a9a9a9a-5d4a-4b6f-9e2d-1a2b3c4d5e6f';

const site = (over: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn', phone: '555-0100',
  hero: { heading: 'H', tagline: 'T', imageUrl: 'https://img.example/hero.jpg' },
  about: { heading: 'A', description: ['d'], imageUrl: '' },
  services: [{ title: 'Fade', name: 'Fade', price: '$30', imageUrl: 'https://img.example/svc.jpg' } as any],
  gallery: ['https://img.example/g0.jpg'], craftImages: [], staff: [],
  contact: { address: '1 Main St', email: 'a@b.co' },
  ...over,
} as WebsiteData);

const ent = (over: Partial<EntitlementRow> = {}): EntitlementRow => ({
  stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', user_id: USER, site_slug: null, tier: 'website',
  billing_interval: 'month', status: 'active', environment: 'live', current_period_end: null, cancel_at_period_end: false, ...over,
});

function fakes(o: { ent?: EntitlementRow | null; env?: 'live' | 'test'; user?: { id: string; email: string | null } | null; sites?: WebSiteRow[]; owners?: SiteOwnerRow[]; taken?: string[]; pending?: Record<string, PendingSite>; outcome?: PublishOutcome } = {}) {
  const sites = new Map<string, WebSiteRow>((o.sites ?? []).map((s) => [s.slug, { ...s }]));
  const owners = new Map<string, SiteOwnerRow>((o.owners ?? []).map((s) => [s.slug, { ...s }]));
  const pending = new Map<string, PendingSite>(Object.entries(o.pending ?? {}));
  const env = o.env ?? 'live';
  const purchasesWrite = vi.fn(); // stands in for ios_purchases: must never be touched
  const deps: WebPublishDeps & { _sites: typeof sites; _owners: typeof owners; _pending: typeof pending } = {
    environment: env,
    userOf: vi.fn(async () => (o.user === undefined ? { id: USER, email: 'Owner@Example.com' } : o.user)),
    entitlementOf: vi.fn(async () => (o.ent === undefined ? ent({ environment: env }) : o.ent)),
    sites: {
      byUser: vi.fn(async (u, e) => [...sites.values()].find((s) => s.user_id === u && s.environment === e) ?? null),
      get: vi.fn(async (s) => sites.get(s) ?? null),
      insertIfAbsent: vi.fn(async (r) => { if (sites.has(r.slug)) return false; sites.set(r.slug, { ...r, published_at: null, taken_down_at: null, removed_at: null }); return true; }),
      releaseUnpublished: vi.fn(async (s) => { if (!sites.get(s)?.published_at) sites.delete(s); }),
      markPublished: vi.fn(async (s, sub) => { const r = sites.get(s)!; r.published_at = new Date(NOW).toISOString(); r.stripe_subscription_id = sub; }),
    },
    owners: {
      get: vi.fn(async (s) => owners.get(s) ?? null),
      insertIfAbsent: vi.fn(async (r) => { if (owners.has(r.slug)) return false; owners.set(r.slug, r); return true; }),
    },
    isTaken: vi.fn(async (s) => (o.taken ?? []).includes(s)),
    readPending: vi.fn(async (s) => pending.get(s) ?? null),
    writePending: vi.fn(async (s, p) => { pending.set(s, p); }),
    publish: vi.fn(async (slug) => o.outcome ?? { ok: true, siteId: slug, deployedUrl: `https://${slug}.vercel.app` }),
    render: () => [],
    rememberSlug: vi.fn(async () => {}),
    now: () => NOW,
  } as any;
  deps._sites = sites; deps._owners = owners; deps._pending = pending;
  return { deps, purchasesWrite };
}

const AUTH = 'Bearer tok';
const bound = (over: Partial<WebSiteRow> = {}): WebSiteRow => ({ slug: 'fresh-cuts', stripe_subscription_id: 'sub_1', user_id: USER, environment: 'live', published_at: '2026-10-01T00:00:00Z', taken_down_at: null, removed_at: null, ...over });
const ownerRow = (over: Partial<SiteOwnerRow> = {}): SiteOwnerRow => ({ slug: 'fresh-cuts', user_id: USER, claim_email: null, owner_email: 'owner@example.com', source: 'checkout', checkout_session_id: 'webapp:sub_1', ...over });

describe('webProductId', () => {
  it('maps all six tier/interval pairs to the iOS product ids tierOf understands', () => {
    for (const t of ['website', 'bookings', 'store'] as const) for (const i of ['month', 'year'] as const) {
      expect(tierOf(webProductId(t, i))).toBe(t);
    }
  });
});

describe('runWebPublish', () => {
  it('401 without a valid caller, nothing written', async () => {
    const { deps } = fakes({ user: null });
    const r = await runWebPublish({ siteData: site() }, deps, { authorization: AUTH });
    expect(r).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(deps.writePending).not.toHaveBeenCalled();
  });

  it('400 on a bad body before anything else', async () => {
    const { deps } = fakes();
    expect((await runWebPublish({ siteData: { nope: 1 } }, deps, { authorization: AUTH })).status).toBe(400);
    expect(deps.userOf).not.toHaveBeenCalled();
  });

  it('402 subscription-inactive without an entitled row, nothing bound', async () => {
    for (const e of [null, ent({ status: 'canceled' })]) {
      const { deps } = fakes({ ent: e });
      const r = await runWebPublish({ siteData: site() }, deps, { authorization: AUTH });
      expect(r).toEqual({ status: 402, body: { error: 'subscription-inactive' } });
      expect(deps._sites.size).toBe(0);
      expect(deps.writePending).not.toHaveBeenCalled();
    }
  });

  it('first publish binds the slug in web_app_sites and site_owners, then deploys without force', async () => {
    const { deps } = fakes();
    const r = await runWebPublish({ siteData: site() }, deps, { authorization: AUTH });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ siteId: 'fresh-cuts', deployedUrl: 'https://fresh-cuts.vercel.app', republished: false, version: 1, editedBy: 'owner' });
    expect(deps._sites.get('fresh-cuts')?.published_at).toBeTruthy();
    expect(deps._owners.get('fresh-cuts')).toMatchObject({ user_id: USER, source: 'checkout', checkout_session_id: 'webapp:sub_1', owner_email: 'owner@example.com' });
    expect(deps.publish).toHaveBeenCalledWith('fresh-cuts', { force: false });
    expect(deps.rememberSlug).toHaveBeenCalledWith('sub_1', 'fresh-cuts');
  });

  it('a taken name gets a suffix', async () => {
    const { deps } = fakes({ taken: ['fresh-cuts'] });
    const r: any = await runWebPublish({ siteData: site() }, deps, { authorization: AUTH });
    expect(r.status).toBe(200);
    expect(r.body.siteId).toMatch(/^fresh-cuts-[a-z0-9]{4}$/);
  });

  it('republish reuses the bound slug, forces, and reports republished', async () => {
    const { deps } = fakes({ sites: [bound()], owners: [ownerRow()] });
    const r: any = await runWebPublish({ siteData: site({ shopName: 'Renamed' }) }, deps, { authorization: AUTH });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ siteId: 'fresh-cuts', republished: true });
    expect(deps.publish).toHaveBeenCalledWith('fresh-cuts', { force: true });
    expect(deps.rememberSlug).not.toHaveBeenCalled();
  });

  it('409 slug-owned when site_owners has the slug for someone else; a fresh binding is released', async () => {
    const { deps } = fakes({ owners: [ownerRow({ user_id: OTHER })] });
    const r = await runWebPublish({ siteData: site() }, deps, { authorization: AUTH });
    expect(r).toEqual({ status: 409, body: { error: 'slug-owned' } });
    expect(deps._sites.size).toBe(0);
    expect(deps.writePending).not.toHaveBeenCalled();
  });

  it('409 slug-owned when the bound slug carries an old Stripe checkout session', async () => {
    const { deps } = fakes({ sites: [bound()], owners: [ownerRow({ checkout_session_id: 'cs_old' })] });
    const r = await runWebPublish({ siteData: site() }, deps, { authorization: AUTH });
    expect(r.status).toBe(409);
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it('a test-mode subscription maps to the sandbox slug prefix', async () => {
    const { deps } = fakes({ env: 'test' });
    const r: any = await runWebPublish({ siteData: site() }, deps, { authorization: AUTH });
    expect(r.body.siteId).toBe('ios-test-fresh-cuts');
    expect(deps._sites.get('ios-test-fresh-cuts')?.environment).toBe('test');
  });

  it('409 site-updated when the stored copy is an admin edit newer than baseVersion', async () => {
    const adminCopy: PendingSite = { siteId: 'fresh-cuts', siteData: site(), version: 3, editedBy: 'admin', adminVersion: 3, editedAt: 'x' };
    const { deps } = fakes({ sites: [bound()], owners: [ownerRow()], pending: { 'fresh-cuts': adminCopy } });
    const r: any = await runWebPublish({ siteData: site(), baseVersion: 1 }, deps, { authorization: AUTH });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('site-updated');
    expect(r.body.site.version).toBe(3);
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it('502 publish-failed keeps the same shape as iOS', async () => {
    const { deps } = fakes({ outcome: { ok: false, siteId: 'x', reason: 'deploy-failed' } });
    const r = await runWebPublish({ siteData: site() }, deps, { authorization: AUTH });
    expect(r).toEqual({ status: 502, body: { error: 'publish-failed', reason: 'deploy-failed' } });
  });

  it('never touches the iOS purchases store (not part of the deps at all)', async () => {
    const { deps, purchasesWrite } = fakes();
    await runWebPublish({ siteData: site() }, deps, { authorization: AUTH });
    expect(Object.keys(deps)).not.toContain('repo');
    expect(purchasesWrite).not.toHaveBeenCalled();
  });
});

import { runWebSiteLookup } from '../../lib/webApp/publishFlow.js';
describe('simultaneous first publishes by one account', () => {
  it('the second request shares the first one\'s binding: it is not "fresh", never releases it, and publishes', async () => {
    const { deps } = fakes({ sites: [bound({ published_at: null })], owners: [ownerRow()], pending: { 'fresh-cuts': { siteId: 'fresh-cuts', existingSiteId: null, siteData: site(), imageUrlMap: {}, timestamp: 1, version: 1, editedBy: 'owner' } as any } });
    // The binding did not exist when this request started (the other request inserts it a moment later).
    (deps.sites.byUser as any).mockResolvedValueOnce(null);
    (deps.isTaken as any).mockResolvedValue(false);
    const r: any = await runWebPublish({ siteData: site() }, deps, { authorization: AUTH });
    expect(r.status).toBe(200);
    expect(r.body.siteId).toBe('fresh-cuts');
    expect(deps.sites.releaseUnpublished).not.toHaveBeenCalled();
    expect(deps._sites.has('fresh-cuts')).toBe(true);
  });
});

describe('runWebSiteLookup', () => {
  const base = (over: any = {}) => ({
    environment: 'test' as const,
    userOf: async () => ({ id: 'u1' }),
    sites: { byUser: async () => ({ slug: 's', stripe_subscription_id: 'sub', user_id: 'u1', environment: 'test', published_at: 'x', taken_down_at: null, removed_at: null }) } as any,
    readPending: async () => null,
    subscriptionOf: async () => ({ status: 'active' }),
    ...over,
  });
  it('401 without a valid caller, 404 with no site', async () => {
    expect((await runWebSiteLookup(base({ userOf: async () => null }), { authorization: 'Bearer x' })).status).toBe(401);
    expect((await runWebSiteLookup(base({ sites: { byUser: async () => null } }), { authorization: 'Bearer x' })).status).toBe(404);
  });
  it('active only while the subscription is entitled and the site is up', async () => {
    const ok: any = await runWebSiteLookup(base(), { authorization: 'Bearer x' });
    expect(ok.status).toBe(200); expect(ok.body.active).toBe(true);
    expect(((await runWebSiteLookup(base({ subscriptionOf: async () => ({ status: 'canceled' }) }), { authorization: 'Bearer x' })) as any).body.active).toBe(false);
    expect(((await runWebSiteLookup(base({ sites: { byUser: async () => ({ slug: 's', taken_down_at: 't', removed_at: null }) } }), { authorization: 'Bearer x' })) as any).body.active).toBe(false);
  });
});

describe('runWebPublish: App Store subscribers', () => {
  it('a non-entitled caller with an App Store state gets 403 app-store-account, nothing written', async () => {
    const { deps } = fakes({ ent: null });
    deps.appStoreState = vi.fn(async () => 'active' as const);
    const r = await runWebPublish({ siteData: site() }, deps, { authorization: AUTH });
    expect(r).toEqual({ status: 403, body: { error: 'app-store-account' } });
    expect(deps.writePending).not.toHaveBeenCalled();
    expect(deps._sites.size).toBe(0);
  });
  it('a non-entitled caller with no App Store state still gets 402; a lookup error also falls back to 402', async () => {
    for (const fn of [async () => null, async () => { throw new Error('boom'); }]) {
      const { deps } = fakes({ ent: null });
      deps.appStoreState = vi.fn(fn as any);
      expect((await runWebPublish({ siteData: site() }, deps, { authorization: AUTH })).status).toBe(402);
    }
  });
  it('an entitled caller is unaffected and the App Store dependency is never called', async () => {
    const { deps } = fakes();
    deps.appStoreState = vi.fn(async () => 'active' as const);
    const r = await runWebPublish({ siteData: site() }, deps, { authorization: AUTH });
    expect(r.status).toBe(200);
    expect(deps.appStoreState).not.toHaveBeenCalled();
  });
});

describe('SF2: the web-origin marker is stamped on the server', () => {
  it('a snapshot without the marker (old tab, client without server drafts) is stored with it and renders the web-only extras', async () => {
    const { deps } = fakes();
    const d = site({ pages: { order: [], hidden: [] }, extraPages: { on: ['faq'], serviceGuides: true, seed: 3 } as any, services: [{ title: 'Skin Fade', subtitle: '', description: '', icon: 'scissors', imageUrl: '', price: '$30' } as any] });
    expect((d as any).source).toBeUndefined();
    const r = await runWebPublish({ siteData: d }, deps, { authorization: AUTH });
    expect(r.status).toBe(200);
    const written = (deps.writePending as any).mock.calls[0][1] as PendingSite;
    expect((written.siteData as any).source).toBe('web-app');
    const out = renderPendingBundle({ siteData: JSON.parse(JSON.stringify(written.siteData)), imageUrlMap: written.imageUrlMap }, { siteBaseUrl: 'https://fresh.example.com' });
    expect(out.robots).not.toBeNull();
  });
  it('a client cannot send another origin: the server value wins', async () => {
    const { deps } = fakes();
    await runWebPublish({ siteData: site({ source: 'ios' } as any) }, deps, { authorization: AUTH });
    expect(((deps.writePending as any).mock.calls[0][1] as PendingSite).siteData.source).toBe('web-app');
  });
});

describe('runWebPublish: the seoFallbacks field of the success body (step 7 reads it)', () => {
  it('lists each dropped seo.* value with page, field, reason and key; the stored copy lacks them', async () => {
    const { deps } = fakes();
    const r: any = await runWebPublish({ siteData: site({ copy: { 'seo.home.title': '💈 Cuts', 'seo.faq.description': 'x'.repeat(161), 'seo.about.title': 'Our story', 'faq.book': 'ours' } as any }) }, deps, { authorization: AUTH });
    expect(r.status).toBe(200);
    expect(r.body.seoFallbacks).toEqual([
      { page: 'home', field: 'title', reason: 'emoji', key: 'seo.home.title' },
      { page: 'faq', field: 'description', reason: 'too_long', key: 'seo.faq.description' },
    ]);
    const stored = [...deps._pending.values()][0].siteData as any;
    expect(stored.copy).toEqual({ 'seo.about.title': 'Our story', 'faq.book': 'ours' });
  });
  it('is an empty list when every value is valid or there are none', async () => {
    for (const copy of [undefined, { 'seo.home.title': 'Fresh Cuts' }]) {
      const { deps } = fakes();
      const r: any = await runWebPublish({ siteData: site(copy ? { copy: copy as any } : {}) }, deps, { authorization: AUTH });
      expect(r.status).toBe(200);
      expect(r.body.seoFallbacks).toEqual([]);
    }
  });
  it('is absent from error bodies', async () => {
    const { deps } = fakes({ ent: null });
    const r: any = await runWebPublish({ siteData: site({ copy: { 'seo.home.title': '💈' } as any }) }, deps, { authorization: AUTH });
    expect(r.status).toBe(402); expect(r.body.seoFallbacks).toBeUndefined();
  });
});

import { customDomainOf, siteBody } from '../../lib/webApp/publishFlow.js';
describe('site body customDomain (additive)', () => {
  it('siteBody without customDomain has no such key; with it (or null) the key is present', () => {
    expect('customDomain' in siteBody('s', null, true)).toBe(false);
    expect(siteBody('s', null, true, null).customDomain).toBeNull();
    const d = { domain: 'a.com', state: 'live', url: 'https://a.com', paidUntil: null, autoRenew: true, ready: true };
    expect(siteBody('s', null, true, d).customDomain).toEqual(d);
  });
  it('customDomainOf maps usable states only', () => {
    expect(customDomainOf(null)).toBeNull();
    expect(customDomainOf({ domain: null, state: 'none' })).toBeNull();
    expect(customDomainOf({ domain: 'a.com', state: 'failed:registrar' })).toBeNull();
    expect(customDomainOf({ domain: 'a.com', state: 'expired' })).toBeNull();
    expect(customDomainOf({ domain: 'a.com', state: 'registering', autoRenew: true })).toMatchObject({ state: 'registering', url: null, autoRenew: true });
    expect(customDomainOf({ domain: 'a.com', state: 'live', url: 'https://a.com', paidUntil: '2027-01-01T00:00:00.000Z', autoRenew: true })!.url).toBe('https://a.com');
  });
  it('customDomainOf readiness: ready only when live AND the row has dns_ready_at; a simulated (sandbox) domain has no url and is never ready', () => {
    const live = { domain: 'a.com', state: 'live', url: 'https://a.com' };
    expect(customDomainOf(live)!.ready).toBe(false); // no row: never ready
    expect(customDomainOf(live, { dns_ready_at: null })!.ready).toBe(false);
    expect(customDomainOf(live, { dns_ready_at: '2026-11-06T00:00:00.000Z' })).toMatchObject({ ready: true, url: 'https://a.com' });
    expect(customDomainOf({ domain: 'a.com', state: 'linking' }, { dns_ready_at: '2026-11-06T00:00:00.000Z' })!.ready).toBe(false);
    const sim = customDomainOf({ ...live, sandbox: true }, { simulated: true, dns_ready_at: '2026-11-06T00:00:00.000Z' })!;
    expect(sim).toMatchObject({ sandbox: true, url: null, ready: false, domain: 'a.com' });
    expect(customDomainOf(live, { simulated: true, dns_ready_at: 'x' })).toMatchObject({ sandbox: true, url: null, ready: false });
    expect('sandbox' in customDomainOf(live, { dns_ready_at: 'x' })!).toBe(false);
  });
  it('lookup: a domainOf that never answers is dropped after the deadline, the lookup still answers 200', async () => {
    vi.useFakeTimers();
    try {
      const base: any = {
        environment: 'test', userOf: async () => ({ id: 'u1' }),
        sites: { byUser: async () => ({ slug: 's', removed_at: null, taken_down_at: null }) },
        readPending: async () => null, subscriptionOf: async () => ({ status: 'active' }),
      };
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
      const p = runWebSiteLookup({ ...base, domainOf: () => new Promise(() => {}) }, { authorization: 'Bearer x' });
      await vi.advanceTimersByTimeAsync(3100);
      const out: any = await p;
      expect(out.status).toBe(200);
      expect('customDomain' in out.body).toBe(false);
      quiet.mockRestore();
    } finally { vi.useRealTimers(); }
  });
  it('lookup: body carries customDomain only when domainOf is wired; a domainOf failure is ignored', async () => {
    const base: any = {
      environment: 'test', userOf: async () => ({ id: 'u1' }),
      sites: { byUser: async () => ({ slug: 's', removed_at: null, taken_down_at: null }) },
      readPending: async () => null, subscriptionOf: async () => ({ status: 'active' }),
    };
    expect('customDomain' in (await runWebSiteLookup(base, { authorization: 'Bearer x' }) as any).body).toBe(false);
    const d = { domain: 'a.com', state: 'live', url: 'https://a.com', paidUntil: null, autoRenew: true, ready: true };
    expect(((await runWebSiteLookup({ ...base, domainOf: async () => d }, { authorization: 'Bearer x' })) as any).body.customDomain).toEqual(d);
    const failed: any = await runWebSiteLookup({ ...base, domainOf: async () => { throw new Error('db'); } }, { authorization: 'Bearer x' });
    expect(failed.status).toBe(200);
    expect('customDomain' in failed.body).toBe(false);
  });
});
