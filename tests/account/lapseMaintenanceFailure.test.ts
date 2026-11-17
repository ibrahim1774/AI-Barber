import { afterEach, describe, expect, it, vi } from 'vitest';
const sweepWebApp = vi.hoisted(() => vi.fn(async () => ({ checked: 3 })));
vi.mock('../../lib/webApp/lapse.js', () => ({ sweepWebApp, liveWebSweepDeps: vi.fn(async () => ({})), sweepIosOverlap: vi.fn(async () => ({ checked: 0 })), liveIosOverlapDeps: vi.fn(() => ({})) }));
vi.mock('../../lib/webApp/dunning.js', () => ({ sweepDunning: vi.fn(async () => ({ sent: 0 })) }));
vi.mock('../../lib/webApp/duplicates.js', () => ({ sweepDuplicates: vi.fn(async () => ({})) }));
vi.mock('../../lib/account/maintenance.js', () => ({ runAccountMaintenance: async () => { throw new Error('maintenance exploded'); } }));
import handler from '../../api/web-app/lapse.js';
afterEach(() => vi.unstubAllEnvs());
describe('the lapse cron survives a failing account maintenance', () => {
  it('still answers 200 with the real sweep result', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const [k, v] of Object.entries({ WEB_APP_ENTITLEMENTS: '1', CRON_SECRET: 's', STRIPE_WEBAPP_SECRET_KEY: 'sk_test_x', ONE_SITE_GUARD: '1' })) vi.stubEnv(k, v);
    const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; };
    await handler({ headers: { authorization: 'Bearer s' } }, r);
    expect(r.code).toBe(200);
    expect(r.body).toMatchObject({ ok: true, checked: 3 });
    expect(r.body.accountMaintenance).toBeUndefined();
  });
});
