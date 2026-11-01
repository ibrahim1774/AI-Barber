import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sweepWebApp = vi.hoisted(() => vi.fn(async () => ({ checked: 0 })));
vi.mock('../../lib/webApp/lapse.js', () => ({
  sweepWebApp, liveWebSweepDeps: vi.fn(async () => ({})),
  sweepIosOverlap: vi.fn(async () => ({ checked: 0 })), liveIosOverlapDeps: vi.fn(() => ({})),
}));
vi.mock('../../lib/webApp/dunning.js', () => ({ sweepDunning: vi.fn(async () => ({ due: 0, sent: 0 })) }));
vi.mock('../../lib/webApp/duplicates.js', () => ({ sweepDuplicates: vi.fn(async () => ({ found: 0, alerted: 0, refunded: 0, errors: 0 })) }));

import handler from '../../api/web-app/lapse.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const call = async (headers: any) => { const r = res(); await handler({ headers }, r); return r; };

beforeEach(() => { sweepWebApp.mockClear(); vi.stubEnv('WEB_APP_ENTITLEMENTS', '1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); });
afterEach(() => vi.unstubAllEnvs());

describe('/api/web-app/lapse auth', () => {
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
