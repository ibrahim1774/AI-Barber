import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ groups: [] as any[], ents: [] as any[], custs: [] as any[], calls: [] as any[], missingTable: false, failRead: false, user: 'u1' as string | null, sessions: [] as any[], created: '2026-11-10T00:00:00Z' }));

vi.mock('../../lib/webApp/webAppServer.js', () => ({
  webAppCors: () => false,
  webAppCheckoutOn: () => process.env.WEB_APP_CHECKOUT === '1',
  stripeCall: async () => ({ data: db.sessions }),
  callerFrom: async () => (db.user ? { id: db.user, email: 'o@example.com' } : null),
  sbRest: async (path: string, init: any = {}) => {
    db.calls.push({ path, ...init });
    if (path.startsWith('web_app_price_groups')) {
      if (db.missingTable) throw Object.assign(new Error('supabase 404'), { status: 404 });
      if (db.failRead) throw Object.assign(new Error('supabase 500'), { status: 500 });
      if ((init.method ?? 'GET') === 'GET') return db.groups.slice(0, 1);
      if (!db.groups.length) db.groups.push(init.body);
      return null;
    }
    if (path.startsWith('web_app_entitlements')) return db.ents.slice(0, 1);
    if (path.startsWith('web_app_customers')) return db.custs.slice(0, 1);
    return [];
  },
}));

import handler from '../../api/web-app/price-group.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; return r; };
const post = async (body: any, method = 'POST') => { const r = res(); await handler({ method, headers: { authorization: 'Bearer t' }, body }, r); return r; };

const ALL = ['G10', 'G20'].flatMap((g) => ['WEBSITE', 'BOOKINGS', 'STORE'].flatMap((t) => ['MONTH', 'YEAR'].map((i) => `STRIPE_WEBAPP_PRICE_${g}_${t}_${i}`)));
const configure = () => { for (const k of ALL) vi.stubEnv(k, 'price_x'); vi.stubEnv('STRIPE_WEBAPP_PORTAL_CONFIG_G10', 'bpc_10'); vi.stubEnv('STRIPE_WEBAPP_PORTAL_CONFIG_G20', 'bpc_20'); };
const writes = () => db.calls.filter((c) => c.method === 'POST');

let n = 0;
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('WEB_APP_CHECKOUT', '1');
  vi.stubEnv('WEB_APP_PRICE_TEST_OPEN', '1'); vi.stubEnv('WEB_APP_PRICE_TEST_START', '2026-11-09T00:00:00Z');
  vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
  configure(); db.sessions = []; db.created = '2026-11-10T00:00:00Z';
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ created_at: db.created }) }));
  db.groups = []; db.ents = []; db.custs = []; db.calls = []; db.missingTable = false; db.failRead = false; db.user = `u${++n}`;
});

describe('POST /api/web-app/price-group', () => {
  it('stores a new sign-up in g10 and returns it', async () => {
    const r = await post({ group: 'g10' });
    expect(r.code).toBe(200); expect(r.body).toEqual({ ok: true, group: 'g10' });
    expect(db.groups[0]).toMatchObject({ price_group: 'g10', source: 'client' });
    expect(db.calls.find((c) => c.method === 'POST').prefer).toContain('ignore-duplicates'); // insert, on conflict do nothing
  });
  it('is write-once: a later g20 does not replace g10', async () => {
    await post({ group: 'g10' });
    const r = await post({ group: 'g20' });
    expect(r.body).toEqual({ ok: true, group: 'g10' });
    expect(db.groups).toHaveLength(1);
    expect(writes()).toHaveLength(1);
  });
  it('a user with an entitlement row gets base, in any environment', async () => {
    db.ents = [{ stripe_subscription_id: 'sub_old' }];
    const r = await post({ group: 'g20' });
    expect(r.body).toEqual({ ok: true, group: 'base' });
    expect(db.groups[0].price_group).toBe('base');
    expect(db.calls.find((c) => c.path.startsWith('web_app_entitlements')).path).not.toContain('environment');
  });
  it('a user with a customer row gets base', async () => {
    db.custs = [{ user_id: 'u1' }];
    expect((await post({ group: 'g10' })).body.group).toBe('base');
  });
  it('base request is stored as base (even when the test is closed), first write wins', async () => {
    vi.stubEnv('WEB_APP_PRICE_TEST_OPEN', '0');
    expect((await post({ group: 'base' })).body).toEqual({ ok: true, group: 'base' });
    expect(db.groups[0].price_group).toBe('base');
    expect((await post({ group: 'g10' })).body.group).toBe('base');
  });
  it('test closed (OPEN not 1, or START unset): nothing written, base returned; stored groups still honoured', async () => {
    vi.stubEnv('WEB_APP_PRICE_TEST_OPEN', '0');
    expect((await post({ group: 'g10' })).body).toEqual({ ok: true, group: 'base' }); expect(writes()).toHaveLength(0);
    vi.stubEnv('WEB_APP_PRICE_TEST_OPEN', '1'); vi.stubEnv('WEB_APP_PRICE_TEST_START', '');
    expect((await post({ group: 'g10' })).body.group).toBe('base'); expect(writes()).toHaveLength(0);
    db.groups = [{ price_group: 'g20' }]; vi.stubEnv('WEB_APP_PRICE_TEST_OPEN', '0');
    expect((await post({ group: 'g10' })).body.group).toBe('g20');
  });
  it('group not fully configured (a price or the portal config missing): nothing written, base', async () => {
    vi.stubEnv('STRIPE_WEBAPP_PRICE_G10_STORE_YEAR', '');
    expect((await post({ group: 'g10' })).body.group).toBe('base'); expect(writes()).toHaveLength(0);
    expect((await post({ group: 'g20' })).body.group).toBe('g20'); // g20 is complete
    db.groups = []; vi.stubEnv('STRIPE_WEBAPP_PORTAL_CONFIG_G20', '');
    expect((await post({ group: 'g20' })).body.group).toBe('base');
  });
  it('an account created before WEB_APP_PRICE_TEST_START is stored base', async () => {
    db.created = '2026-11-01T00:00:00Z';
    expect((await post({ group: 'g10' })).body).toEqual({ ok: true, group: 'base' });
    expect(db.groups[0].price_group).toBe('base');
  });
  it('a completed Checkout session for this user is stored base; other users / open sessions do not count', async () => {
    db.sessions = [{ status: 'complete', metadata: { app: 'aibarber-app', user_id: 'someone-else' } }, { status: 'open', metadata: { app: 'aibarber-app', user_id: db.user } }];
    expect((await post({ group: 'g10' })).body.group).toBe('g10');
    db.groups = []; db.sessions = [{ status: 'complete', metadata: { app: 'aibarber-app', user_id: db.user } }];
    expect((await post({ group: 'g10' })).body.group).toBe('base');
  });
  it('an unreadable auth user fails closed (502), nothing written', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, json: async () => ({}) }));
    expect((await post({ group: 'g10' })).code).toBe(502); expect(writes()).toHaveLength(0);
  });
  it('validates the group', async () => {
    for (const g of ['g30', '', null, undefined, 10, 'G10']) expect((await post({ group: g })).code).toBe(400);
    expect((await post(undefined)).code).toBe(400);
    expect(db.groups).toHaveLength(0);
  });
  it('401 without a user, 405 for GET, 404 when the flag is off', async () => {
    db.user = null; expect((await post({ group: 'g10' })).code).toBe(401);
    db.user = 'u-get'; expect((await post({ group: 'g10' }, 'GET')).code).toBe(405);
    vi.stubEnv('WEB_APP_CHECKOUT', '0'); expect((await post({ group: 'g10' })).code).toBe(404);
  });
  it('rate limits per user', async () => {
    db.user = 'rl';
    let last: any;
    for (let i = 0; i < 25; i++) last = await post({ group: 'g10' });
    expect(last.code).toBe(429);
  });
  it('502 save_failed when the table is missing (migration 034 not applied) or Supabase fails', async () => {
    db.user = 'm1'; db.missingTable = true;
    const a = await post({ group: 'g10' }); expect(a.code).toBe(502);
    db.user = 'm2'; db.missingTable = false; db.failRead = true;
    const b = await post({ group: 'g10' }); expect(b.code).toBe(502); expect(b.body).toEqual({ error: 'save_failed' });
  });
});
