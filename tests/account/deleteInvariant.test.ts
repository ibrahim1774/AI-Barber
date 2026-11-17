// The two native single routes (POST /api/ios/delete-account, POST /api/ios/take-offline) with ACCOUNT_PLAN_V2=1 and X-PB-Build: one call per action, the server does the right thing for
// every account and reports what it did. Plus: with ACCOUNT_PLAN_V2 off, or without the header, both routes are byte-identical to before (snapshot taken from the code before the change).
// The fakes sit at the database, Stripe, Apple and storage boundaries; deleteAccount, liveWebDeleteDeps, removeWebSitesOf, takeSiteOffline and the handlers are the REAL code.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const w = vi.hoisted(() => ({
  appleSite: false, webSite: false, card: false, appleLive: false, stripeDown: false, kindFails: false, publishInProgress: false, purchaseReadFails: false, orphan: false, verifyFails: '' as '' | 'not-found' | 'apple-unavailable', badToken: false, billingAfterTakedown: false, planReadFails: false, cancelFails: false,
  log: { stripe: [] as string[], takenDown: [] as string[], purged: [] as string[], user: 0, content: [] as string[], offline: [] as string[], stamps: [] as string[], base: [] as string[], alerts: 0 },
}));
const FUT = new Date(Date.now() + 30 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 30 * 86_400_000).toISOString();
vi.mock('../../lib/webApp/webAppServer.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/webApp/webAppServer.js')>()),
  webAppCors: () => false, webAppEntitlementsOn: () => process.env.WEB_APP_ENTITLEMENTS === '1', webAppCheckoutOn: () => process.env.WEB_APP_CHECKOUT === '1',
  callerFrom: async () => ({ id: 'u1', email: 'a@b.co' }),
  stripeCall: vi.fn(async (path: string, _b: unknown, method = 'POST') => {
    w.log.stripe.push(`${method} ${path.split('?')[0]}`);
    if (w.stripeDown) throw new Error('stripe down');
    if (w.cancelFails && method === 'DELETE') throw Object.assign(new Error('stripe 500'), { status: 500 });
    if (path.startsWith('checkout/sessions') || path.startsWith('subscriptions?')) return { data: [] };
    if (path.startsWith('subscriptions/') && method === 'GET') return { status: w.cancelFails ? 'active' : 'canceled' };
    return {};
  }),
  sbRest: vi.fn(async (path: string, init: any = {}) => {
    const table = path.split('?')[0];
    if (table === 'web_app_sites') {
      if (init.method === 'PATCH') { w.log.stamps.push(Object.keys(init.body ?? {}).filter((k) => k !== 'updated_at').sort().join('+')); return []; }
      return w.webSite ? [{ slug: 'web-site', stripe_subscription_id: 'sub_1', environment: 'live', published_at: 'x', removed_at: null, taken_down_at: null }] : [];
    }
    if (table === 'web_app_entitlements' && w.kindFails && !path.includes('stripe_customer_id,status')) throw Object.assign(new Error('supabase 500'), { status: 500 });
    if (table === 'web_app_entitlements' && w.planReadFails && path.includes('stripe_customer_id,status')) throw Object.assign(new Error('supabase 500'), { status: 500 });
    if (table === 'web_app_entitlements') return w.card ? [{ stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', status: 'active', environment: 'live' }] : [];
    if (table === 'ios_purchases') {
      if (w.purchaseReadFails) throw Object.assign(new Error('supabase 500'), { status: 500 });
      if (path.includes('site_slug=not.is.null') && !w.appleSite) return [];
      if (path.includes('taken_down_at=is.null') && !w.appleLive) return []; // a lapsed (taken down) Apple site is not a live site
    }
    if (table === 'ios_purchases') return w.appleSite || w.appleLive ? [{ original_transaction_id: '2000000123', product_id: 'com.ibrahim1774.aibarber.hosting.monthly', environment: 'Production', expires_at: w.appleLive || w.billingAfterTakedown ? FUT : PAST, revoked_at: null, taken_down_at: w.appleLive ? null : PAST, site_slug: w.appleSite ? 'apple-site' : null, published_at: w.appleSite ? 'x' : null, removed_at: null, user_id: 'u1' }] : [];
    return [];
  }),
}));
vi.mock('../../lib/ios/deleteAccount.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/ios/deleteAccount.js')>()),
  liveDeleteDeps: () => ({
    getUser: async () => (w.badToken ? null : { id: 'u1' }),
    closeShop: async () => { w.log.base.push('closeShop'); return { ok: true, bookingsCancelled: 0, ordersCancelled: 0, needsRefund: [], notCancelled: [] }; },
    listSites: async () => (w.appleSite ? [{ original_transaction_id: '2000000123', site_slug: 'apple-site', environment: 'Production', published_at: 'x' }] : []),
    takeDown: async (s: any) => { w.log.takenDown.push(s.site_slug); }, purge: async (s: any) => { w.log.purged.push(s.site_slug); },
    deleteSites: async () => {}, deleteUser: async () => { w.log.user++; },
  }),
}));
vi.mock('../../lib/ios/removeSiteLive.js', () => ({
  liveRemoveDeps: () => ({
    releaseDomains: async (s: string) => { w.log.base.push(`domain:${s}`); }, clearSiteBase: async (s: string) => { w.log.base.push(`base:${s}`); },
    deleteContent: async (s: string) => { w.log.content.push(s); }, deployOffline: async (s: string) => { w.log.offline.push(s); },
    markRemoved: async () => { w.log.base.push('removed'); }, markTakenDown: async () => { w.log.base.push('stamp'); }, now: () => 1,
  }),
  liveDeleteAccountRows: async () => {},
}));
vi.mock('../../lib/webApp/reliability.js', () => ({
  suspendWork: async () => { if (w.publishInProgress) throw new Error('publish-in-progress'); }, markSiteOffline: async () => {}, resumeAfterFailedDelete: async () => {}, forgetLiveAddress: async () => {},
  reliabilityOn: () => process.env.WEB_APP_RELIABILITY === '1', enc: encodeURIComponent, draftPath: () => '',
}));
vi.mock('../../lib/webApp/userExists.js', () => ({ emailOfUser: async () => 'a@example.com' }));
vi.mock('../../lib/webApp/emails.js', async (orig) => ({ ...(await orig<typeof import('../../lib/webApp/emails.js')>()), alertOwner: async () => { w.log.alerts++; } }));
vi.mock('../../lib/webApp/legacyDeleteAlert.js', () => ({ alertIfLegacyCustomer: async () => {} }));
vi.mock('../../lib/webApp/checkoutSessions.js', () => ({ storedSessionId: async () => null, forgetSession: async () => {} }));
vi.mock('../../lib/ios/appleVerify.js', async (orig) => {
  const real = await orig<typeof import('../../lib/ios/appleVerify.js')>();
  return { ...real, lazyDefaultVerifier: () => async () => { if (w.verifyFails === 'not-found') throw new real.VerifyFailure('not-found'); if (w.verifyFails) throw new Error('apple down'); return { originalTransactionId: '2000000123', environment: 'Production' }; } };
});
vi.mock('../../lib/ios/purchases.js', () => ({
  supabasePurchases: () => ({ get: async () => (w.appleSite ? { original_transaction_id: '2000000123', site_slug: 'apple-site', environment: 'Production', user_id: 'u1', published_at: 'x' } : w.orphan ? { original_transaction_id: '2000000123', site_slug: 'orphan-site', environment: 'Production', user_id: null, published_at: 'x' } : null) }),
}));
vi.mock('../../lib/bookings/rateLimit.js', async (orig) => ({ ...(await orig<typeof import('../../lib/bookings/rateLimit.js')>()), clientIp: () => '1', iosLimiter: { allow: async () => true } }));
vi.mock('../../lib/ios/publishFlow.js', () => ({ liveUserOf: async () => (w.badToken ? null : { id: 'u1' }), liveDeps: () => ({}), runIosSiteLookup: async () => ({ status: 200, body: {} }) }));
import iosDelete from '../../api/ios/delete-account.js';
import iosTakeOffline from '../../api/ios/take-offline.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };
const post = async (h: any, header: boolean, body?: any, auth: string | null = 'Bearer t') => { const r = res(); await h({ method: 'POST', headers: { ...(auth ? { authorization: auth } : {}), ...(header ? { 'x-pb-build': '57' } : {}) }, body }, r); return r; };
const kindOfWorld = (x: World = w) => (x.appleSite && x.webSite ? 'mixed' : x.webSite || (x.card && !x.appleSite) ? 'web' : x.appleSite || x.appleLive ? 'apple' : 'neither') as 'mixed' | 'web' | 'apple' | 'neither';
const reset = () => { Object.assign(w, { stripeDown: false, kindFails: false, publishInProgress: false, purchaseReadFails: false, orphan: false, verifyFails: '', badToken: false, billingAfterTakedown: false, planReadFails: false, cancelFails: false }); w.log = { stripe: [], takenDown: [], purged: [], user: 0, content: [], offline: [], stamps: [], base: [], alerts: 0 }; };
beforeEach(() => { reset(); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_x'); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const bools = [false, true];
type World = { appleSite: boolean; webSite: boolean; card: boolean; appleLive: boolean };
const worlds: World[] = [];
for (const appleSite of bools) for (const webSite of bools) for (const card of bools) for (const appleLive of bools) worlds.push({ appleSite, webSite, card, appleLive });
const wName = (x: World) => `${x.appleSite ? 'A' : '-'}${x.webSite ? 'W' : '-'}${x.card ? 'C' : '-'}${x.appleLive ? 'L' : '-'}`;
const setWorld = (x: World) => Object.assign(w, x);
const summary = (r: any) => ({ code: r.code, body: r.body, log: JSON.parse(JSON.stringify(w.log)) });

describe('V2 off, or no header: both routes are byte-identical to before (snapshot taken from the code before this change)', () => {
  it('delete account: every world x APP_DELETE_CANCELS_WEB x Stripe up/down x (no header | header with V2 off)', async () => {
    const out: Record<string, unknown> = {};
    for (const x of worlds) for (const cancels of bools) for (const down of bools) for (const header of bools) {
      reset(); setWorld(x); w.stripeDown = down;
      vi.stubEnv('APP_DELETE_CANCELS_WEB', cancels ? '1' : ''); vi.stubEnv('ACCOUNT_PLAN_V2', '');
      out[`${wName(x)} cancels=${cancels} down=${down} header=${header}`] = summary(await post(iosDelete, header));
    }
    expect(out).toMatchSnapshot();
  });
  it('take offline: every world x SAFE_TAKE_OFFLINE x (with|without transaction) x (no header | header with V2 off)', async () => {
    const out: Record<string, unknown> = {};
    for (const x of worlds) for (const safe of bools) for (const tx of bools) for (const header of bools) for (const expect_ of [undefined, 'keep', 'purge']) {
      reset(); setWorld(x); w.stripeDown = false;
      vi.stubEnv('SAFE_TAKE_OFFLINE', safe ? '1' : ''); vi.stubEnv('ACCOUNT_PLAN_V2', '');
      out[`${wName(x)} safe=${safe} tx=${tx} header=${header} expect=${expect_}`] = summary(await post(iosTakeOffline, header, { ...(tx ? { transactionId: '2000000123' } : {}), ...(expect_ ? { expect: expect_ } : {}) }));
    }
    expect(out).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
describe('native single routes (ACCOUNT_PLAN_V2=1 + X-PB-Build): delete account', () => {
  const nativeEnv = (cancels: boolean, ent: boolean) => { vi.stubEnv('ACCOUNT_PLAN_V2', '1'); vi.stubEnv('APP_DELETE_CANCELS_WEB', cancels ? '1' : ''); vi.stubEnv('WEB_APP_ENTITLEMENTS', ent ? '1' : ''); };
  it('every account x APP_DELETE_CANCELS_WEB x WEB_APP_ENTITLEMENTS x Stripe up/down: deletes exactly once or fails closed with nothing changed; never a 409; a card plan is never left billing', async () => {
    let cases = 0;
    for (const x of worlds) for (const cancels of bools) for (const ent of bools) for (const down of bools) {
      reset(); setWorld(x); w.stripeDown = down; nativeEnv(cancels, ent); cases++;
      const label = `${wName(x)} cancels=${cancels} ent=${ent} down=${down}`;
      const r = await post(iosDelete, true);
      expect(r.code, label).not.toBe(409);
      if (x.card && down) {
        // Stripe cannot be reached and the account has Stripe history: fail closed, nothing changed, the app is told it was the card plan.
        expect([r.code, r.body], label).toEqual([500, { error: 'delete-failed', retryable: true, cardCancelFailed: true }]);
        expect(w.log.user, label).toBe(0);
        expect([w.log.takenDown, w.log.purged, w.log.content, w.log.offline], label).toEqual([[], [], [], []]);
        expect(w.log.stripe.filter((c) => c.startsWith('DELETE')), label).toEqual([]);
        continue;
      }
      expect(r.code, label).toBe(200);
      expect(w.log.user, label).toBe(1); // exactly once
      expect(r.body.deleted, label).toBe(true);
      expect(r.body.outcome, label).toEqual({ cardPlanCanceled: x.card, appleSubscriptionActive: x.appleLive });
      // No Stripe history and an Apple-only or empty account: Stripe is not asked at all (so no 8 s wait and no owner alert, up or down).
      const k = kindOfWorld(x);
      if (!x.card && (k === 'apple' || k === 'neither')) { expect(w.log.stripe, label).toEqual([]); expect(w.log.alerts, label).toBe(0); }
      expect('cardCancelFailed' in r.body, label).toBe(false);
      // The live card plan is cancelled whatever the switches say; nothing is cancelled for an account without one.
      expect(w.log.stripe.filter((c) => c === 'DELETE subscriptions/sub_1'), label).toHaveLength(x.card ? 1 : 0);
      // Every site of the account went down and was purged.
      if (x.appleSite) { expect(w.log.takenDown, label).toContain('apple-site'); expect(w.log.purged, label).toContain('apple-site'); }
      if (x.webSite) { expect(w.log.offline, label).toContain('web-site'); expect(w.log.content, label).toContain('web-site'); }
      if (!x.appleSite) expect(w.log.takenDown, label).toEqual([]);
      if (!x.webSite) expect(w.log.content, label).toEqual([]);
    }
    expect(cases).toBe(128);
  });
  it('a failed read before anything is done is 503 with nothing changed; a bad token is 401 as today', async () => {
    reset(); setWorld({ appleSite: true, webSite: true, card: true, appleLive: true }); nativeEnv(false, true);
    w.purchaseReadFails = true;
    const r = await post(iosDelete, true);
    expect([r.code, r.body, w.log.user, w.log.takenDown, w.log.stripe]).toEqual([503, { error: 'temporarily-unavailable' }, 0, [], []]);
  });
  it('appleSubscriptionActive counts a Production purchase that is live at Apple, not an expired or refunded one', async () => {
    reset(); setWorld({ appleSite: false, webSite: false, card: false, appleLive: false }); nativeEnv(false, true);
    expect((await post(iosDelete, true)).body.outcome.appleSubscriptionActive).toBe(false);
    reset(); setWorld({ appleSite: false, webSite: false, card: false, appleLive: true }); nativeEnv(false, true);
    expect((await post(iosDelete, true)).body.outcome.appleSubscriptionActive).toBe(true);
  });
});

describe('native single routes (ACCOUNT_PLAN_V2=1 + X-PB-Build): take offline', () => {
  const kinds = ['expect: undefined', 'keep', 'purge'] as const;
  it('every account x transaction x expect x SAFE_TAKE_OFFLINE x WEB_APP_ENTITLEMENTS x WEB_APP_RELIABILITY: the right site goes down, outcome is truthful, expect keep never purges, never a 409 use-account-*', async () => {
    let cases = 0;
    for (const x of worlds) for (const tx of bools) for (const e of [undefined, 'keep', 'purge'] as const) for (const safe of bools) for (const ent of bools) for (const rel of bools) {
      reset(); setWorld(x); cases++;
      vi.stubEnv('ACCOUNT_PLAN_V2', '1'); vi.stubEnv('SAFE_TAKE_OFFLINE', safe ? '1' : ''); vi.stubEnv('WEB_APP_ENTITLEMENTS', ent ? '1' : ''); vi.stubEnv('WEB_APP_RELIABILITY', rel ? '1' : '');
      const label = `${wName(x)} tx=${tx} expect=${e} safe=${safe} ent=${ent} rel=${rel}`;
      const kind = kindOfWorld(x);
      const r = await post(iosTakeOffline, true, { ...(tx ? { transactionId: '2000000123' } : {}), ...(e ? { expect: e } : {}) });
      expect(String(r.body?.error ?? ''), label).not.toMatch(/^use-account-/);
      const site = kind === 'web' || (kind === 'mixed' && !tx) ? 'web' : 'apple';
      const purges = site === 'apple' && !safe;
      // The Apple site's own preconditions come BEFORE the question about purging: a missing transaction (400) or no site bound to it (404) is never turned into a confirm-purge.
      if (site === 'apple' && !tx) { expect([r.code, r.body], label).toEqual([400, { error: 'bad-request' }]); expect(w.log.offline, label).toEqual([]); continue; }
      if (site === 'apple' && !x.appleSite) { expect([r.code, r.body], label).toEqual([404, { error: 'no-site' }]); expect(w.log.offline, label).toEqual([]); continue; }
      if (e === 'keep' && purges) { // the action would purge: refused before anything is done
        expect([r.code, r.body], label).toEqual([409, { error: 'confirm-purge' }]);
        expect([w.log.offline, w.log.content, w.log.stamps, w.log.base], label).toEqual([[], [], [], []]);
        continue;
      }
      if (site === 'web') {
        if (!x.webSite) { expect([r.code, r.body], label).toEqual([404, { error: 'no-site' }]); continue; }
        expect(r.code, label).toBe(200);
        expect(r.body.outcome, label).toEqual({ site: 'web', contentKept: true, otherSiteLive: x.appleSite && x.appleLive });
        expect(w.log.offline, label).toEqual(['web-site']);
        expect(w.log.content, label).toEqual([]); // content kept
        expect(w.log.stamps.some((s) => s.includes('contact_phone')), label).toBe(false); // phone kept
        expect(w.log.base, label).toContain('base:web-site');
        continue;
      }
      // The Apple site: today's flow (a valid transaction for an account that has one).
      expect(r.code, label).toBe(200);
      expect(r.body.outcome, label).toEqual({ site: 'apple', contentKept: !w.log.content.includes('apple-site'), otherSiteLive: x.webSite });
      expect(w.log.content.includes('apple-site'), label).toBe(!safe); // outcome.contentKept is truthful: purge ran iff SAFE_TAKE_OFFLINE is off
      expect(r.body.outcome.contentKept, label).toBe(safe);
      expect(w.log.offline, label).toEqual(['apple-site']);
    }
    expect(cases).toBe(16 * 2 * 3 * 2 * 2 * 2);
  });
  it('an invalid expect is 400; a failed kind read or other-site read is 503 with nothing done; a publish in progress is 409; a bad body never reaches Stripe or Apple', async () => {
    const run = async (x: World, body: any, tweak: () => void = () => {}) => { reset(); setWorld(x); vi.stubEnv('ACCOUNT_PLAN_V2', '1'); tweak(); return post(iosTakeOffline, true, body); };
    const web: World = { appleSite: false, webSite: true, card: true, appleLive: false };
    expect((await run(web, { expect: 'maybe' })).code).toBe(400);
    const k = await run(web, {}, () => { w.kindFails = true; });
    expect([k.code, k.body, w.log.offline]).toEqual([503, { error: 'temporarily-unavailable' }, []]);
    const o = await run(web, {}, () => { w.purchaseReadFails = true; });
    expect([o.code, o.body, w.log.offline]).toEqual([503, { error: 'temporarily-unavailable' }, []]);
    const p = await run(web, {}, () => { w.publishInProgress = true; });
    expect([p.code, p.body, w.log.offline]).toEqual([409, { error: 'publish-in-progress' }, []]);
  });
  it('a web account with no transaction at all is served (never a 400), even with the account route and the draft engine off', async () => {
    reset(); setWorld({ appleSite: false, webSite: true, card: true, appleLive: false });
    vi.stubEnv('ACCOUNT_PLAN_V2', '1'); vi.stubEnv('WEB_APP_ENTITLEMENTS', ''); vi.stubEnv('WEB_APP_RELIABILITY', '');
    const r = await post(iosTakeOffline, true, { expect: 'keep' });
    expect([r.code, r.body.outcome]).toEqual([200, { site: 'web', contentKept: true, otherSiteLive: false }]);
  });
  void kinds;
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
describe('native single routes: the cases the table does not cover (real kind reading, real tokens, suspendWork refusing, signed-out purchase, card failure tagging)', () => {
  const env = () => { vi.stubEnv('ACCOUNT_PLAN_V2', '1'); vi.stubEnv('WEB_APP_ENTITLEMENTS', '1'); };
  const web: World = { appleSite: false, webSite: true, card: true, appleLive: false };
  const nothing = () => [w.log.user, w.log.takenDown, w.log.purged, w.log.content, w.log.offline, w.log.base.filter((b) => b === 'closeShop'), w.log.stripe.filter((c) => c.startsWith('DELETE'))];

  it('the kind comes from the real reading of the rows (not a formula): every world answers with the kind the rows describe', async () => {
    const { accountKind } = await import('../../lib/account/kind.js');
    for (const x of worlds) { reset(); setWorld(x); expect(await accountKind('u1', 'Production'), wName(x)).toBe(kindOfWorld(x)); }
  });

  it('no token / a token that is not valid: delete is 401 with nothing done; take offline is refused (403 or 400), nothing done', async () => {
    for (const x of worlds) {
      reset(); setWorld(x); env();
      const none = await post(iosDelete, true, undefined, null);
      expect([none.code, none.body], wName(x)).toEqual([401, { error: 'unauthorized' }]); expect(nothing(), wName(x)).toEqual([0, [], [], [], [], [], []]);
      w.badToken = true;
      const bad = await post(iosDelete, true);
      expect([bad.code, bad.body], wName(x)).toEqual([401, { error: 'unauthorized' }]); expect(nothing(), wName(x)).toEqual([0, [], [], [], [], [], []]);
      // take offline: a purchase linked to an account needs that account's token
      const t1 = await post(iosTakeOffline, true, { transactionId: '2000000123' }, null);
      const t2 = await post(iosTakeOffline, true, { transactionId: '2000000123' });
      const t3 = await post(iosTakeOffline, true, {}, null);
      if (x.appleSite) { expect([t1.code, t1.body], wName(x)).toEqual([403, { error: 'sign-in-required' }]); expect([t2.code, t2.body], wName(x)).toEqual([403, { error: 'not-owner' }]); }
      else { expect(t1.code, wName(x)).toBe(404); expect(t2.code, wName(x)).toBe(404); }
      expect(t3.code, wName(x)).toBe(400);
      expect([w.log.offline, w.log.content], wName(x)).toEqual([[], []]);
    }
  });

  it('a publish in progress: delete is 409 publish-in-progress with nothing closed, cancelled or deleted (every world)', async () => {
    for (const x of worlds) {
      reset(); setWorld(x); env(); w.publishInProgress = true;
      const r = await post(iosDelete, true);
      expect([r.code, r.body], wName(x)).toEqual([409, { error: 'publish-in-progress' }]);
      expect(nothing(), wName(x)).toEqual([0, [], [], [], [], [], []]);
    }
  });

  it('appleSubscriptionActive stays true after the Apple site was taken offline (Apple still bills), false once refunded or expired', async () => {
    reset(); setWorld({ appleSite: true, webSite: false, card: false, appleLive: false }); env(); w.billingAfterTakedown = true;
    expect((await post(iosDelete, true)).body.outcome).toEqual({ cardPlanCanceled: false, appleSubscriptionActive: true });
    reset(); setWorld({ appleSite: true, webSite: false, card: false, appleLive: false }); env();
    expect((await post(iosDelete, true)).body.outcome).toEqual({ cardPlanCanceled: false, appleSubscriptionActive: false });
  });

  it('cardCancelFailed only for a failed Stripe call on an account that has something to cancel; a database error or a live subscription out of reach is a plain delete-failed', async () => {
    // a Stripe cancel that fails: tagged, nothing deleted
    reset(); setWorld(web); env(); w.cancelFails = true;
    let r = await post(iosDelete, true);
    expect([r.code, r.body]).toEqual([500, { error: 'delete-failed', retryable: true, cardCancelFailed: true }]); expect(w.log.user).toBe(0);
    // Stripe down on an account with Stripe history: tagged
    reset(); setWorld(web); env(); w.stripeDown = true;
    r = await post(iosDelete, true);
    expect([r.code, r.body]).toEqual([500, { error: 'delete-failed', retryable: true, cardCancelFailed: true }]);
    // a database read error while planning: plain
    reset(); setWorld(web); env(); w.planReadFails = true;
    r = await post(iosDelete, true);
    expect(r.code).toBe(500); expect('cardCancelFailed' in r.body).toBe(false); expect(w.log.user).toBe(0);
    // a live subscription this (test-key) deployment cannot reach: plain
    reset(); setWorld(web); env(); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
    r = await post(iosDelete, true);
    expect(r.code).toBe(500); expect('cardCancelFailed' in r.body).toBe(false); expect(w.log.user).toBe(0);
    // a web sign-up with no Stripe history, refused during a Stripe outage: plain
    reset(); setWorld({ appleSite: false, webSite: true, card: false, appleLive: false }); env(); w.stripeDown = true;
    // (the fake has no sign-up row, so the delete is allowed: nothing to refuse, nothing to cancel)
    r = await post(iosDelete, true);
    expect('cardCancelFailed' in r.body).toBe(false);
  });

  it('a purchase published signed-out (no account on it): delete with its transactionId takes that site down and purges it; without it, or when it does not verify, nothing extra', async () => {
    reset(); setWorld({ appleSite: false, webSite: false, card: false, appleLive: false }); env(); w.orphan = true;
    let r = await post(iosDelete, true, { transactionId: '2000000123' });
    expect(r.code).toBe(200); expect(w.log.takenDown).toEqual(['orphan-site']); expect(w.log.purged).toEqual(['orphan-site']);
    reset(); setWorld({ appleSite: false, webSite: false, card: false, appleLive: false }); env(); w.orphan = true;
    r = await post(iosDelete, true); expect(r.code).toBe(200); expect(w.log.takenDown).toEqual([]);
    reset(); setWorld({ appleSite: false, webSite: false, card: false, appleLive: false }); env(); w.orphan = true; w.verifyFails = 'not-found';
    r = await post(iosDelete, true, { transactionId: '2000000123' }); expect(r.code).toBe(200); expect(w.log.takenDown).toEqual([]);
    reset(); setWorld({ appleSite: false, webSite: false, card: false, appleLive: false }); env(); w.orphan = true; w.verifyFails = 'apple-unavailable';
    r = await post(iosDelete, true, { transactionId: '2000000123' }); expect([r.code, r.body]).toEqual([503, { error: 'temporarily-unavailable' }]); expect(nothing()).toEqual([0, [], [], [], [], [], []]);
    // the account's own purchase is already listed: not taken down twice
    reset(); setWorld({ appleSite: true, webSite: false, card: false, appleLive: true }); env();
    r = await post(iosDelete, true, { transactionId: '2000000123' }); expect(r.code).toBe(200); expect(w.log.takenDown).toEqual(['apple-site']);
  });

  it('a web account naming a transaction bound to a signed-out Apple site: that Apple site is taken offline (not the web site); not verifying, or Apple down, behaves as stated', async () => {
    const body = { transactionId: '2000000123' };
    reset(); setWorld(web); env(); w.orphan = true;
    let r = await post(iosTakeOffline, true, body);
    expect([r.code, r.body.outcome]).toEqual([200, { site: 'apple', contentKept: false, otherSiteLive: true }]); expect(w.log.offline).toEqual(['orphan-site']); expect(w.log.content).toEqual(['orphan-site']);
    // expect keep: the Apple action would purge, so the barber is asked first
    reset(); setWorld(web); env(); w.orphan = true;
    r = await post(iosTakeOffline, true, { ...body, expect: 'keep' }); expect([r.code, r.body]).toEqual([409, { error: 'confirm-purge' }]); expect(w.log.offline).toEqual([]);
    // not verifying: ignored, the web site goes offline
    reset(); setWorld(web); env(); w.orphan = true; w.verifyFails = 'not-found';
    r = await post(iosTakeOffline, true, body); expect([r.code, r.body.outcome?.site]).toEqual([200, 'web']); expect(w.log.offline).toEqual(['web-site']);
    // Apple unreachable: nothing is done
    reset(); setWorld(web); env(); w.orphan = true; w.verifyFails = 'apple-unavailable';
    r = await post(iosTakeOffline, true, body); expect(r.code).toBe(503); expect(w.log.offline).toEqual([]);
    // a transaction bound to nothing: ignored
    reset(); setWorld(web); env();
    r = await post(iosTakeOffline, true, body); expect([r.code, r.body.outcome?.site]).toEqual([200, 'web']);
  });

  it('the Apple preconditions come before confirm-purge: a missing transaction is 400 and an unbound one 404, even with expect keep', async () => {
    reset(); setWorld({ appleSite: true, webSite: false, card: false, appleLive: true }); env();
    let r = await post(iosTakeOffline, true, { expect: 'keep' }); expect([r.code, r.body]).toEqual([400, { error: 'bad-request' }]);
    reset(); setWorld({ appleSite: false, webSite: false, card: false, appleLive: false }); env();
    r = await post(iosTakeOffline, true, { transactionId: '2000000123', expect: 'keep' }); expect([r.code, r.body]).toEqual([404, { error: 'no-site' }]);
  });
});
