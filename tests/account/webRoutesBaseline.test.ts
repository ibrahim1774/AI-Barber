// The browser's web routes (POST /api/web-app/delete-account and /api/web-app/take-offline) with every new switch off: behaviourally identical to live main (origin/main ffa87cdf).
// The snapshot was generated from ffa87cdf in a temporary worktree and diffed against this branch (0 differing worlds). The fakes sit at the database, Stripe and storage boundaries:
// every Stripe call, every database call (with the keys it writes) and every response is recorded; deleteAccount, liveWebDeleteDeps, removeWebSitesOf and both handlers are the REAL code.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const w = vi.hoisted(() => ({
  card: false, site: false, domainSub: false, firstTime: false, openSession: false, priceGroup: false, stripeDown: false, sessionsDown: false, publishInProgress: false, badToken: false, dbDown: false,
  log: [] as string[],
}));
const L = (s: string) => w.log.push(s);
vi.mock('../../lib/webApp/webAppServer.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/webApp/webAppServer.js')>()),
  webAppCors: () => false, webAppEntitlementsOn: () => process.env.WEB_APP_ENTITLEMENTS === '1',
  callerFrom: async () => (w.badToken ? null : { id: 'u1', email: 'a@b.co' }),
  stripeCall: vi.fn(async (path: string, _b: unknown, method = 'POST') => {
    L(`stripe ${method} ${path.replace(/\?.*/, '')}`);
    if (w.stripeDown) throw new Error('stripe down');
    if (path.startsWith('checkout/sessions?')) {
      if (w.sessionsDown) throw new Error('stripe sessions down');
      const data: any[] = [];
      if (w.firstTime) data.push({ id: 'cs_done', status: 'complete', customer: 'cus_ft', metadata: { app: 'aibarber-app', user_id: 'u1' } });
      if (w.openSession) data.push({ id: 'cs_open', status: 'open', metadata: { app: 'aibarber-app', user_id: 'u1' } });
      return { data };
    }
    if (path.startsWith('subscriptions?customer=')) {
      const c = path.split('customer=')[1].split('&')[0];
      const data: any[] = [];
      if (c === 'cus_1' && w.domainSub) data.push({ id: 'sub_dom', status: 'active', metadata: { type: 'domain_purchase', app: 'aibarber-domain' } });
      if (c === 'cus_ft') data.push({ id: 'sub_ft', status: 'active', metadata: { app: 'aibarber-app' } });
      return { data };
    }
    if (path.startsWith('subscriptions/') && method === 'GET') return { status: 'canceled' };
    return {};
  }),
  sbRest: vi.fn(async (path: string, init: any = {}) => {
    const [table, qs = ''] = path.split('?');
    const method = init.method || 'GET';
    L(`db ${method} ${table}${method === 'GET' ? '' : ` {${Object.keys(init.body ?? {}).filter((k) => k !== 'updated_at').sort().join(',')}}`}${qs.includes('environment=') ? ' env' : ''}`);
    if (w.dbDown && method === 'GET' && table === 'web_app_customers') throw new Error('supabase 500');
    if (method !== 'GET') return [];
    if (table === 'web_app_sites') return w.site ? [{ slug: 'web-site', stripe_subscription_id: 'sub_1', environment: 'live', published_at: 'x', removed_at: null, taken_down_at: null }] : [];
    if (table === 'web_app_entitlements') return w.card ? [{ stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', status: 'active', environment: 'live' }] : [];
    if (table === 'web_app_customers') return w.card ? [{ stripe_customer_id: 'cus_1' }] : [];
    if (table === 'web_app_price_groups') return w.priceGroup ? [{ user_id: 'u1' }] : [];
    return [];
  }),
}));
vi.mock('../../lib/ios/deleteAccount.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/ios/deleteAccount.js')>()),
  liveDeleteDeps: () => ({
    getUser: async () => (w.badToken ? null : { id: 'u1' }),
    closeShop: async () => { L('closeShop'); return { ok: true, bookingsCancelled: 0, ordersCancelled: 0, needsRefund: [], notCancelled: [] }; },
    listSites: async () => [],
    takeDown: async (s: any) => { L(`takeDown ${s.site_slug}`); }, purge: async (s: any) => { L(`purge ${s.site_slug}`); },
    deleteSites: async () => { L('deleteSites'); }, deleteUser: async () => { L('deleteUser'); },
  }),
}));
vi.mock('../../lib/ios/removeSiteLive.js', () => ({
  liveRemoveDeps: () => ({
    releaseDomains: async (s: string) => L(`releaseDomains ${s}`), clearSiteBase: async (s: string) => L(`clearSiteBase ${s}`),
    deleteContent: async (s: string) => L(`deleteContent ${s}`), deployOffline: async (s: string) => L(`deployOffline ${s}`),
    markRemoved: async () => L('markRemoved'), markTakenDown: async () => L('markTakenDown'), now: () => 1,
  }),
  liveDeleteAccountRows: async () => {},
}));
vi.mock('../../lib/webApp/reliability.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/webApp/reliability.js')>()),
  suspendWork: async (_u: string, why?: string) => { L(`suspendWork ${why ?? ''}`); if (w.publishInProgress) throw new Error('publish-in-progress'); },
  markSiteOffline: async () => L('markSiteOffline'), resumeAfterFailedDelete: async () => L('resumeAfterFailedDelete'), forgetLiveAddress: async () => L('forgetLiveAddress'),
  reliabilityOn: () => process.env.WEB_APP_RELIABILITY === '1',
}));
vi.mock('../../lib/webApp/userExists.js', () => ({ emailOfUser: async () => 'a@example.com' }));
vi.mock('../../lib/webApp/emails.js', async (orig) => ({ ...(await orig<typeof import('../../lib/webApp/emails.js')>()), alertOwner: async () => L('alertOwner') }));
vi.mock('../../lib/webApp/checkoutSessions.js', () => ({ storedSessionId: async () => null, forgetSession: async () => L('forgetSession') }));

import webDelete from '../../api/web-app/delete-account.js';
import webTakeOffline from '../../api/web-app/take-offline.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };
const call = async (h: any, header: string | null) => { const r = res(); await h({ method: 'POST', headers: { authorization: 'Bearer t', ...(header ? { 'x-pb-build': header } : {}) }, body: {} }, r); return { code: r.code, body: r.body, log: [...w.log] }; };
const reset = () => { Object.assign(w, { card: false, site: false, domainSub: false, firstTime: false, openSession: false, priceGroup: false, stripeDown: false, sessionsDown: false, publishInProgress: false, badToken: false, dbDown: false, log: [] }); };
beforeEach(() => { reset(); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_x'); vi.stubEnv('WEB_APP_ENTITLEMENTS', '1'); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const bools = [false, true];

describe('the browser web routes with every new switch off match live main (ffa87cdf)', () => {
  it('POST /api/web-app/delete-account: every world, as recorded from main', async () => {
    const out: Record<string, unknown> = {};
    for (const card of bools) for (const site of bools) for (const domainSub of bools) for (const firstTime of bools) for (const openSession of bools) for (const priceGroup of bools)
      for (const fail of ['none', 'stripe', 'sessions', 'db', 'publish', 'token']) {
        reset(); Object.assign(w, { card, site, domainSub, firstTime, openSession, priceGroup });
        if (fail === 'stripe') w.stripeDown = true; if (fail === 'sessions') w.sessionsDown = true; if (fail === 'db') w.dbDown = true; if (fail === 'publish') w.publishInProgress = true; if (fail === 'token') w.badToken = true;
        out[`card=${card} site=${site} domainSub=${domainSub} firstTime=${firstTime} open=${openSession} pg=${priceGroup} fail=${fail}`] = await call(webDelete, null);
      }
    expect(out).toMatchSnapshot();
  });
  it('POST /api/web-app/take-offline: every world x WEB_APP_RELIABILITY, as recorded from main', async () => {
    const out: Record<string, unknown> = {};
    for (const card of bools) for (const site of bools) for (const safe of [false]) for (const rel of bools) for (const fail of ['none', 'publish', 'token']) { // (SAFE_TAKE_OFFLINE=1 is a new switch: its own tests)
      reset(); Object.assign(w, { card, site });
      if (fail === 'publish') w.publishInProgress = true; if (fail === 'token') w.badToken = true;
      vi.stubEnv('SAFE_TAKE_OFFLINE', safe ? '1' : ''); vi.stubEnv('WEB_APP_RELIABILITY', rel ? '1' : '');
      out[`card=${card} site=${site} safe=${safe} rel=${rel} fail=${fail}`] = await call(webTakeOffline, null);
    }
    expect(out).toMatchSnapshot();
  });
  it('POST /api/web-app/delete-account with X-PB-Build and ACCOUNT_PLAN_V2 off is exactly the no-header (browser) result, in every world (asserted, not snapshotted)', async () => {
    vi.stubEnv('ACCOUNT_PLAN_V2', '');
    for (const card of bools) for (const site of bools) for (const domainSub of bools) for (const fail of ['none', 'stripe', 'publish', 'token']) {
      const run = async (header: string | null) => {
        reset(); Object.assign(w, { card, site, domainSub });
        if (fail === 'stripe') w.stripeDown = true; if (fail === 'publish') w.publishInProgress = true; if (fail === 'token') w.badToken = true;
        return call(webDelete, header);
      };
      expect(await run('57'), `card=${card} site=${site} domainSub=${domainSub} fail=${fail}`).toEqual(await run(null));
    }
  });
});
