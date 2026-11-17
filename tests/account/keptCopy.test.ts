import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEPT_CAP, MAX_KEPT_BYTES, storeKeptCopy, type KeptStore } from '../../lib/account/keptCopy.js';
import handler from '../../api/account/kept-copy.js';

const U = '11111111-1111-4111-8111-111111111111';
const V = '22222222-2222-4222-8222-222222222222';

function fake(o: { missing?: boolean } = {}) {
  const rows: { user_id: string; digest: string; n: number; expires_at: number; site_data: unknown }[] = [];
  let n = 0;
  const miss = () => { if (o.missing) throw Object.assign(new Error('404'), { status: 404 }); };
  const store: KeptStore = {
    async has(uid, d) { miss(); return rows.some((r) => r.user_id === uid && r.digest === d); },
    async trim(uid, keep) { miss(); const mine = rows.filter((r) => r.user_id === uid).sort((a, b) => b.n - a.n); for (const r of mine.slice(keep)) rows.splice(rows.indexOf(r), 1); },
    async insert(r) { miss(); if (!rows.some((x) => x.user_id === r.user_id && x.digest === r.digest)) rows.push({ user_id: r.user_id, digest: r.digest, n: ++n, expires_at: Date.now() + 90 * 86_400_000, site_data: r.site_data }); },
    async expire(iso) { miss(); let c = 0; for (let i = rows.length - 1; i >= 0; i--) if (rows[i].expires_at < Date.parse(iso)) { rows.splice(i, 1); c++; } return c; },
  };
  return { store, rows };
}
const body = (i: number, over: any = {}) => ({ kind: 'phone-draft', siteData: { shopName: `Shop ${i}` }, ...over });

describe('kept copies', () => {
  it('the same copy twice is stored once and both answers are success', async () => {
    const f = fake();
    expect(await storeKeptCopy(U, 'live', body(1), f.store)).toEqual({ status: 200, body: { ok: true, stored: true } });
    expect(await storeKeptCopy(U, 'live', body(1), f.store)).toEqual({ status: 200, body: { ok: true, stored: false } });
    expect(f.rows).toHaveLength(1);
  });
  it('another account may keep the same copy', async () => {
    const f = fake();
    await storeKeptCopy(U, 'live', body(1), f.store);
    await storeKeptCopy(V, 'live', body(1), f.store);
    expect(f.rows).toHaveLength(2);
  });
  it('caps at 50 per account and removes the oldest first', async () => {
    const f = fake();
    for (let i = 1; i <= KEPT_CAP + 5; i++) await storeKeptCopy(U, 'live', body(i), f.store);
    const mine = f.rows.filter((r) => r.user_id === U);
    expect(mine).toHaveLength(KEPT_CAP);
    expect(mine.some((r) => (r.site_data as any).shopName === 'Shop 1')).toBe(false);
    expect(mine.some((r) => (r.site_data as any).shopName === 'Shop 55')).toBe(true);
  });
  it('an identical copy at the cap removes nothing', async () => {
    const f = fake();
    for (let i = 1; i <= KEPT_CAP; i++) await storeKeptCopy(U, 'live', body(i), f.store);
    await storeKeptCopy(U, 'live', body(1), f.store);
    expect(f.rows).toHaveLength(KEPT_CAP);
  });
  it('413 above the draft size limit, 400 for a bad kind or body, 503 when the table is missing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = fake();
    expect((await storeKeptCopy(U, 'live', body(1, { siteData: { x: 'a'.repeat(MAX_KEPT_BYTES) } }), f.store)).status).toBe(413);
    expect((await storeKeptCopy(U, 'live', body(1, { kind: 'x' }), f.store)).status).toBe(400);
    expect((await storeKeptCopy(U, 'live', { kind: 'phone-draft' }, f.store)).status).toBe(400);
    expect((await storeKeptCopy(U, 'live', body(1), fake({ missing: true }).store)).status).toBe(503);
    expect(f.rows).toHaveLength(0);
  });
  it('expiry removes only expired rows', async () => {
    const f = fake();
    await storeKeptCopy(U, 'live', body(1), f.store);
    expect(await f.store.expire(new Date(Date.now() + 89 * 86_400_000).toISOString())).toBe(0);
    expect(await f.store.expire(new Date(Date.now() + 91 * 86_400_000).toISOString())).toBe(1);
  });
});

describe('POST /api/account/kept-copy gate', () => {
  afterEach(() => vi.unstubAllEnvs());
  const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };
  it('404 unless WEB_APP_CHECKOUT and WEB_APP_RELIABILITY are on', async () => {
    for (const [c, r] of [['', ''], ['1', ''], ['', '1']]) {
      vi.stubEnv('WEB_APP_CHECKOUT', c); vi.stubEnv('WEB_APP_RELIABILITY', r);
      const o = res(); await handler({ method: 'POST', headers: {}, body: {} }, o);
      expect(o.code).toBe(404);
    }
  });
  it('405 for other methods and 401 without a bearer, once on', async () => {
    vi.stubEnv('WEB_APP_CHECKOUT', '1'); vi.stubEnv('WEB_APP_RELIABILITY', '1');
    const g = res(); await handler({ method: 'GET', headers: {} }, g); expect(g.code).toBe(405);
    vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
    const p = res(); await handler({ method: 'POST', headers: {}, body: {} }, p); expect(p.code).toBe(401);
  });
});

describe('account delete cascades', () => {
  it('the migration references auth.users on delete cascade, RLS on, anon revoked', async () => {
    const sql = (await import('node:fs')).readFileSync(new URL('../../supabase/migrations/040_site_kept_copies.sql', import.meta.url), 'utf8');
    expect(sql).toMatch(/references auth\.users\(id\) on delete cascade/);
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/revoke all on public\.site_kept_copies from anon, authenticated/);
    expect(sql).toMatch(/unique \(user_id, digest\)/);
  });
});
