// Take offline and delete account on the web routes: native callers by site mode; browsers unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const st = vi.hoisted(() => ({ removeThrows: null as Error | null, kind: 'web', kindFails: false, kindCalls: 0, removed: 0, deleted: 0 }));
vi.mock('../../lib/webApp/webAppServer.js', async (orig) => ({ ...(await orig<typeof import('../../lib/webApp/webAppServer.js')>()), webAppCors: () => false, webAppEntitlementsOn: () => true, callerFrom: async () => ({ id: 'u1', email: 'a@b.co' }) }));
vi.mock('../../lib/webApp/deleteAccount.js', () => ({ removeWebSitesOf: async () => { if (st.removeThrows) throw st.removeThrows; st.removed++; return 1; }, liveWebDeleteDeps: () => ({}) }));
vi.mock('../../lib/ios/deleteAccount.js', () => ({ deleteAccount: async () => { st.deleted++; return { status: 200, body: { ok: true } }; } }));
vi.mock('../../lib/webApp/reliability.js', () => ({ resumeAfterFailedDelete: async () => {}, reliabilityOn: () => process.env.WEB_APP_RELIABILITY === '1' }));
vi.mock('../../lib/account/kind.js', async (orig) => ({ ...(await orig<typeof import('../../lib/account/kind.js')>()), accountKind: async () => { st.kindCalls++; if (st.kindFails) throw new Error('db'); return st.kind; } }));
import takeOffline from '../../api/web-app/take-offline.js';
import del from '../../api/web-app/delete-account.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };
const call = async (h: any, headers: any = {}) => { const r = res(); await h({ method: 'POST', headers: { authorization: 'Bearer t', ...headers } }, r); return r; };
const HDR = { 'x-pb-build': '57' };
beforeEach(() => { vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); vi.stubEnv('WEB_APP_RELIABILITY', '1'); Object.assign(st, { kind: 'web', kindFails: false, kindCalls: 0, removed: 0, deleted: 0 }); });
afterEach(() => vi.unstubAllEnvs());

describe('/api/web-app/take-offline', () => {
  it('found today: no gate at all. Now a native caller needs a web account: account and web-only mode (web-only with keepContent too); device is 403 not-account-mode', async () => {
    vi.stubEnv('ACCOUNT_DRAFTS_IOS', 'all');
    expect((await call(takeOffline, HDR)).code).toBe(200);
    vi.stubEnv('ACCOUNT_DRAFTS_IOS', ''); st.kind = 'web';
    expect((await call(takeOffline, HDR)).code).toBe(200); // web-only
    st.kind = 'apple'; const d = await call(takeOffline, HDR); expect([d.code, d.body]).toEqual([403, { error: 'not-account-mode' }]);
    expect(st.removed).toBe(2);
  });
  it('a lookup failure for a native caller is 503; a browser is never asked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    st.kindFails = true; expect((await call(takeOffline, HDR)).code).toBe(503);
    st.kindCalls = 0; expect((await call(takeOffline)).code).toBe(200);
    expect(st.kindCalls).toBe(0);
  });
});

describe('keep-content take offline without the draft engine', () => {
  it('works (no 503): a native caller is served in both modes; the browser is unchanged', async () => {
    vi.stubEnv('WEB_APP_RELIABILITY', '');
    vi.stubEnv('ACCOUNT_DRAFTS_IOS', 'all'); expect((await call(takeOffline, HDR)).code).toBe(200);
    vi.stubEnv('ACCOUNT_DRAFTS_IOS', ''); expect((await call(takeOffline, HDR)).code).toBe(200); // web-only
    expect((await call(takeOffline)).code).toBe(200);
    expect(st.removed).toBe(3);
  });
});

describe('/api/web-app/delete-account', () => {
  it('a native web account (account or web-only) may delete; a device caller is refused 403 (it uses /api/ios/delete-account)', async () => {
    vi.stubEnv('ACCOUNT_DRAFTS_IOS', 'all');
    expect((await call(del, HDR)).code).toBe(200);
    vi.stubEnv('ACCOUNT_DRAFTS_IOS', ''); // web-only
    expect((await call(del, HDR)).code).toBe(200);
    for (const k of ['apple', 'mixed', 'neither']) { st.kind = k; const r = await call(del, HDR); expect([r.code, r.body]).toEqual([403, { error: 'not-account-mode' }]); }
    expect(st.deleted).toBe(2);
  });
  it('a browser (no header) is unchanged and never asked; a lookup failure for a native caller is 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    st.kind = 'apple';
    expect((await call(del)).code).toBe(200);
    expect(st.kindCalls).toBe(0);
    st.kindFails = true; expect((await call(del, HDR)).code).toBe(503);
    expect(st.deleted).toBe(1);
  });
});

describe('publish in progress and the kept phone number', () => {
  it('a native caller gets 409 publish-in-progress; the browser keeps its 500 remove-failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    st.removeThrows = new Error('publish-in-progress');
    vi.stubEnv('ACCOUNT_DRAFTS_IOS', 'all');
    const n = await call(takeOffline, HDR);
    expect([n.code, n.body]).toEqual([409, { error: 'publish-in-progress' }]);
    const b = await call(takeOffline);
    expect([b.code, b.body]).toEqual([500, { error: 'remove-failed' }]);
    st.removeThrows = null;
  });
});
