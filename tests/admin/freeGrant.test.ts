// Admin grant-free / revoke-free (lib/admin/freeGrant.ts, api/admin/sites.ts): the Free price group by email.
import { describe, expect, it, vi } from 'vitest';
import { liveFreeGrantDeps, setFreeGroup, type FreeGrantDeps } from '../../lib/admin/freeGrant.js';
import { makeAdminSitesHandler } from '../../api/admin/sites.js';
import { ADMIN_EMAIL } from '../../lib/admin/auth.js';
import { memoryStore } from '../../lib/bookings/rateLimit.js';

const rest = vi.hoisted(() => ({ calls: [] as Array<{ path: string; init: any }>, tables: {} as Record<string, any[]> }));
vi.mock('../../lib/webApp/webAppServer.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/webApp/webAppServer.js')>()),
  sbRest: vi.fn(async (path: string, init: any = {}) => { rest.calls.push({ path, init }); return init.method === 'POST' ? null : rest.tables[path.split('?')[0]] ?? []; }),
}));
vi.mock('../../lib/admin/live.js', () => ({ adminSupabase: vi.fn(), liveAdminDeps: vi.fn(() => ({})) }));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function fake(o: { accounts?: Record<string, { id: string; confirmed: boolean }>; apple?: string[]; appleAccount?: string[]; card?: string[]; groups?: Record<string, string>; mode?: 'live' | 'test' | null; auditFails?: boolean } = {}) {
  const accounts = o.accounts ?? { 'barber@example.com': { id: A, confirmed: true } };
  const groups: Record<string, { price_group: string; source: string }> = Object.fromEntries(Object.entries(o.groups ?? {}).map(([k, v]) => [k, { price_group: v, source: 'free-site' }]));
  const writes: Array<[string, string, string]> = [];
  const deps: FreeGrantDeps = {
    mode: () => (o.mode === undefined ? 'live' : o.mode),
    userByEmail: async (e) => { const a = accounts[e]; return a ? { id: a.id, email: e, emailConfirmed: a.confirmed } : null; },
    holdsAppleAddress: async (uid) => (o.apple ?? []).includes(uid),
    hasCardPlan: async (uid) => (o.card ?? []).includes(uid),
    appStoreAccount: async (uid) => (o.appleAccount ?? []).includes(uid),
    readGroup: async (uid) => groups[uid]?.price_group ?? null,
    writeGroup: async (uid, group, source) => { writes.push([uid, group, source]); groups[uid] = { price_group: group, source }; },
    audit: vi.fn(async () => { if (o.auditFails) throw new Error('audit down'); }),
  };
  return { deps, groups, writes };
}

describe('setFreeGroup', () => {
  it('grant-free writes the row (source admin), replacing an existing group, and audits', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const f = fake({ groups: { [A]: 'base' } });
    const r = await setFreeGroup('grant-free', 'Barber@Example.com', f.deps, 'admin@x');
    expect(r).toEqual({ ok: true, userId: A, email: 'barber@example.com', group: 'free', previous: 'base' });
    expect(f.writes).toEqual([[A, 'free', 'admin']]);
    expect(f.deps.audit).toHaveBeenCalledWith({ action: 'grant-free', by: 'admin@x', userId: A, email: 'barber@example.com', previous: 'base' });
  });
  it('revoke-free writes base with source admin-revoke, and audits', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const f = fake({ groups: { [A]: 'free' } });
    expect(await setFreeGroup('revoke-free', 'barber@example.com', f.deps)).toMatchObject({ ok: true, group: 'base', previous: 'free' });
    expect(f.writes).toEqual([[A, 'base', 'admin-revoke']]);
    expect(f.deps.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'revoke-free' }));
  });
  it('refuses an account that holds an Apple address (nothing written); revoke is allowed for it', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const f = fake({ apple: [A], groups: { [A]: 'free' } });
    expect(await setFreeGroup('grant-free', 'barber@example.com', f.deps)).toMatchObject({ ok: false, error: 'apple-address' });
    expect(f.writes).toEqual([]);
    expect(await setFreeGroup('revoke-free', 'barber@example.com', f.deps)).toMatchObject({ ok: true, group: 'base' });
  });
  it('refuses an unknown or unconfirmed account and a bad email (nothing written)', async () => {
    const f = fake({ accounts: { 'new@example.com': { id: B, confirmed: false } } });
    expect(await setFreeGroup('grant-free', 'nobody@example.com', f.deps)).toMatchObject({ ok: false, error: 'not-found' });
    expect(await setFreeGroup('grant-free', 'new@example.com', f.deps)).toMatchObject({ ok: false, error: 'unconfirmed' });
    expect(await setFreeGroup('revoke-free', 'new@example.com', f.deps)).toMatchObject({ ok: false, error: 'unconfirmed' });
    expect(await setFreeGroup('grant-free', 'nope', f.deps)).toMatchObject({ ok: false, error: 'bad-request' });
    expect(f.writes).toEqual([]);
  });
  it('revoke-free refuses unless the stored group is exactly free (no row, base, g10, g20): not-free, nothing written', async () => {
    for (const g of [undefined, 'base', 'g10', 'g20']) {
      const f = fake({ groups: g ? { [A]: g } : {} });
      expect(await setFreeGroup('revoke-free', 'barber@example.com', f.deps), String(g)).toMatchObject({ ok: false, error: 'not-free' });
      expect(f.writes).toEqual([]);
    }
  });
  it('grant-free refuses a g10 / g20 account (has-price-group); no row and base are allowed', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    for (const g of ['g10', 'g20']) {
      const f = fake({ groups: { [A]: g } });
      expect(await setFreeGroup('grant-free', 'barber@example.com', f.deps)).toMatchObject({ ok: false, error: 'has-price-group' });
      expect(f.writes).toEqual([]);
    }
    for (const groups of [{}, { [A]: 'base' }]) expect(await setFreeGroup('grant-free', 'barber@example.com', fake({ groups }).deps)).toMatchObject({ ok: true });
  });
  it('grant-free refuses an account with a card plan (has-paid-plan)', async () => {
    const f = fake({ card: [A] });
    expect(await setFreeGroup('grant-free', 'barber@example.com', f.deps)).toMatchObject({ ok: false, error: 'has-paid-plan' });
    expect(f.writes).toEqual([]);
  });
  it('grant-free refuses a live Apple purchase or a shop linked to one (apple-account), the assignGroup rule', async () => {
    const f = fake({ appleAccount: [A] });
    expect(await setFreeGroup('grant-free', 'barber@example.com', f.deps)).toMatchObject({ ok: false, error: 'apple-account' });
    expect(f.writes).toEqual([]);
  });
  it('Production key only: a test or missing key writes nothing', async () => {
    for (const mode of ['test', null] as const) {
      const f = fake({ mode });
      expect(await setFreeGroup('grant-free', 'barber@example.com', f.deps)).toMatchObject({ ok: false, error: 'not-production' });
      expect(f.writes).toEqual([]);
    }
  });
  it('a failed audit never undoes the write; a failed Apple-address read throws before anything is written', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fake({ auditFails: true });
    expect(await setFreeGroup('grant-free', 'barber@example.com', f.deps)).toMatchObject({ ok: true });
    const g = fake();
    g.deps.holdsAppleAddress = async () => { throw new Error('db down'); };
    await expect(setFreeGroup('grant-free', 'barber@example.com', g.deps)).rejects.toThrow('db down');
    expect(g.writes).toEqual([]);
  });
});

describe('liveFreeGrantDeps against a mocked sbRest', () => {
  it('reads the previous group, upserts the row (merge-duplicates on user_id) and inserts the ab_events audit', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    rest.calls.length = 0; rest.tables = { web_app_price_groups: [{ price_group: 'base' }] };
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_x');
    const inserts: any[] = [];
    const client: any = {
      auth: { admin: { listUsers: async () => ({ data: { users: [{ id: A, email: 'barber@example.com', email_confirmed_at: '2026-01-01' }] }, error: null }) } },
      from: (t: string) => ({ insert: async (row: any) => { inserts.push([t, row]); return { error: null }; } }),
    };
    const r = await setFreeGroup('grant-free', 'barber@example.com', liveFreeGrantDeps(client), 'admin@x');
    vi.unstubAllEnvs();
    expect(r).toMatchObject({ ok: true, group: 'free', previous: 'base' });
    const post = rest.calls.find((c) => c.init.method === 'POST')!;
    expect(post.path).toBe('web_app_price_groups?on_conflict=user_id');
    expect(post.init.body).toEqual({ user_id: A, price_group: 'free', source: 'admin' });
    expect(post.init.prefer).toBe('resolution=merge-duplicates,return=minimal');
    expect(rest.calls.some((c) => c.path.startsWith(`web_app_price_groups?user_id=eq.${A}&select=price_group`))).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0][0]).toBe('ab_events');
    expect(inserts[0][1]).toMatchObject({ kind: 'admin_free_group', payload: { action: 'grant-free', userId: A, previous: 'base', by: 'admin@x' } });
  });
});

describe('liveFreeGrantDeps refusals from mocked database rows', () => {
  const client: any = { auth: { admin: { listUsers: async () => ({ data: { users: [{ id: A, email: 'barber@example.com', email_confirmed_at: '2026-01-01' }] }, error: null }) } }, from: () => ({ insert: async () => ({ error: null }) }) };
  const purchase = (o: object) => ({ original_transaction_id: 'T1', product_id: 'com.ibrahim1774.aibarber.hosting.monthly', environment: 'Production', expires_at: '2099-01-01T00:00:00Z', revoked_at: null, taken_down_at: null, site_slug: null, published_at: null, removed_at: null, user_id: A, ...o });
  const run = async (tables: Record<string, any[]>) => {
    rest.calls.length = 0; rest.tables = tables;
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_x');
    try { return await setFreeGroup('grant-free', 'barber@example.com', liveFreeGrantDeps(client)); } finally { vi.unstubAllEnvs(); }
  };
  it('apple-address, apple-account and has-paid-plan come from the real readers, and nothing is written', async () => {
    expect(await run({ ios_purchases: [purchase({ site_slug: 'a', published_at: 'x' })] })).toMatchObject({ ok: false, error: 'apple-address' });
    expect(await run({ ios_purchases: [purchase({})] })).toMatchObject({ ok: false, error: 'apple-account' });
    expect(await run({ web_app_entitlements: [{ stripe_subscription_id: 'sub_1', status: 'active', tier: 'bookings' }] })).toMatchObject({ ok: false, error: 'has-paid-plan' });
    expect(rest.calls.some((c) => c.init.method === 'POST')).toBe(false);
    expect(await run({})).toMatchObject({ ok: true, group: 'free' });
  });
});

describe('/api/admin/sites grant-free and revoke-free', () => {
  const handler = (core: unknown) => makeAdminSitesHandler({
    emailOf: () => async (t: string) => (t === 'admin' ? ADMIN_EMAIL : t === 'user' ? 'x@example.com' : null),
    core: () => core as any, reads: memoryStore(), writes: memoryStore(), now: () => 1_000, configured: () => true,
  });
  const call = async (h: any, body: unknown, token: string | null = 'admin') => {
    const r: any = { statusCode: 0, body: null, setHeader() {}, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
    await h({ method: 'POST', query: {}, body, headers: token ? { authorization: `Bearer ${token}` } : {} } as any, r);
    return r;
  };
  it('admin only: no token 401, another user 403, nothing written', async () => {
    const f = fake(); const h = handler({ freeGrant: f.deps });
    expect((await call(h, { action: 'grant-free', email: 'barber@example.com' }, null)).statusCode).toBe(401);
    expect((await call(h, { action: 'grant-free', email: 'barber@example.com' }, 'user')).statusCode).toBe(403);
    expect((await call(h, { action: 'revoke-free', email: 'barber@example.com' }, 'user')).statusCode).toBe(403);
    expect(f.writes).toEqual([]);
  });
  it('the admin writes the row: 200; an Apple address 409; unknown account 404; bad email 400; no deps 503', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const f = fake({ accounts: { 'barber@example.com': { id: A, confirmed: true }, 'apple@example.com': { id: B, confirmed: true } }, apple: [B] });
    const h = handler({ freeGrant: f.deps });
    expect(await call(h, { action: 'grant-free', email: 'barber@example.com' })).toMatchObject({ statusCode: 200, body: { ok: true, userId: A, group: 'free' } });
    expect(f.writes).toEqual([[A, 'free', 'admin']]);
    expect(await call(h, { action: 'grant-free', email: 'apple@example.com' })).toMatchObject({ statusCode: 409, body: { error: 'apple-address' } });
    expect((await call(h, { action: 'grant-free', email: 'nobody@example.com' })).statusCode).toBe(404);
    expect((await call(h, { action: 'grant-free', email: 'nope' })).statusCode).toBe(400);
    expect(await call(h, { action: 'revoke-free', email: 'barber@example.com' })).toMatchObject({ statusCode: 200, body: { group: 'base' } });
    expect(f.writes.at(-1)).toEqual([A, 'base', 'admin-revoke']);
    expect((await call(handler({}), { action: 'grant-free', email: 'barber@example.com' })).statusCode).toBe(503);
  });
});
