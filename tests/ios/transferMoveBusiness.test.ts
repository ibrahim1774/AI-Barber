import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal in-memory Supabase: select/insert/update with eq/neq/in/like/limit filters, maybeSingle, unique dedupe_key.
const tables: Record<string, any[]> = {};
const writes: Array<{ table: string; patch: any }> = [];
let failOn: string | null = null;
const val = (r: any, c: string) => (c.includes('->>') ? c.split('->>').reduce((acc: any, k, i) => (i === 0 ? r[k] : acc?.[k]), null as any) : r[c]);

function builder(table: string) {
  let mode: 'select' | 'update' | 'insert' = 'select';
  let patch: any = null;
  let lim = Infinity;
  const filters: Array<(r: any) => boolean> = [];
  const run = () => {
    if (failOn === `${mode}:${table}`) return { data: null, error: { message: 'boom' } };
    if (mode === 'insert') {
      const rows = tables[table] ?? (tables[table] = []);
      if (patch.dedupe_key && rows.some((r) => r.dedupe_key === patch.dedupe_key)) return { data: null, error: { code: '23505', message: 'dup' } };
      rows.push({ id: `${table}-${rows.length}`, ...patch });
      writes.push({ table, patch });
      return { data: null, error: null };
    }
    const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, lim);
    if (mode === 'update') { rows.forEach((r) => Object.assign(r, patch)); writes.push({ table, patch }); return { data: rows, error: null }; }
    return { data: rows.map((r) => ({ ...r })), error: null };
  };
  const b: any = {
    select: () => b,
    insert: (p: any) => { mode = 'insert'; patch = p; return b; },
    update: (p: any) => { mode = 'update'; patch = p; return b; },
    eq: (c: string, v: any) => { filters.push((r) => val(r, c) === v); return b; },
    neq: (c: string, v: any) => { filters.push((r) => val(r, c) !== v); return b; },
    in: (c: string, vs: any[]) => { filters.push((r) => vs.includes(val(r, c))); return b; },
    like: (c: string, pat: string) => { const pre = pat.replace(/%$/, ''); filters.push((r) => String(val(r, c) ?? '').startsWith(pre)); return b; },
    limit: (n: number) => { lim = n; return b; },
    maybeSingle: async () => { const r = run(); return r.error ? r : { data: (r.data as any[])[0] ?? null, error: null }; },
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('../../lib/bookings/repo.js', () => ({ serviceClient: () => ({}) }));

import { liveMoveBusiness } from '../../lib/ios/transferLive.js';
import { liveMoveIntents, finishPendingMoves, moveInProgressFrom } from '../../lib/ios/moveIntent.js';

const O = 'o-user', C = 'c-user', X = 'x-user';
const OTID = '2000000123';
const move = (slug: string | null = 'fade-lab', from = O) => liveMoveBusiness(OTID, from, C, slug);
const shop1 = () => tables.ab_shops.find((r) => r.id === 'shop1');
const member = (id: string) => tables.ab_members.find((r) => r.id === id);

beforeEach(() => {
  process.env.SUPABASE_URL = 'http://x'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  failOn = null; writes.length = 0;
  tables.sites = [
    { id: 's1', user_id: O, deployed_url: 'https://fade-lab.vercel.app' },
    { id: 's2', user_id: O, deployed_url: 'https://other-site.vercel.app' },
    { id: 's3', user_id: X, deployed_url: 'https://fade-lab-two.vercel.app' },
    { id: 's4', user_id: X, deployed_url: 'https://fade-lab.vercel.app/' }, // X's row at the same url: never touched
  ];
  tables.ab_shops = [
    { id: 'shop1', owner_id: O, ios_otid: OTID, stripe_account_id: null, stripe_charges_enabled: false, manual_handles: {} },
    { id: 'shop2', owner_id: X, ios_otid: '555', stripe_account_id: 'acct_x', stripe_charges_enabled: true, manual_handles: { venmo: '@x' } },
  ];
  tables.ab_members = [
    { id: 'm1', shop_id: 'shop1', role: 'owner', user_id: O, active: true, ics_token: 'OLD-TOKEN-' + 'a'.repeat(30) },
    { id: 'm2', shop_id: 'shop1', role: 'barber', user_id: X, active: true, ics_token: 'x'.repeat(40) },
    { id: 'm3', shop_id: 'shop2', role: 'owner', user_id: X, active: true, ics_token: 'y'.repeat(40) },
  ];
  tables.ab_push_tokens = [{ user_id: O, expo_token: 't' }];
  tables.ios_domains = [{ original_transaction_id: OTID, site_slug: 'fade-lab' }];
  tables.ios_purchases = [];
  tables.ab_events = [];
});

describe('liveMoveBusiness (per-table decisions)', () => {
  it('moves the shop, its owner member, then the slug\'s sites row; nothing else', async () => {
    expect(await move()).toEqual({ paymentsReset: false });
    expect(tables.sites.find((r) => r.id === 's1')!.user_id).toBe(C);
    expect(tables.sites.find((r) => r.id === 's2')!.user_id).toBe(O);
    expect(tables.sites.find((r) => r.id === 's3')!.user_id).toBe(X);
    expect(tables.sites.find((r) => r.id === 's4')!.user_id).toBe(X);
    expect(shop1()).toMatchObject({ owner_id: C, ios_otid: OTID });
    expect(tables.ab_shops.find((r) => r.id === 'shop2')).toMatchObject({ owner_id: X, stripe_account_id: 'acct_x' });
    expect(member('m1')!.user_id).toBe(C);
    expect(member('m2')!.user_id).toBe(X);
    expect(member('m3')!.user_id).toBe(X);
    expect(tables.ab_push_tokens[0].user_id).toBe(O);
    expect(tables.ios_domains[0]).toEqual({ original_transaction_id: OTID, site_slug: 'fade-lab' });
  });

  it('M3: the shop and owner member move BEFORE the sites copy', async () => {
    await move();
    const order = writes.map((w) => w.table);
    expect(order.indexOf('ab_shops')).toBeLessThan(order.indexOf('sites'));
    expect(order.indexOf('ab_members')).toBeLessThan(order.indexOf('sites'));
  });

  it('M1: the owner calendar token is rotated; the old token matches no member any more', async () => {
    const old = member('m1')!.ics_token;
    await move();
    const now = member('m1')!.ics_token;
    expect(now).not.toBe(old);
    expect(now).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(tables.ab_members.some((m) => m.ics_token === old)).toBe(false);
    expect(member('m2')!.ics_token).toBe('x'.repeat(40)); // staff feeds untouched
  });

  it('M1: a retry does not rotate again', async () => {
    await move();
    const t = member('m1')!.ics_token;
    await move();
    expect(member('m1')!.ics_token).toBe(t);
  });

  it('M2: Stripe account, charges flag and manual handles are cleared; the old values are audited once; paymentsReset true', async () => {
    Object.assign(shop1(), { stripe_account_id: 'acct_o', stripe_charges_enabled: true, manual_handles: { cashapp: '$o' } });
    expect(await move()).toEqual({ paymentsReset: true });
    expect(shop1()).toMatchObject({ owner_id: C, stripe_account_id: null, stripe_charges_enabled: false, manual_handles: {} });
    const audit = tables.ab_events.filter((e) => e.kind === 'ios_transfer_payments_reset');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ shop_id: 'shop1', payload: { from: O, to: C, stripe_account_id: 'acct_o', stripe_charges_enabled: true, manual_handles: { cashapp: '$o' } } });
    // retry: still reports the reset (from the audit row), does not audit again
    expect(await move()).toEqual({ paymentsReset: true });
    expect(tables.ab_events.filter((e) => e.kind === 'ios_transfer_payments_reset')).toHaveLength(1);
  });

  it('M2: the audit row is written BEFORE the shop is changed (a failure leaves the old values recoverable)', async () => {
    Object.assign(shop1(), { stripe_account_id: 'acct_o' });
    failOn = 'update:ab_shops';
    await expect(move()).rejects.toThrow();
    expect(tables.ab_events.some((e) => e.kind === 'ios_transfer_payments_reset')).toBe(true);
    expect(shop1()).toMatchObject({ owner_id: O, stripe_account_id: 'acct_o' });
  });

  it('M2: only handles (no Stripe) also counts as payments', async () => {
    Object.assign(shop1(), { manual_handles: { zelle: 'o@x.com' } });
    expect((await move()).paymentsReset).toBe(true);
  });

  it('M4: C is already a barber in O\'s shop: that row is deactivated (user_id null), the owner row moves, exactly one active member row for C', async () => {
    tables.ab_members.push({ id: 'm4', shop_id: 'shop1', role: 'barber', user_id: C, active: true, ics_token: 'z'.repeat(40) });
    await move();
    expect(member('m4')).toMatchObject({ active: false, user_id: null });
    expect(member('m1')!.user_id).toBe(C);
    const forC = tables.ab_members.filter((m) => m.shop_id === 'shop1' && m.user_id === C);
    expect(forC).toHaveLength(1);
    expect(forC[0].role).toBe('owner');
    expect(tables.ab_members.some((m) => m.shop_id === 'shop1' && m.user_id === O)).toBe(false); // O has no member access left
  });

  it('H2: a shop of ANOTHER account holding this otid is never touched (only rows owned by `from`)', async () => {
    tables.ab_shops[0].owner_id = X; tables.ab_members[0].user_id = X;
    await move();
    expect(shop1()).toMatchObject({ owner_id: X });
    expect(member('m1')!.user_id).toBe(X);
    expect(tables.sites.find((r) => r.id === 's4')!.user_id).toBe(X);
  });

  it('H2: sites of another account at the slug url stay; only `from`\'s row moves', async () => {
    await move();
    expect(tables.sites.filter((r) => r.user_id === C).map((r) => r.id)).toEqual(['s1']);
  });

  it('idempotent: a second run changes nothing', async () => {
    await move();
    const snap = JSON.stringify(tables);
    await move();
    expect(JSON.stringify(tables)).toBe(snap);
  });

  it('finishes a half-done move: shop moved, owner member not yet', async () => {
    shop1()!.owner_id = C;
    await move();
    expect(member('m1')!.user_id).toBe(C);
    expect(tables.sites.find((r) => r.id === 's1')!.user_id).toBe(C);
  });

  it('finishes a half-done move: shop and member moved, sites not yet', async () => {
    shop1()!.owner_id = C; member('m1')!.user_id = C;
    await move();
    expect(tables.sites.find((r) => r.id === 's1')!.user_id).toBe(C);
  });

  it('unpublished draft (null deployed_url) moves when O has no other purchase; stays when O has another purchase', async () => {
    tables.sites.push({ id: 'd1', user_id: O, deployed_url: null });
    await move();
    expect(tables.sites.find((r) => r.id === 'd1')!.user_id).toBe(C);
    tables.sites.push({ id: 'd2', user_id: O, deployed_url: null });
    tables.ios_purchases = [{ original_transaction_id: '999', user_id: O }];
    await move();
    expect(tables.sites.find((r) => r.id === 'd2')!.user_id).toBe(O);
  });

  it('no slug and no shop: nothing to move', async () => {
    tables.ab_shops = [];
    await move(null);
    expect(writes).toEqual([]);
  });

  it('caller already owns a different shop: the move throws (503 and a retry later), nothing is changed or detached', async () => {
    tables.ab_shops.push({ id: 'shopC', owner_id: C, ios_otid: null });
    await expect(move()).rejects.toThrow(/another shop/);
    expect(shop1()).toMatchObject({ owner_id: O, ios_otid: OTID });
    expect(member('m1')!.user_id).toBe(O);
  });

  it.each(['select:sites', 'update:sites', 'select:ab_shops', 'update:ab_shops', 'update:ab_members', 'select:ios_purchases'])('a database error on %s throws (503, the finisher retries)', async (f) => {
    tables.sites.push({ id: 'd1', user_id: O, deployed_url: null });
    failOn = f;
    await expect(move()).rejects.toThrow();
  });
});

describe('move intents and the finisher', () => {
  const purchase = (u: string | null, slug: string | null = 'fade-lab') => async () => ({ user_id: u, site_slug: slug });

  it('begin writes one ab_events row; a second begin refreshes it; find/pendingFor/pendingFrom see it', async () => {
    const it_ = liveMoveIntents();
    await it_.begin({ otid: OTID, from: O, to: C, slug: 'a' });
    await it_.begin({ otid: OTID, from: O, to: C, slug: 'b' });
    expect(tables.ab_events).toHaveLength(1);
    expect(await it_.find(OTID, C)).toMatchObject({ otid: OTID, from: O, to: C, slug: 'b' });
    expect((await it_.pendingFor(C)).length).toBe(1);
    expect((await it_.pendingFor(X)).length).toBe(0);
    expect((await it_.pendingFrom(O)).length).toBe(1);
  });

  it('finish and cancel rename the key (nothing deleted) so the intent is no longer pending', async () => {
    const it_ = liveMoveIntents();
    await it_.begin({ otid: OTID, from: O, to: C, slug: 'a' });
    await it_.finish(OTID, C);
    expect(tables.ab_events).toHaveLength(1);
    expect(tables.ab_events[0].dedupe_key).toMatch(/^ios-transfer-done:/);
    expect(await it_.find(OTID, C)).toBeNull();
    expect(await it_.pendingFor(C)).toEqual([]);
    await it_.begin({ otid: OTID, from: O, to: C, slug: 'a' }); // the same pair may move again later
    await it_.cancel(OTID, C);
    expect(tables.ab_events.map((e) => e.dedupe_key.split(':')[0]).sort()).toEqual(['ios-transfer-cancelled', 'ios-transfer-done']);
  });

  it('finisher: moves for the intent owner when the purchase is the caller\'s, closes the intent', async () => {
    const it_ = liveMoveIntents();
    await it_.begin({ otid: OTID, from: O, to: C, slug: 'fade-lab' });
    const r = await finishPendingMoves(C, { intents: it_, purchase: purchase(C), moveBusiness: liveMoveBusiness });
    expect(r).toMatchObject({ pending: false, finished: 1 });
    expect(shop1()!.owner_id).toBe(C);
    expect(await it_.pendingFor(C)).toEqual([]);
  });

  it('finisher: nothing pending = no work; the purchase not (yet) the caller\'s = left alone', async () => {
    const it_ = liveMoveIntents();
    expect(await finishPendingMoves(C, { intents: it_, purchase: purchase(C), moveBusiness: liveMoveBusiness })).toMatchObject({ pending: false, finished: 0 });
    await it_.begin({ otid: OTID, from: O, to: C, slug: 'fade-lab' });
    const r = await finishPendingMoves(C, { intents: it_, purchase: purchase(O), moveBusiness: liveMoveBusiness });
    expect(r).toMatchObject({ pending: false, finished: 0 });
    expect(shop1()!.owner_id).toBe(O);
    expect((await it_.pendingFor(C)).length).toBe(1);
  });

  it('finisher: a failing move is reported pending (setup must wait) and keeps the intent', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const it_ = liveMoveIntents();
    await it_.begin({ otid: OTID, from: O, to: C, slug: 'fade-lab' });
    const r = await finishPendingMoves(C, { intents: it_, purchase: purchase(C), moveBusiness: async () => { throw new Error('db'); } });
    expect(r.pending).toBe(true);
    expect((await it_.pendingFor(C)).length).toBe(1);
  });

  it('finisher: an intent lookup failure is pending, never throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    failOn = 'select:ab_events';
    expect((await finishPendingMoves(C, { intents: liveMoveIntents(), purchase: purchase(C), moveBusiness: liveMoveBusiness })).pending).toBe(true);
  });

  it('L1/M3: moveInProgressFrom is true only while the purchase has already left the old owner', async () => {
    const it_ = liveMoveIntents();
    await it_.begin({ otid: OTID, from: O, to: C, slug: 'fade-lab' });
    expect(await moveInProgressFrom(O, it_, purchase(O))).toBe(false); // the CAS never won: O may delete
    expect(await moveInProgressFrom(O, it_, purchase(C))).toBe(true);
    expect(await moveInProgressFrom(X, it_, purchase(C))).toBe(false);
    await it_.finish(OTID, C);
    expect(await moveInProgressFrom(O, it_, purchase(C))).toBe(false);
  });
});
