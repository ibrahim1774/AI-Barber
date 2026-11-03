import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const caller = vi.hoisted(() => ({ user: { id: 'u1', email: 'a@example.com' } as any }));
vi.mock('../../lib/webApp/webAppServer.js', async (orig) => ({ ...(await orig<any>()), callerFrom: async () => caller.user }));

import handler, { COOKIE_MAX_AGE } from '../../api/web-app/session.js';

const ORIGIN = 'https://www.primebarber.org';
function res() {
  const r: any = { code: 0, body: undefined, headers: {} as Record<string, string> };
  r.status = (c: number) => { r.code = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.end = () => r;
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  return r;
}
const call = async (req: any) => { const r = res(); await handler({ headers: {}, ...req }, r); return r; };
const supa = (status: number, body: any = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
const session = (rt: string, uid = 'u1') => ({ access_token: 'at-' + rt, refresh_token: rt, expires_in: 3600, user: { id: uid } });

let n = 0;
beforeEach(() => {
  vi.stubEnv('WEB_APP_CHECKOUT', '1'); vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc');
  caller.user = { id: 'u1', email: 'a@example.com' };
  n += 1; // a distinct client ip per test keeps the in-memory rate limiter from leaking between tests
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const ip = () => ({ 'x-real-ip': `10.0.0.${n}` });

describe('POST /api/web-app/session', () => {
  const post = (extra: any = {}) => call({ method: 'POST', headers: { origin: ORIGIN, authorization: 'Bearer at', ...ip() }, body: { refresh_token: 'rt-old' }, ...extra });

  it('rotates once, stores the NEW token in a locked-down cookie and returns the new session', async () => {
    const f = supa(200, session('rt-new')); vi.stubGlobal('fetch', f);
    const r = await post();
    expect(r.code).toBe(200);
    expect(r.body).toMatchObject({ access_token: 'at-rt-new', refresh_token: 'rt-new' });
    expect(r.body.user).toBeUndefined();
    const c = r.headers['Set-Cookie'];
    expect(c).toContain('pb_rt=rt-new');
    for (const a of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/api/web-app/session', `Max-Age=${COOKIE_MAX_AGE}`]) expect(c).toContain(a);
    expect(COOKIE_MAX_AGE).toBe(400 * 86400);
    expect(r.headers['Cache-Control']).toBe('no-store');
    expect(r.headers['Access-Control-Allow-Origin']).toBe(ORIGIN);
    expect(r.headers['Access-Control-Allow-Credentials']).toBe('true');
    expect(f).toHaveBeenCalledTimes(1);
    expect(String((f.mock.calls[0] as any[])[0])).toContain('grant_type=refresh_token');
  });
  it('rejects a refresh token that belongs to another user', async () => {
    vi.stubGlobal('fetch', supa(200, session('rt-new', 'someone-else')));
    const r = await post();
    expect(r.code).toBe(401);
    expect(r.headers['Set-Cookie']).toBeUndefined();
  });
  it('401 without a valid access token, and never reaches Supabase refresh', async () => {
    const f = supa(200, session('x')); vi.stubGlobal('fetch', f); caller.user = null;
    const r = await post();
    expect(r.code).toBe(401); expect(f).not.toHaveBeenCalled();
  });
  it('400 on a missing refresh token', async () => {
    const r = await post({ body: {} });
    expect(r.code).toBe(400);
  });
  it('a revoked refresh token is 401 and sets no cookie', async () => {
    vi.stubGlobal('fetch', supa(400, { error: 'invalid_grant' }));
    const r = await post();
    expect(r.code).toBe(401); expect(r.headers['Set-Cookie']).toBeUndefined();
  });
  it('403 for a foreign or missing Origin (CSRF guard)', async () => {
    vi.stubGlobal('fetch', supa(200, session('x')));
    expect((await post({ headers: { origin: 'https://evil.example', authorization: 'Bearer at', ...ip() } })).code).toBe(403);
    expect((await post({ headers: { authorization: 'Bearer at', ...ip() } })).code).toBe(403);
  });
  it('is rate limited', async () => {
    vi.stubGlobal('fetch', supa(200, session('x')));
    let last: any;
    for (let i = 0; i < 31; i++) last = await post();
    expect(last.code).toBe(429);
  });
  it('is off when the web app is off', async () => {
    vi.stubEnv('WEB_APP_CHECKOUT', '0');
    expect((await post()).code).toBe(404);
  });
});

describe('GET /api/web-app/session (restore)', () => {
  const get = (cookie: string | undefined, extra: any = {}) => call({ method: 'GET', headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}), ...ip() }, ...extra });

  it('exchanges the cookie for a fresh session and re-sets the rotated cookie', async () => {
    const f = supa(200, session('rt-2')); vi.stubGlobal('fetch', f);
    const r = await get('other=1; pb_rt=rt-1; x=y');
    expect(r.code).toBe(200);
    expect(r.body).toMatchObject({ access_token: 'at-rt-2', refresh_token: 'rt-2' });
    expect(JSON.parse((f.mock.calls[0] as any[])[1].body)).toEqual({ refresh_token: 'rt-1' });
    expect(r.headers['Set-Cookie']).toContain('pb_rt=rt-2');
    expect(r.headers['Set-Cookie']).toContain('HttpOnly');
    expect(r.headers['Cache-Control']).toBe('no-store');
  });
  it('401 with no cookie', async () => {
    const f = supa(200, session('x')); vi.stubGlobal('fetch', f);
    const r = await get(undefined);
    expect(r.code).toBe(401); expect(f).not.toHaveBeenCalled();
  });
  it('clears the cookie when Supabase rejects the token', async () => {
    vi.stubGlobal('fetch', supa(400, { error: 'invalid_grant' }));
    const r = await get('pb_rt=dead');
    expect(r.code).toBe(401);
    expect(r.headers['Set-Cookie']).toContain('pb_rt=;');
    expect(r.headers['Set-Cookie']).toContain('Max-Age=0');
  });
  it('keeps the cookie through a Supabase outage', async () => {
    vi.stubGlobal('fetch', supa(503));
    const r = await get('pb_rt=alive');
    expect(r.code).toBe(502); expect(r.headers['Set-Cookie']).toBeUndefined();
  });
  it('403 when a foreign Origin is sent, and no CORS headers are granted to it', async () => {
    const f = supa(200, session('x')); vi.stubGlobal('fetch', f);
    const r = await get('pb_rt=rt-1', { headers: { origin: 'https://evil.example', cookie: 'pb_rt=rt-1', ...ip() } });
    expect(r.code).toBe(403); expect(f).not.toHaveBeenCalled();
    expect(r.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });
  it('allows a same-origin GET without an Origin header', async () => {
    vi.stubGlobal('fetch', supa(200, session('rt-2')));
    const r = await call({ method: 'GET', headers: { cookie: 'pb_rt=rt-1', ...ip() } });
    expect(r.code).toBe(200);
  });
});

describe('DELETE /api/web-app/session', () => {
  it('clears the cookie', async () => {
    const r = await call({ method: 'DELETE', headers: { origin: ORIGIN, ...ip() } });
    expect(r.code).toBe(204);
    expect(r.headers['Set-Cookie']).toMatch(/^pb_rt=; HttpOnly; Secure; SameSite=Lax; Path=\/api\/web-app\/session; Max-Age=0$/);
  });
  it('403 from a foreign origin or with none', async () => {
    expect((await call({ method: 'DELETE', headers: { origin: 'https://evil.example', ...ip() } })).code).toBe(403);
    expect((await call({ method: 'DELETE', headers: { ...ip() } })).code).toBe(403);
  });
  it('answers the preflight for allowed origins only', async () => {
    const r = await call({ method: 'OPTIONS', headers: { origin: ORIGIN, ...ip() } });
    expect(r.code).toBe(204); expect(r.headers['Access-Control-Allow-Methods']).toContain('DELETE');
    const bad = await call({ method: 'OPTIONS', headers: { origin: 'https://evil.example', ...ip() } });
    expect(bad.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });
});
