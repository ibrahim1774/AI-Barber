import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const db = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, failPath: '' as string }));
const baseClose = vi.hoisted(() => vi.fn(async () => ({ ok: true, bookingsCancelled: 0, ordersCancelled: 0, needsRefund: [], notCancelled: [] })));
const stripeImpl = vi.hoisted(() => ({ fn: null as any }));
const alerts = vi.hoisted(() => ({ alert: vi.fn(async (..._a: any[]) => {}) }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  sbRest: vi.fn(async (p: string) => { if (db.failPath && p.startsWith(db.failPath)) throw new Error('supabase 500'); return db.tables[p.split('?')[0]] ?? []; }),
  stripeCall: vi.fn((...a: any[]) => stripeImpl.fn(...a)),
}));
vi.mock('../../lib/ios/deleteAccount.js', () => ({
  liveDeleteDeps: vi.fn(() => ({ closeShop: baseClose, listSites: async () => [], takeDown: async () => {}, purge: async () => {}, deleteUser: async () => {} })),
  deleteAccount: vi.fn(async () => ({ status: 200, body: { deleted: true } })),
}));
vi.mock('../../lib/ios/removeSiteLive.js', () => ({ liveRemoveDeps: vi.fn(() => ({})) }));
vi.mock('../../lib/webApp/reliability.js', () => ({ suspendWork: vi.fn(async () => {}), markSiteOffline: vi.fn(async () => {}), resumeAfterFailedDelete: vi.fn(async () => {}), reliabilityOn: () => false, enc: encodeURIComponent, draftPath: () => '' }));
vi.mock('../../lib/webApp/userExists.js', () => ({ emailOfUser: vi.fn(async () => 'a@example.com') }));
vi.mock('../../lib/webApp/emails.js', () => ({ alertOwner: alerts.alert }));

import { stripeCall } from '../../lib/webApp/webAppServer.js';
import { liveDeleteDeps, deleteAccount } from '../../lib/ios/deleteAccount.js';
import { hasStripeHistory, liveWebDeleteDeps } from '../../lib/webApp/deleteAccount.js';
import handler from '../../api/ios/delete-account.js';

const stripeOk = (extra: (p: string, m: string) => any = () => undefined) => async (p: string, _b: any, m = 'POST') => extra(p, m) ?? { data: [] };
const calls = () => (stripeCall as any).mock.calls.map((c: any[]) => `${c[2] ?? 'POST'} ${c[0]}`);

beforeEach(() => {
  db.tables = {}; db.failPath = ''; baseClose.mockClear(); alerts.alert.mockClear(); (stripeCall as any).mockClear();
  stripeImpl.fn = stripeOk();
  vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('hasStripeHistory', () => {
  it('false with no rows (a price-group row alone does not count)', async () => {
    db.tables = { web_app_price_groups: [{ user_id: 'u1' }] };
    expect(await hasStripeHistory('u1')).toBe(false);
  });
  for (const t of ['web_app_entitlements', 'web_app_customers', 'web_app_checkout_sessions']) {
    it(`true with a row in ${t}`, async () => { db.tables = { [t]: [{ user_id: 'u1' }] }; expect(await hasStripeHistory('u1')).toBe(true); });
  }
  it('a read error rejects', async () => {
    db.failPath = 'web_app_customers';
    await expect(hasStripeHistory('u1')).rejects.toThrow('supabase 500');
  });
});

describe('web delete endpoint deps (no option): exactly today, even with the switch on', () => {
  it('switch on, no history: Stripe is still consulted and a Stripe error still throws', async () => {
    vi.stubEnv('APP_DELETE_CANCELS_WEB', '1');
    stripeImpl.fn = async () => { throw new Error('stripe down'); };
    await expect(liveWebDeleteDeps().closeShop!('u1')).rejects.toThrow('stripe down');
    expect(baseClose).not.toHaveBeenCalled();
    expect(alerts.alert).not.toHaveBeenCalled();
  });
  it('missing Stripe key throws as today', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', '');
    await expect(liveWebDeleteDeps().closeShop!('u1')).rejects.toThrow(/STRIPE_WEBAPP_SECRET_KEY/);
  });
});

describe('iOS delete deps (allowNoStripe)', () => {
  const ios = () => liveWebDeleteDeps({ allowNoStripe: true }).closeShop!('u1');
  const sub = (id = 'sub_1') => ({ id, status: 'active', metadata: { app: 'aibarber-app' } });
  const sessions = { data: [{ id: 'cs_1', status: 'complete', customer: 'cus_n', metadata: { app: 'aibarber-app', user_id: 'u1' } }] };

  it('no local rows but Stripe answers with a live subscription: it is cancelled', async () => {
    stripeImpl.fn = stripeOk((p, m) => p.startsWith('checkout/sessions?') ? sessions : p.startsWith('subscriptions?') ? { data: [sub()] } : p === 'subscriptions/sub_1' && m === 'DELETE' ? {} : undefined);
    const r = await ios();
    expect(r.ok).toBe(true);
    expect(calls()).toContain('DELETE subscriptions/sub_1');
    expect(alerts.alert).not.toHaveBeenCalled();
  });
  it('no rows, Stripe answers with nothing: delete goes on, nothing cancelled, no alert', async () => {
    await ios();
    expect(baseClose).toHaveBeenCalledTimes(1);
    expect(calls().some((c: string) => c.startsWith('DELETE'))).toBe(false);
    expect(alerts.alert).not.toHaveBeenCalled();
  });
  it('Stripe unreachable + Apple row: proceeds without Stripe, owner alerted', async () => {
    stripeImpl.fn = async () => { throw new Error('ECONNRESET'); };
    db.tables = { ios_purchases: [{ original_transaction_id: 'o1' }], web_app_price_groups: [{ user_id: 'u1' }] };
    const r = await ios();
    expect(r.ok).toBe(true);
    expect(baseClose).toHaveBeenCalledTimes(1);
    expect(alerts.alert).toHaveBeenCalledTimes(1);
    expect((alerts.alert.mock.calls[0] as any)[1].join('\n')).toMatch(/u1/);
  });
  it('Stripe unreachable + no web sign-up and no Apple row: proceeds with an alert', async () => {
    stripeImpl.fn = async () => { throw new Error('ECONNRESET'); };
    await ios();
    expect(baseClose).toHaveBeenCalledTimes(1);
    expect(alerts.alert).toHaveBeenCalledTimes(1);
  });
  it('Stripe unreachable + web sign-up and no Apple row: fails closed', async () => {
    stripeImpl.fn = async () => { throw new Error('ECONNRESET'); };
    db.tables = { web_app_drafts: [{ user_id: 'u1' }] };
    await expect(ios()).rejects.toThrow(/refused/);
    expect(baseClose).not.toHaveBeenCalled();
    expect(alerts.alert).not.toHaveBeenCalled();
  });
  it('Stripe unreachable + Apple row but Stripe history exists: fails closed', async () => {
    stripeImpl.fn = async () => { throw new Error('ECONNRESET'); };
    db.tables = { ios_purchases: [{ original_transaction_id: 'o1' }], web_app_customers: [{ user_id: 'u1' }] };
    await expect(ios()).rejects.toThrow(/Stripe history/);
    expect(baseClose).not.toHaveBeenCalled();
  });
  it('Stripe key missing + Apple row: proceeds with an alert', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', '');
    db.tables = { ios_purchases: [{ original_transaction_id: 'o1' }] };
    await ios();
    expect(baseClose).toHaveBeenCalledTimes(1);
    expect(alerts.alert).toHaveBeenCalledTimes(1);
    expect(stripeCall).not.toHaveBeenCalled();
  });
  it('Stripe timing out (8 s) counts as unreachable', async () => {
    vi.useFakeTimers();
    stripeImpl.fn = () => new Promise(() => {});
    const p = ios();
    await vi.advanceTimersByTimeAsync(8100);
    expect((await p).ok).toBe(true);
    expect(alerts.alert).toHaveBeenCalledTimes(1);
  });
  it('a database read error in the fallback lookups fails closed', async () => {
    stripeImpl.fn = async () => { throw new Error('ECONNRESET'); };
    db.failPath = 'ios_purchases';
    await expect(ios()).rejects.toThrow('supabase 500');
    expect(baseClose).not.toHaveBeenCalled();
  });
  it('a read error before Stripe (the entitlement lookup) fails closed, no base closeShop', async () => {
    db.failPath = 'web_app_entitlements';
    await expect(ios()).rejects.toThrow('supabase 500');
    expect(baseClose).not.toHaveBeenCalled();
  });
  it('a live subscription under a test key (live-subscription-elsewhere) still refuses', async () => {
    db.tables = { web_app_entitlements: [{ stripe_subscription_id: 'sub_l', status: 'active', environment: 'live' }] };
    await expect(ios()).rejects.toThrow('live-subscription-elsewhere');
    expect(baseClose).not.toHaveBeenCalled();
  });
});

describe('api/ios/delete-account deps choice', () => {
  const res = () => { const r: any = {}; r.setHeader = () => r; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.end = () => r; return r; };
  const call = async () => { (deleteAccount as any).mockClear(); (liveDeleteDeps as any).mockClear(); await handler({ method: 'POST', headers: { authorization: 'Bearer t' } } as any, res()); return (deleteAccount as any).mock.calls[0][1]; };
  it('switch off: the handler passes exactly what liveDeleteDeps() returned', async () => {
    const sentinel: any = { closeShop: vi.fn(), marker: 'plain' };
    (liveDeleteDeps as any).mockReturnValueOnce(sentinel);
    const deps = await call();
    expect(deps).toBe(sentinel);
  });
  it('switch on: wrapped web deps (not the plain object), and a no-rows delete asks Stripe', async () => {
    vi.stubEnv('APP_DELETE_CANCELS_WEB', '1');
    const sentinel: any = { closeShop: baseClose, listSites: async () => [], takeDown: async () => {}, purge: async () => {}, deleteUser: async () => {} };
    (liveDeleteDeps as any).mockReturnValueOnce(sentinel);
    const deps = await call();
    expect(deps).not.toBe(sentinel);
    await deps.closeShop('u1');
    expect(stripeCall).toHaveBeenCalled();
  });
});
