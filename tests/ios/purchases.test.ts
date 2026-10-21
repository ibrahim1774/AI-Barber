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
      expect(calls[1]).toEqual({ method: 'select', args: ['expires_at, product_id, product_purchased_at'] });
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

  describe('product_id never moves backwards (Phase 4 tiers)', () => {
    const P = 'com.ibrahim1774.aibarber.';
    const T0 = 1_800_000_000_000;
    const DAY = 86_400_000;
    const stored = (product: string, purchasedAt: number | null) => ({
      data: { expires_at: null, product_id: product, product_purchased_at: purchasedAt == null ? null : new Date(purchasedAt).toISOString() },
      error: null,
    });
    const vtx = (productId: string, productPurchasedAt: number | null | undefined) => ({
      originalTransactionId: 'o1', transactionId: 't1', productId, environment: 'Production' as const,
      expiresAt: T0 + 30 * DAY, revoked: false, productPurchasedAt,
    });
    const upserted = (calls: Call[]) => find(calls, 'upsert')!.args[0] as Record<string, unknown>;

    it('reads the stored product and its purchase date with the expiry', async () => {
      const { client, calls } = fakeClient({ data: {}, error: null }, { data: null, error: null });
      await supabasePurchases(client).upsertVerified(vtx(`${P}store.monthly`, T0));
      expect(calls[1]).toEqual({ method: 'select', args: ['expires_at, product_id, product_purchased_at'] });
    });

    it('a first insert always writes the product (and its purchase date)', async () => {
      const { client, calls } = fakeClient({ data: {}, error: null }, { data: null, error: null });
      await supabasePurchases(client).upsertVerified(vtx(`${P}bookings.monthly`, T0));
      expect(upserted(calls)).toMatchObject({ product_id: `${P}bookings.monthly`, product_purchased_at: new Date(T0).toISOString() });
    });

    it('a first insert without a purchase date still writes the product', async () => {
      const { client, calls } = fakeClient({ data: {}, error: null }, { data: null, error: null });
      await supabasePurchases(client).upsertVerified(vtx(`${P}hosting.monthly`, null));
      expect(upserted(calls).product_id).toBe(`${P}hosting.monthly`);
      expect(Object.keys(upserted(calls))).not.toContain('product_purchased_at');
    });

    it('an older productPurchasedAt keeps the stored product (sent back unchanged: product_id is NOT NULL)', async () => {
      const { client, calls } = fakeClient({ data: {}, error: null }, stored(`${P}store.monthly`, T0));
      await supabasePurchases(client).upsertVerified(vtx(`${P}hosting.monthly`, T0 - DAY));
      expect(upserted(calls).product_id).toBe(`${P}store.monthly`);
      expect(Object.keys(upserted(calls))).not.toContain('product_purchased_at');
    });

    it('a newer one overwrites both columns', async () => {
      const { client, calls } = fakeClient({ data: {}, error: null }, stored(`${P}hosting.monthly`, T0));
      await supabasePurchases(client).upsertVerified(vtx(`${P}store.yearly`, T0 + DAY));
      expect(upserted(calls)).toMatchObject({ product_id: `${P}store.yearly`, product_purchased_at: new Date(T0 + DAY).toISOString() });
    });

    it('the same purchase date (a re-verify of the same transaction) writes', async () => {
      const { client, calls } = fakeClient({ data: {}, error: null }, stored(`${P}hosting.monthly`, T0));
      await supabasePurchases(client).upsertVerified(vtx(`${P}bookings.monthly`, T0));
      expect(upserted(calls).product_id).toBe(`${P}bookings.monthly`);
    });

    it('a pre-010 row (stored purchase date null) takes the incoming product', async () => {
      const { client, calls } = fakeClient({ data: {}, error: null }, stored(`${P}hosting.monthly`, null));
      await supabasePurchases(client).upsertVerified(vtx(`${P}store.monthly`, T0));
      expect(upserted(calls)).toMatchObject({ product_id: `${P}store.monthly`, product_purchased_at: new Date(T0).toISOString() });
    });

    it('an incoming tx without a purchase date never replaces a stored product', async () => {
      const { client, calls } = fakeClient({ data: {}, error: null }, stored(`${P}store.monthly`, null));
      await supabasePurchases(client).upsertVerified(vtx(`${P}hosting.monthly`, undefined));
      expect(upserted(calls).product_id).toBe(`${P}store.monthly`);
    });

    const notify = (client: any, over: Record<string, unknown>) => supabasePurchases(client).applyNotification({
      otid: 'o1', productId: `${P}hosting.monthly`, environment: 'Production', expiresAt: null, revokedAt: null, type: 'DID_RENEW', ...over,
    } as any);

    it('applyNotification reads the stored product even without an expiry', async () => {
      const { client, calls } = fakeClient({ data: null, error: null }, { data: null, error: null });
      await notify(client, { purchasedAt: T0 });
      expect(find(calls, 'select')!.args).toEqual(['expires_at, product_id, product_purchased_at']);
    });

    it('a DID_RENEW for a lower tier with a newer purchase date downgrades the product', async () => {
      const { client, calls } = fakeClient({ data: null, error: null }, stored(`${P}store.monthly`, T0));
      await notify(client, { productId: `${P}hosting.monthly`, purchasedAt: T0 + 30 * DAY });
      expect(upserted(calls)).toMatchObject({ product_id: `${P}hosting.monthly`, product_purchased_at: new Date(T0 + 30 * DAY).toISOString() });
    });

    it('an older (late, retried) notification keeps the stored product', async () => {
      const { client, calls } = fakeClient({ data: null, error: null }, stored(`${P}store.monthly`, T0));
      await notify(client, { productId: `${P}hosting.monthly`, purchasedAt: T0 - DAY });
      expect(upserted(calls).product_id).toBe(`${P}store.monthly`);
      expect(Object.keys(upserted(calls))).not.toContain('product_purchased_at');
    });

    it('isUpgraded with a revokedAt: no revoked_at and no product write', async () => {
      const { client, calls } = fakeClient({ data: null, error: null }, stored(`${P}store.monthly`, T0));
      await notify(client, { productId: `${P}hosting.monthly`, purchasedAt: T0 + DAY, isUpgraded: true, revokedAt: T0 + DAY, type: 'REFUND' });
      const payload = upserted(calls);
      expect(Object.keys(payload)).not.toContain('revoked_at');
      expect(payload.product_id).toBe(`${P}store.monthly`);
      expect(Object.keys(payload)).not.toContain('product_purchased_at');
    });

    it('isUpgraded on a purchase we have no row for inserts its product with no purchase date (any later write wins)', async () => {
      const { client, calls } = fakeClient({ data: null, error: null }, { data: null, error: null });
      await notify(client, { productId: `${P}hosting.monthly`, purchasedAt: T0, isUpgraded: true });
      expect(upserted(calls).product_id).toBe(`${P}hosting.monthly`);
      expect(Object.keys(upserted(calls))).not.toContain('product_purchased_at');
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

  describe('stale revocations clear only on a newer, active, unrevoked answer', () => {
    const T = 1_800_000_000_000;
    const vtx = (over: Record<string, unknown> = {}) => ({
      originalTransactionId: 'o1', transactionId: 't9', productId: 'p', environment: 'Production' as const,
      expiresAt: T + 86_400_000, revoked: false, status: 1, ...over,
    });
    const revokedRow = { original_transaction_id: 'o1', revoked_at: new Date(T - 86_400_000).toISOString() };

    it('upsertVerified with checkedAt + Apple active clears a revocation older than the check (conditional in SQL)', async () => {
      // awaits: read expires_at, upsert, conditional clear
      const { client, calls } = fakeClient({ data: [{ original_transaction_id: 'o1' }], error: null },
        { data: null, error: null }, { data: revokedRow, error: null });
      const row = await supabasePurchases(client).upsertVerified(vtx(), { checkedAt: T });
      expect(row.revoked_at).toBeNull();
      expect(find(calls, 'update')!.args).toEqual([{ revoked_at: null }]);
      expect(find(calls, 'lt')!.args).toEqual(['revoked_at', new Date(T).toISOString()]);
    });

    it('a revocation recorded after the check survives (SQL condition matches nothing)', async () => {
      const { client } = fakeClient({ data: [], error: null }, { data: null, error: null }, { data: revokedRow, error: null });
      const row = await supabasePurchases(client).upsertVerified(vtx(), { checkedAt: T });
      expect(row.revoked_at).toBe(revokedRow.revoked_at);
    });

    it('never clears without checkedAt, for a revoked tx, or when Apple says inactive (billing retry)', async () => {
      for (const [tx, opts] of [[vtx(), undefined], [vtx({ revoked: true, status: 5 }), { checkedAt: T }], [vtx({ status: 3 }), { checkedAt: T }]] as const) {
        const { client, calls } = fakeClient({ data: revokedRow, error: null });
        await supabasePurchases(client).upsertVerified(tx as any, opts as any);
        expect(calls.filter((c) => c.method === 'update')).toEqual([]);
      }
    });

    it('applyNotification with clearRevokedBefore clears only revocations older than the purchase', async () => {
      const { client, calls } = fakeClient();
      await supabasePurchases(client).applyNotification({
        otid: 'o1', productId: 'p', environment: 'Production', expiresAt: null, revokedAt: null, type: 'SUBSCRIBED', clearRevokedBefore: T,
      });
      expect(find(calls, 'update')!.args).toEqual([{ revoked_at: null }]);
      expect(find(calls, 'lt')!.args).toEqual(['revoked_at', new Date(T).toISOString()]);
      expect(Object.keys(find(calls, 'upsert')!.args[0] as object)).not.toContain('revoked_at');
    });

    it('applyNotification without clearRevokedBefore issues no clear', async () => {
      const { client, calls } = fakeClient();
      await supabasePurchases(client).applyNotification({
        otid: 'o1', productId: 'p', environment: 'Production', expiresAt: null, revokedAt: null, type: 'DID_RENEW',
      });
      expect(find(calls, 'update')).toBeUndefined();
    });
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
