// INVARIANT (App Store rule + billing), modelled on the real 1.2 app: it picks its first route from its MODE (siteModeFromKind; with ACCOUNT_PLAN_V2 off it believes it is in device
// mode), account / web-only -> /api/web-app/* first, device -> /api/ios/* first. Fallback, one hop each way: a web route 404 not_found or 403 not-account-mode -> one try on the
// iOS route; an iOS 409 use-account-* -> the web route. For every kind x switch combination at least one route deletes the account / takes the site offline, and no route
// deletes a web or two-site account while leaving its card plan billing. A web account has no Apple transaction (the Apple take-offline route cannot take its site down).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({ kind: 'web', deleted: 0, cancelled: false, down: [] as string[] }));
vi.mock('../../lib/webApp/webAppServer.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/webApp/webAppServer.js')>()),
  webAppCors: () => false, webAppEntitlementsOn: () => process.env.WEB_APP_ENTITLEMENTS === '1', callerFrom: async () => ({ id: 'u1', email: 'a@b.co' }),
}));
vi.mock('../../lib/ios/deleteAccount.js', () => ({
  liveDeleteDeps: () => ({ cancels: false }),
  deleteAccount: async (_a: unknown, deps: any) => { st.deleted++; st.cancelled = !!deps.cancels; return { status: 200, body: { ok: true } }; },
}));
vi.mock('../../lib/webApp/deleteAccount.js', () => ({
  liveWebDeleteDeps: () => ({ cancels: true, closeShop: async () => ({ ok: true }) }),
  removeWebSitesOf: async () => { st.down.push('web'); return 1; },
}));
vi.mock('../../lib/webApp/legacyDeleteAlert.js', () => ({ alertIfLegacyCustomer: async () => {} }));
vi.mock('../../lib/webApp/reliability.js', () => ({ resumeAfterFailedDelete: async () => {}, reliabilityOn: () => process.env.WEB_APP_RELIABILITY === '1' }));
// The Apple take-offline route needs an Apple transaction: only a kind that holds an Apple site (apple, mixed) has one, and it takes down THAT site only.
vi.mock('../../lib/ios/takeOffline.js', () => ({
  takeSiteOffline: async () => {
    if (st.kind === 'apple' || st.kind === 'mixed') { st.down.push('apple'); return { status: 200, body: { ok: true } }; }
    return { status: 400, body: { error: 'bad-request' } };
  },
}));
vi.mock('../../lib/ios/appleVerify.js', () => ({ lazyDefaultVerifier: () => async () => ({}) }));
vi.mock('../../lib/ios/purchases.js', () => ({ supabasePurchases: () => ({}) }));
vi.mock('../../lib/ios/removeSiteLive.js', () => ({ liveRemoveDeps: () => ({}), liveDeleteAccountRows: {} }));
vi.mock('../../lib/bookings/rateLimit.js', async (orig) => ({ ...(await orig<typeof import('../../lib/bookings/rateLimit.js')>()), clientIp: () => '1', iosLimiter: { allow: async () => true } }));
vi.mock('../../lib/ios/publishFlow.js', () => ({ liveUserOf: async () => ({ id: 'u1' }) }));
vi.mock('../../lib/account/kind.js', async (orig) => ({ ...(await orig<typeof import('../../lib/account/kind.js')>()), accountKind: async () => st.kind }));

import iosDelete from '../../api/ios/delete-account.js';
import iosTakeOffline from '../../api/ios/take-offline.js';
import webDelete from '../../api/web-app/delete-account.js';
import webTakeOffline from '../../api/web-app/take-offline.js';
import { siteModeFromKind } from '../../lib/account/siteMode.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };
const post = async (h: any, header: boolean) => { const r = res(); await h({ method: 'POST', headers: { authorization: 'Bearer t', ...(header ? { 'x-pb-build': '57' } : {}) }, body: { transactionId: '1' } }, r); return r; };
beforeEach(() => { Object.assign(st, { deleted: 0, cancelled: false, down: [] }); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const KINDS = ['apple', 'web', 'mixed', 'neither'] as const;
type Combo = { v2: boolean; cancels: boolean; ent: boolean; drafts: boolean; rel: boolean };
const combos: Combo[] = [];
for (const v2 of [false, true]) for (const cancels of [false, true]) for (const ent of [false, true]) for (const drafts of [false, true]) for (const rel of [false, true]) combos.push({ v2, cancels, ent, drafts, rel });
const setEnv = (c: Combo) => {
  vi.stubEnv('ACCOUNT_PLAN_V2', c.v2 ? '1' : ''); vi.stubEnv('APP_DELETE_CANCELS_WEB', c.cancels ? '1' : '');
  vi.stubEnv('WEB_APP_ENTITLEMENTS', c.ent ? '1' : ''); vi.stubEnv('ACCOUNT_DRAFTS_IOS', c.drafts ? 'all' : ''); vi.stubEnv('WEB_APP_RELIABILITY', c.rel ? '1' : '');
};
/** The app's mode: with ACCOUNT_PLAN_V2 off the plan answer has no siteMode, so it believes it is in device mode. */
const appMode = (kind: (typeof KINDS)[number], c: Combo) => (c.v2 ? siteModeFromKind(kind, 'u1', { ACCOUNT_DRAFTS_IOS: c.drafts ? 'all' : '' }) : 'device');

/** The app's flow: first route by mode, then one hop each way on the documented fallback answers. */
async function appFlow(web: any, ios: any, mode: string) {
  const order = mode === 'device' ? [ios, web] : [web, ios];
  const isIos = (h: any) => h === ios;
  let r = await post(order[0], true);
  let last = isIos(order[0]) ? 'ios' : 'web';
  const fallsBack = isIos(order[0])
    ? r.code === 409 && /^use-account-/.test(r.body?.error ?? '')
    : (r.code === 404 && r.body?.error === 'not_found') || (r.code === 403 && r.body?.error === 'not-account-mode');
  if (fallsBack) { r = await post(order[1], true); last = isIos(order[1]) ? 'ios' : 'web'; }
  return { r, last };
}

describe('delete account: every kind x switch ends deleted, and a web or two-site account never with its card plan left billing', () => {
  for (const kind of KINDS) for (const c of combos) {
    it(`${kind} ${JSON.stringify(c)}`, async () => {
      st.kind = kind; setEnv(c);
      const { r, last } = await appFlow(webDelete, iosDelete, appMode(kind, c));
      expect(r.code, `${last} ${JSON.stringify(r.body)}`).toBe(200);
      expect(st.deleted).toBe(1);
      const hasCard = kind === 'web' || kind === 'mixed';
      // With ACCOUNT_PLAN_V2 on the guarantee holds. With it off the Apple route is exactly today's (it cancels only with APP_DELETE_CANCELS_WEB=1): switches off = today.
      if (hasCard && c.v2) expect(st.cancelled, 'never deleted with the card plan still billing').toBe(true);
      if (hasCard && !c.v2) expect(st.cancelled).toBe(c.cancels);
    });
  }
  it('builds 55 and 1.1 (no header) are exactly as before: the Apple route cancels the card plan only with APP_DELETE_CANCELS_WEB=1, never a 409', async () => {
    for (const kind of KINDS) for (const c of combos) {
      Object.assign(st, { deleted: 0, cancelled: false }); st.kind = kind; setEnv(c);
      const r = await post(iosDelete, false);
      expect(r.code).toBe(200);
      expect(st.cancelled).toBe(c.cancels);
    }
  });
});

describe('take offline: every kind x switch takes the right site down', () => {
  // Which site goes down: apple -> the Apple site; web -> the web site; mixed -> ONLY the Apple site (the device-mode site the phone shows; the web site is untouched).
  const expected = { apple: ['apple'], web: ['web'], mixed: ['apple'] } as const;
  for (const kind of ['apple', 'web', 'mixed'] as const) for (const c of combos) {
    it(`${kind} ${JSON.stringify(c)}`, async () => {
      st.kind = kind; setEnv(c);
      if (kind === 'web' && !c.v2) return; // ACCOUNT_PLAN_V2 off: today's Apple route; the app has no mode, and a web account has no Apple transaction (switches off = today)
      const { r, last } = await appFlow(webTakeOffline, iosTakeOffline, appMode(kind, c));
      expect(r.code, `${last} ${JSON.stringify(r.body)}`).toBe(200);
      expect(st.down).toEqual(expected[kind]);
    });
  }
  it('header-less calls never get a 409 on the Apple route', async () => {
    for (const kind of KINDS) for (const c of combos) { st.kind = kind; setEnv(c); expect((await post(iosTakeOffline, false)).code).not.toBe(409); }
  });
});
