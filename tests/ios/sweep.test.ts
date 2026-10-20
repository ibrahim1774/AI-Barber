import { describe, it, expect, vi, afterEach } from 'vitest';
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
  afterEach(() => vi.restoreAllMocks());

  it('publishes bound unpublished rows', async () => {
    const { r, markPublished, unpublishedBound } = repo([row('o1', 'a'), row('o2', 'b')]);
    const publish = vi.fn(async (s: string) => ok(s));
    const out = await sweepIos({ repo: r, publish });
    expect(unpublishedBound).toHaveBeenCalledWith(50);
    expect(publish.mock.calls).toEqual([['a'], ['b']]);
    expect(markPublished.mock.calls).toEqual([['o1'], ['o2']]);
    expect(out).toEqual({ checked: 2, published: ['a', 'b'], failed: [], missing: [], deferred: [] });
  });

  it('leaves failures for next run', async () => {
    const { r, markPublished } = repo([row('o1', 'a')]);
    const publish = vi.fn(async (s: string): Promise<PublishOutcome> => ({ ok: false, siteId: s, reason: 'deploy-failed', error: 'boom' }));
    const out = await sweepIos({ repo: r, publish });
    expect(markPublished).not.toHaveBeenCalled();
    expect(out).toEqual({ checked: 1, published: [], failed: ['a'], missing: [], deferred: [] });
  });

  it('no rows → zero work', async () => {
    const { r } = repo([]);
    const publish = vi.fn();
    expect(await sweepIos({ repo: r, publish })).toEqual({ checked: 0, published: [], failed: [], missing: [], deferred: [] });
    expect(publish).not.toHaveBeenCalled();
  });

  it('no-backup is reported as missing, not failed', async () => {
    const { r, markPublished } = repo([row('o1', 'a')]);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const publish = vi.fn(async (s: string): Promise<PublishOutcome> => ({ ok: false, siteId: s, reason: 'no-backup' }));
    const out = await sweepIos({ repo: r, publish });
    expect(out).toEqual({ checked: 1, published: [], failed: [], missing: ['a'], deferred: [] });
    expect(markPublished).not.toHaveBeenCalled();
    expect(err.mock.calls.flat().join(' ')).toMatch(/a.*o1|o1.*a/);
    err.mockRestore();
  });

  it('a thrown publish for one row does not stop the next', async () => {
    const { r, markPublished } = repo([row('o1', 'a'), row('o2', 'b')]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const publish = vi.fn(async (s: string) => { if (s === 'a') throw new Error('kaboom'); return ok(s); });
    const out = await sweepIos({ repo: r, publish });
    expect(out).toEqual({ checked: 2, published: ['b'], failed: ['a'], missing: [], deferred: [] });
    expect(markPublished.mock.calls).toEqual([['o2']]);
  });
});


describe('sweepIos extras', () => {
  afterEach(() => vi.restoreAllMocks());

  it('defers rows once the time budget is spent', async () => {
    const { r, markPublished } = repo([row('o1', 'a'), row('o2', 'b'), row('o3', 'c')]);
    let t = 0;
    const publish = vi.fn(async (s: string) => { t += 500_000; return ok(s); });
    const out = await sweepIos({ repo: r, publish }, 50, { deadlineMs: 200_000, now: () => t });
    expect(publish.mock.calls).toEqual([['a']]);
    expect(markPublished.mock.calls).toEqual([['o1']]);
    expect(out).toEqual({ checked: 3, published: ['a'], failed: [], missing: [], deferred: ['b', 'c'] });
  });

  it('a markPublished throw is isolated per row', async () => {
    const { r, markPublished } = repo([row('o1', 'a'), row('o2', 'b')]);
    markPublished.mockRejectedValueOnce(new Error('db'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await sweepIos({ repo: r, publish: async (s) => ok(s) });
    expect(out).toEqual({ checked: 2, published: ['b'], failed: ['a'], missing: [], deferred: [] });
  });

  it('ok with alreadyLive still marks published', async () => {
    const { r, markPublished } = repo([row('o1', 'a')]);
    const out = await sweepIos({ repo: r, publish: async (s) => ({ ok: true, siteId: s, alreadyLive: true }) });
    expect(markPublished).toHaveBeenCalledWith('o1');
    expect(out.published).toEqual(['a']);
  });
});
