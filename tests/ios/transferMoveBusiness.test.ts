import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal in-memory Supabase: select/update with eq/neq/in/ilike filters, maybeSingle.
const tables: Record<string, any[]> = {};
const writes: Array<{ table: string; patch: any }> = [];
let failOn: string | null = null;

function builder(table: string) {
  let mode: 'select' | 'update' = 'select';
  let patch: any = null;
  const filters: Array<(r: any) => boolean> = [];
  const run = () => {
    if (failOn === `${mode}:${table}`) return { data: null, error: { message: 'boom' } };
    const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    if (mode === 'update') { rows.forEach((r) => Object.assign(r, patch)); writes.push({ table, patch }); return { data: rows, error: null }; }
    return { data: rows.map((r) => ({ ...r })), error: null };
  };
  const b: any = {
    select: () => b,
    update: (p: any) => { mode = 'update'; patch = p; return b; },
    eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return b; },
    neq: (c: string, v: any) => { filters.push((r) => r[c] !== v); return b; },
    in: (c: string, vs: any[]) => { filters.push((r) => vs.includes(r[c])); return b; },
    ilike: (c: string, pat: string) => { const needle = pat.replace(/%/g, '').toLowerCase(); filters.push((r) => String(r[c] ?? '').toLowerCase().includes(needle)); return b; },
    maybeSingle: async () => { const r = run(); return r.error ? r : { data: (r.data as any[])[0] ?? null, error: null }; },
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('../../lib/bookings/repo.js', () => ({ serviceClient: () => ({}) }));

import { liveMoveBusiness } from '../../lib/ios/transferLive.js';

const O = 'o-user', C = 'c-user', X = 'x-user';
const OTID = '2000000123';

beforeEach(() => {
  process.env.SUPABASE_URL = 'http://x'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  failOn = null; writes.length = 0;
  tables.sites = [
    { id: 's1', user_id: O, deployed_url: 'https://fade-lab.vercel.app' },
    { id: 's2', user_id: O, deployed_url: 'https://other-site.vercel.app' },
    { id: 's3', user_id: X, deployed_url: 'https://fade-lab-two.vercel.app' },
  ];
  tables.ab_shops = [{ id: 'shop1', owner_id: O, ios_otid: OTID }, { id: 'shop2', owner_id: X, ios_otid: '555' }];
  tables.ab_members = [
    { id: 'm1', shop_id: 'shop1', role: 'owner', user_id: O },
    { id: 'm2', shop_id: 'shop1', role: 'barber', user_id: X },
    { id: 'm3', shop_id: 'shop2', role: 'owner', user_id: X },
  ];
  tables.ab_push_tokens = [{ user_id: O, expo_token: 't' }];
  tables.ios_domains = [{ original_transaction_id: OTID, site_slug: 'fade-lab' }];
});

describe('liveMoveBusiness (per-table decisions)', () => {
  it('moves the slug\'s sites row, the shop, and the owner member; nothing else', async () => {
    await liveMoveBusiness(OTID, C, 'fade-lab');
    expect(tables.sites.find((r) => r.id === 's1')!.user_id).toBe(C);
    expect(tables.sites.find((r) => r.id === 's2')!.user_id).toBe(O); // another slug of O: untouched
    expect(tables.sites.find((r) => r.id === 's3')!.user_id).toBe(X); // prefix look-alike slug: untouched
    expect(tables.ab_shops.find((r) => r.id === 'shop1')).toMatchObject({ owner_id: C, ios_otid: OTID });
    expect(tables.ab_shops.find((r) => r.id === 'shop2')).toMatchObject({ owner_id: X });
    expect(tables.ab_members.find((r) => r.id === 'm1')!.user_id).toBe(C);
    expect(tables.ab_members.find((r) => r.id === 'm2')!.user_id).toBe(X); // staff member keeps their login
    expect(tables.ab_members.find((r) => r.id === 'm3')!.user_id).toBe(X);
    expect(tables.ab_push_tokens[0].user_id).toBe(O); // push tokens stay with the device owner
    expect(tables.ios_domains[0]).toEqual({ original_transaction_id: OTID, site_slug: 'fade-lab' });
    expect(writes.map((w) => w.table).sort()).toEqual(['ab_members', 'ab_shops', 'sites']);
  });

  it('idempotent: a second run changes nothing', async () => {
    await liveMoveBusiness(OTID, C, 'fade-lab');
    const snap = JSON.stringify(tables);
    await liveMoveBusiness(OTID, C, 'fade-lab');
    expect(JSON.stringify(tables)).toBe(snap);
  });

  it('finishes a half-done move: sites already moved, shop not yet', async () => {
    tables.sites[0].user_id = C;
    await liveMoveBusiness(OTID, C, 'fade-lab');
    expect(tables.ab_shops[0].owner_id).toBe(C);
    expect(tables.ab_members[0].user_id).toBe(C);
  });

  it('finishes a half-done move: shop moved, owner member not yet', async () => {
    tables.ab_shops[0].owner_id = C;
    await liveMoveBusiness(OTID, C, 'fade-lab');
    expect(tables.ab_members[0].user_id).toBe(C);
  });

  it('no slug and no shop: nothing to do', async () => {
    tables.ab_shops = [];
    await liveMoveBusiness(OTID, C, null);
    expect(writes).toEqual([]);
  });

  it('caller already owns a different shop: the purchase\'s shop is only detached (ios_otid null), never moved or deleted', async () => {
    tables.ab_shops.push({ id: 'shopC', owner_id: C, ios_otid: null });
    await liveMoveBusiness(OTID, C, 'fade-lab');
    expect(tables.ab_shops.find((r) => r.id === 'shop1')).toMatchObject({ owner_id: O, ios_otid: null });
    expect(tables.ab_members.find((r) => r.id === 'm1')!.user_id).toBe(O);
  });

  it.each(['select:sites', 'update:sites', 'select:ab_shops', 'update:ab_shops', 'update:ab_members'])('a database error on %s throws (so the move answers 503 and a retry finishes it)', async (f) => {
    failOn = f;
    await expect(liveMoveBusiness(OTID, C, 'fade-lab')).rejects.toThrow();
  });
});
