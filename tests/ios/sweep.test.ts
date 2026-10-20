import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sweepIos } from '../../lib/ios/sweep.js';
import type { PurchaseRow, PurchasesRepo } from '../../lib/ios/purchases.js';
import type { PublishOutcome } from '../../lib/publishSite.js';

const row = (otid: string, slug: string): PurchaseRow => ({
  original_transaction_id: otid, product_id: 'p', environment: 'Production', site_slug: slug,
  user_id: null, expires_at: null, revoked_at: null, last_notification: null, published_at: null,
});
const ok = (siteId: string): PublishOutcome => ({ ok: true, siteId, deployedUrl: `https://${siteId}.x` });

function repo(rows: PurchaseRow[]) {
  const unpublishedBound = vi.fn(async (_n: number) => rows);
  const markPublished = vi.fn(async (_o: string) => {});
  return { r: { unpublishedBound, markPublished } as unknown as PurchasesRepo, unpublishedBound, markPublished };
}

describe('sweepIos', () => {
  it('publishes bound unpublished rows', async () => {
    const { r, markPublished, unpublishedBound } = repo([row('o1', 'a'), row('o2', 'b')]);
    const publish = vi.fn(async (s: string) => ok(s));
    const out = await sweepIos({ repo: r, publish });
    expect(unpublishedBound).toHaveBeenCalledWith(50);
    expect(publish.mock.calls).toEqual([['a'], ['b']]);
    expect(markPublished.mock.calls).toEqual([['o1'], ['o2']]);
    expect(out).toEqual({ checked: 2, published: ['a', 'b'], failed: [], missing: [] });
  });

  it('leaves failures for next run', async () => {
    const { r, markPublished } = repo([row('o1', 'a')]);
    const publish = vi.fn(async (s: string): Promise<PublishOutcome> => ({ ok: false, siteId: s, reason: 'deploy-failed', error: 'boom' }));
    const out = await sweepIos({ repo: r, publish });
    expect(markPublished).not.toHaveBeenCalled();
    expect(out).toEqual({ checked: 1, published: [], failed: ['a'], missing: [] });
  });

  it('no rows → zero work', async () => {
    const { r } = repo([]);
    const publish = vi.fn();
    expect(await sweepIos({ repo: r, publish })).toEqual({ checked: 0, published: [], failed: [], missing: [] });
    expect(publish).not.toHaveBeenCalled();
  });

  it('no-backup is reported as missing, not failed', async () => {
    const { r, markPublished } = repo([row('o1', 'a')]);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const publish = vi.fn(async (s: string): Promise<PublishOutcome> => ({ ok: false, siteId: s, reason: 'no-backup' }));
    const out = await sweepIos({ repo: r, publish });
    expect(out).toEqual({ checked: 1, published: [], failed: [], missing: ['a'] });
    expect(markPublished).not.toHaveBeenCalled();
    expect(err.mock.calls.flat().join(' ')).toMatch(/a.*o1|o1.*a/);
    err.mockRestore();
  });

  it('a thrown publish for one row does not stop the next', async () => {
    const { r, markPublished } = repo([row('o1', 'a'), row('o2', 'b')]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const publish = vi.fn(async (s: string) => { if (s === 'a') throw new Error('kaboom'); return ok(s); });
    const out = await sweepIos({ repo: r, publish });
    expect(out).toEqual({ checked: 2, published: ['b'], failed: ['a'], missing: [] });
    expect(markPublished.mock.calls).toEqual([['o2']]);
  });
});

describe('publish-sweeper handler', () => {
  beforeEach(() => { vi.resetModules(); vi.restoreAllMocks(); });

  it('sweeper still returns the Stripe result when the iOS branch throws', async () => {
    vi.doMock('../../lib/publishSite.js', () => ({ publishSite: vi.fn() }));
    vi.doMock('../../lib/ios/purchases.js', () => ({
      supabasePurchases: () => ({ unpublishedBound: async () => { throw new Error('db down'); } }),
    }));
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: [], has_more: false }) })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { default: handler } = await import('../../api/publish-sweeper.js');
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await handler({ headers: { 'user-agent': 'vercel-cron/1.0' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({ ok: true, paidSitesChecked: 0, repaired: [], skipped: [] });
    expect(body.ios).toEqual({ error: 'db down' });
    vi.unstubAllGlobals();
  });
});
