import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sweepWebApp = vi.hoisted(() => vi.fn(async () => ({ checked: 0 })));
vi.mock('../../lib/webApp/lapse.js', () => ({
  sweepWebApp, liveWebSweepDeps: vi.fn(async () => ({})),
  sweepIosOverlap: vi.fn(async () => ({ checked: 0 })), liveIosOverlapDeps: vi.fn(() => ({})),
}));
vi.mock('../../lib/webApp/dunning.js', () => ({ sweepDunning: vi.fn(async () => ({ due: 0, sent: 0 })) }));
vi.mock('../../lib/webApp/duplicates.js', () => ({ sweepDuplicates: vi.fn(async () => ({ found: 0, alerted: 0, refunded: 0, errors: 0 })) }));

const sweepSignupNudges = vi.hoisted(() => vi.fn(async (..._a: any[]) => ({ enrolled: 0, sent: 0, stopped: 0, skipped: 0, errors: 0 })));
vi.mock('../../lib/webApp/signupNudges.js', () => ({ sweepSignupNudges, liveSignupNudgeDeps: vi.fn(() => ({})) }));

import handler from '../../api/web-app/lapse.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const call = async (headers: any) => { const r = res(); await handler({ headers }, r); return r; };

beforeEach(() => { sweepWebApp.mockClear(); sweepSignupNudges.mockClear(); vi.stubEnv('WEB_APP_NUDGES', ''); vi.stubEnv('WEB_APP_ENTITLEMENTS', '1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); });
afterEach(() => vi.unstubAllEnvs());

describe('/api/web-app/lapse auth', () => {
  it('flag off: 200 skipped exactly as before, with or without a secret, and nothing runs', async () => {
    vi.stubEnv('WEB_APP_ENTITLEMENTS', '');
    for (const sec of ['', 's3cret']) {
      vi.stubEnv('CRON_SECRET', sec);
      const r = await call({});
      expect(r.code).toBe(200); expect(r.body).toEqual({ skipped: true });
    }
    expect(sweepWebApp).not.toHaveBeenCalled();
  });
  it('503 without a secret, even with the vercel-cron user agent; the sweep never runs', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const r = await call({ 'user-agent': 'vercel-cron/1.0' });
    expect(r.code).toBe(503); expect(r.body).toEqual({ error: 'cron-secret-missing' });
    expect(sweepWebApp).not.toHaveBeenCalled();
  });
  it('401 with a bad bearer; the sweep never runs', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret');
    expect((await call({ authorization: 'Bearer nope' })).code).toBe(401);
    expect((await call({ 'user-agent': 'vercel-cron/1.0' })).code).toBe(401);
    expect(sweepWebApp).not.toHaveBeenCalled();
  });
  it('200 with the right bearer', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret');
    const r = await call({ authorization: 'Bearer s3cret' });
    expect(r.code).toBe(200);
    expect(sweepWebApp).toHaveBeenCalledTimes(1);
  });
});

describe('/api/web-app/lapse no longer runs the sign-up reminders (they have their own cron, /api/web-app/nudges)', () => {
  beforeEach(() => vi.stubEnv('CRON_SECRET', 's3cret'));
  it('even with WEB_APP_NUDGES=1 the nudge sweep is never called from lapse and the answer has no nudges key', async () => {
    vi.stubEnv('WEB_APP_NUDGES', '1');
    const r = await call({ authorization: 'Bearer s3cret' });
    expect(r.code).toBe(200); expect(r.body.ok).toBe(true);
    expect(sweepSignupNudges).not.toHaveBeenCalled();
    expect('nudges' in r.body).toBe(false);
  });
});
