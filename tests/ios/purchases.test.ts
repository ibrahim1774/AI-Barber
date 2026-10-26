import { describe, it, expect } from 'vitest';
import { supabasePurchases } from '../../lib/ios/purchases.js';

type Call = { method: string; args: unknown[] };

type Result = { data: unknown; error: unknown };

// Minimal fake: every chain method records itself and returns the chain; awaiting it yields
// the next `queued` result, then `result` for every later await.
function fakeClient(result: Result = { data: null, error: null }, ...queued: Result[]) {
  const calls: Call[] = [];
  const chain: any = {
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(queued.length ? queued.shift() : result).then(res, rej),
  };
  for (const m of ['select', 'insert', 'update', 'upsert', 'eq', 'is', 'not', 'or', 'gt', 'lt', 'order', 'limit', 'maybeSingle', 'single']) {
    chain[m] = (...args: unknown[]) => { calls.push({ method: m, args }); return chain; };
  }
  const client: any = { from: (t: string) => { calls.push({ method: 'from', args: [t] }); return chain; } };
  return { client, calls };
}
const find = (calls: Call[], m: string) => calls.find((c) => c.method === m);

// upsertVerified and applyNotification: tests/ios/purchasesWrites.test.ts (stateful fake).
describe('supabasePurchases', () => {
  it('bindSlug only updates when site_slug is null', async () => {
    const { client, calls } = fakeClient({ data: [{ original_transaction_id: 'o1' }], error: null });
    expect(await supabasePurchases(client).bindSlug('o1', 'joes-cuts')).toBe(true);
    expect(find(calls, 'from')!.args).toEqual(['ios_purchases']);
    expect(find(calls, 'update')!.args[0]).toEqual({ site_slug: 'joes-cuts' });
    expect(find(calls, 'eq')!.args).toEqual(['original_transaction_id', 'o1']);
    expect(find(calls, 'is')!.args).toEqual(['site_slug', null]);
  });

  it('bindSlug returns false when 0 rows updated', async () => {
    const { client } = fakeClient({ data: [], error: null });
    expect(await supabasePurchases(client).bindSlug('o1', 'x')).toBe(false);
  });

  it('bindSlug returns false on unique violation (slug taken)', async () => {
    const { client } = fakeClient({ data: null, error: { code: '23505' } });
    expect(await supabasePurchases(client).bindSlug('o1', 'x')).toBe(false);
  });

  it('slugTaken reflects whether a row exists', async () => {
    expect(await supabasePurchases(fakeClient({ data: [{ original_transaction_id: 'o' }], error: null }).client).slugTaken('a')).toBe(true);
    const { client, calls } = fakeClient({ data: [], error: null });
    expect(await supabasePurchases(client).slugTaken('a')).toBe(false);
    expect(find(calls, 'eq')!.args).toEqual(['site_slug', 'a']);
  });

  it('unpublishedBound filters bound, unpublished, unrevoked, oldest first', async () => {
    const { client, calls } = fakeClient({ data: [{ original_transaction_id: 'o1' }], error: null });
    const rows = await supabasePurchases(client).unpublishedBound(5);
    expect(rows).toHaveLength(1);
    expect(find(calls, 'not')!.args).toEqual(['site_slug', 'is', null]);
    expect(calls.filter((c) => c.method === 'is').map((c) => c.args)).toEqual([['published_at', null], ['revoked_at', null], ['removed_at', null]]);
    expect(find(calls, 'order')!.args).toEqual(['verified_at', { ascending: true }]);
    expect(find(calls, 'limit')!.args).toEqual([5]);
  });

  it('get returns null when missing', async () => {
    const { client } = fakeClient({ data: null, error: null });
    expect(await supabasePurchases(client).get('nope')).toBeNull();
  });

  describe('lapse takedown queries', () => {
    const NOW = 1_800_000_000_000;
    const DAY = 86_400_000;
    const iso = (ms: number) => new Date(ms).toISOString();

    it('takedownCandidates: bound, published, not taken down, revoked or expired past the grace; re-checked in JS', async () => {
      const rows = [
        { original_transaction_id: 'expired', expires_at: iso(NOW - 2 * DAY), revoked_at: null },
        { original_transaction_id: 'revoked', expires_at: iso(NOW + DAY), revoked_at: iso(NOW - DAY) },
        { original_transaction_id: 'in-grace', expires_at: iso(NOW - 1000), revoked_at: null },
        { original_transaction_id: 'no-expiry', expires_at: null, revoked_at: null },
        { original_transaction_id: 'unpublished', site_slug: 's5', published_at: null, taken_down_at: null, expires_at: iso(NOW - 2 * DAY), revoked_at: null },
        { original_transaction_id: 'already-down', site_slug: 's6', published_at: iso(NOW - 9 * DAY), taken_down_at: iso(NOW - DAY), expires_at: iso(NOW - 2 * DAY), revoked_at: null },
      ].map((r, i) => ({ site_slug: `s${i}`, published_at: iso(NOW - 9 * DAY), taken_down_at: null, ...r }));
      const { client, calls } = fakeClient({ data: rows, error: null });
      const out = await supabasePurchases(client).takedownCandidates(7, NOW);
      expect(out.map((r) => r.original_transaction_id)).toEqual(['expired', 'revoked']);
      expect(calls.filter((c) => c.method === 'not').map((c) => c.args)).toEqual([['site_slug', 'is', null], ['published_at', 'is', null]]);
      expect(calls.filter((c) => c.method === 'is').map((c) => c.args)).toEqual([['taken_down_at', null]]);
      expect(find(calls, 'or')!.args).toEqual([`revoked_at.not.is.null,expires_at.lte."${iso(NOW - 3_600_000)}"`]);
      expect(find(calls, 'limit')!.args).toEqual([7]);
    });

    it('restoreCandidates: taken down and (revoked or unexpired), oldest-checked first; re-checked in JS', async () => {
      const rows = [
        { original_transaction_id: 'back', site_slug: 'b', expires_at: iso(NOW + DAY), revoked_at: null, taken_down_at: iso(NOW - DAY) },
        { original_transaction_id: 'stale', site_slug: 's', expires_at: iso(NOW - 1), revoked_at: null, taken_down_at: iso(NOW - DAY) },
        { original_transaction_id: 'refunded', site_slug: 'r', expires_at: iso(NOW - DAY), revoked_at: iso(NOW - DAY), taken_down_at: iso(NOW - DAY) },
      ];
      const { client, calls } = fakeClient({ data: rows, error: null });
      const out = await supabasePurchases(client).restoreCandidates(3, NOW);
      expect(out.map((r) => r.original_transaction_id)).toEqual(['back', 'refunded']);
      expect(find(calls, 'not')!.args).toEqual(['taken_down_at', 'is', null]);
      expect(find(calls, 'or')!.args).toEqual([`revoked_at.not.is.null,expires_at.gt."${iso(NOW)}"`]);
      expect(calls.filter((c) => c.method === 'order').map((c) => c.args)).toEqual([
        ['lapse_checked_at', { ascending: true, nullsFirst: true }], ['expires_at', { ascending: true }],
      ]);
      expect(find(calls, 'limit')!.args).toEqual([3]);
    });

    it('restoreCandidates never returns an owner-removed row (SQL filter + JS re-check)', async () => {
      const rows = [
        { original_transaction_id: 'gone', site_slug: 'g', expires_at: iso(NOW + DAY), revoked_at: null, taken_down_at: iso(NOW - DAY), removed_at: iso(NOW - DAY) },
        { original_transaction_id: 'lapsed', site_slug: 'l', expires_at: iso(NOW + DAY), revoked_at: null, taken_down_at: iso(NOW - DAY), removed_at: null },
      ];
      const { client, calls } = fakeClient({ data: rows, error: null });
      const out = await supabasePurchases(client).restoreCandidates(3, NOW);
      expect(out.map((r) => r.original_transaction_id)).toEqual(['lapsed']);
      expect(find(calls, 'is')!.args).toEqual(['removed_at', null]);
    });

    it('markRemoved keeps the first stamp; clearRemoved only clears the stamp it was given', async () => {
      const a = fakeClient();
      await supabasePurchases(a.client).markRemoved('o1', NOW);
      expect(find(a.calls, 'update')!.args).toEqual([{ removed_at: iso(NOW) }]);
      expect(find(a.calls, 'is')!.args).toEqual(['removed_at', null]);
      const b = fakeClient();
      await supabasePurchases(b.client).clearRemoved('o1', iso(NOW));
      expect(find(b.calls, 'update')!.args).toEqual([{ removed_at: null }]);
      expect(b.calls.filter((c) => c.method === 'eq').map((c) => c.args)).toEqual([['original_transaction_id', 'o1'], ['removed_at', iso(NOW)]]);
    });

    it('takedownCandidates: oldest-checked first; Sandbox excluded unless includeSandbox', async () => {
      const rows = [
        { original_transaction_id: 'prod', environment: 'Production', site_slug: 'p', published_at: iso(NOW - 9 * DAY), taken_down_at: null, expires_at: iso(NOW - 2 * DAY), revoked_at: null },
        { original_transaction_id: 'sbx', environment: 'Sandbox', site_slug: 's', published_at: iso(NOW - 9 * DAY), taken_down_at: null, expires_at: iso(NOW - 2 * DAY), revoked_at: null },
      ];
      const a = fakeClient({ data: rows, error: null });
      expect((await supabasePurchases(a.client).takedownCandidates(5, NOW, { includeSandbox: false })).map((r) => r.original_transaction_id)).toEqual(['prod']);
      expect(find(a.calls, 'eq')!.args).toEqual(['environment', 'Production']);
      expect(a.calls.filter((c) => c.method === 'order').map((c) => c.args)).toEqual([
        ['lapse_checked_at', { ascending: true, nullsFirst: true }], ['expires_at', { ascending: true }],
      ]);
      const b = fakeClient({ data: rows, error: null });
      expect((await supabasePurchases(b.client).takedownCandidates(5, NOW, { includeSandbox: true })).map((r) => r.original_transaction_id)).toEqual(['prod', 'sbx']);
      expect(find(b.calls, 'eq')).toBeUndefined();
    });

    it('markLapseChecked only touches lapse_checked_at', async () => {
      const a = fakeClient();
      await supabasePurchases(a.client).markLapseChecked('o1', NOW);
      expect(find(a.calls, 'update')!.args).toEqual([{ lapse_checked_at: iso(NOW) }]);
      expect(find(a.calls, 'eq')!.args).toEqual(['original_transaction_id', 'o1']);
    });

    it('markTakenDown / clearTakenDown only touch taken_down_at', async () => {
      const a = fakeClient();
      await supabasePurchases(a.client).markTakenDown('o1', NOW);
      expect(find(a.calls, 'update')!.args).toEqual([{ taken_down_at: iso(NOW) }]);
      expect(find(a.calls, 'eq')!.args).toEqual(['original_transaction_id', 'o1']);
      const b = fakeClient();
      await supabasePurchases(b.client).clearTakenDown('o1');
      expect(find(b.calls, 'update')!.args).toEqual([{ taken_down_at: null }]);
      expect(find(b.calls, 'eq')!.args).toEqual(['original_transaction_id', 'o1']);
    });

    it('findBySlug looks up by site_slug and throws on error', async () => {
      const a = fakeClient({ data: { original_transaction_id: 'o1', site_slug: 's' }, error: null });
      expect((await supabasePurchases(a.client).findBySlug('s'))!.original_transaction_id).toBe('o1');
      expect(find(a.calls, 'eq')!.args).toEqual(['site_slug', 's']);
      const b = fakeClient({ data: null, error: { message: 'boom' } });
      await expect(supabasePurchases(b.client).findBySlug('s')).rejects.toThrow(/findBySlug/);
    });
  });
});
