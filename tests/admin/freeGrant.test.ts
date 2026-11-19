// Admin grant-free / revoke-free (lib/admin/freeGrant.ts, api/admin/sites.ts): the Free price group by email.
import { describe, expect, it, vi } from 'vitest';
import { setFreeGroup, type FreeGrantDeps } from '../../lib/admin/freeGrant.js';
import { makeAdminSitesHandler } from '../../api/admin/sites.js';
import { ADMIN_EMAIL } from '../../lib/admin/auth.js';
import { memoryStore } from '../../lib/bookings/rateLimit.js';

vi.mock('../../lib/admin/live.js', () => ({ adminSupabase: vi.fn(), liveAdminDeps: vi.fn(() => ({})) }));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function fake(o: { accounts?: Record<string, { id: string; confirmed: boolean }>; apple?: string[]; groups?: Record<string, string>; mode?: 'live' | 'test' | null; auditFails?: boolean } = {}) {
  const accounts = o.accounts ?? { 'barber@example.com': { id: A, confirmed: true } };
  const groups: Record<string, { price_group: string; source: string }> = Object.fromEntries(Object.entries(o.groups ?? {}).map(([k, v]) => [k, { price_group: v, source: 'free-site' }]));
  const writes: Array<[string, string, string]> = [];
  const deps: FreeGrantDeps = {
    mode: () => (o.mode === undefined ? 'live' : o.mode),
    userByEmail: async (e) => { const a = accounts[e]; return a ? { id: a.id, email: e, emailConfirmed: a.confirmed } : null; },
    holdsAppleAddress: async (uid) => (o.apple ?? []).includes(uid),
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
    const f = fake({ apple: [A] });
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
