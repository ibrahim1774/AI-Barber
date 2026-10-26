import { describe, it, expect, vi } from 'vitest';
import { takeSiteOffline } from '../../lib/ios/takeOffline.js';
import { VerifyFailure } from '../../lib/ios/appleVerify.js';

const row = (over: any = {}) => ({
  original_transaction_id: 'orig-A', product_id: 'p', environment: 'Production', site_slug: 'fade-lab', user_id: null,
  expires_at: null, revoked_at: null, last_notification: null, published_at: 'x', taken_down_at: null, lapse_checked_at: null, ...over,
});

function mk(over: any = {}) {
  const calls: string[] = [];
  const rows: Record<string, any> = { 'orig-A': row() };
  return {
    calls, rows,
    now: () => 1,
    verify: vi.fn(async (id: string) => {
      if (id === 'bogus') throw new VerifyFailure('not-found');
      // Apple resolves any renewal id to the ORIGINAL transaction id.
      return { originalTransactionId: id === 'tx-B' ? 'orig-B' : 'orig-A', transactionId: id, productId: 'p', environment: 'Production', expiresAt: 0, revoked: false } as any;
    }),
    repo: { get: vi.fn(async (o: string) => rows[o] ?? null) },
    markTakenDown: vi.fn(async (o: string) => { calls.push(`stamp:${o}`); }),
    deployOffline: vi.fn(async (s: string) => { calls.push(`offline:${s}`); }),
    releaseDomains: vi.fn(async (s: string) => { calls.push(`domain:${s}`); }),
    deleteContent: vi.fn(async (s: string) => { calls.push(`content:${s}`); }),
    userOf: vi.fn(async (t: string) => (t === 'tok-owner' ? { id: 'u1' } : t === 'tok-other' ? { id: 'u2' } : null)),
    ...over,
  };
}

describe('takeSiteOffline (no account, keyed by Apple transaction id)', () => {
  it('rejects a missing / blank / non-string transaction id before asking Apple', async () => {
    const d = mk();
    for (const b of [null, {}, { transactionId: '' }, { transactionId: 5 }, { transactionId: 'x'.repeat(65) }]) {
      expect((await takeSiteOffline(b, d)).status).toBe(400);
    }
    expect(d.verify).not.toHaveBeenCalled();
  });

  it('a transaction Apple does not know removes nothing (404)', async () => {
    const d = mk();
    const r = await takeSiteOffline({ transactionId: 'bogus' }, d);
    expect(r.status).toBe(404);
    expect(d.calls).toEqual([]);
  });

  it('Apple unreachable -> 503, nothing removed', async () => {
    const d = mk({ verify: vi.fn(async () => { throw new VerifyFailure('apple-unavailable'); }) });
    expect((await takeSiteOffline({ transactionId: 't' }, d)).status).toBe(503);
    expect(d.calls).toEqual([]);
  });

  it('removes exactly the site bound to the VERIFIED original transaction, in order', async () => {
    const d = mk();
    const r = await takeSiteOffline({ transactionId: 'renewal-1', slug: 'someone-elses-site' }, d);
    expect(r).toEqual({ status: 200, body: { removed: true } });
    expect(d.calls).toEqual(['stamp:orig-A', 'offline:fade-lab', 'domain:fade-lab', 'content:fade-lab']);
  });

  it("another user's transaction id cannot touch this site: it only ever resolves to its own purchase", async () => {
    const d = mk();
    d.rows['orig-B'] = row({ original_transaction_id: 'orig-B', site_slug: 'other-shop' });
    await takeSiteOffline({ transactionId: 'tx-B' }, d);
    expect(d.calls).toContain('offline:other-shop');
    expect(d.calls).not.toContain('offline:fade-lab');
    expect(d.calls.join()).not.toContain('fade-lab');
  });

  it('a verified purchase with no site bound -> 404, nothing removed', async () => {
    const d = mk();
    d.rows['orig-A'] = row({ site_slug: null });
    expect((await takeSiteOffline({ transactionId: 't' }, d)).status).toBe(404);
    expect(d.calls).toEqual([]);
  });

  describe('a purchase linked to an account', () => {
    it('refused without a token (403), refused for a different account (403), nothing removed', async () => {
      const d = mk();
      d.rows['orig-A'] = row({ user_id: 'u1' });
      expect((await takeSiteOffline({ transactionId: 't' }, d)).status).toBe(403);
      expect((await takeSiteOffline({ transactionId: 't' }, d, { authorization: 'Bearer tok-other' })).status).toBe(403);
      expect((await takeSiteOffline({ transactionId: 't' }, d, { authorization: 'Bearer garbage' })).status).toBe(403);
      expect(d.calls).toEqual([]);
    });
    it('allowed for the owning account', async () => {
      const d = mk();
      d.rows['orig-A'] = row({ user_id: 'u1' });
      const r = await takeSiteOffline({ transactionId: 't' }, d, { authorization: 'Bearer tok-owner' });
      expect(r.status).toBe(200);
      expect(d.calls[1]).toBe('offline:fade-lab');
    });
    it('token lookup outage -> 503, nothing removed', async () => {
      const d = mk({ userOf: vi.fn(async () => { throw new Error('auth down'); }) });
      d.rows['orig-A'] = row({ user_id: 'u1' });
      expect((await takeSiteOffline({ transactionId: 't' }, d, { authorization: 'Bearer x' })).status).toBe(503);
      expect(d.calls).toEqual([]);
    });
  });

  it('a lapsed subscription can still remove its own site (no isActive gate)', async () => {
    const d = mk();
    d.rows['orig-A'] = row({ revoked_at: 'x', taken_down_at: 'x' });
    expect((await takeSiteOffline({ transactionId: 't' }, d)).status).toBe(200);
  });

  it('a failure during removal surfaces as 500 and later steps do not run', async () => {
    const d = mk({ deployOffline: vi.fn(async () => { throw new Error('boom'); }) });
    const r = await takeSiteOffline({ transactionId: 't' }, d);
    expect(r).toEqual({ status: 500, body: { error: 'remove-failed' } });
    expect(d.deleteContent).not.toHaveBeenCalled();
  });
});
