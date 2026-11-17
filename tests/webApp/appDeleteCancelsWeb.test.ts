import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const db = vi.hoisted(() => ({ tables: {} as Record<string, any[]> }));
const baseClose = vi.hoisted(() => vi.fn(async () => ({ ok: true, bookingsCancelled: 0, ordersCancelled: 0, needsRefund: [], notCancelled: [] })));
const fetchSpy = vi.hoisted(() => vi.fn());
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  sbRest: vi.fn(async (p: string) => { const t = p.split('?')[0]; return db.tables[t] ?? []; }),
  stripeCall: vi.fn(async (...a: any[]) => { fetchSpy(...a); return { data: [] }; }),
}));
vi.mock('../../lib/ios/deleteAccount.js', () => ({
  liveDeleteDeps: vi.fn(() => ({ closeShop: baseClose, listSites: async () => [], takeDown: async () => {}, purge: async () => {}, deleteUser: async () => {} })),
  deleteAccount: vi.fn(async () => ({ status: 200, body: { deleted: true } })),
}));
vi.mock('../../lib/ios/removeSiteLive.js', () => ({ liveRemoveDeps: vi.fn(() => ({})) }));
vi.mock('../../lib/webApp/reliability.js', () => ({ suspendWork: vi.fn(async () => {}), markSiteOffline: vi.fn(async () => {}), reliabilityOn: () => false, enc: encodeURIComponent, draftPath: () => '' }));
vi.mock('../../lib/webApp/userExists.js', () => ({ emailOfUser: vi.fn(async () => 'a@example.com') }));

import { stripeCall } from '../../lib/webApp/webAppServer.js';
import { liveDeleteDeps, deleteAccount } from '../../lib/ios/deleteAccount.js';
import { hasStripeHistory, liveWebDeleteDeps } from '../../lib/webApp/deleteAccount.js';
import handler from '../../api/ios/delete-account.js';

beforeEach(() => {
  db.tables = {}; baseClose.mockClear(); fetchSpy.mockClear(); (stripeCall as any).mockClear();
  vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
});
afterEach(() => vi.unstubAllEnvs());

describe('hasStripeHistory', () => {
  it('false with no rows (a price-group row alone does not count)', async () => {
    db.tables = { web_app_price_groups: [{ user_id: 'u1' }] };
    expect(await hasStripeHistory('u1')).toBe(false);
  });
  for (const t of ['web_app_entitlements', 'web_app_customers', 'web_app_checkout_sessions']) {
    it(`true with a row in ${t}`, async () => { db.tables = { [t]: [{ user_id: 'u1' }] }; expect(await hasStripeHistory('u1')).toBe(true); });
  }
});

describe('closeShop wrapper', () => {
  it('switch on, no Stripe history: zero Stripe calls, base closeShop still runs', async () => {
    vi.stubEnv('APP_DELETE_CANCELS_WEB', '1');
    const r = await liveWebDeleteDeps().closeShop!('u1');
    expect(r.ok).toBe(true);
    expect(stripeCall).not.toHaveBeenCalled();
    expect(baseClose).toHaveBeenCalledTimes(1);
  });
  it('switch on, entitlement row: today\'s path (Stripe is asked)', async () => {
    vi.stubEnv('APP_DELETE_CANCELS_WEB', '1');
    db.tables = { web_app_entitlements: [{ user_id: 'u1', stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', status: 'active', environment: 'test' }] };
    await liveWebDeleteDeps().closeShop!('u1');
    expect(stripeCall).toHaveBeenCalled();
  });
  it('switch on, entitlement row: a Stripe error still throws (fail closed)', async () => {
    vi.stubEnv('APP_DELETE_CANCELS_WEB', '1');
    db.tables = { web_app_entitlements: [{ user_id: 'u1', stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', status: 'active', environment: 'test' }] };
    (stripeCall as any).mockRejectedValueOnce(new Error('stripe down'));
    await expect(liveWebDeleteDeps().closeShop!('u1')).rejects.toThrow('stripe down');
    expect(baseClose).not.toHaveBeenCalled();
  });
  it('switch OFF, no history: today\'s code, Stripe is still consulted (byte-for-byte path)', async () => {
    await liveWebDeleteDeps().closeShop!('u1');
    expect(stripeCall).toHaveBeenCalled();
  });
  it('switch OFF, missing Stripe key still throws as today', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', '');
    await expect(liveWebDeleteDeps().closeShop!('u1')).rejects.toThrow(/STRIPE_WEBAPP_SECRET_KEY/);
  });
});

describe('api/ios/delete-account deps choice', () => {
  const res = () => { const r: any = { headers: {} }; r.setHeader = () => r; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.end = () => r; return r; };
  const call = async () => { (deleteAccount as any).mockClear(); await handler({ method: 'POST', headers: { authorization: 'Bearer t' } } as any, res()); return (deleteAccount as any).mock.calls[0][1]; };
  it('switch off: liveDeleteDeps (unchanged), plain deps without the web wrapper', async () => {
    const deps = await call();
    expect(liveDeleteDeps).toHaveBeenCalled();
    await deps.closeShop('u1');
    expect(stripeCall).not.toHaveBeenCalled(); // the base closeShop, no Stripe
  });
  it('switch on: web deps (cancels web plans)', async () => {
    vi.stubEnv('APP_DELETE_CANCELS_WEB', '1');
    db.tables = { web_app_customers: [{ user_id: 'u1' }] };
    const deps = await call();
    await deps.closeShop('u1');
    expect(stripeCall).toHaveBeenCalled();
  });
});
