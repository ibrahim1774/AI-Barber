import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthUnavailableError, callerFrom } from '../../lib/webApp/webAppServer.js';
import draft from '../../api/web-app/draft.js';
import takeOffline from '../../api/web-app/take-offline.js';
import portal from '../../api/web-app/portal.js';
import checkout from '../../api/web-app/checkout.js';
import me from '../../api/web-app/me.js';
import keptCopy from '../../api/account/kept-copy.js';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const setup = (authStatus: number | 'network', on: boolean) => {
  for (const [k, v] of Object.entries({ SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'k', WEB_APP_CHECKOUT: '1', WEB_APP_ENTITLEMENTS: '1', WEB_APP_RELIABILITY: '1', STRIPE_WEBAPP_SECRET_KEY: 'sk_test_x', AUTH_OUTAGE_503: on ? '1' : '' })) vi.stubEnv(k, v);
  vi.stubGlobal('fetch', vi.fn(async () => { if (authStatus === 'network') throw new TypeError('fetch failed'); return new Response(authStatus === 200 ? JSON.stringify({ id: 'u1', email: 'a@b.co' }) : '{}', { status: authStatus }); }));
};
const A = 'Bearer tok';
const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };

describe('callerFrom', () => {
  it('OFF (default): every non-OK answer is null, exactly as today; a network error throws as today', async () => {
    for (const s of [401, 403, 429, 500, 503]) { setup(s, false); expect(await callerFrom(A), String(s)).toBeNull(); }
    setup('network', false); await expect(callerFrom(A)).rejects.toThrow('fetch failed');
    setup(200, false); expect(await callerFrom(A)).toEqual({ id: 'u1', email: 'a@b.co' });
  });
  it('AUTH_OUTAGE_503=1: 401 and 403 are an invalid token (null); 429, 5xx and network errors are an outage', async () => {
    for (const s of [401, 403]) { setup(s, true); expect(await callerFrom(A), String(s)).toBeNull(); }
    for (const s of [429, 500, 502, 503]) { setup(s, true); await expect(callerFrom(A), String(s)).rejects.toBeInstanceOf(AuthUnavailableError); }
    setup('network', true); await expect(callerFrom(A)).rejects.toBeInstanceOf(AuthUnavailableError);
    setup(200, true); expect(await callerFrom(A)).toEqual({ id: 'u1', email: 'a@b.co' });
  });
  it('no or malformed header is null without any request', async () => {
    setup(500, true);
    expect(await callerFrom(undefined)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('endpoints through an auth outage', () => {
  const calls: [string, (q: any, r: any) => Promise<any>, any][] = [
    ['draft GET', draft, { method: 'GET' }], ['draft PUT', draft, { method: 'PUT', body: {} }], ['take-offline', takeOffline, { method: 'POST' }],
    ['portal', portal, { method: 'POST' }], ['checkout', checkout, { method: 'POST', body: {} }], ['me', me, { method: 'GET' }], ['kept-copy', keptCopy, { method: 'POST', body: {} }],
  ];
  for (const [name, h, req] of calls) {
    it(`${name}: outage answers 503 temporarily-unavailable with the switch on, 401 for a bad token, and today's answer with the switch off`, async () => {
      setup(500, true);
      let r = res(); await h({ headers: { authorization: A }, ...req }, r);
      expect([r.code, r.body], 'outage').toEqual([503, { error: 'temporarily-unavailable' }]);
      setup('network', true);
      r = res(); await h({ headers: { authorization: A }, ...req }, r);
      expect(r.code, 'network').toBe(503);
      setup(401, true);
      r = res(); await h({ headers: { authorization: A }, ...req }, r);
      expect(r.code, 'invalid token').toBe(401);
      setup(500, false);
      r = res(); await h({ headers: { authorization: A }, ...req }, r);
      expect(r.code, 'switch off, auth 500').toBe(401);
    });
  }
});
