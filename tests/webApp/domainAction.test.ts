// api/web-app/domain-action.ts: GET shows, POST acts (same-origin only), rate limited, no-store / noindex, no token in logs.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  allow: vi.fn(async (_s: string, _k: string) => true),
  view: vi.fn(async (_t: unknown, _e: unknown) => ({ status: 200, html: '<p>view</p>' })),
  run: vi.fn(async (_t: unknown, _e: unknown) => ({ status: 200, html: '<p>done</p>' })),
}));
vi.mock('../../lib/bookings/rateLimit.js', () => ({ publicLimiter: { allow: h.allow }, clientIp: (hd: any) => hd?.['x-real-ip'] ?? 'unknown' }));
vi.mock('../../lib/webApp/domainManualLive.js', () => ({ liveManualEnv: () => ({ env: true }) }));
vi.mock('../../lib/webApp/domainManual.js', async (orig) => ({ ...(await orig<any>()), domainActionView: h.view, runDomainAction: h.run }));

import handler from '../../api/web-app/domain-action.js';
import { verifyStubOn, linkBase, DEFAULT_ORDERS_EMAIL } from '../../lib/webApp/domainManualEnv.js';

const mkRes = () => {
  const res: any = { headers: {} as Record<string, string>, code: 0, body: '' };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  res.status = (c: number) => { res.code = c; return res; };
  res.send = (b: string) => { res.body = b; return res; };
  return res;
};

beforeEach(() => { h.allow.mockClear(); h.view.mockClear(); h.run.mockClear(); h.allow.mockResolvedValue(true); });

describe('api/web-app/domain-action', () => {
  it('GET renders the view, never runs the action; no-store, noindex, no referrer', async () => {
    const res = mkRes();
    await handler({ method: 'GET', headers: { 'x-real-ip': '1.2.3.4' }, query: { t: 'tok' } }, res);
    expect(res.code).toBe(200);
    expect(h.view).toHaveBeenCalledWith('tok', { env: true });
    expect(h.run).not.toHaveBeenCalled();
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.headers['X-Robots-Tag']).toMatch(/noindex/);
    expect(res.headers['Referrer-Policy']).toBe('no-referrer');
    expect(h.allow).toHaveBeenCalledWith('1.2.3.4', 'read');
  });

  it('POST without a same-origin browser is 403 and does nothing; with one it acts', async () => {
    const bad = mkRes();
    await handler({ method: 'POST', headers: { 'sec-fetch-site': 'cross-site' }, body: { t: 'tok' }, query: {} }, bad);
    expect(bad.code).toBe(403);
    const none = mkRes();
    await handler({ method: 'POST', headers: {}, body: { t: 'tok' }, query: {} }, none);
    expect(none.code).toBe(403);
    expect(h.run).not.toHaveBeenCalled();
    const ok = mkRes();
    await handler({ method: 'POST', headers: { 'sec-fetch-site': 'same-origin' }, body: { t: 'tok' }, query: {} }, ok);
    expect(ok.code).toBe(200);
    expect(h.run).toHaveBeenCalledWith('tok', { env: true });
    expect(h.allow).toHaveBeenLastCalledWith('unknown', 'write');
    const viaOrigin = mkRes();
    await handler({ method: 'POST', headers: { origin: 'https://h.example', host: 'h.example' }, body: { t: 'tok2' }, query: {} }, viaOrigin);
    expect(viaOrigin.code).toBe(200);
  });

  it('rate limited per IP: 429 and nothing runs', async () => {
    h.allow.mockResolvedValue(false);
    const res = mkRes();
    await handler({ method: 'GET', headers: {}, query: { t: 'tok' } }, res);
    expect(res.code).toBe(429);
    expect(h.view).not.toHaveBeenCalled();
  });

  it('other methods are 405; an internal error is a generic 500 that never echoes the token', async () => {
    const m = mkRes();
    await handler({ method: 'PUT', headers: {}, query: {} }, m);
    expect(m.code).toBe(405);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.view.mockRejectedValueOnce(new Error('boom tok-SECRETVALUE'));
    const e = mkRes();
    await handler({ method: 'GET', headers: {}, query: { t: 'tok-SECRETVALUE' } }, e);
    expect(e.code).toBe(500);
    expect(e.body).not.toContain('SECRETVALUE');
    spy.mockRestore();
  });
});

describe('manual-domain env', () => {
  it('the verify stub needs the flag AND DOMAINS_BUY_DISABLED AND a test Stripe key (production ignores it)', () => {
    expect(verifyStubOn({ DOMAIN_LIVE_VERIFY_STUB: '1', DOMAINS_BUY_DISABLED: '1', STRIPE_SECRET_KEY: 'sk_test_x' })).toBe(true);
    expect(verifyStubOn({ DOMAIN_LIVE_VERIFY_STUB: '1', DOMAINS_BUY_DISABLED: '1', STRIPE_SECRET_KEY: 'sk_live_x' })).toBe(false);
    expect(verifyStubOn({ DOMAIN_LIVE_VERIFY_STUB: '1', STRIPE_SECRET_KEY: 'sk_test_x' })).toBe(false);
    expect(verifyStubOn({ DOMAINS_BUY_DISABLED: '1', STRIPE_SECRET_KEY: 'sk_test_x' })).toBe(false);
    expect(verifyStubOn({ DOMAIN_LIVE_VERIFY_STUB: '1', DOMAINS_BUY_DISABLED: '1', VERCEL_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_x' })).toBe(false);
  });
  it('defaults: orders go to the owner inbox; the link base is explicit or the production URL', () => {
    expect(DEFAULT_ORDERS_EMAIL).toBe('ibrahim3709@gmail.com');
    expect(linkBase({ DOMAIN_ADMIN_LINK_BASE: 'https://x.example' })).toBe('https://x.example');
    expect(linkBase({ VERCEL_PROJECT_PRODUCTION_URL: 'api.example' })).toBe('https://api.example');
  });
});
