// FREE_IS_WEB=1: a Free (price group 'free') account with no Apple address is a WEB account for the iOS app, so the app shows no Apple paywall.
// Switch unset: the kind, the plan answer and the reads are exactly today's (no web_app_price_groups read from kind loading).
// The fakes sit at the database / Stripe boundaries (the same shape as deleteInvariant.test.ts); kind, plan, gates, mayTake and the routes are the REAL code.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const w = vi.hoisted(() => ({
  free: true, webSite: false, card: false, appleSite: false, appleLive: false, priceGroupFails: false,
  reads: [] as string[], log: { stripe: [] as string[], user: 0, priceGroupDeleted: 0, offline: [] as string[], content: [] as string[] },
}));
vi.mock('../../lib/webApp/webAppServer.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/webApp/webAppServer.js')>()),
  webAppCors: () => false, webAppEntitlementsOn: () => process.env.WEB_APP_ENTITLEMENTS === '1', webAppCheckoutOn: () => process.env.WEB_APP_CHECKOUT === '1',
  callerFrom: async () => ({ id: 'u1', email: 'a@b.co' }),
  stripeCall: vi.fn(async (path: string, _b: unknown, method = 'POST') => {
    w.log.stripe.push(`${method} ${path.split('?')[0]}`);
    if (path.startsWith('checkout/sessions?')) return { data: [] };
    return path.startsWith('subscriptions?') || path.startsWith('checkout/sessions') ? { data: [] } : {};
  }),
  sbRest: vi.fn(async (path: string, init: any = {}) => {
    const table = path.split('?')[0];
    if (table === 'web_app_price_groups') {
      if (init.method === 'DELETE') { w.log.priceGroupDeleted++; return null; }
      w.reads.push(path);
      if (w.priceGroupFails) throw Object.assign(new Error('supabase 500'), { status: 500 });
      return w.free ? [{ price_group: 'free' }] : [];
    }
    if (table === 'web_app_sites') return w.webSite ? [{ slug: 'web-site', stripe_subscription_id: 'sub_1', environment: 'live', published_at: 'x', removed_at: null, taken_down_at: null }] : [];
    if (table === 'web_app_entitlements') return w.card ? [{ stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', status: 'active', environment: 'live' }] : [];
    if (table === 'ios_purchases') return w.appleSite ? [{ original_transaction_id: '2000000123', product_id: 'com.ibrahim1774.aibarber.hosting.monthly', environment: 'Production', expires_at: '2099-01-01T00:00:00Z', revoked_at: null, taken_down_at: null, site_slug: 'apple-site', published_at: 'x', removed_at: null, user_id: 'u1' }] : [];
    return [];
  }),
}));
vi.mock('../../lib/ios/deleteAccount.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/ios/deleteAccount.js')>()),
  liveDeleteDeps: () => ({
    getUser: async () => ({ id: 'u1' }),
    closeShop: async () => ({ ok: true, bookingsCancelled: 0, ordersCancelled: 0, needsRefund: [], notCancelled: [] }),
    listSites: async () => [], takeDown: async () => {}, purge: async () => {}, deleteSites: async () => {}, deleteUser: async () => { w.log.user++; },
  }),
}));
vi.mock('../../lib/ios/removeSiteLive.js', () => ({
  liveRemoveDeps: () => ({ releaseDomains: async () => {}, clearSiteBase: async () => {}, deleteContent: async (s: string) => { w.log.content.push(s); }, deployOffline: async (s: string) => { w.log.offline.push(s); }, markRemoved: async () => {}, markTakenDown: async () => {}, now: () => 1 }),
  liveDeleteAccountRows: async () => {},
}));
vi.mock('../../lib/webApp/reliability.js', () => ({
  suspendWork: async () => {}, markSiteOffline: async () => {}, resumeAfterFailedDelete: async () => {}, forgetLiveAddress: async () => {},
  reliabilityOn: () => process.env.WEB_APP_RELIABILITY === '1', enc: encodeURIComponent, draftPath: () => '',
}));
vi.mock('../../lib/webApp/userExists.js', () => ({ emailOfUser: async () => 'a@example.com' }));
vi.mock('../../lib/webApp/emails.js', async (orig) => ({ ...(await orig<typeof import('../../lib/webApp/emails.js')>()), alertOwner: async () => {} }));
vi.mock('../../lib/webApp/legacyDeleteAlert.js', () => ({ alertIfLegacyCustomer: async () => {} }));
vi.mock('../../lib/webApp/checkoutSessions.js', () => ({ storedSessionId: async () => null, forgetSession: async () => {} }));
vi.mock('../../lib/bookings/rateLimit.js', async (orig) => ({ ...(await orig<typeof import('../../lib/bookings/rateLimit.js')>()), clientIp: () => '1', iosLimiter: { allow: async () => true } }));
vi.mock('../../lib/ios/publishFlow.js', () => ({ liveUserOf: async () => ({ id: 'u1' }), liveDeps: () => ({}), runIosSiteLookup: async () => ({ status: 200, body: {} }) }));
vi.mock('../../lib/ios/purchases.js', () => ({ supabasePurchases: () => ({ get: async () => null }) }));
vi.mock('../../lib/ios/domainsRepo.js', async (orig) => ({ ...(await orig<typeof import('../../lib/ios/domainsRepo.js')>()), supabaseDomains: () => ({ forSite: async () => [] }) }));

import { accountKind, accountKindReading, freeIsWebOn, loadKindFacts, readKind, type AccountKind, type ApplePurchaseFact, type EntitlementFact, type KindDeps, type KindFacts, type WebSiteFact } from '../../lib/account/kind.js';
import { accountPlan, loadPlanFacts, type PlanDeps } from '../../lib/account/plan.js';
import { nativeModeGate, oldRouteGate, siteModeOf } from '../../lib/account/siteMode.js';
import { checkTie, mayTakePurchase, type MayTakeDeps } from '../../lib/account/mayTake.js';
import { getPlan } from '../../lib/ios/planFlow.js';
import { guardMode } from '../../lib/account/sites.js';
import iosDelete from '../../api/ios/delete-account.js';
import iosTakeOffline from '../../api/ios/take-offline.js';

const UID = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-11-18T12:00:00Z');
const FUTURE = new Date(NOW + 30 * 86_400_000).toISOString();
const HOSTING = 'com.ibrahim1774.aibarber.hosting.monthly';
const ENGINE = { WEB_APP_RELIABILITY: '1', WEB_APP_CHECKOUT: '1', WEB_APP_ENTITLEMENTS: '1' };
const ON = { FREE_IS_WEB: '1' };

const apple = (o: Partial<ApplePurchaseFact> = {}): ApplePurchaseFact => ({ original_transaction_id: 'OLD', product_id: HOSTING, environment: 'Production', expires_at: FUTURE, revoked_at: null, taken_down_at: null, site_slug: null, published_at: null, user_id: UID, ...o });
const published: WebSiteFact = { slug: 'cuts', published_at: '2026-10-01T00:00:00Z', removed_at: null, taken_down_at: null };
const card: EntitlementFact = { stripe_subscription_id: 'sub_1', status: 'active', tier: 'bookings' };
const facts = (o: Partial<KindFacts> = {}): KindFacts => ({ env: 'Production', webSites: [], applePurchases: [], entitlements: [], now: NOW, ...o });

beforeEach(() => {
  w.free = true; w.webSite = false; w.card = false; w.appleSite = false; w.appleLive = false; w.priceGroupFails = false; w.reads = [];
  w.log = { stripe: [], user: 0, priceGroupDeleted: 0, offline: [], content: [] };
  vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_x');
  vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('freeIsWebOn', () => {
  it('only the exact value 1 turns it on', () => {
    expect(freeIsWebOn({})).toBe(false);
    for (const v of ['', '0', 'true', 'on', ' 1']) expect(freeIsWebOn({ FREE_IS_WEB: v })).toBe(false);
    expect(freeIsWebOn({ FREE_IS_WEB: '1' })).toBe(true);
  });
});

describe('readKind: Free is read only through freeIsWeb', () => {
  // [name, facts without the Free flag, kind with the switch on and the account Free, kind with the switch off (freeIsWeb never set)]
  const table: Array<[string, Partial<KindFacts>, AccountKind, AccountKind]> = [
    ['Free only', {}, 'web', 'neither'],
    ['Free + Production Apple address', { applePurchases: [apple({ site_slug: 'a' })] }, 'apple', 'apple'],
    ['Free + Sandbox Apple address, seen from Production', { applePurchases: [apple({ site_slug: 'a', environment: 'Sandbox' })] }, 'web', 'neither'],
    ['Free + live Apple purchase, no address', { applePurchases: [apple()] }, 'apple', 'apple'],
    ['Free + card plan', { entitlements: [card] }, 'web', 'web'],
    ['Free + published site', { webSites: [published] }, 'web', 'web'],
    ['Free + published site + Apple address', { webSites: [published], applePurchases: [apple({ site_slug: 'a' })] }, 'mixed', 'mixed'],
  ];
  for (const [name, f, on, off] of table) {
    it(`${name}: switch on ${on}, switch off ${off}`, () => {
      expect(readKind(facts({ ...f, freeIsWeb: true })).kind).toBe(on);
      expect(readKind(facts({ ...f })).kind).toBe(off);
      expect(readKind(facts({ ...f, freeIsWeb: undefined })).kind).toBe(off);
    });
  }
  it('Free removed (switch on, not Free): neither', () => {
    expect(readKind(facts({ freeIsWeb: false })).kind).toBe('neither');
  });
  it('Free is not a card plan and not an alert: appleAlsoPaysCard stays false, cardPlan false', () => {
    const r = readKind(facts({ freeIsWeb: true, applePurchases: [apple({ site_slug: 'a' })] }));
    expect(r).toMatchObject({ kind: 'apple', cardPlan: false, appleAlsoPaysCard: false, holdsWebAddress: false });
  });
  it('PlanFacts.free (the plan floor) never changes the kind by itself', () => {
    expect(readKind({ ...facts(), free: true } as any).kind).toBe('neither');
  });
});

describe('loadKindFacts', () => {
  const deps = (isFree?: KindDeps['isFree']): KindDeps => ({ webSites: async () => [], applePurchases: async () => [], entitlements: async () => [], now: () => NOW, isFree });
  it('switch off: isFree is never called and freeIsWeb is absent', async () => {
    const isFree = vi.fn(async () => true);
    const f = await loadKindFacts(UID, 'Production', deps(isFree), {});
    expect(isFree).not.toHaveBeenCalled();
    expect('freeIsWeb' in f).toBe(false);
    expect(await loadKindFacts(UID, 'Production', deps(isFree), { FREE_IS_WEB: '0' })).not.toHaveProperty('freeIsWeb');
  });
  it('switch on: isFree is called once and its answer is the fact', async () => {
    const isFree = vi.fn(async () => true);
    expect((await loadKindFacts(UID, 'Production', deps(isFree), ON)).freeIsWeb).toBe(true);
    expect(isFree).toHaveBeenCalledTimes(1);
    expect((await loadKindFacts(UID, 'Production', deps(async () => false), ON)).freeIsWeb).toBe(false);
  });
  it('switch on and no isFree dep (older fakes): no read, no fact', async () => {
    expect('freeIsWeb' in (await loadKindFacts(UID, 'Production', deps(undefined), ON))).toBe(false);
  });
  it('a throwing isFree makes accountKind throw (fails closed); the plan answer is then siteMode unknown and the native gate 503', async () => {
    vi.stubEnv('FREE_IS_WEB', '1'); vi.stubEnv('ACCOUNT_PLAN_V2', '1');
    const bad = deps(async () => { throw Object.assign(new Error('supabase 500'), { status: 500 }); });
    await expect(accountKind(UID, 'Production', bad)).rejects.toThrow('supabase 500');
    const g = await nativeModeGate({ headers: { 'x-pb-build': '57' } }, UID, { kind: (u) => accountKind(u, 'Production', bad) });
    expect(g).toEqual({ status: 503, body: { error: 'temporarily-unavailable' } });
    const shopDeps = { getUser: async () => ({ id: UID, email: null, fullName: null }), shopByOwner: async () => ({ id: 's', ios_otid: null }), purchase: async () => null, verify: async () => { throw new Error('no'); }, upsertVerified: async () => { throw new Error('no'); }, setShopOtid: async () => 'ok', setUserIfUnlinked: async () => true, now: () => NOW,
      accountPlan: () => accountPlan(UID, 'Production', { ...bad, isFree: async () => { throw new Error('supabase 500'); }, legacyOwner: async () => false }) } as any;
    const r: any = await getPlan('Bearer x', shopDeps);
    expect(r.status).toBe(200);
    expect(r.body.capabilities).toEqual({ siteMode: 'unknown' });
    expect('kind' in r.body).toBe(false);
  });
});

describe('loadPlanFacts: one Free read per plan answer', () => {
  const planDeps = (isFree: PlanDeps['isFree']): PlanDeps => ({
    webSites: async () => [], applePurchases: async () => [], entitlements: async () => [], now: () => NOW, isFree, legacyOwner: async () => false,
  });
  it('switch on: the single plan Free read feeds both free and freeIsWeb', async () => {
    const isFree = vi.fn(async () => true);
    const f = await loadPlanFacts(UID, 'Production', planDeps(isFree), ON);
    expect(isFree).toHaveBeenCalledTimes(1);
    expect(f).toMatchObject({ free: true, freeIsWeb: true });
  });
  it('switch off: one read, freeIsWeb absent (the plan facts are as before)', async () => {
    const isFree = vi.fn(async () => true);
    const f = await loadPlanFacts(UID, 'Production', planDeps(isFree), {});
    expect(isFree).toHaveBeenCalledTimes(1);
    expect(f.free).toBe(true);
    expect('freeIsWeb' in f).toBe(false);
  });
  it('switch on, live deps: one price-group read for the whole plan answer', async () => {
    vi.stubEnv('FREE_IS_WEB', '1');
    await accountPlan(UID, 'Production');
    expect(w.reads).toHaveLength(1);
  });
});

describe('a Free account with no site (switch on)', () => {
  const planDeps = (): PlanDeps => ({ webSites: async () => [], applePurchases: async () => [], entitlements: async () => [], now: () => NOW, isFree: async () => true, legacyOwner: async () => false });
  const env = { ...ENGINE, ...ON, ACCOUNT_DRAFTS_IOS: 'all' };
  const stub = () => { for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v); vi.stubEnv('ACCOUNT_PLAN_V2', '1'); };
  it('accountPlan: kind web, siteMode account, source free, active, no site', async () => {
    stub();
    const p = await accountPlan(UID, 'Production', planDeps());
    expect(p).toMatchObject({ kind: 'web', siteMode: 'account', source: 'free', active: true, site: null, webSite: null });
  });
  it('with the switch off the same account is neither / device', async () => {
    for (const [k, v] of Object.entries({ ...ENGINE, ACCOUNT_DRAFTS_IOS: 'all' })) vi.stubEnv(k, v);
    expect(await accountPlan(UID, 'Production', planDeps())).toMatchObject({ kind: 'neither', siteMode: 'device', source: 'free', active: true });
  });
  it('getPlan with ACCOUNT_PLAN_V2=1: capabilities.siteMode is account', async () => {
    stub();
    const shopDeps = { getUser: async () => ({ id: UID, email: null, fullName: null }), shopByOwner: async () => ({ id: 's', ios_otid: null }), purchase: async () => null, verify: async () => { throw new Error('no'); }, upsertVerified: async () => { throw new Error('no'); }, setShopOtid: async () => 'ok', setUserIfUnlinked: async () => true, now: () => NOW,
      accountPlan: () => accountPlan(UID, 'Production', planDeps()) } as any;
    const r: any = await getPlan('Bearer x', shopDeps);
    expect(r.status).toBe(200);
    expect(r.body.capabilities.siteMode).toBe('account');
    expect(r.body.kind).toBe('web');
  });
  it('nativeModeGate lets it through (null) and oldRouteGate answers 409 use-account-publish', async () => {
    stub();
    const kind = async (u: string) => accountKind(u, 'Production', { webSites: async () => [], applePurchases: async () => [], entitlements: async () => [], isFree: async () => true, now: () => NOW });
    expect(await nativeModeGate({ headers: { 'x-pb-build': '57' } }, UID, { kind })).toBeNull();
    const h = { 'x-pb-build': '57', authorization: 'Bearer t' };
    expect(await oldRouteGate({ headers: h }, async () => ({ id: UID }), { kind })).toEqual({ status: 409, body: { error: 'use-account-publish' } });
    expect(await siteModeOf(UID, { kind })).toBe('account');
  });
  it('Free + Production Apple address stays apple / device for the gates', async () => {
    stub();
    const kind = async (u: string) => accountKind(u, 'Production', { webSites: async () => [], applePurchases: async () => [apple({ site_slug: 'a' })], entitlements: async () => [], isFree: async () => true, now: () => NOW });
    expect(await nativeModeGate({ headers: { 'x-pb-build': '57' } }, UID, { kind })).toEqual({ status: 403, body: { error: 'not-account-mode' } });
  });
});

describe('mayTake with ONE_SITE_GUARD=1', () => {
  const world = (isFree: boolean): MayTakeDeps => ({
    kindDeps: { webSites: async () => [], applePurchases: async () => [], entitlements: async () => [], now: () => NOW, isFree: async () => isFree },
    env: () => 'Production', address: async () => null,
    purchase: async () => ({ original_transaction_id: 'NEW', user_id: null, environment: 'Production' }) as any,
    purchaseOfSlug: async () => null,
  });
  it('switch on: a Free account with no site is ALLOWED (an older phone still ties its Apple purchase, exactly as on origin/main)', async () => {
    vi.stubEnv('FREE_IS_WEB', '1');
    expect(await mayTakePurchase(UID, 'NEW', world(true))).toEqual({ may: true });
    const report = vi.fn(async () => {});
    const d = await checkTie(UID, 'NEW', 'test', { mode: () => guardMode({ ONE_SITE_GUARD: '1' }), mayTake: (u, o) => mayTakePurchase(u, o, world(true)), report });
    expect(d).toEqual({ action: 'allow' });
    expect(report).not.toHaveBeenCalled();
  });
  it('switch on: Free + published site and Free + card plan are still refused web-account, as today', async () => {
    vi.stubEnv('FREE_IS_WEB', '1');
    const w1 = world(true); w1.kindDeps.webSites = async () => [published];
    expect(await mayTakePurchase(UID, 'NEW', w1)).toMatchObject({ may: false, reason: 'web-account', slug: 'cuts' });
    const w2 = world(true); w2.kindDeps.entitlements = async () => [card];
    expect(await mayTakePurchase(UID, 'NEW', w2)).toMatchObject({ may: false, reason: 'web-account' });
  });
  it('switch off: allowed as today', async () => {
    expect(await mayTakePurchase(UID, 'NEW', world(true))).toEqual({ may: true });
    const d = await checkTie(UID, 'NEW', 'test', { mode: () => guardMode({ ONE_SITE_GUARD: '1' }), mayTake: (u, o) => mayTakePurchase(u, o, world(true)), report: async () => {} });
    expect(d).toEqual({ action: 'allow' });
  });
  it('switch on, not Free: allowed', async () => {
    vi.stubEnv('FREE_IS_WEB', '1');
    expect(await mayTakePurchase(UID, 'NEW', world(false))).toEqual({ may: true });
  });
});

describe('parity: FREE_IS_WEB unset', () => {
  it('accountKind, accountPlan and siteModeOf read no price group from kind loading, and answer as today', async () => {
    vi.stubEnv('FREE_IS_WEB', '');
    w.free = true; // a Free account in the database: today it is `neither`
    expect(await accountKind(UID, 'Production')).toBe('neither');
    expect(await accountKindReading(UID, 'Production')).toMatchObject({ kind: 'neither', cardPlan: false });
    expect(w.reads).toEqual([]);
    const p = await accountPlan(UID, 'Production');
    expect(p).toMatchObject({ kind: 'neither', source: 'free', active: true, site: null });
    expect(w.reads).toHaveLength(1); // the plan answer's own single Free read, as today
    w.reads = [];
    await siteModeOf(UID);
    expect(w.reads).toEqual([]);
    vi.stubEnv('FREE_IS_WEB', undefined as any);
    expect(await accountKind(UID, 'Production')).toBe('neither');
    expect(w.reads).toEqual([]);
  });
  it('switch on, live deps: accountKind reads the group once and a Free account is web; not Free is neither', async () => {
    vi.stubEnv('FREE_IS_WEB', '1');
    expect(await accountKind(UID, 'Production')).toBe('web');
    expect(w.reads).toHaveLength(1);
    w.free = false;
    expect(await accountKind(UID, 'Production')).toBe('neither');
    w.priceGroupFails = true;
    await expect(accountKind(UID, 'Production')).rejects.toThrow('supabase 500');
  });
});

describe('routes for a Free account with no site (ACCOUNT_PLAN_V2=1, FREE_IS_WEB=1, native header)', () => {
  const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };
  const post = async (h: any, body?: any) => { const r = res(); await h({ method: 'POST', headers: { authorization: 'Bearer t', 'x-pb-build': '57' }, body }, r); return r; };
  beforeEach(() => { vi.stubEnv('ACCOUNT_PLAN_V2', '1'); vi.stubEnv('FREE_IS_WEB', '1'); vi.stubEnv('WEB_APP_ENTITLEMENTS', '1'); vi.stubEnv('APP_DELETE_CANCELS_WEB', '1'); });
  it('delete: 200, nothing in Stripe to cancel (cardPlanCanceled false), the price-group row is deleted', async () => {
    const r = await post(iosDelete);
    expect(r.code).toBe(200);
    expect(r.body.deleted).toBe(true);
    expect(r.body.outcome).toEqual({ cardPlanCanceled: false, appleSubscriptionActive: false });
    expect(w.log.user).toBe(1);
    expect(w.log.priceGroupDeleted).toBe(1);
    expect(w.log.stripe.filter((c) => c.startsWith('DELETE'))).toEqual([]);
  });
  it('delete with Stripe down: refused 500 delete-failed, nothing deleted (a web sign-up with no subscription, as on origin/main)', async () => {
    const stripe = (await import('../../lib/webApp/webAppServer.js')).stripeCall as any;
    stripe.mockImplementation(async (path: string, _b: unknown, method = 'POST') => { w.log.stripe.push(`${method} ${path.split('?')[0]}`); throw new Error('stripe down'); });
    const r = await post(iosDelete);
    expect(r.code).toBe(500);
    expect(r.body).toMatchObject({ error: 'delete-failed' });
    expect([w.log.user, w.log.priceGroupDeleted]).toEqual([0, 0]);
  });
  it('take offline: 404 no-site, nothing taken down', async () => {
    const r = await post(iosTakeOffline, {});
    expect(r.code).toBe(404);
    expect(r.body).toMatchObject({ error: 'no-site' });
    expect([w.log.offline, w.log.content]).toEqual([[], []]);
  });
});
