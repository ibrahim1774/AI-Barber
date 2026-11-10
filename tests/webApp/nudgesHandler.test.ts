import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sweepSignupNudges = vi.hoisted(() => vi.fn(async (..._a: any[]) => ({ enrolled: 2, sent: 1, stopped: 0, skipped: 0, errors: 0 })));
const enrollSignups = vi.hoisted(() => vi.fn(async (..._a: any[]) => ({ enrolled: 3, errors: 0 })));
vi.mock('../../lib/webApp/signupNudges.js', () => ({ sweepSignupNudges, enrollSignups, liveSignupNudgeDeps: vi.fn(() => ({})) }));
const sweepSignupSheet = vi.hoisted(() => vi.fn(async (..._a: any[]) => ({ sent: 4, failed: 0, skipped: 0 })));
vi.mock('../../lib/webApp/signupSheet.js', () => ({ sweepSignupSheet, liveSignupSheetDeps: vi.fn(() => ({})) }));

import handler, { config } from '../../api/web-app/nudges.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const call = async (headers: any = { authorization: 'Bearer s3cret' }) => { const r = res(); await handler({ headers }, r); return r; };

beforeEach(() => {
  sweepSignupNudges.mockClear(); enrollSignups.mockClear(); sweepSignupSheet.mockClear();
  vi.stubEnv('WEB_APP_ENTITLEMENTS', '1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); vi.stubEnv('CRON_SECRET', 's3cret');
  vi.stubEnv('WEB_APP_NUDGES', ''); vi.stubEnv('MAKE_SIGNUP_WEBHOOK_URL', '');
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('/api/web-app/nudges cron', () => {
  it('has its own 300 s budget, a 10-minute cron entry and a functions entry in vercel.json', async () => {
    expect(config.maxDuration).toBe(300);
    const v = JSON.parse((await import('node:fs')).readFileSync('vercel.json', 'utf8'));
    expect(v.crons).toContainEqual({ path: '/api/web-app/nudges', schedule: '*/10 * * * *' });
    expect(v.functions['api/web-app/nudges.ts']).toEqual({ maxDuration: 300 });
    expect(v.crons.filter((c: any) => c.path === '/api/web-app/lapse')).toHaveLength(1);
  });
  it('flag off: 200 skipped, nothing runs, secret or not', async () => {
    vi.stubEnv('WEB_APP_ENTITLEMENTS', '');
    const r = await call({}); expect(r.code).toBe(200); expect(r.body).toEqual({ skipped: true });
    expect(sweepSignupNudges).not.toHaveBeenCalled();
  });
  it('no CRON_SECRET: 503; wrong or missing bearer: 401', async () => {
    vi.stubEnv('CRON_SECRET', ''); expect((await call({})).code).toBe(503);
    vi.stubEnv('CRON_SECRET', 's3cret');
    expect((await call({})).code).toBe(401); expect((await call({ authorization: 'Bearer nope' })).code).toBe(401);
    expect(sweepSignupNudges).not.toHaveBeenCalled();
  });
  it('WEB_APP_NUDGES=1: sweeps with the Stripe mode and a deadline inside the 300 s budget; the summary is returned and logged', async () => {
    vi.stubEnv('WEB_APP_NUDGES', '1');
    const r = await call();
    expect(r.code).toBe(200); expect(sweepSignupNudges).toHaveBeenCalledTimes(1);
    const o = (sweepSignupNudges.mock.calls[0] as any[])[1];
    expect(o.mode).toBe('test'); expect(o.deadlineMs).toBeGreaterThanOrEqual(100_000); expect(o.deadlineMs).toBeLessThanOrEqual(200_000);
    expect(r.body.nudges).toEqual({ enrolled: 2, sent: 1, stopped: 0, skipped: 0, errors: 0 });
    expect((console.log as any).mock.calls.some((c: any[]) => String(c[0]).includes('[web-app nudges] run'))).toBe(true);
  });
  it('WEB_APP_NUDGES unset: the nudge sweep is not called', async () => {
    const r = await call(); expect(r.code).toBe(200); expect(sweepSignupNudges).not.toHaveBeenCalled(); expect(r.body.nudges).toBeNull();
  });
  it('a nudge sweep that throws still answers 200 with a visible error flag', async () => {
    vi.stubEnv('WEB_APP_NUDGES', '1'); sweepSignupNudges.mockRejectedValueOnce(new Error('boom'));
    const r = await call(); expect(r.code).toBe(200); expect(r.body.ok).toBe(true); expect(r.body.nudges).toEqual({ error: true });
  });
});
