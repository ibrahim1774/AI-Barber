import { afterEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({ kind: 'web', kindFails: false }));
vi.mock('../../lib/webApp/webAppServer.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/webApp/webAppServer.js')>()),
  webAppCors: () => false, webAppCheckoutOn: () => process.env.WEB_APP_CHECKOUT === '1',
  callerFrom: async () => ({ id: 'u1', email: 'o@x.co' }),
}));
vi.mock('../../lib/account/kind.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/account/kind.js')>()),
  accountKind: async () => { if (st.kindFails) throw new Error('db'); return st.kind; },
}));

import handler from '../../api/account/kept-copy.js';
import { keptCopiesInUse, liveKeptStore } from '../../lib/account/keptCopy.js';
import { runAccountMaintenance, runDaily } from '../../lib/account/maintenance.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };
const post = async () => { const r = res(); await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { kind: 'phone-draft', siteData: { a: 1 } } }, r); return r; };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const on = (extra: Record<string, string> = {}) => { for (const [k, v] of Object.entries({ WEB_APP_CHECKOUT: '1', WEB_APP_RELIABILITY: '1', STRIPE_WEBAPP_SECRET_KEY: 'sk_test_x', SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'k', ...extra })) vi.stubEnv(k, v); };

describe('POST /api/account/kept-copy outside the rollout', () => {
  it('403 not-account-mode for web-only, apple, mixed and neither; 503 when the mode cannot be decided; nothing stored', async () => {
    const fetchSpy = vi.fn(async () => new Response('[]', { status: 200 })); vi.stubGlobal('fetch', fetchSpy);
    on(); // ACCOUNT_DRAFTS_IOS off
    st.kind = 'web'; expect((await post()).code).toBe(403);
    on({ ACCOUNT_DRAFTS_IOS: 'all' });
    for (const k of ['apple', 'mixed', 'neither']) { st.kind = k; const r = await post(); expect(r.code).toBe(403); expect(r.body).toEqual({ error: 'not-account-mode' }); }
    vi.spyOn(console, 'error').mockImplementation(() => {});
    st.kind = 'web'; st.kindFails = true; expect((await post()).code).toBe(503); st.kindFails = false;
    expect((fetchSpy.mock.calls as any[][]).filter((c) => String(c[0]).includes('site_kept_copies'))).toHaveLength(0);
  });
  it('an account-mode caller stores a copy with environment Production/Sandbox, never live/test', async () => {
    const sent: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: any) => { if (init?.method === 'POST' && String(u).includes('site_kept_copies')) sent.push(JSON.parse(init.body)); return new Response('[]', { status: 200 }); }));
    on({ ACCOUNT_DRAFTS_IOS: 'all' }); st.kind = 'web';
    expect((await post()).code).toBe(200);
    expect(sent[0].environment).toBe('Sandbox'); // sk_test key
  });
});

describe('the daily expiry', () => {
  const claims = () => ({ claim: vi.fn(async () => true), release: vi.fn(async () => {}) });
  it('keptCopiesInUse needs the endpoint gate AND a rollout switch that is not off', () => {
    expect(keptCopiesInUse({})).toBe(false);
    expect(keptCopiesInUse({ WEB_APP_CHECKOUT: '1', WEB_APP_RELIABILITY: '1' })).toBe(false);
    expect(keptCopiesInUse({ WEB_APP_CHECKOUT: '1', ACCOUNT_DRAFTS_IOS: 'all' })).toBe(false);
    expect(keptCopiesInUse({ WEB_APP_CHECKOUT: '1', WEB_APP_RELIABILITY: '1', ACCOUNT_DRAFTS_IOS: 'allowlist' })).toBe(true);
  });
  it('gated off: nothing is claimed, read or deleted', async () => {
    const m = claims();
    const kept = { has: vi.fn(), trim: vi.fn(), insert: vi.fn(), renew: vi.fn(), expire: vi.fn() };
    vi.stubEnv('WEB_APP_CHECKOUT', ''); 
    expect(await runAccountMaintenance(Date.now(), { mode: 'off', maintenance: m, kept: undefined })).toBeNull();
    expect(m.claim).not.toHaveBeenCalled();
    expect(kept.expire).not.toHaveBeenCalled();
  });
  it('the live delete never pulls site_data back (Prefer: return=minimal)', async () => {
    const seen: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: any) => { seen.push({ u, init }); return new Response(null, { status: 200 }); }));
    on();
    await liveKeptStore().expire('2026-11-18T00:00:00.000Z', 'Sandbox');
    expect(seen[0].u).toMatch(/environment=eq.Sandbox/);
    expect(seen[0].init.method).toBe('DELETE');
    expect(seen[0].init.headers.Prefer).toBe('return=minimal');
    expect(seen[0].u).not.toMatch(/select=/);
  });
  it('a missing table inside the task is no-table and the claim is NOT given back', async () => {
    const m = claims();
    const r = await runDaily('x', async () => { throw Object.assign(new Error('404'), { status: 404 }); }, Date.now(), m);
    expect(r).toEqual({ ran: false, reason: 'no-table' });
    expect(m.release).not.toHaveBeenCalled();
  });
  it('a failing task is contained: runDaily and runAccountMaintenance never throw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const m = claims();
    const kept = { has: vi.fn(), trim: vi.fn(), insert: vi.fn(), renew: vi.fn(), expire: vi.fn(async () => { throw new Error('boom'); }) };
    await expect(runAccountMaintenance(Date.now(), { mode: 'off', maintenance: m, kept: kept as any, env: 'Production' })).resolves.toMatchObject({ expiredKeptCopies: { ran: false, reason: 'error' } });
  });
});
