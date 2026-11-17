// INVARIANT (App Store rule + billing): for every kind x build header x switch combination with a 1.2 build (header present) at least one route deletes the account
// (and at least one takes the site offline), and no route deletes a web or two-site account without cancelling its card plan. Builds 55 and 1.1 (no header) are unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({ kind: 'web', deleted: 0, cancelled: false, tookOffline: 0 }));
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
  removeWebSitesOf: async () => { st.tookOffline++; return 1; },
}));
vi.mock('../../lib/webApp/legacyDeleteAlert.js', () => ({ alertIfLegacyCustomer: async () => {} }));
vi.mock('../../lib/webApp/reliability.js', () => ({ resumeAfterFailedDelete: async () => {}, reliabilityOn: () => true }));
vi.mock('../../lib/ios/takeOffline.js', () => ({ takeSiteOffline: async () => { st.tookOffline++; return { status: 200, body: { ok: true } }; } }));
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

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };
const post = async (h: any, header: boolean) => { const r = res(); await h({ method: 'POST', headers: { authorization: 'Bearer t', ...(header ? { 'x-pb-build': '57' } : {}) }, body: { transactionId: '1' } }, r); return r; };
beforeEach(() => { Object.assign(st, { deleted: 0, cancelled: false, tookOffline: 0 }); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const KINDS = ['apple', 'web', 'mixed', 'neither'] as const;
const bool = [false, true];
const combos: { v2: boolean; cancels: boolean; ent: boolean; drafts: boolean }[] = [];
for (const v2 of bool) for (const cancels of bool) for (const ent of bool) for (const drafts of bool) combos.push({ v2, cancels, ent, drafts });
const setEnv = (c: (typeof combos)[number]) => {
  vi.stubEnv('ACCOUNT_PLAN_V2', c.v2 ? '1' : ''); vi.stubEnv('APP_DELETE_CANCELS_WEB', c.cancels ? '1' : '');
  vi.stubEnv('WEB_APP_ENTITLEMENTS', c.ent ? '1' : ''); vi.stubEnv('ACCOUNT_DRAFTS_IOS', c.drafts ? 'all' : '');
};

describe('delete account: every kind x switch with a 1.2 build ends deleted, and never with a live card plan left billing', () => {
  for (const kind of KINDS) for (const c of combos) {
    it(`${kind} ${JSON.stringify(c)}`, async () => {
      st.kind = kind; setEnv(c);
      // The app: try the Apple route; on 409 use-account-delete use the account route.
      let r = await post(iosDelete, true);
      let route = 'ios';
      if (r.code === 409 && r.body?.error === 'use-account-delete') { r = await post(webDelete, true); route = 'web'; }
      expect(r.code, `${route} ${JSON.stringify(r.body)}`).toBe(200);
      expect(st.deleted).toBe(1);
      const hasCard = kind === 'web' || kind === 'mixed';
      // With ACCOUNT_PLAN_V2 on the guarantee holds. With every new switch off the Apple route is exactly today's (it cancels only with APP_DELETE_CANCELS_WEB=1): switches off = today.
      if (hasCard && c.v2) expect(st.cancelled, 'a web or two-site account is never deleted with its card plan still billing').toBe(true);
      if (hasCard && !c.v2) expect(st.cancelled).toBe(c.cancels);
      // The 409 only ever points at an account route that exists.
      if (route === 'web') expect(c.ent).toBe(true);
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

describe('take offline: every kind x switch with a 1.2 build ends offline', () => {
  for (const kind of KINDS) for (const c of combos) {
    it(`${kind} ${JSON.stringify(c)}`, async () => {
      st.kind = kind; setEnv(c);
      let r = await post(iosTakeOffline, true);
      let route = 'ios';
      if (r.code === 409 && r.body?.error === 'use-account-take-offline') { r = await post(webTakeOffline, true); route = 'web'; }
      expect(r.code, `${route} ${JSON.stringify(r.body)}`).toBe(200);
      expect(st.tookOffline).toBe(1);
      if (route === 'web') expect(c.ent).toBe(true);
    });
  }
  it('header-less calls never get a 409 on the Apple route', async () => {
    for (const kind of KINDS) for (const c of combos) { st.kind = kind; setEnv(c); expect((await post(iosTakeOffline, false)).code).toBe(200); }
  });
});
