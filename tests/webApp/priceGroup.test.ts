import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ groups: [] as any[], ents: [] as any[], custs: [] as any[], calls: [] as any[], missingTable: false, failRead: false, user: 'u1' as string | null }));

vi.mock('../../lib/webApp/webAppServer.js', () => ({
  webAppCors: () => false,
  webAppCheckoutOn: () => process.env.WEB_APP_CHECKOUT === '1',
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

beforeEach(() => {
  vi.stubEnv('WEB_APP_CHECKOUT', '1');
  db.groups = []; db.ents = []; db.custs = []; db.calls = []; db.missingTable = false; db.failRead = false; db.user = 'u1';
});

describe('POST /api/web-app/price-group', () => {
  it('stores a new sign-up in g10 and returns it', async () => {
    const r = await post({ group: 'g10' });
    expect(r.code).toBe(200); expect(r.body).toEqual({ ok: true, group: 'g10' });
    expect(db.groups[0]).toMatchObject({ user_id: 'u1', price_group: 'g10', source: 'client' });
    expect(db.calls.find((c) => c.method === 'POST').prefer).toContain('ignore-duplicates'); // insert, on conflict do nothing
  });
  it('is write-once: a later g20 does not replace g10', async () => {
    await post({ group: 'g10' });
    const r = await post({ group: 'g20' });
    expect(r.body).toEqual({ ok: true, group: 'g10' });
    expect(db.groups).toHaveLength(1);
    expect(db.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
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
  it('base request is stored as base', async () => {
    expect((await post({ group: 'base' })).body).toEqual({ ok: true, group: 'base' });
  });
  it('validates the group', async () => {
    for (const g of ['g30', '', null, undefined, 10, 'G10']) expect((await post({ group: g })).code).toBe(400);
    expect((await post(undefined)).code).toBe(400);
    expect(db.groups).toHaveLength(0);
  });
  it('401 without a user, 405 for GET, 404 when the flag is off', async () => {
    db.user = null; expect((await post({ group: 'g10' })).code).toBe(401);
    db.user = 'u1'; expect((await post({ group: 'g10' }, 'GET')).code).toBe(405);
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
