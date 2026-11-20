// Wave W2 server half: WEB_APPLE_VIEW_ONLY. Off = every route unchanged and nothing new read; on = Apple accounts are view-only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ ios: [] as any[], sites: [] as any[], ent: [] as any[], draft: null as any, drafts: 0, calls: [] as string[], failTable: '' }));
vi.mock('../../lib/webApp/appStoreGuard.js', () => ({ appStoreStateOf: async () => null }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  webAppCors: () => false, webAppCheckoutOn: () => true, webAppEntitlementsOn: () => true, authOutage: () => false,
  callerFrom: async () => ({ id: 'u1', email: 'o@example.com' }),
  sbRest: async (path: string, init: any = {}) => {
    const method = init.method ?? 'GET';
    db.calls.push(`${method} ${path}`);
    if (db.failTable && path.startsWith(db.failTable)) throw new Error('down');
    if (path.startsWith('web_app_entitlements?')) return db.ent;
    if (path.startsWith('web_app_sites?')) return db.sites;
    if (path.startsWith('ios_purchases?')) return db.ios;
    if (path.startsWith('site_owners?')) return [];
    if (path.startsWith('web_app_price_groups?')) return [{ price_group: 'base' }];
    if (path.startsWith('web_app_drafts')) {
      if (method === 'GET') return db.draft ? [db.draft] : [];
      if (method === 'PATCH') return [{ ...db.draft, ...init.body }];
      return [{ ...init.body }];
    }
    return [];
  },
}));

import me from '../../api/web-app/me.js';
import draft from '../../api/web-app/draft.js';
import { viewOnlyOf, webKindOf, webViewOnlyOn, type ViewOnlyDeps } from '../../lib/account/webViewOnly.js';
import { liveWebPublishDeps, runWebPublish, type WebPublishDeps } from '../../lib/webApp/publishFlow.js';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const P = 'com.ibrahim1774.aibarber.';
const apple = (o: any = {}) => ({ original_transaction_id: '2000000000001', product_id: `${P}bookings.monthly`, environment: 'Production', user_id: 'u1', site_slug: 'fresh-cuts', published_at: iso(NOW - 30 * DAY), expires_at: iso(Date.now() + 20 * DAY), revoked_at: null, taken_down_at: null, removed_at: null, last_notification: null, ...o });
const lapsed = (o: any = {}) => apple({ expires_at: iso(Date.now() - 3 * DAY), taken_down_at: iso(Date.now() - DAY), ...o });
const card = (o: any = {}) => ({ stripe_subscription_id: 'sub_1', status: 'active', tier: 'bookings', billing_interval: 'month', current_period_end: iso(Date.now() + 10 * DAY), created_at: '2026-10-01', ...o });
const webSite = () => ({ slug: 'web-cuts', published_at: '2026-10-02', removed_at: null, taken_down_at: null });

const kdeps = (m: { ios?: any[]; sites?: any[]; ent?: any[]; oldDraft?: boolean; free?: boolean; fail?: boolean }): ViewOnlyDeps => ({
  webSites: async () => { if (m.fail) throw new Error('down'); return m.sites ?? []; },
  applePurchases: async () => m.ios ?? [], entitlements: async () => m.ent ?? [],
  isFree: async () => !!m.free, legacyOwner: async () => false, now: () => Date.now(),
  oldDraft: async () => !!m.oldDraft,
});

describe('viewOnlyOf (the field shape)', () => {
  it('apple holder with a live purchase', async () => {
    expect(await viewOnlyOf('u1', 'Production', kdeps({ ios: [apple()] }))).toEqual({ reason: 'apple', site: { slug: 'fresh-cuts', url: 'https://fresh-cuts.vercel.app' }, planActive: true, tier: 'bookings', cardPlan: false, oldDraft: false });
  });
  it('apple holder, lapsed: planActive false', async () => {
    const v = await viewOnlyOf('u1', 'Production', kdeps({ ios: [lapsed()] }));
    expect(v).toMatchObject({ reason: 'apple', planActive: false });
  });
  it('apple holder plus a card plan: cardPlan true', async () => {
    expect(await viewOnlyOf('u1', 'Production', kdeps({ ios: [apple()], ent: [card()] }))).toMatchObject({ reason: 'apple', cardPlan: true });
  });
  it('oldDraft follows the drafts lookup', async () => {
    expect((await viewOnlyOf('u1', 'Production', kdeps({ ios: [apple()], oldDraft: true })))?.oldDraft).toBe(true);
  });
  it('apple with no address yet: site null', async () => {
    expect((await viewOnlyOf('u1', 'Production', kdeps({ ios: [apple({ site_slug: null, published_at: null })] })))?.site).toBeNull();
  });
  it('web account with a stray lapsed ios_otid: null', async () => {
    expect(await viewOnlyOf('u1', 'Production', kdeps({ sites: [webSite()], ent: [card()], ios: [lapsed({ site_slug: null, published_at: null })] }))).toBeNull();
  });
  it('mixed and neither: null', async () => {
    expect(await viewOnlyOf('u1', 'Production', kdeps({ ios: [apple()], sites: [webSite()] }))).toBeNull();
    expect(await viewOnlyOf('u1', 'Production', kdeps({}))).toBeNull();
    expect(await viewOnlyOf('u1', 'Production', kdeps({ ent: [card()] }))).toBeNull();
  });
  it('sandbox-only Apple purchase: not view-only on Production, view-only on a Sandbox deployment', async () => {
    const m = { ios: [apple({ environment: 'Sandbox' })] };
    expect(await viewOnlyOf('u1', 'Production', kdeps(m))).toBeNull();
    expect(await viewOnlyOf('u1', 'Sandbox', kdeps(m))).toMatchObject({ reason: 'apple' });
  });
  it('FREE_IS_WEB=1 with a Free account holding an Apple address is still apple', async () => {
    vi.stubEnv('FREE_IS_WEB', '1');
    expect(await viewOnlyOf('u1', 'Production', kdeps({ ios: [apple()], free: true }))).toMatchObject({ reason: 'apple' });
    vi.unstubAllEnvs();
  });
  it('a failed read throws (callers decide)', async () => {
    await expect(viewOnlyOf('u1', 'Production', kdeps({ fail: true }))).rejects.toThrow();
    await expect(webKindOf('u1', 'Production', kdeps({ fail: true }))).rejects.toThrow();
  });
  it('the switch is === "1"', () => {
    expect(webViewOnlyOn({})).toBe(false);
    expect(webViewOnlyOn({ WEB_APPLE_VIEW_ONLY: 'true' })).toBe(false);
    expect(webViewOnlyOn({ WEB_APPLE_VIEW_ONLY: '1' })).toBe(true);
  });
});

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };
const getMe = async () => { const r = res(); await me({ method: 'GET', headers: { authorization: 'Bearer t' } }, r); return r; };
const run = async (method: string, headers: any = {}, body?: any) => { const r = res(); await draft({ method, headers: { authorization: 'Bearer t', ...headers }, body }, r); return r; };
const siteData = () => ({ shopName: 'Fresh Cuts', area: 'Brooklyn', phone: '555', hero: { heading: 'H', tagline: 'T', imageUrl: '' }, about: { heading: 'A', description: ['d'], imageUrl: '' }, services: [{ title: 'Fade', name: 'Fade', price: '$30', imageUrl: '' }], gallery: [], craftImages: [], staff: [], contact: { address: '1 Main St', email: 'a@b.co' } });
const existing = () => ({ user_id: 'u1', environment: 'live', draft_id: 'd1', revision: 1, site_data: { ...siteData(), source: 'web-app', shopName: 'Old' }, deployed_url: null, published_binding: null, updated_at: 'x', suspended: false });
const put = () => ({ id: 'd1', expectedRevision: 1, site_data: siteData() });
const touchedKind = () => db.calls.some((c) => c.includes('ios_purchases?') || c.includes('site_owners?') || c.includes('web_app_sites?'));

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_x'); vi.stubEnv('WEB_APP_RELIABILITY', '1'); vi.stubEnv('WEB_APP_CHECKOUT', '1'); vi.stubEnv('WEB_APP_ENTITLEMENTS', '1');
  vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
  Object.assign(db, { ios: [], sites: [], ent: [], draft: existing(), calls: [], failTable: '' });
});
afterEach(() => vi.unstubAllEnvs());

describe('switch off: unchanged and nothing new read', () => {
  for (const [name, setup] of Object.entries({ apple: () => { db.ios = [apple()]; }, web: () => { db.sites = [webSite()]; db.ent = [card()]; }, none: () => {} })) {
    it(`${name}: /me has no viewOnly key, draft PUT saves, no kind or drafts read`, async () => {
      setup();
      for (const v of [undefined, '', '0', 'true']) {
        if (v !== undefined) vi.stubEnv('WEB_APPLE_VIEW_ONLY', v);
        db.calls = [];
        const m = await getMe();
        expect(m.code).toBe(200);
        expect(Object.keys(m.body)).not.toContain('viewOnly');
        expect(db.calls.some((c) => c.includes('ios_purchases?') || c.includes('site_owners?') || c.includes('web_app_drafts'))).toBe(false);
        db.calls = [];
        const g = await run('GET'); const p = await run('PUT', {}, put());
        expect(g.code).toBe(200); expect(p.code).toBe(200);
        expect(touchedKind()).toBe(false);
      }
    });
  }
  it('/me body equals the switch-on body minus viewOnly', async () => {
    db.ios = [apple()];
    const off = await getMe();
    vi.stubEnv('WEB_APPLE_VIEW_ONLY', '1');
    const on = await getMe();
    const { viewOnly, ...rest } = on.body;
    expect(JSON.stringify(rest)).toBe(JSON.stringify(off.body));
    expect(viewOnly).toMatchObject({ reason: 'apple' });
  });
});

describe('switch on', () => {
  beforeEach(() => vi.stubEnv('WEB_APPLE_VIEW_ONLY', '1'));
  it('apple holder, live purchase: viewOnly.planActive, PUT 403 nothing written, GET 200', async () => {
    db.ios = [apple()];
    const m = await getMe();
    expect(m.body.viewOnly).toMatchObject({ reason: 'apple', planActive: true, tier: 'bookings', cardPlan: false, oldDraft: true, site: { slug: 'fresh-cuts' } });
    db.calls = [];
    const p = await run('PUT', {}, put());
    expect(p.code).toBe(403); expect(p.body).toEqual({ error: 'app-store-account' });
    expect(db.calls.some((c) => c.startsWith('PATCH') || c.startsWith('POST'))).toBe(false);
    expect((await run('GET')).code).toBe(200);
  });
  it('apple holder, lapsed: planActive false', async () => {
    db.ios = [lapsed()];
    expect((await getMe()).body.viewOnly).toMatchObject({ planActive: false });
  });
  it('apple plus card plan: cardPlan true', async () => {
    db.ios = [apple()]; db.ent = [card()];
    expect((await getMe()).body.viewOnly).toMatchObject({ cardPlan: true });
  });
  it('web account with a stray lapsed ios_otid: viewOnly null, PUT 200', async () => {
    db.sites = [webSite()]; db.ent = [card()]; db.ios = [lapsed({ site_slug: null, published_at: null })];
    expect((await getMe()).body.viewOnly).toBeNull();
    expect((await run('PUT', {}, put())).code).toBe(200);
  });
  it('mixed and neither: not view-only, PUT 200', async () => {
    db.ios = [apple()]; db.sites = [webSite()];
    expect((await getMe()).body.viewOnly).toBeNull();
    expect((await run('PUT', {}, put())).code).toBe(200);
    db.ios = []; db.sites = [];
    expect((await getMe()).body.viewOnly).toBeNull();
    expect((await run('PUT', {}, put())).code).toBe(200);
  });
  it('sandbox-only Apple purchase: Production deployment not view-only, Sandbox deployment view-only', async () => {
    db.ios = [apple({ environment: 'Sandbox' })];
    expect((await getMe()).body.viewOnly).toBeNull();
    expect((await run('PUT', {}, put())).code).toBe(200);
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
    db.draft = { ...existing(), environment: 'test' };
    expect((await getMe()).body.viewOnly).toMatchObject({ reason: 'apple' });
    expect((await run('PUT', {}, put())).code).toBe(403);
  });
  it('a native caller (X-PB-Build) is left to nativeModeGate: the view-only guard adds no kind read for it', async () => {
    // An Apple account from the phone is refused by nativeModeGate (not-account-mode), never by the view-only guard.
    db.ios = [apple()];
    const a = await run('PUT', { 'x-pb-build': '57' }, put());
    expect(a.code).toBe(403); expect(a.body).toEqual({ error: 'not-account-mode' });
    // A web account in account mode saves from the phone. The gate reads the kind once; with the switch on the draft guard must not read it again
    // (removing `!nativeBuild(req)` from api/web-app/draft.ts makes this 2 reads, and the next line fails).
    vi.stubEnv('ACCOUNT_DRAFTS_IOS', 'all');
    db.ios = []; db.sites = [webSite()]; db.ent = [card()];
    const reads = async () => { db.calls = []; const r = await run('PUT', { 'x-pb-build': '57' }, put()); expect(r.code).toBe(200); return db.calls.filter((c) => c.startsWith('GET ios_purchases?')).length; };
    const withOn = await reads();
    vi.stubEnv('WEB_APPLE_VIEW_ONLY', '');
    const withOff = await reads();
    expect(withOff).toBe(1);
    expect(withOn).toBe(withOff);
  });
  it('kind lookup throws: PUT proceeds, /me has no viewOnly field', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.ios = [apple()]; db.failTable = 'ios_purchases?';
    expect((await run('PUT', {}, put())).code).toBe(200);
    const m = await getMe();
    expect(m.code).toBe(200);
    expect(Object.keys(m.body)).not.toContain('viewOnly');
    err.mockRestore();
  });
});

describe('publish (runWebPublish)', () => {
  const sd = { shopName: 'Fresh Cuts', area: 'Brooklyn', phone: '555-0100', hero: { heading: 'H', tagline: 'T', imageUrl: 'https://img.example/hero.jpg' }, about: { heading: 'A', description: ['d'], imageUrl: '' }, services: [{ title: 'Fade', name: 'Fade', price: '$30', imageUrl: 'https://img.example/svc.jpg' }], gallery: ['https://img.example/g0.jpg'], craftImages: [], staff: [], contact: { address: '1 Main St', email: 'a@b.co' } };
  const mk = (kind: any) => {
    const entitlementOf = vi.fn(async () => ({ stripe_subscription_id: 'sub_1', user_id: 'u1', tier: 'website', billing_interval: 'month', status: 'active', environment: 'live' }));
    const webKind = vi.fn(async () => { if (kind instanceof Error) throw kind; return kind; });
    const deps: any = { environment: 'live', userOf: async () => ({ id: 'u1', email: 'o@example.com' }), entitlementOf, webKind,
      sites: { byUser: vi.fn(async () => null), get: vi.fn(async () => null), insertIfAbsent: vi.fn(async () => true), releaseUnpublished: vi.fn(), markPublished: vi.fn() },
      owners: { get: vi.fn(async () => null), insertIfAbsent: vi.fn(async () => true) }, isTaken: async () => false, readPending: async () => null, writePending: vi.fn(),
      publish: vi.fn(async (slug: string) => ({ ok: true, siteId: slug, deployedUrl: `https://${slug}.vercel.app` })), render: () => [], rememberSlug: vi.fn(), now: () => NOW };
    return { deps: deps as WebPublishDeps, entitlementOf, webKind };
  };
  it('switch off: the kind is never asked', async () => {
    const { deps, webKind } = mk('apple');
    const r = await runWebPublish({ siteData: sd }, deps, { authorization: 'Bearer t' });
    expect(r.status).not.toBe(403); expect(webKind).not.toHaveBeenCalled(); // the fake site store does not hold state, so the flow may stop later; it got past the entitlement step
    expect(deps.entitlementOf).toHaveBeenCalled();
  });
  it('switch on: an entitled Apple account (live or card plan) gets 403 app-store-account, nothing written', async () => {
    vi.stubEnv('WEB_APPLE_VIEW_ONLY', '1');
    const { deps, entitlementOf } = mk('apple');
    const r = await runWebPublish({ siteData: sd }, deps, { authorization: 'Bearer t' });
    expect(r).toEqual({ status: 403, body: { error: 'app-store-account' } });
    expect(entitlementOf).not.toHaveBeenCalled();
    expect((deps.sites as any).insertIfAbsent).not.toHaveBeenCalled(); expect((deps.publish as any)).not.toHaveBeenCalled();
  });
  it('switch on: web, mixed and neither publish as today', async () => {
    vi.stubEnv('WEB_APPLE_VIEW_ONLY', '1');
    for (const k of ['web', 'mixed', 'neither']) { const m = mk(k); expect((await runWebPublish({ siteData: sd }, m.deps, { authorization: 'Bearer t' })).status).not.toBe(403); expect(m.entitlementOf).toHaveBeenCalled(); }
  });
  it('switch on: a kind lookup error answers 503', async () => {
    vi.stubEnv('WEB_APPLE_VIEW_ONLY', '1');
    const r = await runWebPublish({ siteData: sd }, mk(new Error('db')).deps, { authorization: 'Bearer t' });
    expect(r.status).toBe(503);
  });
  it('the publish job refuses an Apple account too (it runs the same flow with the live deps)', async () => {
    vi.stubEnv('WEB_APPLE_VIEW_ONLY', '1');
    const jobDeps = mk('apple').deps; // publishJobs.publish = runWebPublish(snapshot, liveWebPublishDeps() with userOf replaced, { draftId })
    const r = await runWebPublish({ siteData: sd, baseVersion: null }, jobDeps, { draftId: 'd1' });
    expect(r).toEqual({ status: 403, body: { error: 'app-store-account' } });
  });
});

describe('live wiring of the kind guard', () => {
  beforeEach(() => { vi.stubEnv('WEB_APPLE_VIEW_ONLY', '1'); db.draft = null; });
  it('liveWebPublishDeps wires webKind (the publish job and the endpoint both run on these deps)', async () => {
    const deps = liveWebPublishDeps();
    expect(typeof deps.webKind).toBe('function');
    db.ios = [apple()];
    expect(await deps.webKind!('u1')).toBe('apple');
  });
  it('FREE_IS_WEB=1: the kind lookups (guard deps and webKindOf) make no price-group read', async () => {
    vi.stubEnv('FREE_IS_WEB', '1');
    db.ios = [apple()];
    db.calls = [];
    expect(await liveWebPublishDeps().webKind!('u1')).toBe('apple');
    expect(await webKindOf('u1', 'Production')).toBe('apple');
    expect(db.calls.length).toBeGreaterThan(0);
    expect(db.calls.some((c) => c.startsWith('GET web_app_price_groups?'))).toBe(false);
    // A failing price-group table is no failure point either.
    db.failTable = 'web_app_price_groups?';
    expect(await webKindOf('u1', 'Production')).toBe('apple');
  });
  it('/me with ACCOUNT_PLAN_V2 and the switch both on reads the plan once (one ios_purchases read) and returns both fields', async () => {
    vi.stubEnv('ACCOUNT_PLAN_V2', '1');
    db.ios = [apple()]; db.calls = [];
    const m = await getMe();
    expect(m.body.viewOnly).toMatchObject({ reason: 'apple' });
    expect(m.body.kind).toBe('apple');
    expect(db.calls.filter((c) => c.startsWith('GET ios_purchases?')).length).toBe(1);
  });
});
