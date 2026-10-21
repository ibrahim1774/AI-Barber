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
  for (const m of ['select', 'insert', 'update', 'upsert', 'eq', 'is', 'not', 'or', 'gt', 'order', 'limit', 'maybeSingle', 'single']) {
    chain[m] = (...args: unknown[]) => { calls.push({ method: m, args }); return chain; };
  }
  const client: any = { from: (t: string) => { calls.push({ method: 'from', args: [t] }); return chain; } };
  return { client, calls };
}
const find = (calls: Call[], m: string) => calls.find((c) => c.method === m);

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

  it('upsertVerified does not send site_slug, user_id or published_at', async () => {
    const row = { original_transaction_id: 'o1' };
    const { client, calls } = fakeClient({ data: row, error: null });
    const out = await supabasePurchases(client).upsertVerified({
      originalTransactionId: 'o1', transactionId: 't1', productId: 'p', environment: 'Sandbox',
      expiresAt: 2_000_000_000_000, revoked: false,
    });
    expect(out).toBe(row);
    const payload = find(calls, 'upsert')!.args[0] as Record<string, unknown>;
    expect(Object.keys(payload)).not.toContain('site_slug');
    expect(Object.keys(payload)).not.toContain('user_id');
    expect(Object.keys(payload)).not.toContain('published_at');
    expect(Object.keys(payload)).not.toContain('revoked_at');
    expect(payload.expires_at).toBe(new Date(2_000_000_000_000).toISOString());
    expect(find(calls, 'upsert')!.args[1]).toEqual({ onConflict: 'original_transaction_id' });
  });

  it('upsertVerified sets revoked_at when revoked and null expires_at for null expiry', async () => {
    const { client, calls } = fakeClient({ data: {}, error: null });
    await supabasePurchases(client).upsertVerified({
      originalTransactionId: 'o1', transactionId: 't1', productId: 'p', environment: 'Production', expiresAt: null, revoked: true,
    });
    const payload = find(calls, 'upsert')!.args[0] as Record<string, unknown>;
    expect(payload.expires_at).toBeNull();
    expect(typeof payload.revoked_at).toBe('string');
  });

  describe('upsertVerified never moves expires_at backwards', () => {
    const tx = (expiresAt: number | null) => ({
      originalTransactionId: 'o1', transactionId: 't1', productId: 'p', environment: 'Production' as const, expiresAt, revoked: false,
    });
    const STORED = 2_000_000_000_000;

    it('reads the stored row for this purchase first', async () => {
      const { client, calls } = fakeClient({ data: {}, error: null }, { data: null, error: null });
      await supabasePurchases(client).upsertVerified(tx(STORED));
      expect(calls[1]).toEqual({ method: 'select', args: ['expires_at'] });
      expect(find(calls, 'eq')!.args).toEqual(['original_transaction_id', 'o1']);
      expect(calls.findIndex((c) => c.method === 'select')).toBeLessThan(calls.findIndex((c) => c.method === 'upsert'));
    });

    it('older incoming expiry is not written', async () => {
      const stored = { data: { expires_at: new Date(STORED).toISOString() }, error: null };
      const { client, calls } = fakeClient({ data: {}, error: null }, stored);
      await supabasePurchases(client).upsertVerified(tx(STORED - 86_400_000));
      expect(Object.keys(find(calls, 'upsert')!.args[0] as object)).not.toContain('expires_at');
    });

    it('newer incoming expiry is written', async () => {
      const stored = { data: { expires_at: new Date(STORED).toISOString() }, error: null };
      const { client, calls } = fakeClient({ data: {}, error: null }, stored);
      await supabasePurchases(client).upsertVerified(tx(STORED + 86_400_000));
      expect((find(calls, 'upsert')!.args[0] as Record<string, unknown>).expires_at).toBe(new Date(STORED + 86_400_000).toISOString());
    });

    it('null incoming expiry does not wipe a stored one', async () => {
      const stored = { data: { expires_at: new Date(STORED).toISOString() }, error: null };
      const { client, calls } = fakeClient({ data: {}, error: null }, stored);
      await supabasePurchases(client).upsertVerified(tx(null));
      expect(Object.keys(find(calls, 'upsert')!.args[0] as object)).not.toContain('expires_at');
    });

    it('no stored row: expiry written', async () => {
      const { client, calls } = fakeClient({ data: {}, error: null }, { data: null, error: null });
      await supabasePurchases(client).upsertVerified(tx(STORED));
      expect((find(calls, 'upsert')!.args[0] as Record<string, unknown>).expires_at).toBe(new Date(STORED).toISOString());
    });

    it('read error throws, nothing written', async () => {
      const { client, calls } = fakeClient({ data: {}, error: null }, { data: null, error: { message: 'db down' } });
      await expect(supabasePurchases(client).upsertVerified(tx(STORED))).rejects.toThrow(/upsertVerified/);
      expect(find(calls, 'upsert')).toBeUndefined();
    });
  });

  it('slugTaken reflects whether a row exists', async () => {
    expect(await supabasePurchases(fakeClient({ data: [{ original_transaction_id: 'o' }], error: null }).client).slugTaken('a')).toBe(true);
    const { client, calls } = fakeClient({ data: [], error: null });
    expect(await supabasePurchases(client).slugTaken('a')).toBe(false);
    expect(find(calls, 'eq')!.args).toEqual(['site_slug', 'a']);
  });

  it('applyNotification upserts without touching site_slug, user_id or published_at', async () => {
    const { client, calls } = fakeClient();
    await supabasePurchases(client).applyNotification({
      otid: 'o1', productId: 'p', environment: 'Production', expiresAt: 5000, revokedAt: null, type: 'DID_RENEW',
    });
    const payload = find(calls, 'upsert')!.args[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ original_transaction_id: 'o1', product_id: 'p', last_notification: 'DID_RENEW' });
    for (const k of ['site_slug', 'user_id', 'published_at', 'revoked_at']) expect(Object.keys(payload)).not.toContain(k);
    expect(payload.expires_at).toBe(new Date(5000).toISOString());
  });

  describe('applyNotification never moves expires_at backwards', () => {
    const STORED = 1_800_000_000_000;
    const apply = (client: any, expiresAt: number) => supabasePurchases(client).applyNotification({
      otid: 'o1', productId: 'p', environment: 'Production', expiresAt, revokedAt: null, type: 'DID_RENEW',
    });

    it('an older (late, retried) notification keeps the stored expiry but still records the rest', async () => {
      const { client, calls } = fakeClient({ data: null, error: null }, { data: { expires_at: new Date(STORED).toISOString() }, error: null });
      await apply(client, STORED - 86_400_000);
      const payload = find(calls, 'upsert')!.args[0] as Record<string, unknown>;
      expect(Object.keys(payload)).not.toContain('expires_at');
      expect(payload.last_notification).toBe('DID_RENEW');
    });

    it('a newer expiry is written', async () => {
      const { client, calls } = fakeClient({ data: null, error: null }, { data: { expires_at: new Date(STORED).toISOString() }, error: null });
      await apply(client, STORED + 86_400_000);
      expect((find(calls, 'upsert')!.args[0] as Record<string, unknown>).expires_at).toBe(new Date(STORED + 86_400_000).toISOString());
    });

    it('no stored expiry takes the new value', async () => {
      const { client, calls } = fakeClient({ data: null, error: null }, { data: { expires_at: null }, error: null });
      await apply(client, STORED);
      expect((find(calls, 'upsert')!.args[0] as Record<string, unknown>).expires_at).toBe(new Date(STORED).toISOString());
    });

    it('a read error throws (Apple retries) and nothing is written', async () => {
      const { client, calls } = fakeClient({ data: null, error: null }, { data: null, error: { message: 'boom' } });
      await expect(apply(client, STORED)).rejects.toThrow(/applyNotification/);
      expect(find(calls, 'upsert')).toBeUndefined();
    });
  });

  it('applyNotification omits expires_at when expiresAt is null', async () => {
    const { client, calls } = fakeClient();
    await supabasePurchases(client).applyNotification({
      otid: 'o1', productId: 'p', environment: 'Production', expiresAt: null, revokedAt: null, type: 'DID_CHANGE_RENEWAL_STATUS',
    });
    expect(Object.keys(find(calls, 'upsert')!.args[0] as object)).not.toContain('expires_at');
  });

  it('applyNotification sets revoked_at when given', async () => {
    const { client, calls } = fakeClient();
    await supabasePurchases(client).applyNotification({
      otid: 'o1', productId: 'p', environment: 'Production', expiresAt: null, revokedAt: 7000, type: 'REFUND',
    });
    const payload = find(calls, 'upsert')!.args[0] as Record<string, unknown>;
    expect(payload.revoked_at).toBe(new Date(7000).toISOString());
  });

  it('applyNotification with clearRevoked sets revoked_at to null', async () => {
    const { client, calls } = fakeClient();
    await supabasePurchases(client).applyNotification({
      otid: 'o1', productId: 'p', environment: 'Production', expiresAt: 9000, revokedAt: null, clearRevoked: true, type: 'REFUND_REVERSED',
    });
    const payload = find(calls, 'upsert')!.args[0] as Record<string, unknown>;
    expect(Object.keys(payload)).toContain('revoked_at');
    expect(payload.revoked_at).toBeNull();
    expect(payload.last_notification).toBe('REFUND_REVERSED');
  });

  it('applyNotification: clearRevoked wins over a revokedAt', async () => {
    const { client, calls } = fakeClient();
    await supabasePurchases(client).applyNotification({
      otid: 'o1', productId: 'p', environment: 'Production', expiresAt: null, revokedAt: 7000, clearRevoked: true, type: 'REFUND_REVERSED',
    });
    expect((find(calls, 'upsert')!.args[0] as Record<string, unknown>).revoked_at).toBeNull();
  });

  it('unpublishedBound filters bound, unpublished, unrevoked, oldest first', async () => {
    const { client, calls } = fakeClient({ data: [{ original_transaction_id: 'o1' }], error: null });
    const rows = await supabasePurchases(client).unpublishedBound(5);
    expect(rows).toHaveLength(1);
    expect(find(calls, 'not')!.args).toEqual(['site_slug', 'is', null]);
    expect(calls.filter((c) => c.method === 'is').map((c) => c.args)).toEqual([['published_at', null], ['revoked_at', null]]);
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
      expect(find(calls, 'or')!.args).toEqual([`revoked_at.not.is.null,expires_at.lte."${iso(NOW - DAY)}"`]);
      expect(find(calls, 'limit')!.args).toEqual([7]);
    });

    it('restoreCandidates: taken down, unrevoked, unexpired; re-checked in JS', async () => {
      const rows = [
        { original_transaction_id: 'back', site_slug: 'b', expires_at: iso(NOW + DAY), revoked_at: null, taken_down_at: iso(NOW - DAY) },
        { original_transaction_id: 'stale', site_slug: 's', expires_at: iso(NOW - 1), revoked_at: null, taken_down_at: iso(NOW - DAY) },
      ];
      const { client, calls } = fakeClient({ data: rows, error: null });
      const out = await supabasePurchases(client).restoreCandidates(3, NOW);
      expect(out.map((r) => r.original_transaction_id)).toEqual(['back']);
      expect(find(calls, 'not')!.args).toEqual(['taken_down_at', 'is', null]);
      expect(find(calls, 'is')!.args).toEqual(['revoked_at', null]);
      expect(find(calls, 'gt')!.args).toEqual(['expires_at', iso(NOW)]);
      expect(find(calls, 'limit')!.args).toEqual([3]);
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
