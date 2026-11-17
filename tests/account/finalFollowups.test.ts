// S1 native take offline keeps content, S2 web accounts on the Apple delete / take-offline routes, S3 blockedPurchase on the GET plan.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const order: string[] = [];
const rm = {
  releaseDomains: vi.fn(async (s: string) => { order.push(`domain:${s}`); }),
  clearSiteBase: vi.fn(async (s: string) => { order.push(`base:${s}`); }),
  deleteContent: vi.fn(async (s: string) => { order.push(`content:${s}`); }),
  deployOffline: vi.fn(async (s: string) => { order.push(`offline:${s}`); }),
  markRemoved: vi.fn(async () => {}), markTakenDown: vi.fn(async () => {}), now: () => 1,
};
const st = vi.hoisted(() => ({ removeCalls: [] as any[], kind: 'web', kindFails: false, kindCalls: 0, deleted: 0, tookOffline: 0 }));
vi.mock('../../lib/webApp/webAppServer.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/webApp/webAppServer.js')>()),
  webAppCors: () => false, webAppEntitlementsOn: () => true, callerFrom: async () => ({ id: 'u1', email: 'a@b.co' }),
  sbRest: vi.fn(async (path: string) => (path.startsWith('web_app_sites?user_id=') ? [{ slug: 'fresh-cuts', stripe_subscription_id: 'sub_1', environment: 'live', published_at: 'x' }] : [])),
  stripeCall: vi.fn(),
}));
vi.mock('../../lib/ios/deleteAccount.js', () => ({ liveDeleteDeps: vi.fn(() => ({ listSites: async () => [] })), deleteAccount: async () => { st.deleted++; return { status: 200, body: { ok: true } }; } }));
vi.mock('../../lib/ios/removeSiteLive.js', () => ({ liveRemoveDeps: vi.fn(() => rm), liveDeleteAccountRows: {} }));
vi.mock('../../lib/ios/takeOffline.js', () => ({ takeSiteOffline: async () => { st.tookOffline++; return { status: 200, body: { ok: true } }; } }));
vi.mock('../../lib/ios/appleVerify.js', () => ({ lazyDefaultVerifier: () => async () => ({}) }));
vi.mock('../../lib/ios/purchases.js', () => ({ supabasePurchases: () => ({}) }));
vi.mock('../../lib/bookings/rateLimit.js', async (orig) => ({ ...(await orig<typeof import('../../lib/bookings/rateLimit.js')>()), clientIp: () => '1', iosLimiter: { allow: async () => true } }));
vi.mock('../../lib/ios/publishFlow.js', () => ({ liveUserOf: async () => ({ id: 'u1' }) }));
vi.mock('../../lib/webApp/reliability.js', () => ({ suspendWork: vi.fn(async () => { order.push('suspend'); }), markSiteOffline: vi.fn(async () => { order.push('markSiteOffline'); }), resumeAfterFailedDelete: async () => {} }));
vi.mock('../../lib/account/kind.js', async (orig) => ({ ...(await orig<typeof import('../../lib/account/kind.js')>()), accountKind: async () => { st.kindCalls++; if (st.kindFails) throw new Error('db'); return st.kind; } }));

import { removeWebSitesOf } from '../../lib/webApp/deleteAccount.js';
import takeOffline from '../../api/web-app/take-offline.js';
import iosDelete from '../../api/ios/delete-account.js';
import iosTakeOffline from '../../api/ios/take-offline.js';
import { webAccountOnIosRoute } from '../../lib/account/siteMode.js';
import { getPlan, type PlanDeps } from '../../lib/ios/planFlow.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };
const post = async (h: any, headers: any = {}, body: any = { transactionId: '1' }) => { const r = res(); await h({ method: 'POST', headers: { authorization: 'Bearer t', ...headers }, body }, r); return r; };
beforeEach(() => { order.length = 0; vi.clearAllMocks(); Object.assign(st, { kind: 'web', kindFails: false, kindCalls: 0, deleted: 0, tookOffline: 0 }); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); });
afterEach(() => vi.unstubAllEnvs());

describe('S1: native account-mode take offline never deletes the stored copy', () => {
  it('keepContent: domain detached, address forgotten, NOTHING deleted, whatever SAFE_TAKE_OFFLINE says', async () => {
    for (const safe of ['', '1']) {
      order.length = 0; vi.stubEnv('SAFE_TAKE_OFFLINE', safe);
      expect(await removeWebSitesOf('u1', { keepContent: true })).toBe(1);
      expect(order).toEqual(['suspend', 'offline:fresh-cuts', 'domain:fresh-cuts', 'base:fresh-cuts', 'markSiteOffline']);
      expect(rm.deleteContent).not.toHaveBeenCalled();
    }
  });
  it('the web\'s own take offline and old builds stay exactly as today (full purge with the switch off)', async () => {
    await removeWebSitesOf('u1');
    expect(order).toEqual(['suspend', 'offline:fresh-cuts', 'domain:fresh-cuts', 'content:fresh-cuts', 'markSiteOffline']);
  });
  it('the route passes keepContent only for the native caller; a browser passes nothing', async () => {
    vi.stubEnv('ACCOUNT_DRAFTS_IOS', 'all');
    expect((await post(takeOffline, { 'x-pb-build': '57' })).code).toBe(200);
    expect(order).toContain('base:fresh-cuts');
    expect(rm.deleteContent).not.toHaveBeenCalled();
    order.length = 0;
    expect((await post(takeOffline)).code).toBe(200);
    expect(order).toContain('content:fresh-cuts');
  });
  it('markSiteOffline clears deployed_url and the binding, so a later draft PUT can never return the old live address (independent of DRAFT_PUT_KEEPS_LIVE_URL)', async () => {
    const real = await vi.importActual<typeof import('../../lib/webApp/reliability.js')>('../../lib/webApp/reliability.js');
    const { sbRest } = await import('../../lib/webApp/webAppServer.js');
    vi.stubEnv('WEB_APP_RELIABILITY', '1');
    await real.markSiteOffline('u1');
    const patch = (sbRest as any).mock.calls.find((c: any[]) => String(c[0]).startsWith('web_app_drafts'));
    expect(patch[1].body).toEqual({ deployed_url: null, published_binding: null });
  });
});

describe('S2: a web or mixed account never deletes or takes offline through the Apple routes', () => {
  const userOf = async () => ({ id: 'u1' });
  const hdr = { headers: { authorization: 'Bearer t' } };
  it('switch off: null at once, nothing read (the kind lookup would throw)', async () => {
    vi.stubEnv('ACCOUNT_PLAN_V2', '');
    const kind = vi.fn(async () => { throw new Error('no'); });
    expect(await webAccountOnIosRoute(hdr, userOf, 'use-account-delete', { kind: kind as any })).toBeNull();
    expect(kind).not.toHaveBeenCalled();
  });
  it('switch on: web and mixed are 409 with the route\'s code; apple, neither, no token and a bad token pass; a failed lookup is 503', async () => {
    vi.stubEnv('ACCOUNT_PLAN_V2', '1'); vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const k of ['web', 'mixed'] as const) {
      expect(await webAccountOnIosRoute(hdr, userOf, 'use-account-delete', { kind: async () => k })).toEqual({ status: 409, body: { error: 'use-account-delete' } });
      expect(await webAccountOnIosRoute(hdr, userOf, 'use-account-take-offline', { kind: async () => k })).toEqual({ status: 409, body: { error: 'use-account-take-offline' } });
    }
    for (const k of ['apple', 'neither'] as const) expect(await webAccountOnIosRoute(hdr, userOf, 'use-account-delete', { kind: async () => k })).toBeNull();
    expect(await webAccountOnIosRoute({ headers: {} }, userOf, 'use-account-delete', { kind: async () => 'web' })).toBeNull();
    expect(await webAccountOnIosRoute(hdr, async () => null, 'use-account-delete', { kind: async () => 'web' })).toBeNull();
    expect((await webAccountOnIosRoute(hdr, userOf, 'use-account-delete', { kind: async () => { throw new Error('db'); } }))?.status).toBe(503);
  });
  it('handlers: ACCOUNT_PLAN_V2 on + web: 409 and nothing is deleted or taken offline; off: today\'s flow; an unknown Stripe key never 503s an Apple account', async () => {
    vi.stubEnv('ACCOUNT_PLAN_V2', '1');
    let r = await post(iosDelete); expect([r.code, r.body]).toEqual([409, { error: 'use-account-delete' }]);
    r = await post(iosTakeOffline); expect([r.code, r.body]).toEqual([409, { error: 'use-account-take-offline' }]);
    expect(st.deleted).toBe(0); expect(st.tookOffline).toBe(0);
    st.kind = 'apple'; vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', ''); vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await post(iosDelete)).code).toBe(200); expect((await post(iosTakeOffline)).code).toBe(200);
    vi.stubEnv('ACCOUNT_PLAN_V2', ''); st.kind = 'web'; st.kindCalls = 0; st.deleted = 0;
    expect((await post(iosDelete)).code).toBe(200);
    expect(st.deleted).toBe(1); expect(st.kindCalls).toBe(0);
  });
});

describe('S3: GET /api/shop/plan carries blockedPurchase while the refused purchase is unresolved', () => {
  const user = { id: 'u1', email: 'me@example.com', fullName: null };
  const base = (over: Partial<PlanDeps> = {}): PlanDeps => ({
    getUser: async () => user, shopByOwner: async () => null, purchase: async () => null, verify: async () => { throw new Error('no'); }, upsertVerified: async () => { throw new Error('no'); },
    setShopOtid: async () => 'ok', setUserIfUnlinked: async () => true, now: () => 1_800_000_000_000, ...over,
  } as any);
  const blocked = (reason = 'web-account') => vi.fn(async () => ({ reason, originalTransactionId: '2000000123' }));
  it('ONE_SITE_GUARD=1: reason, the purchase id (so the app shows it once per purchase) and the caller\'s own email; not otherwise', async () => {
    vi.stubEnv('ONE_SITE_GUARD', '1');
    const on: any = await getPlan('Bearer x', base({ blockedPurchase: blocked() }));
    expect(on.body.blockedPurchase).toEqual({ reason: 'web-account', originalTransactionId: '2000000123', accountEmail: 'me@example.com' });
    for (const v of ['alert', '']) {
      vi.stubEnv('ONE_SITE_GUARD', v);
      const dep = blocked();
      const off: any = await getPlan('Bearer x', base({ blockedPurchase: dep }));
      expect('blockedPurchase' in off.body).toBe(false);
      expect(dep).not.toHaveBeenCalled();
    }
  });
  it('none unresolved: absent; a failed lookup: absent, never a 5xx; planLive rides along for web-account when the plan answer is on', async () => {
    vi.stubEnv('ONE_SITE_GUARD', '1');
    const none: any = await getPlan('Bearer x', base({ blockedPurchase: async () => null }));
    expect('blockedPurchase' in none.body).toBe(false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad: any = await getPlan('Bearer x', base({ blockedPurchase: async () => { throw new Error('db'); } }));
    expect(bad.status).toBe(200); expect('blockedPurchase' in bad.body).toBe(false);
    vi.stubEnv('ACCOUNT_PLAN_V2', '1');
    const plan = { source: 'stripe', status: 'canceled', active: false, kind: 'web', site: null, legacy: false, holderPurchaseEnded: false, siteMode: 'account' } as any;
    const v2: any = await getPlan('Bearer x', base({ blockedPurchase: blocked(), accountPlan: async () => plan }));
    expect(v2.body.blockedPurchase).toMatchObject({ reason: 'web-account', planLive: false });
    const other: any = await getPlan('Bearer x', base({ blockedPurchase: blocked('other-apple-id'), accountPlan: async () => plan }));
    expect('planLive' in other.body.blockedPurchase).toBe(false);
    expect('planLive' in v2.body).toBe(false);
  });
  it('the live lookup: ledger rows of the account, Production purchases only, live and not tied to the account; web-publish: rows ignored; no ledger table = none', async () => {
    const { livePlanDeps } = await import('../../lib/ios/planFlow.js');
    for (const [k, v] of Object.entries({ SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'k' })) vi.stubEnv(k, v);
    const NOW = Date.now(); const FUT = new Date(NOW + 30 * 86_400_000).toISOString(); const PAST = new Date(NOW - 86_400_000).toISOString();
    const { sbRest } = await import('../../lib/webApp/webAppServer.js');
    const calls: string[] = [];
    const fetchWith = (ledger: any[] | 404, purchases: any[]) => (sbRest as any).mockImplementation(async (path: string) => {
      calls.push(decodeURIComponent(path));
      if (path.startsWith('blocked_purchases')) { if (ledger === 404) throw Object.assign(new Error('supabase 404'), { status: 404 }); return ledger; }
      return purchases;
    });
    const dep = (livePlanDeps() as any).blockedPurchase as (u: string, n: number) => Promise<any>;
    const prod = (id: string, over: any = {}) => ({ original_transaction_id: id, product_id: 'com.ibrahim1774.aibarber.hosting.monthly', environment: 'Production', expires_at: FUT, revoked_at: null, taken_down_at: null, user_id: null, ...over });
    fetchWith([{ original_transaction_id: 'web-publish:slug', reason: 'mixed' }, { original_transaction_id: 'OLD', reason: 'web-account' }, { original_transaction_id: 'LIVE', reason: 'other-apple-id' }], [prod('OLD', { expires_at: PAST }), prod('LIVE')]);
    expect(await dep('u1', NOW)).toEqual({ reason: 'other-apple-id', originalTransactionId: 'LIVE' });
    expect(calls.find((c) => c.startsWith('ios_purchases'))).toMatch(/original_transaction_id=in\.\(OLD,LIVE\).*environment=eq\.Production/);
    fetchWith([{ original_transaction_id: 'X', reason: 'web-account' }], [prod('X', { user_id: 'u1' })]); // tied to the account now: resolved
    expect(await dep('u1', NOW)).toBeNull();
    fetchWith([{ original_transaction_id: 'X', reason: 'web-account' }], [prod('X', { revoked_at: PAST })]); // refunded
    expect(await dep('u1', NOW)).toBeNull();
    fetchWith(404, []); expect(await dep('u1', NOW)).toBeNull();
  });
});
