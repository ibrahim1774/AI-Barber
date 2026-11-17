// POST /api/web-app/publish, /api/ios/publish and /api/ios/site with and without X-PB-Build.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({ callerCalls: 0, kind: 'web', kindFails: false, kindCalls: 0, prepare: [] as any[], runWeb: [] as any[], iosPublish: [] as any[], iosSite: [] as any[] }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  webAppEntitlementsOn: () => true,
  callerFrom: async () => { st.callerCalls++; return { id: 'u1', email: 'o@example.com' }; },
  sbRest: async (path: string) => (path.startsWith('web_app_publish_intents') ? [{ status: 'live', result: { body: { siteId: 's' } } }] : [{ stripe_subscription_id: 'sub_1' }]),
}));
vi.mock('../../lib/bookings/rateLimit.js', () => ({ clientIp: () => '1.1.1.1', iosLimiter: { allow: async () => true } }));
vi.mock('../../lib/webApp/publishFlow.js', () => ({ liveWebPublishDeps: () => ({}), runWebPublish: async (...a: any[]) => { st.runWeb.push(a); return { status: 200, body: { siteId: 'web' } }; } }));
vi.mock('../../lib/webApp/reliability.js', () => ({
  reliabilityOn: () => process.env.WEB_APP_RELIABILITY === '1', modeOf: () => 'test', enc: encodeURIComponent,
  readDraft: async () => ({ draft_id: 'd1', revision: 2, site_data: { shopName: 'X', bookingUrl: '/book', staff: [] } }),
  prepareIntent: async (...a: any[]) => { st.prepare.push(a); return { id: 'job1' }; },
}));
vi.mock('../../lib/webApp/publishJobs.js', () => ({ runJob: async () => {}, dispatchJob: () => {} }));
vi.mock('../../lib/webApp/priceGroup.js', () => ({ entitlementOrFree: async () => null, isFreeSubscriptionId: () => false }));
vi.mock('../../lib/webApp/contactPhoneLive.js', () => ({ savedPhoneState: async () => ({ phone: '1', contactsOk: true }) }));
vi.mock('../../lib/account/nativePublish.js', () => ({ bookingInputsFrom: () => ({}), nativePublication: async () => ({ bookingUrl: '/book', staff: [{ name: 'Server' }] }) }));
vi.mock('../../lib/account/kind.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/account/kind.js')>()),
  accountKind: async () => { st.kindCalls++; if (st.kindFails) throw new Error('db'); return st.kind; },
}));
vi.mock('../../lib/ios/publishFlow.js', () => ({
  liveDeps: () => ({}), liveUserOf: async () => ({ id: 'u1' }),
  runIosPublish: async (...a: any[]) => { st.iosPublish.push(a); return { status: 200, body: { siteId: 'ios' } }; },
  runIosSiteLookup: async (...a: any[]) => { st.iosSite.push(a); return { status: 200, body: { siteId: 'ios' } }; },
}));

import webPublish from '../../api/web-app/publish.js';
import iosPublish from '../../api/ios/publish.js';
import iosSite from '../../api/ios/site.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };
const call = async (h: any, headers: any, body: any, method = 'POST') => { const r = res(); await h({ method, headers: { authorization: 'Bearer t', ...headers }, body }, r); return r; };
const STATES: Record<string, Record<string, string>> = { off: {}, allowlist: { ACCOUNT_DRAFTS_IOS: 'allowlist', ACCOUNT_DRAFTS_IOS_USERS: 'u1' }, all: { ACCOUNT_DRAFTS_IOS: 'all' } };
const HDR = { 'x-pb-build': '57' };
const siteData = { shopName: 'X' };
const drafted = { draftId: 'd1', revision: 2, siteData: { shopName: 'browser', bookingUrl: 'https://own.example', staff: [{ name: 'Phone' }] } };

beforeEach(() => {
  vi.unstubAllEnvs(); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
  Object.assign(st, { callerCalls: 0, kind: 'web', kindFails: false, kindCalls: 0, prepare: [], runWeb: [], iosPublish: [], iosSite: [] });
});
afterEach(() => vi.unstubAllEnvs());
const setEnv = (e: Record<string, string>) => { vi.unstubAllEnvs(); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); for (const [k, v] of Object.entries(e)) vi.stubEnv(k, v); };

describe('requests without X-PB-Build are unchanged in every switch state', () => {
  it('web publish (plain and drafted): identical outcomes and what reaches prepareIntent; the kind is never read', async () => {
    const seen: string[] = [];
    for (const env of Object.values(STATES)) {
      setEnv({ ...env, WEB_APP_RELIABILITY: '1' });
      st.prepare = []; st.runWeb = []; st.callerCalls = 0;
      const a = await call(webPublish, {}, drafted);
      const b = await call(webPublish, {}, { siteData });
      seen.push(JSON.stringify([a.code, a.body, b.code, b.body, st.prepare.map((p) => p[5]), st.callerCalls]));
    }
    expect(new Set(seen).size).toBe(1);
    expect(st.kindCalls).toBe(0);
  });
  it('ios publish and site: the flow runs, the kind is never read, no extra lookup', async () => {
    for (const env of Object.values(STATES)) {
      setEnv(env);
      expect((await call(iosPublish, { 'x-forwarded-for': '1' }, { transactionId: '1', siteData })).code).toBe(200);
      expect((await call(iosSite, {}, { transactionId: '1' })).code).toBe(200);
    }
    expect(st.kindCalls).toBe(0);
    expect(st.iosPublish).toHaveLength(3); expect(st.iosSite).toHaveLength(3);
  });
});

describe('native callers on the web publish', () => {
  it('web-only (switch off): 403 not-account-mode before anything runs', async () => {
    setEnv({ WEB_APP_RELIABILITY: '1' });
    const r = await call(webPublish, HDR, drafted);
    expect(r.code).toBe(403); expect(r.body).toEqual({ error: 'not-account-mode' });
    expect(st.prepare).toHaveLength(0); expect(st.runWeb).toHaveLength(0);
  });
  it('account mode, drafted: the server\'s links and team go to prepareIntent, not the phone\'s', async () => {
    setEnv({ WEB_APP_RELIABILITY: '1', ACCOUNT_DRAFTS_IOS: 'all' });
    const r = await call(webPublish, HDR, drafted);
    expect(r.code).toBe(200);
    expect(st.prepare[0][5]).toEqual({ bookingUrl: '/book', staff: [{ name: 'Server' }] });
  });
  it('a browser drafted publish still passes its own siteData (links and team from the browser)', async () => {
    setEnv({ WEB_APP_RELIABILITY: '1', ACCOUNT_DRAFTS_IOS: 'all' });
    await call(webPublish, {}, drafted);
    expect(st.prepare[0][5]).toEqual(drafted.siteData);
  });
  it('a native call with no draft id never reaches runWebPublish: 409 use-drafted-publish with the draft engine on, 503 with it off', async () => {
    setEnv({ WEB_APP_RELIABILITY: '1', ACCOUNT_DRAFTS_IOS: 'all' });
    const r = await call(webPublish, HDR, { siteData });
    expect(r.code).toBe(409); expect(r.body).toEqual({ error: 'use-drafted-publish' });
    setEnv({ WEB_APP_RELIABILITY: '', ACCOUNT_DRAFTS_IOS: 'all' });
    const off = await call(webPublish, HDR, { siteData });
    expect(off.code).toBe(503); expect(off.body).toEqual({ error: 'temporarily-unavailable' });
    expect((await call(webPublish, HDR, drafted)).code).toBe(503);
    expect(st.runWeb).toHaveLength(0);
  });
  it('a stale revision is 409 and nothing is prepared', async () => {
    setEnv({ WEB_APP_RELIABILITY: '1', ACCOUNT_DRAFTS_IOS: 'all' });
    const r = await call(webPublish, HDR, { ...drafted, revision: 1 });
    expect(r.code).toBe(409);
    expect(st.prepare).toHaveLength(0);
  });
  it('a lookup failure is 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setEnv({ WEB_APP_RELIABILITY: '1', ACCOUNT_DRAFTS_IOS: 'all' }); st.kindFails = true;
    expect((await call(webPublish, HDR, drafted)).code).toBe(503);
    expect(st.prepare).toHaveLength(0);
  });
});

describe('item 5: the old routes refuse a native account-mode caller only', () => {
  it('native + account mode: 409 use-account-publish on publish and Restore, the flow never runs', async () => {
    setEnv({ ACCOUNT_DRAFTS_IOS: 'all' });
    for (const [h, b] of [[iosPublish, { transactionId: '1', siteData }], [iosSite, { transactionId: '1' }]] as const) {
      const r = await call(h as any, HDR, b);
      expect(r.code).toBe(409); expect(r.body).toEqual({ error: 'use-account-publish' });
    }
    expect(st.iosPublish).toHaveLength(0); expect(st.iosSite).toHaveLength(0);
  });
  it('native + apple/neither: the old route answers as before', async () => {
    setEnv({ ACCOUNT_DRAFTS_IOS: 'all' }); st.kind = 'apple';
    expect((await call(iosPublish, HDR, { transactionId: '1', siteData })).code).toBe(200);
    st.kind = 'neither';
    expect((await call(iosSite, HDR, { transactionId: '1' })).code).toBe(200);
  });
  it('native + web-only (switch off, kind web): the old routes answer 409 use-account-publish too', async () => {
    setEnv({}); st.kind = 'web';
    for (const [h, b] of [[iosPublish, { transactionId: '1', siteData }], [iosSite, { transactionId: '1' }]] as const) {
      const r = await call(h as any, HDR, b);
      expect(r.code).toBe(409); expect(r.body).toEqual({ error: 'use-account-publish' });
    }
  });
  it('a lookup failure for a native caller is 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setEnv({ ACCOUNT_DRAFTS_IOS: 'all' }); st.kindFails = true;
    expect((await call(iosPublish, HDR, { transactionId: '1', siteData })).code).toBe(503);
  });
});
