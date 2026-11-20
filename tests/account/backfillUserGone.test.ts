import { describe, expect, it } from 'vitest';
import { liveBackfillDeps, planBackfill, runBackfill, type BackfillDeps, type BackfillRow } from '../../lib/account/backfill.js';

const LIVE = '11111111-1111-4111-8111-111111111111';
const GONE = '99999999-9999-4999-8999-999999999999';
const LIVE2 = '22222222-2222-4222-8222-222222222222';
const pub = (user_id: string, slug: string, environment: 'live' | 'test' = 'live') => ({ user_id, slug, environment, published_at: '2026-01-01' });

describe('backfill skips deleted accounts', () => {
  it('lists a gone user\'s rows as user-gone and still plans the living user\'s', () => {
    const p = planBackfill([pub(GONE, 'old-shop'), pub(GONE, 'old-test', 'test'), pub(LIVE, 'my-shop')], [{ user_id: GONE, site_slug: 'old-app', environment: 'Production', published_at: 'x' }], [], new Set([LIVE]));
    expect(p.toInsert.map((r) => [r.user_id, r.slug])).toEqual([[LIVE, 'my-shop']]);
    expect(p.listed.filter((l) => l.reason === 'user-gone').map((l) => [l.user_id, l.environment, l.slugs])).toEqual([
      [GONE, 'Production', ['old-shop', 'old-app']], [GONE, 'Sandbox', ['old-test']],
    ]);
    expect(p.listed.some((l) => l.reason !== 'user-gone')).toBe(false); // a gone user is not also "mixed"
  });
  it('a slug held only by a gone user\'s row can be taken by a living user', () => {
    const p = planBackfill([pub(GONE, 'same-slug'), pub(LIVE, 'same-slug')], [], [], new Set([LIVE]));
    expect(p.toInsert.map((r) => [r.user_id, r.slug])).toEqual([[LIVE, 'same-slug']]);
    expect(p.listed.map((l) => l.reason)).toEqual(['user-gone']); // no slug-held
    // order must not matter (gone user sorts after the living one here)
    const q = planBackfill([pub(LIVE, 'same-slug'), pub(GONE, 'same-slug')], [], [], new Set([LIVE]));
    expect(q.toInsert).toHaveLength(1); expect(q.listed.map((l) => l.reason)).toEqual(['user-gone']);
  });
  it('a gone user\'s Apple purchase never makes a living holder\'s row stale', () => {
    const p = planBackfill([], [{ user_id: GONE, site_slug: 's', environment: 'Production', published_at: 'x' }, { user_id: LIVE, site_slug: 's', environment: 'Production', published_at: 'x' }], [{ user_id: LIVE2, environment: 'Production', slug: 's', holder: 'apple' }], new Set([LIVE, LIVE2]));
    expect(p.toDelete.map((r) => r.user_id)).toEqual([LIVE2]); // moved to LIVE (living), as before
    const q = planBackfill([], [{ user_id: GONE, site_slug: 's', environment: 'Production', published_at: 'x' }], [{ user_id: LIVE2, environment: 'Production', slug: 's', holder: 'apple' }], new Set([LIVE2]));
    expect(q.toDelete).toEqual([]);
  });
  it('without a user list nobody is skipped (the older rules are unchanged)', () => {
    expect(planBackfill([pub(GONE, 'x')], [], []).toInsert).toHaveLength(1);
  });

  const fakeDb = (webRows: any[], users: string[], insert: (row: BackfillRow, table: BackfillRow[]) => Promise<any>) => {
    const table: BackfillRow[] = [];
    const deps: BackfillDeps = { webSites: async () => webRows, apple: async () => [], existing: async () => [], remove: async () => false, users: async () => new Set(users), insert: (row) => insert(row, table) };
    return { table, deps };
  };
  it('apply: the plan never even tries the gone user; the counts are in the plan', async () => {
    const tried: string[] = [];
    const { deps } = fakeDb([pub(GONE, 'a'), pub(LIVE, 'b')], [LIVE], async (row, t) => { tried.push(row.user_id); t.push(row); return true; });
    const r = await runBackfill(deps, { apply: true });
    expect(tried).toEqual([LIVE]); expect(r.inserted).toBe(1);
    expect(r.plan.listed.filter((l) => l.reason === 'user-gone')).toHaveLength(1);
  });
  it('apply: a foreign-key 409 at insert is listed user-gone and the remaining rows are still inserted', async () => {
    const { deps, table } = fakeDb([pub(LIVE, 'a'), pub(LIVE2, 'b')], [LIVE, LIVE2], async (row, t) => { if (row.slug === 'a') return 'user-gone'; t.push(row); return true; });
    const r = await runBackfill(deps, { apply: true });
    expect(r.inserted).toBe(1); expect(table.map((x) => x.slug)).toEqual(['b']);
    expect(r.insertSkipped).toEqual([{ user_id: LIVE, environment: 'Production', reason: 'user-gone', slugs: ['a'] }]);
  });
  it('apply: a slug unique 409 is listed slug-held and the run continues', async () => {
    const { deps, table } = fakeDb([pub(LIVE, 'a'), pub(LIVE2, 'b')], [LIVE, LIVE2], async (row, t) => { if (row.slug === 'a') return 'slug-held'; t.push(row); return true; });
    const r = await runBackfill(deps, { apply: true });
    expect(r.inserted).toBe(1); expect(table).toHaveLength(1);
    expect(r.insertSkipped.map((l) => l.reason)).toEqual(['slug-held']);
  });
  it('apply: any other error still stops the run', async () => {
    const { deps } = fakeDb([pub(LIVE, 'a'), pub(LIVE2, 'b')], [LIVE, LIVE2], async () => { throw new Error('supabase 500'); });
    await expect(runBackfill(deps, { apply: true })).rejects.toThrow('supabase 500');
  });
});

describe('liveBackfillDeps', () => {
  const err = (status: number, code: string | undefined, pgDetails: string) => Object.assign(new Error(`supabase ${status}`), { status, code, pgDetails });
  const row: BackfillRow = { user_id: LIVE, environment: 'Production', slug: 's', holder: 'web', published_once: true };
  const insertWith = async (e: any) => (await liveBackfillDeps(async () => { throw e; })).insert(row);
  it('maps 23503 on the user to user-gone and 23505 on the slug to slug-held', async () => {
    expect(await insertWith(err(409, '23503', 'insert or update violates foreign key constraint "account_sites_user_id_fkey" Key (user_id)=(x) is not present in table "users".'))).toBe('user-gone');
    expect(await insertWith(err(409, '23505', 'duplicate key value violates unique constraint "account_sites_slug_key" Key (slug)=(s) already exists.'))).toBe('slug-held');
  });
  it('everything else throws: 500, a 409 without a code, another constraint', async () => {
    await expect(insertWith(err(500, undefined, ''))).rejects.toThrow('supabase 500');
    await expect(insertWith(err(409, undefined, ''))).rejects.toThrow('supabase 409');
    await expect(insertWith(err(409, '23505', 'Key (other)=(1) already exists.'))).rejects.toThrow('supabase 409');
    await expect(insertWith(err(409, '23503', 'Key (zzz)=(1) is not present in table "things".'))).rejects.toThrow('supabase 409');
  });
  it('users() pages the GoTrue list 1000 at a time and refuses an empty or failed list', async () => {
    process.env.SUPABASE_URL = 'https://x.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    const urls: string[] = [];
    const mk = (n: number, off: number) => Array.from({ length: n }, (_, i) => ({ id: `u${off + i}` }));
    const f: any = async (u: string) => { urls.push(u); const page = Number(/page=(\d+)/.exec(u)![1]); return { ok: true, status: 200, json: async () => ({ users: page === 1 ? mk(1000, 0) : page === 2 ? mk(5, 1000) : [] }) }; };
    const ids = await (await liveBackfillDeps(async () => [], f)).users!();
    expect(ids.size).toBe(1005); expect(urls).toHaveLength(3); // stops on the empty page, not the short one
    const empty: any = async () => ({ ok: true, status: 200, json: async () => ({ users: [] }) });
    await expect((await liveBackfillDeps(async () => [], empty)).users!()).rejects.toThrow(/empty/);
    const bad: any = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await expect((await liveBackfillDeps(async () => [], bad)).users!()).rejects.toThrow('500');
  });
  it('users() keeps paging when the server caps per_page (50 returned for 1000 asked)', async () => {
    process.env.SUPABASE_URL = 'https://x.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    const mk = (n: number, off: number) => Array.from({ length: n }, (_, i) => ({ id: `u${off + i}` }));
    const f: any = async (u: string) => { const page = Number(/page=(\d+)/.exec(u)![1]); return { ok: true, status: 200, headers: new Headers({ 'x-total-count': '120' }), json: async () => ({ users: page === 1 ? mk(50, 0) : page === 2 ? mk(50, 50) : page === 3 ? mk(20, 100) : [] }) }; };
    expect((await (await liveBackfillDeps(async () => [], f)).users!()).size).toBe(120);
  });
  it('users() throws when x-total-count is higher than what was collected', async () => {
    process.env.SUPABASE_URL = 'https://x.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    const f: any = async (u: string) => { const page = Number(/page=(\d+)/.exec(u)![1]); return { ok: true, status: 200, headers: new Headers({ 'x-total-count': '500' }), json: async () => ({ users: page === 1 ? [{ id: 'a' }, { id: 'b' }] : [] }) }; };
    await expect((await liveBackfillDeps(async () => [], f)).users!()).rejects.toThrow(/incomplete/);
  });
  it('users() throws on a body without users', async () => {
    process.env.SUPABASE_URL = 'https://x.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    const f: any = async () => ({ ok: true, status: 200, json: async () => ({}) });
    await expect((await liveBackfillDeps(async () => [], f)).users!()).rejects.toThrow(/unreadable/);
  });
});

describe('one living user, same Apple slug in Production and Sandbox', () => {
  const apple = [{ user_id: LIVE, site_slug: 'dual', environment: 'Sandbox', published_at: 'x' }, { user_id: LIVE, site_slug: 'dual', environment: 'Production', published_at: 'x' }];
  it('plans one insert (Production) and lists Sandbox as slug-held at plan time', () => {
    const p = planBackfill([], apple, [], new Set([LIVE]));
    expect(p.toInsert.map((r) => [r.environment, r.slug])).toEqual([['Production', 'dual']]);
    expect(p.listed).toEqual([{ user_id: LIVE, environment: 'Sandbox', reason: 'slug-held', slugs: ['dual'] }]);
  });
  it('when Production is already stored, Sandbox is slug-held too', () => {
    const p = planBackfill([], apple, [{ user_id: LIVE, environment: 'Production', slug: 'dual', holder: 'apple' }], new Set([LIVE]));
    expect(p.toInsert).toEqual([]); expect(p.alreadyThere).toBe(1);
    expect(p.listed.map((l) => [l.environment, l.reason])).toEqual([['Sandbox', 'slug-held']]);
  });
  it('a second plan after apply reports wouldInsert 0', async () => {
    const table: any[] = [];
    const deps: BackfillDeps = { webSites: async () => [], apple: async () => apple, existing: async () => table.map((r) => ({ ...r })), remove: async () => false, users: async () => new Set([LIVE]), insert: async (row) => { table.push(row); return true; } };
    const first = await runBackfill(deps, { apply: true });
    expect(first.inserted).toBe(1); expect(first.insertSkipped).toEqual([]);
    const second = await runBackfill(deps, { apply: false });
    expect(second.plan.toInsert).toHaveLength(0);
    expect(second.plan.listed.map((l) => l.reason)).toEqual(['slug-held']);
  });
});
