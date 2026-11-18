import { describe, expect, it } from 'vitest';
import { cleanupUnpublished, guardMode, markPublishedOnce, moveAddress, releaseUnpublished, takeAddress, tryTake } from '../../lib/account/sites.js';
import { planBackfill, runBackfill, type BackfillDeps, type BackfillRow, type WebSiteSource } from '../../lib/account/backfill.js';
import { fakeSites } from './fakes/sites.js';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

describe('guardMode', () => {
  it('is off unless the switch is exactly "alert" or "1"', () => {
    expect(guardMode({})).toBe('off');
    expect(guardMode({ ONE_SITE_GUARD: '0' })).toBe('off');
    expect(guardMode({ ONE_SITE_GUARD: 'true' })).toBe('off');
    expect(guardMode({ ONE_SITE_GUARD: 'alert' })).toBe('alert');
    expect(guardMode({ ONE_SITE_GUARD: '1' })).toBe('enforce');
  });
});

describe('takeAddress', () => {
  it('inserts, and the same row again is ok', async () => {
    const f = fakeSites();
    expect(await takeAddress(U1, 'Production', 'a-cuts', 'web', f.deps)).toMatchObject({ status: 'ok', created: true });
    expect(await takeAddress(U1, 'Production', 'a-cuts', 'web', f.deps)).toMatchObject({ status: 'ok', created: false });
    expect(f.rows).toHaveLength(1);
  });
  it('another address of the same account is refused, with the row it holds', async () => {
    const f = fakeSites([{ user_id: U1, environment: 'Production', slug: 'a-cuts', holder: 'apple', published_once: true }]);
    const r = await takeAddress(U1, 'Production', 'b-cuts', 'web', f.deps);
    expect(r).toMatchObject({ status: 'refused', existing: { slug: 'a-cuts', holder: 'apple' } });
    expect(f.rows).toHaveLength(1);
  });
  it('a slug held by another account is refused with no existing row', async () => {
    const f = fakeSites([{ user_id: U2, environment: 'Production', slug: 'a-cuts', holder: 'web', published_once: true }]);
    expect(await takeAddress(U1, 'Production', 'a-cuts', 'web', f.deps)).toEqual({ status: 'refused', existing: null });
  });
  it('environments are separate (Production and Sandbox each get one)', async () => {
    const f = fakeSites();
    expect((await takeAddress(U1, 'Production', 'a', 'web', f.deps)).status).toBe('ok');
    expect((await takeAddress(U1, 'Sandbox', 'b', 'web', f.deps)).status).toBe('ok');
  });
  it('TWO FIRST PUBLISHES AT ONCE give one address: the loser converges on the winner or is refused, never a second row', async () => {
    const f = fakeSites();
    const [a, b] = await Promise.all([
      takeAddress(U1, 'Production', 'x-cuts', 'web', f.deps),
      takeAddress(U1, 'Production', 'y-cuts', 'web', f.deps),
    ]);
    expect(f.rows).toHaveLength(1);
    const winner = f.rows[0].slug;
    const created = [a, b].filter((r) => r.status === 'ok' && r.created);
    expect(created).toHaveLength(1);
    const loser = [a, b].find((r) => !(r.status === 'ok' && r.created))!;
    expect(loser).toMatchObject({ status: 'refused', existing: { slug: winner, holder: 'web' } });
  });
  it('the same slug asked twice at once is one row, both ok', async () => {
    const f = fakeSites();
    const r = await Promise.all([takeAddress(U1, 'Production', 'x', 'web', f.deps), takeAddress(U1, 'Production', 'x', 'web', f.deps)]);
    expect(r.every((x) => x.status === 'ok')).toBe(true);
    expect(r.filter((x) => x.status === 'ok' && x.created)).toHaveLength(1);
    expect(f.rows).toHaveLength(1);
  });
});

describe('release and mark', () => {
  it('a Free account that never published keeps no row once released; a published one keeps it', async () => {
    const f = fakeSites();
    await takeAddress(U1, 'Production', 'a', 'web', f.deps);
    await releaseUnpublished(U1, 'Production', {}, f.deps);
    expect(f.rows).toHaveLength(0);
    await takeAddress(U1, 'Production', 'a', 'web', f.deps);
    await markPublishedOnce(U1, 'Production', 'a', f.deps);
    await releaseUnpublished(U1, 'Production', {}, f.deps);
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0].published_once).toBe(true);
  });
  it('release without a slug never deletes an Apple row (a bound iOS slug is permanent)', async () => {
    const f = fakeSites([{ user_id: U1, environment: 'Production', slug: 'a', holder: 'apple', published_once: false }]);
    await releaseUnpublished(U1, 'Production', {}, f.deps);
    expect(f.rows).toHaveLength(1);
    await releaseUnpublished(U1, 'Production', { slug: 'a' }, f.deps); // the request's own exact row
    expect(f.rows).toHaveLength(0);
  });
  it('the daily clean-up drops old unpublished rows of this environment: stale web, unbound Apple; never a live web site or a bound Apple slug', async () => {
    const now = Date.parse('2026-11-18T12:00:00Z');
    const old = new Date(now - 25 * 3600_000).toISOString();
    const fresh = new Date(now - 3600_000).toISOString();
    const f = fakeSites([
      { user_id: U1, environment: 'Production', slug: 'old-web', holder: 'web', published_once: false, taken_at: old },
      { user_id: U2, environment: 'Production', slug: 'fresh-web', holder: 'web', published_once: false, taken_at: fresh },
      { user_id: '33333333-3333-4333-8333-333333333333', environment: 'Production', slug: 'old-apple', holder: 'apple', published_once: false, taken_at: old },
      { user_id: '55555555-5555-4555-8555-555555555555', environment: 'Production', slug: 'bound-apple', holder: 'apple', published_once: false, taken_at: old },
      { user_id: '66666666-6666-4666-8666-666666666666', environment: 'Production', slug: 'live-web', holder: 'web', published_once: false, taken_at: old },
      { user_id: '77777777-7777-4777-8777-777777777777', environment: 'Sandbox', slug: 'other-env', holder: 'web', published_once: false, taken_at: old },
      { user_id: '44444444-4444-4444-8444-444444444444', environment: 'Production', slug: 'old-pub', holder: 'web', published_once: true, taken_at: old },
    ], { boundSlugs: ['bound-apple'], webPublished: ['live-web'] });
    // Production only; old unbound apple and the stale web row go; a bound Apple row, a live web site (healed) and a fresh row stay
    expect(await cleanupUnpublished(now, f.deps, 'Production')).toBe(2);
    expect(f.rows.map((r) => r.slug).sort()).toEqual(['bound-apple', 'fresh-web', 'live-web', 'old-pub', 'other-env']);
    expect(f.rows.find((r) => r.slug === 'live-web')!.published_once).toBe(true);
  });
});

describe('moveAddress never throws', () => {
  it('moves the Apple row of the slug', async () => {
    const f = fakeSites([{ user_id: U1, environment: 'Production', slug: 'a', holder: 'apple', published_once: true }]);
    expect(await moveAddress(U1, U2, 'a', f.deps)).toBe('moved');
    expect(f.rows[0].user_id).toBe(U2);
  });
  it('no row, no slug, a missing table and a conflict are all fine', async () => {
    expect(await moveAddress(U1, U2, 'a', fakeSites().deps)).toBe('moved'); // no row: nothing to move, no error
    expect(await moveAddress(U1, U2, null, fakeSites().deps)).toBe('skipped');
    expect(await moveAddress(U1, U2, 'a', fakeSites([], { missing: true }).deps)).toBe('skipped');
    const clash = fakeSites([
      { user_id: U1, environment: 'Production', slug: 'a', holder: 'apple', published_once: true },
      { user_id: U2, environment: 'Production', slug: 'b', holder: 'apple', published_once: true },
    ]);
    expect(await moveAddress(U1, U2, 'a', clash.deps)).toBe('error');
    expect(clash.rows.find((r) => r.slug === 'a')!.user_id).toBe(U1);
  });
});

describe('tryTake policy', () => {
  it('guard off calls nothing at all', async () => {
    const f = fakeSites();
    expect(await tryTake(U1, 'Production', 'a', 'web', 'off', f.deps)).toEqual({ kind: 'skip' });
    expect(f.calls).toEqual([]);
  });
  it('a missing table behaves as off in alert and in enforce', async () => {
    for (const mode of ['alert', 'enforce'] as const) {
      expect(await tryTake(U1, 'Production', 'a', 'web', mode, fakeSites([], { missing: true }).deps)).toEqual({ kind: 'skip' });
    }
  });
  it('another read error: alert goes on as today, enforce says unavailable', async () => {
    expect(await tryTake(U1, 'Production', 'a', 'web', 'alert', fakeSites([], { failGet: true }).deps)).toEqual({ kind: 'skip' });
    expect(await tryTake(U1, 'Production', 'a', 'web', 'enforce', fakeSites([], { failGet: true }).deps)).toEqual({ kind: 'unavailable' });
  });
});

describe('backfill', () => {
  const web: WebSiteSource[] = [
    { user_id: U1, slug: 'web-one', environment: 'live', published_at: '2026-01-01' },
    { user_id: U2, slug: 'never', environment: 'live', published_at: null },
  ];
  const apple = [{ user_id: '33333333-3333-4333-8333-333333333333', site_slug: 'apple-one', environment: 'Production', published_at: '2026-01-02' }];
  const fakeDb = (webRows = web, appleRows = apple) => {
    const table: BackfillRow[] = [];
    const deps: BackfillDeps = {
      webSites: async () => webRows,
      apple: async () => appleRows,
      existing: async () => table.map((r) => ({ ...r })),
      remove: async (row) => { const i = table.findIndex((r) => r.user_id === row.user_id && r.environment === row.environment && r.slug === row.slug && r.holder === 'apple'); if (i >= 0) table.splice(i, 1); },
      insert: async (row) => { if (table.some((r) => r.user_id === row.user_id && r.environment === row.environment)) return false; table.push(row); return true; },
    };
    return { table, deps };
  };

  it('writes web rows as Production/Sandbox holders, skips never-published rows, and a second run changes nothing', async () => {
    const { table, deps } = fakeDb([...web, { user_id: U2, slug: 'sandbox-one', environment: 'test', published_at: '2026-02-01' }]);
    const first = await runBackfill(deps, { apply: true });
    const snapshot = JSON.stringify(table);
    expect(first.inserted).toBe(3);
    expect(table.find((r) => r.slug === 'web-one')).toMatchObject({ environment: 'Production', holder: 'web', published_once: true });
    expect(table.find((r) => r.slug === 'sandbox-one')).toMatchObject({ environment: 'Sandbox', holder: 'web' });
    expect(table.find((r) => r.slug === 'apple-one')).toMatchObject({ holder: 'apple', published_once: true });
    expect(table.find((r) => r.slug === 'never')).toBeUndefined();
    const second = await runBackfill(deps, { apply: true });
    expect(second.inserted).toBe(0);
    expect(second.plan.alreadyThere).toBe(3);
    expect(JSON.stringify(table)).toBe(snapshot);
  });
  it('a purchase moved A -> B while the guard was off: A\'s stale Apple row is removed and B gets the address (re-derived from ios_purchases); a second run changes nothing', async () => {
    const A = '11111111-aaaa-4aaa-8aaa-111111111111'; const B = '22222222-bbbb-4bbb-8bbb-222222222222';
    const { table, deps } = fakeDb([], [{ user_id: B, site_slug: 'moved-site', environment: 'Production', published_at: 'x' }]);
    table.push({ user_id: A, environment: 'Production', slug: 'moved-site', holder: 'apple', published_once: true });
    const dry = await runBackfill(deps, { apply: false });
    expect(dry.plan.toDelete.map((r) => r.user_id)).toEqual([A]); expect(dry.plan.listed).toEqual([]); expect(table).toHaveLength(1);
    const r = await runBackfill(deps, { apply: true });
    expect([r.removed, r.inserted]).toEqual([1, 1]);
    expect(table).toEqual([{ user_id: B, environment: 'Production', slug: 'moved-site', holder: 'apple', published_once: true }]);
    const again = await runBackfill(deps, { apply: true });
    expect([again.removed, again.inserted, again.plan.listed]).toEqual([0, 0, []]);
  });
  it('a slug held by an account that STILL owns the purchase (or a web row) is never taken away: listed as slug-held', () => {
    const A = '11111111-aaaa-4aaa-8aaa-111111111111'; const B = '22222222-bbbb-4bbb-8bbb-222222222222';
    const both = planBackfill([], [{ user_id: A, site_slug: 's', environment: 'Production' }, { user_id: B, site_slug: 's', environment: 'Production' }], [{ user_id: A, environment: 'Production', slug: 's', holder: 'apple' }]);
    expect(both.toDelete).toEqual([]); expect(both.listed.map((l) => l.reason)).toEqual(['slug-held']);
    const webHolder = planBackfill([], [{ user_id: B, site_slug: 's', environment: 'Production' }], [{ user_id: A, environment: 'Production', slug: 's', holder: 'web' }]);
    expect(webHolder.toDelete).toEqual([]); expect(webHolder.listed.map((l) => l.reason)).toEqual(['slug-held']);
  });
  it('a dry run writes nothing', async () => {
    const { table, deps } = fakeDb();
    const r = await runBackfill(deps, { apply: false });
    expect(table).toHaveLength(0);
    expect(r.plan.toInsert).toHaveLength(2);
  });
  it('an account with both sides gets no row and is listed (mixed)', () => {
    const p = planBackfill(
      [{ user_id: U1, slug: 'w', environment: 'live', published_at: 'x' }],
      [{ user_id: U1, site_slug: 'a', environment: 'Production' }],
      [],
    );
    expect(p.toInsert).toHaveLength(0);
    expect(p.listed).toEqual([{ user_id: U1, environment: 'Production', reason: 'mixed', slugs: ['w', 'a'] }]);
  });
  it('two addresses on one side are listed, not guessed', () => {
    const p = planBackfill(
      [{ user_id: U1, slug: 'w1', environment: 'live', published_at: 'x' }, { user_id: U1, slug: 'w2', environment: 'live', published_at: 'x' }],
      [{ user_id: U2, site_slug: 'a1', environment: 'Production' }, { user_id: U2, site_slug: 'a2', environment: 'Production' }],
      [],
    );
    expect(p.toInsert).toHaveLength(0);
    expect(p.listed.map((l) => l.reason).sort()).toEqual(['multiple-apple', 'multiple-web']);
  });
  it('an existing row with another slug is listed and never overwritten', () => {
    const p = planBackfill([{ user_id: U1, slug: 'w', environment: 'live', published_at: 'x' }], [], [{ user_id: U1, environment: 'Production', slug: 'other', holder: 'web' }]);
    expect(p.toInsert).toHaveLength(0);
    expect(p.listed).toEqual([{ user_id: U1, environment: 'Production', reason: 'differs', slugs: ['other', 'w'] }]);
  });
  it('removed sites still hold their address (removed or not), a purchase with no account is ignored', () => {
    const p = planBackfill(
      [{ user_id: U1, slug: 'removed-web', environment: 'live', published_at: 'x' }],
      [{ user_id: null, site_slug: 'orphan', environment: 'Production' }],
      [],
    );
    expect(p.toInsert.map((r) => r.slug)).toEqual(['removed-web']);
  });
});
