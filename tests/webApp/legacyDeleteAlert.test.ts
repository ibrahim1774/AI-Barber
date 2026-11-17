import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, reads: [] as string[], alert: vi.fn(async (..._a: any[]) => {}) }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  sbRest: vi.fn(async (p: string) => { h.reads.push(p); return h.tables[p.split('?')[0]] ?? []; }),
  stripeCall: vi.fn(async () => ({ data: [] })),
}));
vi.mock('../../lib/webApp/emails.js', () => ({ alertOwner: h.alert }));
vi.mock('../../lib/webApp/userExists.js', () => ({ emailOfUser: vi.fn(async () => 'a@example.com') }));
vi.mock('../../lib/webApp/reliability.js', () => ({ suspendWork: vi.fn(async () => {}), markSiteOffline: vi.fn(async () => {}), reliabilityOn: () => false, enc: encodeURIComponent, draftPath: () => '' }));
vi.mock('../../lib/ios/removeSiteLive.js', () => ({ liveRemoveDeps: vi.fn(() => ({})) }));
vi.mock('../../lib/ios/deleteAccount.js', () => ({
  liveDeleteDeps: vi.fn(() => ({
    closeShop: async () => ({ ok: true, bookingsCancelled: 0, ordersCancelled: 0, needsRefund: [], notCancelled: [] }),
    listSites: async () => [], takeDown: async () => {}, purge: async () => {}, deleteUser: async () => {},
  })),
  deleteAccount: vi.fn(async (_a: any, deps: any) => {
    const r = await deps.closeShop('u1');
    return { status: r.ok ? 200 : 500, body: { deleted: true } };
  }),
}));

import handler from '../../api/ios/delete-account.js';

const res = () => { const r: any = {}; r.setHeader = () => r; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.end = () => r; return r; };
const run = async () => { const r = res(); await handler({ method: 'POST', headers: { authorization: 'Bearer t' } } as any, r); return r; };

beforeEach(() => { h.tables = {}; h.reads = []; h.alert.mockClear(); vi.stubEnv('APP_DELETE_CANCELS_WEB', '1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); });
afterEach(() => vi.unstubAllEnvs());

describe('legacy customer delete alert (APP_DELETE_CANCELS_WEB)', () => {
  it('site_owners row with a non-webapp checkout: one alert, delete continues', async () => {
    h.tables = { site_owners: [{ slug: 'old-cuts', checkout_session_id: 'cs_live_1' }] };
    const r = await run();
    expect(r.code).toBe(200);
    expect(h.alert).toHaveBeenCalledTimes(1);
    const [subject, lines] = h.alert.mock.calls[0] as any;
    expect(subject).toBe('Legacy customer deleted their account');
    expect(lines.join('\n')).toMatch(/u1|a@example.com/);
    expect(lines.join('\n')).toMatch(/old-cuts/);
    expect(lines.join('\n')).toMatch(/NOT cancelled/);
  });
  it('null checkout_session_id counts as legacy', async () => {
    h.tables = { site_owners: [{ slug: 'x', checkout_session_id: null }] };
    await run();
    expect(h.alert).toHaveBeenCalledTimes(1);
  });
  it('sites row with source null: one alert', async () => {
    h.tables = { sites: [{ company_name: 'Old Barber Co' }] };
    const r = await run();
    expect(r.code).toBe(200);
    expect(h.alert).toHaveBeenCalledTimes(1);
    expect((h.alert.mock.calls[0] as any)[1].join('\n')).toMatch(/Old Barber Co/);
  });
  it('non-legacy web account (webapp: session): no alert', async () => {
    h.tables = { site_owners: [{ slug: 'new', checkout_session_id: 'webapp:sub_1' }] };
    const r = await run();
    expect(r.code).toBe(200);
    expect(h.alert).not.toHaveBeenCalled();
  });
  it('alert throws: delete still completes', async () => {
    h.tables = { site_owners: [{ slug: 'old', checkout_session_id: null }] };
    h.alert.mockRejectedValueOnce(new Error('mail down'));
    const r = await run();
    expect(r.code).toBe(200);
  });
  it('switch off: no lookup, no alert', async () => {
    vi.stubEnv('APP_DELETE_CANCELS_WEB', '');
    h.tables = { site_owners: [{ slug: 'old', checkout_session_id: null }], sites: [{ company_name: 'x' }] };
    const r = await run();
    expect(r.code).toBe(200);
    expect(h.reads.filter((p) => /^(site_owners|sites)\?/.test(p))).toEqual([]);
    expect(h.alert).not.toHaveBeenCalled();
  });
});
