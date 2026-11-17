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
vi.mock('../../lib/webApp/reliability.js', () => ({ suspendWork: vi.fn(async () => { order.push('suspend'); }), markSiteOffline: vi.fn(async () => { order.push('markSiteOffline'); }), resumeAfterFailedDelete: async () => {}, forgetLiveAddress: vi.fn(async () => { order.push('forget'); }), reliabilityOn: () => process.env.WEB_APP_RELIABILITY === '1' }));
vi.mock('../../lib/account/kind.js', async (orig) => ({ ...(await orig<typeof import('../../lib/account/kind.js')>()), accountKind: async () => { st.kindCalls++; if (st.kindFails) throw new Error('db'); return st.kind; } }));

import { removeWebSitesOf } from '../../lib/webApp/deleteAccount.js';
import takeOffline from '../../api/web-app/take-offline.js';
import iosDelete from '../../api/ios/delete-account.js';
import iosTakeOffline from '../../api/ios/take-offline.js';
import { iosDestructiveRoute } from '../../lib/account/siteMode.js';
import { getPlan, type PlanDeps } from '../../lib/ios/planFlow.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };
const post = async (h: any, headers: any = {}, body: any = { transactionId: '1' }) => { const r = res(); await h({ method: 'POST', headers: { authorization: 'Bearer t', ...headers }, body }, r); return r; };
beforeEach(() => { vi.stubEnv('WEB_APP_RELIABILITY', '1'); order.length = 0; vi.clearAllMocks(); Object.assign(st, { kind: 'web', kindFails: false, kindCalls: 0, deleted: 0, tookOffline: 0 }); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); });
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
  it('keep-content forgets the draft\'s live address itself when the draft engine is off; with it on markSiteOffline does it (no second write)', async () => {
    vi.stubEnv('WEB_APP_RELIABILITY', '');
    await removeWebSitesOf('u1', { keepContent: true });
    expect(order).toContain('forget');
    order.length = 0; vi.stubEnv('WEB_APP_RELIABILITY', '1');
    await removeWebSitesOf('u1', { keepContent: true });
    expect(order).not.toContain('forget');
    order.length = 0; vi.stubEnv('WEB_APP_RELIABILITY', '');
    await removeWebSitesOf('u1'); // the web's own take offline: unchanged
    expect(order).not.toContain('forget');
  });
  it('a failed clear of the draft address is logged, never fatal (native draft GET and publish then hide the stale address: nativeStaleOffline.test.ts)', async () => {
    const { forgetLiveAddress } = await import('../../lib/webApp/reliability.js');
    (forgetLiveAddress as any).mockRejectedValueOnce(Object.assign(new Error('supabase 500'), { status: 500 }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('WEB_APP_RELIABILITY', '');
    expect(await removeWebSitesOf('u1', { keepContent: true })).toBe(1);
    expect(log.mock.calls.some((c) => String(c[0]).includes('could not forget the draft live address'))).toBe(true);
    log.mockRestore();
  });
  it('keep-content keeps the saved contact phone number; the other take offline still drops it', async () => {
    const { sbRest } = await import('../../lib/webApp/webAppServer.js');
    const phonePatches = () => (sbRest as any).mock.calls.filter((c: any[]) => c[1]?.method === 'PATCH' && 'contact_phone' in (c[1]?.body ?? {}));
    await removeWebSitesOf('u1', { keepContent: true });
    expect(phonePatches()).toHaveLength(0);
    await removeWebSitesOf('u1');
    expect(phonePatches()).toHaveLength(1);
    expect(phonePatches()[0][1].body).toMatchObject({ contact_phone: null, contact_phone_at: null });
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

describe('S2: iosDestructiveRoute decisions', () => {
  const userOf = async () => ({ id: 'u1' });
  const hdr = { headers: { authorization: 'Bearer t', 'x-pb-build': '57' } };
  const run = (kind: any, route: 'delete' | 'take-offline', req: any = hdr) => iosDestructiveRoute(req, userOf, route, { kind: async () => kind });
  it('switch off, no header or no token: allow at once, nothing read', async () => {
    const kind = vi.fn(async () => { throw new Error('no'); });
    vi.stubEnv('ACCOUNT_PLAN_V2', '');
    expect(await iosDestructiveRoute(hdr, userOf, 'delete', { kind: kind as any })).toEqual({ action: 'allow' });
    vi.stubEnv('ACCOUNT_PLAN_V2', '1');
    expect(await iosDestructiveRoute({ headers: { authorization: 'Bearer t' } }, userOf, 'delete', { kind: kind as any })).toEqual({ action: 'allow' }); // builds 55 and 1.1
    expect(await iosDestructiveRoute({ headers: { 'x-pb-build': '57' } }, userOf, 'delete', { kind: kind as any })).toEqual({ action: 'allow' });
    expect(kind).not.toHaveBeenCalled();
  });
  it('web account: 409 only while the account route exists and APP_DELETE_CANCELS_WEB is off; otherwise the iOS delete cancels the card plan itself or the switch branch does', async () => {
    vi.stubEnv('ACCOUNT_PLAN_V2', '1');
    vi.stubEnv('WEB_APP_ENTITLEMENTS', '1');
    expect(await run('web', 'delete')).toEqual({ action: 'respond', status: 409, body: { error: 'use-account-delete' } });
    expect(await run('web', 'take-offline')).toEqual({ action: 'respond', status: 409, body: { error: 'use-account-take-offline' } });
    vi.stubEnv('APP_DELETE_CANCELS_WEB', '1');
    expect(await run('web', 'delete')).toEqual({ action: 'allow' });
    vi.stubEnv('APP_DELETE_CANCELS_WEB', '');
    vi.stubEnv('WEB_APP_ENTITLEMENTS', '');
    expect(await run('web', 'delete')).toEqual({ action: 'forceCancel' });
    expect(await run('web', 'take-offline')).toEqual({ action: 'webTakeOffline', userId: 'u1' }); // no account route: the web site is taken offline right here
    expect(await run('mixed', 'take-offline')).toEqual({ action: 'allow' }); // the Apple route takes down only the Apple site
  });
  it('mixed is never refused (it resolves to device and has no other delete): forceCancel unless APP_DELETE_CANCELS_WEB=1; apple and neither pass; a failed lookup is 503', async () => {
    vi.stubEnv('ACCOUNT_PLAN_V2', '1'); vi.stubEnv('WEB_APP_ENTITLEMENTS', '1'); vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run('mixed', 'delete')).toEqual({ action: 'forceCancel' });
    expect(await run('mixed', 'take-offline')).toEqual({ action: 'allow' });
    vi.stubEnv('APP_DELETE_CANCELS_WEB', '1');
    expect(await run('mixed', 'delete')).toEqual({ action: 'allow' });
    for (const k of ['apple', 'neither']) expect(await run(k, 'delete')).toEqual({ action: 'allow' });
    expect(await iosDestructiveRoute(hdr, userOf, 'delete', { kind: async () => { throw new Error('db'); } })).toMatchObject({ action: 'respond', status: 503 });
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
  it('blockedPurchaseChecked: true whenever the lookup ran and succeeded (also for "none"); absent on a failed lookup, with the guard off, and independent of ACCOUNT_PLAN_V2', async () => {
    vi.stubEnv('ONE_SITE_GUARD', '1'); vi.stubEnv('ACCOUNT_PLAN_V2', '');
    const none: any = await getPlan('Bearer x', base({ blockedPurchase: async () => null }));
    expect(none.body.blockedPurchaseChecked).toBe(true); expect('blockedPurchase' in none.body).toBe(false);
    const some: any = await getPlan('Bearer x', base({ blockedPurchase: blocked() }));
    expect(some.body.blockedPurchaseChecked).toBe(true); expect(some.body.blockedPurchase.reason).toBe('web-account');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad: any = await getPlan('Bearer x', base({ blockedPurchase: async () => { throw new Error('db'); } }));
    expect('blockedPurchaseChecked' in bad.body).toBe(false);
    vi.stubEnv('ONE_SITE_GUARD', '');
    const off: any = await getPlan('Bearer x', base({ blockedPurchase: async () => null }));
    expect('blockedPurchaseChecked' in off.body).toBe(false);
  });
  it('none unresolved: absent; a failed lookup: absent, never a 5xx; planLive rides along for web-account when the plan answer is on', async () => {
    vi.stubEnv('ONE_SITE_GUARD', '1');
    const none: any = await getPlan('Bearer x', base({ blockedPurchase: async () => null }));
    expect('blockedPurchase' in none.body).toBe(false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad: any = await getPlan('Bearer x', base({ blockedPurchase: async () => { throw new Error('db'); } }));
    expect(bad.status).toBe(200); expect('blockedPurchase' in bad.body).toBe(false);
    vi.stubEnv('ACCOUNT_PLAN_V2', '1');
    // planLive comes from the one planLive source (deps.planLive), independent of ACCOUNT_PLAN_V2
    vi.stubEnv('ACCOUNT_PLAN_V2', '');
    const ended: any = await getPlan('Bearer x', base({ blockedPurchase: blocked(), planLive: async () => false }));
    expect(ended.body.blockedPurchase).toMatchObject({ reason: 'web-account', planLive: false });
    const live: any = await getPlan('Bearer x', base({ blockedPurchase: blocked(), planLive: async () => true }));
    expect(live.body.blockedPurchase.planLive).toBe(true);
    const failing: any = await getPlan('Bearer x', base({ blockedPurchase: blocked(), planLive: async () => { throw new Error('db'); } }));
    expect(failing.body.blockedPurchase.planLive).toBe(true); // never "ended" on a guess
    const other: any = await getPlan('Bearer x', base({ blockedPurchase: blocked('other-apple-id'), planLive: async () => false }));
    expect('planLive' in other.body.blockedPurchase).toBe(false);
  });
  it('the live lookup: ledger rows of the account, Production purchases only, live and not tied to the account; web-publish: rows ignored; no ledger table = none', async () => {
    const { livePlanDeps } = await import('../../lib/ios/planFlow.js');
    for (const [k, v] of Object.entries({ SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'k' })) vi.stubEnv(k, v);
    const NOW = Date.now(); const FUT = new Date(NOW + 30 * 86_400_000).toISOString(); const PAST = new Date(NOW - 86_400_000).toISOString();
    const { sbRest } = await import('../../lib/webApp/webAppServer.js');
    const calls: string[] = [];
    let shopLinks: any[] = [];
    const fetchWith = (ledger: any[] | 404, purchases: any[]) => (sbRest as any).mockImplementation(async (path: string) => {
      calls.push(decodeURIComponent(path));
      if (path.startsWith('blocked_purchases')) { if (ledger === 404) throw Object.assign(new Error('supabase 404'), { status: 404 }); return ledger; }
      if (path.startsWith('ab_shops')) return shopLinks;
      return purchases;
    });
    const dep = (livePlanDeps() as any).blockedPurchase as (u: string, n: number) => Promise<any>;
    const prod = (id: string, over: any = {}) => ({ original_transaction_id: id, product_id: 'com.ibrahim1774.aibarber.hosting.monthly', environment: 'Production', expires_at: FUT, revoked_at: null, taken_down_at: null, user_id: null, ...over });
    fetchWith([{ original_transaction_id: 'web-publish:slug', reason: 'mixed' }, { original_transaction_id: 'OLD', reason: 'web-account' }, { original_transaction_id: 'LIVE', reason: 'other-apple-id' }], [prod('OLD', { expires_at: PAST }), prod('LIVE')]);
    expect(await dep('u1', NOW)).toEqual({ reason: 'other-apple-id', originalTransactionId: 'LIVE' });
    expect(calls.find((c) => c.startsWith('ios_purchases'))).toMatch(/original_transaction_id=in\.\(OLD,LIVE\).*environment=eq\.Production/);
    fetchWith([{ original_transaction_id: 'X', reason: 'web-account' }], [prod('X', { user_id: 'u1' })]); // tied to the account now: resolved
    expect(await dep('u1', NOW)).toBeNull();
    fetchWith([{ original_transaction_id: 'P', reason: 'web-account' }], [prod('P', { user_id: 'B' })]); // refused for A, later tied to B: A's GET has no signal
    expect(await dep('A', NOW)).toBeNull();
    shopLinks = [{ ios_otid: 'P2' }];
    fetchWith([{ original_transaction_id: 'P2', reason: 'web-account' }], [prod('P2')]); // a shop now points at it: resolved too
    expect(await dep('A', NOW)).toBeNull();
    shopLinks = [];
    fetchWith([{ original_transaction_id: 'X', reason: 'web-account' }], [prod('X', { revoked_at: PAST })]); // refunded
    expect(await dep('u1', NOW)).toBeNull();
    fetchWith(404, []); expect(await dep('u1', NOW)).toBeNull();
  });
});
