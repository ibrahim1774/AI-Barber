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
  for (const m of ['select', 'insert', 'update', 'upsert', 'eq', 'is', 'not', 'order', 'limit', 'maybeSingle', 'single']) {
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
});
