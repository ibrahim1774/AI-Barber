import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';

// Free site portal (primebarber.org/free-site): the 'free' group, its in-memory entitlement, and every place that must accept or skip it.
const db = vi.hoisted(() => ({
  groups: [] as any[], ents: [] as any[], custs: [] as any[], calls: [] as any[], sessions: [] as any[],
  user: 'u1', created: '2026-11-13T00:00:00Z', phone: null as string | null, sites: [] as any[],
}));

vi.mock('../../lib/webApp/webAppServer.js', () => ({
  webAppCors: () => false,
  webAppCheckoutOn: () => true,
  stripeCall: async () => ({ data: db.sessions }),
  callerFrom: async () => ({ id: db.user, email: 'o@example.com' }),
  sbRest: async (path: string, init: any = {}) => {
    db.calls.push({ path, ...init });
    if (path.startsWith('web_app_price_groups')) {
      if ((init.method ?? 'GET') === 'GET') return db.groups.slice(0, 1);
      if (!db.groups.length) db.groups.push(init.body);
      return null;
    }
    if (path.startsWith('web_app_entitlements')) return db.ents.slice(0, 1);
    if (path.startsWith('web_app_customers')) return db.custs.slice(0, 1);
    if (path.startsWith('web_app_sites')) return db.sites;
    return [];
  },
}));
vi.mock('../../lib/webApp/contactPhoneLive.js', () => ({
  savedPhoneOf: async () => db.phone, savedPhoneState: async () => ({ phone: db.phone, contactsOk: true }),
}));
vi.mock('../../lib/webApp/appStoreGuard.js', () => ({ appStoreStateOf: async () => null }));

import handler from '../../api/web-app/price-group.js';
import me from '../../api/web-app/me.js';
import { assignGroup, freeEntitlementOf, entitlementOrFree, isFree, isFreeSubscriptionId } from '../../lib/webApp/priceGroup.js';
import { runWebPublish, liveEntitlementOf, type WebPublishDeps } from '../../lib/webApp/publishFlow.js';
import { liveWebSweepDeps, sweepWebApp } from '../../lib/webApp/lapse.js';
import { needsPhone } from '../../lib/webApp/phoneGate.js';
import { PRICE_ENV, PRICE_GROUPS, groupConfigured, isPriceGroup, portalConfigFor, priceIdFor, tierForPriceId } from '../../lib/webApp/stripeCore.js';
import { priceGroupField } from '../../lib/priceGroupField.js';
import { buildPayload } from '../../lib/webApp/signupSheet.js';
import { ownerHasWebPlan } from '../../lib/webApp/ownerNotify.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; return r; };
const post = async (body: any, ip = '1.1.1.1') => { const r = res(); await handler({ method: 'POST', headers: { authorization: 'Bearer t', 'x-real-ip': ip }, body }, r); return r; };
const writes = () => db.calls.filter((c) => c.method === 'POST');

let n = 0;
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('WEB_APP_CHECKOUT', '1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
  vi.stubEnv('WEB_APP_FREE_OPEN', '1'); vi.stubEnv('WEB_APP_FREE_START', '2026-11-12T00:00:00Z');
  vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
  db.created = '2026-11-13T00:00:00Z'; db.sessions = []; db.groups = []; db.ents = []; db.custs = []; db.calls = []; db.phone = null; db.sites = [];
  db.user = `u${++n}`;
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ created_at: db.created }) }));
});

describe('assignGroup / POST price-group with free', () => {
  it('stores a new sign-up as free', async () => {
    const r = await post({ group: 'free' });
    expect(r.code).toBe(200); expect(r.body).toEqual({ ok: true, group: 'free' });
    expect(db.groups[0]).toMatchObject({ price_group: 'free', source: 'client' });
  });
  it('is write-once: an existing group is returned untouched (free never replaces it, nothing replaces free)', async () => {
    db.groups = [{ price_group: 'g10' }];
    expect((await post({ group: 'free' })).body.group).toBe('g10');
    expect(writes()).toHaveLength(0);
    db.groups = [{ price_group: 'free' }];
    expect((await post({ group: 'base' })).body.group).toBe('free');
    expect((await post({ group: 'g20' })).body.group).toBe('free');
    expect(writes()).toHaveLength(0);
  });
  it('Stripe history (entitlement or customer row, any environment) is stored base', async () => {
    db.ents = [{ stripe_subscription_id: 'sub_old' }];
    expect((await post({ group: 'free' })).body.group).toBe('base');
    expect(db.groups[0].price_group).toBe('base');
    db.groups = []; db.ents = []; db.custs = [{ user_id: db.user }];
    expect((await post({ group: 'free' })).body.group).toBe('base');
  });
  it('a completed Checkout session for this user is stored base', async () => {
    db.sessions = [{ status: 'complete', metadata: { app: 'aibarber-app', user_id: db.user } }];
    expect((await post({ group: 'free' })).body.group).toBe('base');
  });
  it('an account created before WEB_APP_FREE_START is stored base', async () => {
    db.created = '2026-11-01T00:00:00Z';
    expect((await post({ group: 'free' })).body).toEqual({ ok: true, group: 'base' });
    expect(db.groups[0].price_group).toBe('base');
  });
  it('flag off (OPEN not 1, or START missing/invalid): base returned, nothing written; a stored free is still honoured', async () => {
    vi.stubEnv('WEB_APP_FREE_OPEN', '0');
    expect((await post({ group: 'free' })).body).toEqual({ ok: true, group: 'base' }); expect(writes()).toHaveLength(0);
    vi.stubEnv('WEB_APP_FREE_OPEN', '1'); vi.stubEnv('WEB_APP_FREE_START', '');
    expect((await post({ group: 'free' })).body.group).toBe('base'); expect(writes()).toHaveLength(0);
    vi.stubEnv('WEB_APP_FREE_START', 'junk');
    expect((await post({ group: 'free' })).body.group).toBe('base');
    db.groups = [{ price_group: 'free' }]; vi.stubEnv('WEB_APP_FREE_OPEN', '0');
    expect((await post({ group: 'free' })).body.group).toBe('free');
  });
  it('free does not depend on the price test flag or price configuration', async () => {
    vi.stubEnv('WEB_APP_PRICE_TEST_OPEN', '0');
    expect((await post({ group: 'free' })).body.group).toBe('free');
  });
  it('assignGroup used directly behaves the same', async () => {
    expect(await assignGroup(db.user, 'o@example.com', 'free', 'test')).toBe('free');
    expect(await isFree(db.user)).toBe(true);
  });
  it('limits NEW free assignments per IP, but never an already stored group', async () => {
    let last: any;
    for (let i = 0; i < 11; i++) { db.user = `ip-${n}-${i}`; db.groups = []; last = await post({ group: 'free' }, '9.9.9.9'); }
    expect(last.code).toBe(429);
    db.user = 'stored-user'; db.groups = [{ price_group: 'free' }];
    expect((await post({ group: 'free' }, '9.9.9.9')).code).toBe(200);
    db.groups = []; db.user = 'other-ip-user';
    expect((await post({ group: 'free' }, '8.8.8.8')).code).toBe(200);
  });
});

describe('free is base wherever money is involved', () => {
  it('is a valid group; price ids and the portal config are the base ones; it never matches a price id', () => {
    expect(PRICE_GROUPS).toContain('free'); expect(isPriceGroup('free')).toBe(true);
    const env = { STRIPE_WEBAPP_PRICE_WEBSITE_MONTH: 'price_base', STRIPE_WEBAPP_PORTAL_CONFIG: 'bpc_base' };
    expect(PRICE_ENV('website', 'month', 'free')).toBe('STRIPE_WEBAPP_PRICE_WEBSITE_MONTH');
    expect(priceIdFor('website', 'month', env, 'free')).toBe('price_base');
    expect(portalConfigFor('free', env)).toBe('bpc_base');
    expect(groupConfigured('free', {})).toBe(true);
    expect(tierForPriceId('price_base', env)?.group).toBe('base');
  });
  it('the Meta / TikTok forwarder field accepts free', () => { expect(priceGroupField({ price_group: 'free' })).toBe('free'); });
});

describe('free entitlement', () => {
  it('is in memory only: free:<uid>, bookings, active, current environment, far-future end', () => {
    const e = freeEntitlementOf('u9', 'test');
    expect(e).toMatchObject({ stripe_subscription_id: 'free:u9', tier: 'bookings', status: 'active', environment: 'test', user_id: 'u9' });
    expect(Date.parse(e.current_period_end!)).toBeGreaterThan(Date.parse('2090-01-01'));
    expect(isFreeSubscriptionId(e.stripe_subscription_id)).toBe(true); expect(isFreeSubscriptionId('sub_1')).toBe(false);
  });
  it('a paid row wins; free only when the stored group is free; nothing is ever written', async () => {
    const real: any = { stripe_subscription_id: 'sub_1' };
    db.groups = [{ price_group: 'free' }];
    expect(await entitlementOrFree(db.user, real, 'test')).toBe(real);
    expect((await entitlementOrFree(db.user, null, 'test'))?.stripe_subscription_id).toBe(`free:${db.user}`);
    db.groups = [{ price_group: 'base' }];
    expect(await entitlementOrFree(db.user, null, 'test')).toBeNull();
    expect(writes()).toHaveLength(0);
  });
  it('liveEntitlementOf returns the free entitlement when no paid row exists', async () => {
    db.groups = [{ price_group: 'free' }];
    expect((await liveEntitlementOf(db.user, 'test'))?.stripe_subscription_id).toBe(`free:${db.user}`);
    db.ents = [{ stripe_subscription_id: 'sub_9', status: 'active' }];
    expect((await liveEntitlementOf(db.user, 'test'))?.stripe_subscription_id).toBe('sub_9');
  });
});

// ---- publish with no payment ----
const USER = '3f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f';
const siteData: any = {
  shopName: 'Fresh Cuts', area: 'Brooklyn', phone: '555-0100',
  hero: { heading: 'H', tagline: 'T', imageUrl: 'https://img.example/hero.jpg' },
  about: { heading: 'A', description: ['d'], imageUrl: '' },
  services: [{ title: 'Fade', name: 'Fade', price: '$30', imageUrl: 'https://img.example/svc.jpg' }],
  gallery: ['https://img.example/g0.jpg'], craftImages: [], staff: [], contact: { address: '1 Main St', email: 'a@b.co' },
};
function publishDeps(o: { phone?: boolean } = {}) {
  const sites = new Map<string, any>(); const owners = new Map<string, any>(); const pending = new Map<string, any>();
  const deps: any = {
    environment: 'test',
    userOf: vi.fn(async () => ({ id: USER, email: 'Owner@Example.com' })),
    entitlementOf: vi.fn(async (uid: string) => freeEntitlementOf(uid, 'test')),
    sites: {
      byUser: vi.fn(async (u: string, e: string) => [...sites.values()].find((s) => s.user_id === u && s.environment === e) ?? null),
      get: vi.fn(async (s: string) => sites.get(s) ?? null),
      insertIfAbsent: vi.fn(async (r: any) => { if (sites.has(r.slug)) return false; sites.set(r.slug, { ...r, published_at: null, taken_down_at: null, removed_at: null }); return true; }),
      releaseUnpublished: vi.fn(async () => {}),
      markPublished: vi.fn(async (s: string, sub: string) => { const r = sites.get(s); r.published_at = 'now'; r.stripe_subscription_id = sub; }),
    },
    owners: { get: vi.fn(async (s: string) => owners.get(s) ?? null), insertIfAbsent: vi.fn(async (r: any) => { if (owners.has(r.slug)) return false; owners.set(r.slug, r); return true; }) },
    isTaken: vi.fn(async () => false), readPending: vi.fn(async (s: string) => pending.get(s) ?? null), writePending: vi.fn(async (s: string, p: any) => { pending.set(s, p); }),
    publish: vi.fn(async (slug: string) => ({ ok: true, siteId: slug, deployedUrl: `https://${slug}.vercel.app` })),
    render: () => [], rememberSlug: vi.fn(async () => {}), now: () => 1_800_000_000_000,
    ...(o.phone === undefined ? {} : { phoneOnFile: vi.fn(async () => o.phone) }),
  };
  return { deps: deps as WebPublishDeps & typeof deps, sites, owners };
}

describe('publish for a free account', () => {
  it('200 with no web_app_entitlements row: binds the slug to free:<uid>, never calls Stripe (rememberSlug) and never touches an entitlement table', async () => {
    const { deps, sites, owners } = publishDeps({ phone: true });
    const r = await runWebPublish({ siteData }, deps, { authorization: 'Bearer t' });
    expect(r.status).toBe(200);
    const row = [...sites.values()][0];
    expect(row.stripe_subscription_id).toBe(`free:${USER}`);
    expect([...owners.values()][0].checkout_session_id).toBe(`webapp:free:${USER}`);
    expect(deps.rememberSlug).not.toHaveBeenCalled();
    expect(db.calls.filter((c) => c.path.startsWith('web_app_entitlements'))).toHaveLength(0);
  });
  it('403 phone-required without a saved phone, nothing bound; a paid entitlement is not subject to the phone check', async () => {
    const { deps, sites } = publishDeps({ phone: false });
    const r = await runWebPublish({ siteData }, deps, { authorization: 'Bearer t' });
    expect(r).toEqual({ status: 403, body: { error: 'phone-required' } });
    expect(sites.size).toBe(0);
    const paid = publishDeps({ phone: false });
    paid.deps.entitlementOf = vi.fn(async () => ({ ...freeEntitlementOf(USER, 'test'), stripe_subscription_id: 'sub_1' }));
    expect((await runWebPublish({ siteData }, paid.deps, { authorization: 'Bearer t' })).status).toBe(200);
  });
  it('a non-free, non-paid account still gets 402', async () => {
    const { deps } = publishDeps({ phone: true });
    deps.entitlementOf = vi.fn(async () => null);
    expect((await runWebPublish({ siteData }, deps, { authorization: 'Bearer t' })).status).toBe(402);
  });
});

// ---- lapse ----
describe('lapse skips free accounts', () => {
  it('hasEntitledRow is true for a free group (so a free site is never taken down), false for base with no row', async () => {
    const d = await liveWebSweepDeps();
    db.groups = [{ price_group: 'free' }];
    expect(await d.hasEntitledRow('u1')).toBe(true);
    db.groups = [{ price_group: 'base' }];
    expect(await d.hasEntitledRow('u1')).toBe(false);
  });
  it('takedownCandidates excludes free:<uid> subscription ids in its query', async () => {
    const d = await liveWebSweepDeps();
    db.calls = [];
    await d.takedownCandidates(10);
    expect(decodeURIComponent(db.calls[0].path)).toContain('stripe_subscription_id=not.like.free:*');
  });
  it('sweepWebApp: a free site whose user has no paid row is not taken down and Stripe is never asked', async () => {
    db.groups = [{ price_group: 'free' }];
    const live = await liveWebSweepDeps();
    const deps = {
      ...live,
      takedownCandidates: async () => [{ slug: 'fs', stripe_subscription_id: 'free:u1', user_id: 'u1', environment: 'test', published_at: 'x', taken_down_at: null, removed_at: null }] as any,
      restoreCandidates: async () => [], iosOwnsSlug: async () => false,
      stampChecked: async () => {}, subscriptionStatus: vi.fn(async () => 'canceled'), markTakenDown: vi.fn(async () => {}), deployOffline: vi.fn(async () => {}),
    };
    const r = await sweepWebApp(deps as any);
    expect(r.stillActive).toEqual(['fs']); expect(r.takenDown).toEqual([]);
    expect(deps.subscriptionStatus).not.toHaveBeenCalled(); expect(deps.markTakenDown).not.toHaveBeenCalled();
  });
});

// ---- me / phone gate / site / owner / sheet ----
const call = async (fn: any, req: any) => { const r = res(); await fn({ headers: { authorization: 'Bearer t' }, ...req }, r); return r; };
describe('GET /api/web-app/me for a free account', () => {
  it('free group, no paid row: entitled, tier bookings, plan free, priceGroup free', async () => {
    db.groups = [{ price_group: 'free' }];
    const b = (await call(me, { method: 'GET' })).body;
    expect(b).toMatchObject({ priceGroup: 'free', entitled: true, tier: 'bookings', plan: 'free', status: 'active', subscriptionId: null });
  });
  it('a paid row wins over the free group', async () => {
    db.groups = [{ price_group: 'free' }];
    db.ents = [{ stripe_subscription_id: 'sub_1', tier: 'store', billing_interval: 'month', status: 'active', created_at: '2026-11-13T00:00:00Z' }];
    const b = (await call(me, { method: 'GET' })).body;
    expect(b).toMatchObject({ entitled: true, tier: 'store', plan: 'paid', subscriptionId: 'sub_1' });
  });
  it('base with no row stays not entitled, plan null', async () => {
    const b = (await call(me, { method: 'GET' })).body;
    expect(b).toMatchObject({ priceGroup: 'base', entitled: false, plan: null, tier: null });
  });
  it('needsPhone asks a free account (flag on, no phone) but not once a phone is saved', () => {
    expect(needsPhone({ flag: true, phone: null, entitlementRows: [], free: true })).toBe(true);
    expect(needsPhone({ flag: true, phone: '+15551234567', entitlementRows: [], free: true })).toBe(false);
    expect(needsPhone({ flag: false, phone: null, entitlementRows: [], free: true })).toBe(false);
    expect(needsPhone({ flag: true, phone: null, entitlementRows: [] })).toBe(false);
  });
});

describe('other readers accept free', () => {
  it('ownerHasWebPlan (owner emails) is true for a free group with no row', async () => {
    const rest: any = async (path: string) => (path.startsWith('web_app_price_groups') ? [{ price_group: 'free' }] : []);
    expect(await ownerHasWebPlan('u1', rest)).toBe(true);
    const none: any = async () => [];
    expect(await ownerHasWebPlan('u1', none)).toBe(false);
  });
  it('signup sheet keeps free and tags the source primebarber.org/free-site', () => {
    const row: any = { signup_at: '2026-11-13T00:00:00Z', email: 'a@b.co' };
    const base = { email: 'a@b.co', companyName: 'C', location: 'L', phone: 'P', bookingLink: '' };
    expect(buildPayload(row, { ...base, priceGroup: 'free' })).toMatchObject({ priceGroup: 'free', source: 'primebarber.org/free-site' });
    expect(buildPayload(row, { ...base, priceGroup: 'g10' })).toMatchObject({ priceGroup: 'g10', source: 'primebarber.org' });
  });
});

describe('vercel.json', () => {
  it('/free-site and /free-site/ serve the app on www.primebarber.org only, ahead of the catch-all, like /10', () => {
    const rewrites: any[] = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')).rewrites;
    const catchAll = rewrites.findIndex((r) => r.destination === '/index.html');
    for (const src of ['/free-site', '/free-site/']) {
      const i = rewrites.findIndex((r) => r.source === src);
      expect(i).toBeGreaterThanOrEqual(0); expect(i).toBeLessThan(catchAll);
      expect(rewrites[i].destination).toBe('https://prime-barber-web.vercel.app/app/');
      expect(rewrites[i].has).toEqual([{ type: 'host', value: 'www.primebarber.org' }]);
    }
  });
});

describe('migration 036', () => {
  it('replaces the price_group check (adds free) and the nudge stop_reason check (adds free); applies nothing else', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/036_free_group.sql', import.meta.url), 'utf8');
    expect(sql).toMatch(/check \(price_group in \('base', 'g10', 'g20', 'free'\)\)/);
    expect(sql).toMatch(/stop_reason in \([^)]*'late','free'\)/);
    expect(sql).not.toMatch(/drop table|delete from/i);
  });
});
