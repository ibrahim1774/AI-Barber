// liveSitesDeps over a faked fetch: the PostgREST behaviour the table logic relies on.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveSitesDeps, takeAddress } from '../../lib/account/sites.js';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const UID = '11111111-1111-4111-8111-111111111111';

function table(seed: any[] = []) {
  const rows = seed.map((r) => ({ ...r }));
  const calls: { url: string; method: string; prefer: string; body?: any }[] = [];
  vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    const method = init?.method ?? 'GET'; const prefer = init?.headers?.Prefer ?? '';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, prefer, body });
    const json = (d: any, status = 200) => new Response(JSON.stringify(d), { status });
    if (method === 'POST') {
      if (rows.some((r) => r.slug === body.slug)) return json({ code: '23505' }, 409); // unique(slug)
      if (rows.some((r) => r.user_id === body.user_id && r.environment === body.environment)) return json([]); // ignore-duplicates on the primary key: nothing returned
      rows.push(body); return json([body], 201);
    }
    if (method === 'GET') {
      const u = new URL(url); const q = (k: string) => u.searchParams.get(k)?.replace(/^eq\./, '');
      return json(rows.filter((r) => (!q('user_id') || r.user_id === q('user_id')) && (!q('environment') || r.environment === q('environment')) && (!q('slug') || r.slug === q('slug'))));
    }
    return json(null, 200);
  }));
  return { rows, calls };
}

describe('liveSitesDeps wire behaviour', () => {
  it('insert: ignore-duplicates returns [] on a primary-key conflict (false) and 409 on a slug conflict (throws status 409)', async () => {
    const t = table([{ user_id: UID, environment: 'Production', slug: 'mine', holder: 'web', published_once: false }]);
    const d = liveSitesDeps();
    expect(await d.insert({ user_id: UID, environment: 'Production', slug: 'another', holder: 'web' })).toBe(false); // same (user, env)
    await expect(d.insert({ user_id: 'u2', environment: 'Production', slug: 'mine', holder: 'web' })).rejects.toMatchObject({ status: 409 });
    expect(await d.insert({ user_id: 'u2', environment: 'Production', slug: 'free', holder: 'apple' })).toBe(true);
    expect(t.calls.filter((c) => c.method === 'POST').every((c) => c.prefer === 'resolution=ignore-duplicates,return=representation' && c.url.includes('on_conflict=user_id,environment'))).toBe(true);
  });
  it('takeAddress over the wire: a slug held by another account is refused with no existing row; the same row is ok', async () => {
    table([{ user_id: 'other', environment: 'Production', slug: 'taken', holder: 'web', published_once: true }]);
    const d = liveSitesDeps();
    expect(await takeAddress(UID, 'Production', 'taken', 'web', d)).toEqual({ status: 'refused', existing: null });
    expect(await takeAddress(UID, 'Production', 'new', 'web', d)).toMatchObject({ status: 'ok', created: true });
    expect(await takeAddress(UID, 'Production', 'new', 'web', d)).toMatchObject({ status: 'ok', created: false });
  });
  it('held() and the guarded writes build the exact filters (unpublished only, exact slug, holder web without a slug)', async () => {
    const t = table([{ user_id: UID, environment: 'Production', slug: 's', holder: 'web', published_once: false }]);
    const d = liveSitesDeps();
    expect(await d.held('s')).toBe(true);
    expect(await d.held('nope')).toBe(false);
    await d.release(UID, 'Production');
    await d.release(UID, 'Production', 's');
    await d.markPublishedOnce(UID, 'Production', 's');
    const w = t.calls.filter((c) => c.method !== 'GET' && c.method !== 'POST').map((c) => `${c.method} ${decodeURIComponent(c.url.split('/rest/v1/')[1])}`);
    expect(w).toEqual([
      `DELETE account_sites?user_id=eq.${UID}&environment=eq.Production&published_once=eq.false&holder=eq.web`,
      `DELETE account_sites?user_id=eq.${UID}&environment=eq.Production&published_once=eq.false&slug=eq.s`,
      `PATCH account_sites?user_id=eq.${UID}&environment=eq.Production&slug=eq.s&published_once=eq.false`,
    ]);
  });
});

// A small PostgREST over arrays: eq., lt., not.is.null filters, order, limit, offset, GET/PATCH/DELETE. Records every request.
function pg(tables: Record<string, any[]>) {
  const log: { method: string; table: string; query: string }[] = [];
  vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    const u = new URL(url); const table = u.pathname.split('/rest/v1/')[1]; const method = init?.method ?? 'GET';
    log.push({ method, table, query: decodeURIComponent(u.search.slice(1)) });
    const body = init?.body ? JSON.parse(init.body) : undefined;
    let rows = tables[table] ?? [];
    const keep = (r: any) => [...u.searchParams.entries()].every(([k, v]) => {
      if (['select', 'order', 'limit', 'offset'].includes(k)) return true;
      if (v.startsWith('eq.')) return String(r[k]) === v.slice(3) || (v === 'eq.false' && r[k] === false);
      if (v.startsWith('lt.')) return String(r[k]) < v.slice(3);
      if (v === 'not.is.null') return r[k] != null;
      return true;
    });
    let hit = rows.filter(keep);
    if (method === 'DELETE') { tables[table] = rows.filter((r) => !keep(r)); return new Response('[]', { status: 200 }); }
    if (method === 'PATCH') { for (const r of hit) Object.assign(r, body); return new Response('[]', { status: 200 }); }
    const ord = u.searchParams.get('order'); if (ord) { const [c] = ord.split('.'); hit = [...hit].sort((a, b) => (a[c] < b[c] ? -1 : 1)); }
    const off = Number(u.searchParams.get('offset') ?? 0); const lim = Number(u.searchParams.get('limit') ?? 1000);
    return new Response(JSON.stringify(hit.slice(off, off + lim)), { status: 200 });
  }));
  return { tables, log };
}
const OLD = '2026-11-01T00:00:00.000Z';
const BEFORE = '2026-11-17T00:00:00.000Z';
const row = (slug: string, holder: 'web' | 'apple', over: any = {}) => ({ user_id: `u-${slug}`, environment: 'Production', slug, holder, published_once: false, taken_at: OLD, ...over });

describe('liveSitesDeps().cleanup over the wire', () => {
  it('reads each candidate, deletes only the stale ones with the published_once=false guard, heals a live web row, keeps a bound Apple row, and respects the environment', async () => {
    const t = pg({
      account_sites: [row('stale-web', 'web'), row('live-web', 'web'), row('bound-apple', 'apple'), row('stale-apple', 'apple'), row('sbx', 'web', { environment: 'Sandbox' }), row('fresh', 'web', { taken_at: '2026-11-17T12:00:00.000Z' }), row('done', 'web', { published_once: true })],
      web_app_sites: [{ slug: 'live-web', published_at: '2026-11-02T00:00:00Z' }],
      ios_purchases: [{ site_slug: 'bound-apple', original_transaction_id: 'o1' }],
    });
    const n = await liveSitesDeps().cleanup(BEFORE, 'Production');
    expect(n).toBe(2);
    expect(t.tables.account_sites.map((r) => r.slug).sort()).toEqual(['bound-apple', 'done', 'fresh', 'live-web', 'sbx']);
    expect(t.tables.account_sites.find((r) => r.slug === 'live-web').published_once).toBe(true); // healed
    const deletes = t.log.filter((l) => l.method === 'DELETE').map((l) => l.query);
    expect(deletes).toHaveLength(2);
    expect(deletes.every((q) => q.includes('published_once=eq.false'))).toBe(true);
    expect(t.log.find((l) => l.method === 'GET' && l.table === 'account_sites')!.query).toMatch(/environment=eq\.Production.*order=taken_at\.asc.*limit=100/);
    expect(t.log.some((l) => l.table === 'web_app_sites' && l.query.includes('slug=eq.stale-web') && l.query.includes('published_at=not.is.null'))).toBe(true);
    expect(t.log.some((l) => l.table === 'ios_purchases' && l.query.includes('site_slug=eq.stale-apple'))).toBe(true);
  });
  it('kept rows do not starve the rest: with more than a page of bound Apple rows first, later stale rows are still cleaned', async () => {
    const kept = Array.from({ length: 120 }, (_, i) => row(`bound-${i}`, 'apple', { taken_at: `2026-10-01T00:${String(i % 60).padStart(2, '0')}:00.000Z` }));
    const t = pg({
      account_sites: [...kept, row('late-stale', 'web', { taken_at: '2026-11-10T00:00:00.000Z' })],
      web_app_sites: [], ios_purchases: kept.map((k) => ({ site_slug: k.slug, original_transaction_id: k.slug })),
    });
    expect(await liveSitesDeps().cleanup(BEFORE, 'Production')).toBe(1);
    expect(t.tables.account_sites).toHaveLength(120);
    const pages = t.log.filter((l) => l.method === 'GET' && l.table === 'account_sites').map((l) => /offset=(\d+)/.exec(l.query)![1]);
    expect(pages).toEqual(['0', '100']); // the second page starts past the 100 kept rows
  });
  it('stops at its time budget', async () => {
    const t = pg({ account_sites: Array.from({ length: 150 }, (_, i) => row(`s${i}`, 'web')), web_app_sites: [] });
    expect(await liveSitesDeps().cleanup(BEFORE, 'Production', 0)).toBe(0);
    expect(t.tables.account_sites).toHaveLength(150);
  });
});
