import { describe, it, expect, vi, afterEach } from 'vitest';
import { sweepIos, type IosSweepSummary } from '../../lib/ios/sweep.js';
import type { PurchaseRow, PurchasesRepo } from '../../lib/ios/purchases.js';
import type { PublishOutcome } from '../../lib/publishSite.js';

const row = (otid: string, slug: string): PurchaseRow => ({
  original_transaction_id: otid, product_id: 'p', environment: 'Production', site_slug: slug,
  user_id: null, expires_at: null, revoked_at: null, last_notification: null, published_at: null, taken_down_at: null,
});
const ok = (siteId: string): PublishOutcome => ({ ok: true, siteId, deployedUrl: `https://${siteId}.x` });

function repo(rows: PurchaseRow[], restores: PurchaseRow[] = [], takedowns: PurchaseRow[] = []) {
  const unpublishedBound = vi.fn(async (_n: number) => rows);
  const markPublished = vi.fn(async (_o: string) => {});
  const restoreCandidates = vi.fn(async (_n: number, _now: number) => restores);
  const takedownCandidates = vi.fn(async (_n: number, _now: number) => takedowns);
  const markTakenDown = vi.fn(async (_o: string, _at: number) => {});
  const clearTakenDown = vi.fn(async (_o: string) => {});
  const r = { unpublishedBound, markPublished, restoreCandidates, takedownCandidates, markTakenDown, clearTakenDown } as unknown as PurchasesRepo;
  return { r, unpublishedBound, markPublished, restoreCandidates, takedownCandidates, markTakenDown, clearTakenDown };
}
const noOffline = async (_s: string) => {};
const summary = (over: Partial<IosSweepSummary> = {}): IosSweepSummary => ({
  checked: 0, published: [], failed: [], missing: [], deferred: [],
  skippedLapsed: [], restored: [], restoreFailed: [], takenDown: [], takedownFailed: [],
  ...over,
});

describe('sweepIos', () => {
  afterEach(() => vi.restoreAllMocks());

  it('publishes bound unpublished rows', async () => {
    const { r, markPublished, unpublishedBound } = repo([row('o1', 'a'), row('o2', 'b')]);
    const publish = vi.fn(async (s: string) => ok(s));
    const out = await sweepIos({ repo: r, publish, deployOffline: noOffline });
    expect(unpublishedBound).toHaveBeenCalledWith(50);
    expect(publish.mock.calls).toEqual([['a'], ['b']]);
    expect(markPublished.mock.calls).toEqual([['o1'], ['o2']]);
    expect(out).toEqual(summary({ checked: 2, published: ['a', 'b'], failed: [], missing: [], deferred: [] }));
  });

  it('leaves failures for next run', async () => {
    const { r, markPublished } = repo([row('o1', 'a')]);
    const publish = vi.fn(async (s: string): Promise<PublishOutcome> => ({ ok: false, siteId: s, reason: 'deploy-failed', error: 'boom' }));
    const out = await sweepIos({ repo: r, publish, deployOffline: noOffline });
    expect(markPublished).not.toHaveBeenCalled();
    expect(out).toEqual(summary({ checked: 1, published: [], failed: ['a'], missing: [], deferred: [] }));
  });

  it('no rows → zero work', async () => {
    const { r } = repo([]);
    const publish = vi.fn();
    expect(await sweepIos({ repo: r, publish, deployOffline: noOffline })).toEqual(summary({ checked: 0, published: [], failed: [], missing: [], deferred: [] }));
    expect(publish).not.toHaveBeenCalled();
  });

  it('no-backup is reported as missing, not failed', async () => {
    const { r, markPublished } = repo([row('o1', 'a')]);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const publish = vi.fn(async (s: string): Promise<PublishOutcome> => ({ ok: false, siteId: s, reason: 'no-backup' }));
    const out = await sweepIos({ repo: r, publish, deployOffline: noOffline });
    expect(out).toEqual(summary({ checked: 1, published: [], failed: [], missing: ['a'], deferred: [] }));
    expect(markPublished).not.toHaveBeenCalled();
    expect(err.mock.calls.flat().join(' ')).toMatch(/a.*o1|o1.*a/);
    err.mockRestore();
  });

  it('a thrown publish for one row does not stop the next', async () => {
    const { r, markPublished } = repo([row('o1', 'a'), row('o2', 'b')]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const publish = vi.fn(async (s: string) => { if (s === 'a') throw new Error('kaboom'); return ok(s); });
    const out = await sweepIos({ repo: r, publish, deployOffline: noOffline });
    expect(out).toEqual(summary({ checked: 2, published: ['b'], failed: ['a'], missing: [], deferred: [] }));
    expect(markPublished.mock.calls).toEqual([['o2']]);
  });
});


describe('sweepIos extras', () => {
  afterEach(() => vi.restoreAllMocks());

  it('defers rows once the time budget is spent', async () => {
    const { r, markPublished } = repo([row('o1', 'a'), row('o2', 'b'), row('o3', 'c')]);
    let t = 0;
    const publish = vi.fn(async (s: string) => { t += 500_000; return ok(s); });
    const out = await sweepIos({ repo: r, publish, deployOffline: noOffline }, 50, { deadlineMs: 200_000, now: () => t });
    expect(publish.mock.calls).toEqual([['a']]);
    expect(markPublished.mock.calls).toEqual([['o1']]);
    expect(out).toEqual(summary({ checked: 3, published: ['a'], failed: [], missing: [], deferred: ['b', 'c'] }));
  });

  it('default start deadline is 140 s: a ~150 s deploy leaves no time to start another', async () => {
    const { r } = repo([row('o1', 'a'), row('o2', 'b'), row('o3', 'c')]);
    let t = 0;
    const publish = vi.fn(async (s: string) => { t += 150_000; return ok(s); });
    const out = await sweepIos({ repo: r, publish, deployOffline: noOffline }, 50, { now: () => t });
    expect(publish.mock.calls).toEqual([['a']]);
    expect(out).toEqual(summary({ checked: 3, published: ['a'], failed: [], missing: [], deferred: ['b', 'c'] }));
  });

  it('a markPublished throw is isolated per row', async () => {
    const { r, markPublished } = repo([row('o1', 'a'), row('o2', 'b')]);
    markPublished.mockRejectedValueOnce(new Error('db'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await sweepIos({ repo: r, publish: async (s) => ok(s), deployOffline: noOffline });
    expect(out).toEqual(summary({ checked: 2, published: ['b'], failed: ['a'], missing: [], deferred: [] }));
  });

  it('ok with alreadyLive still marks published', async () => {
    const { r, markPublished } = repo([row('o1', 'a')]);
    const out = await sweepIos({ repo: r, publish: async (s) => ({ ok: true, siteId: s, alreadyLive: true }), deployOffline: noOffline });
    expect(markPublished).toHaveBeenCalledWith('o1');
    expect(out.published).toEqual(['a']);
  });
});

describe('sweepIos lapse takedown / restore', () => {
  afterEach(() => vi.restoreAllMocks());

  const NOW = 1_800_000_000_000;
  const DAY = 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const lapsed = (otid: string, slug: string): PurchaseRow => ({
    ...row(otid, slug), expires_at: iso(NOW - 2 * DAY), published_at: iso(NOW - 30 * DAY),
  });
  const active = (otid: string, slug: string): PurchaseRow => ({
    ...row(otid, slug), expires_at: iso(NOW + 30 * DAY), published_at: iso(NOW - 60 * DAY), taken_down_at: iso(NOW - DAY),
  });

  it('takes down a lapsed published row: offline page deployed, flag stamped, publish never called', async () => {
    const { r, markTakenDown, takedownCandidates, clearTakenDown } = repo([], [], [lapsed('o1', 'a')]);
    const publish = vi.fn(async (s: string) => ok(s));
    const deployOffline = vi.fn(async (_s: string) => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const out = await sweepIos({ repo: r, publish, deployOffline }, 50, { now: () => NOW });
    expect(takedownCandidates).toHaveBeenCalledWith(50, NOW);
    expect(deployOffline.mock.calls).toEqual([['a']]);
    expect(markTakenDown.mock.calls).toEqual([['o1', NOW]]);
    expect(publish).not.toHaveBeenCalled();
    expect(clearTakenDown).not.toHaveBeenCalled();
    expect(out).toEqual(summary({ takenDown: ['a'] }));
  });

  it('a failed takedown is not stamped and is retried next sweep', async () => {
    const { r, markTakenDown } = repo([], [], [lapsed('o1', 'a'), lapsed('o2', 'b')]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const deployOffline = vi.fn(async (s: string) => { if (s === 'a') throw new Error('vercel down'); });
    const out = await sweepIos({ repo: r, publish: vi.fn(), deployOffline }, 50, { now: () => NOW });
    expect(markTakenDown.mock.calls).toEqual([['o2', NOW]]);
    expect(out).toEqual(summary({ takenDown: ['b'], takedownFailed: ['a'] }));
  });

  it('skips (does not publish) an unpublished bound row whose subscription has lapsed', async () => {
    const unpublishedLapsed = { ...row('o1', 'a'), expires_at: iso(NOW - 2 * DAY) };
    const { r, markPublished, markTakenDown } = repo([unpublishedLapsed, row('o2', 'b')]);
    const publish = vi.fn(async (s: string) => ok(s));
    const deployOffline = vi.fn(async (_s: string) => {});
    const out = await sweepIos({ repo: r, publish, deployOffline }, 50, { now: () => NOW });
    expect(publish.mock.calls).toEqual([['b']]);
    expect(markPublished.mock.calls).toEqual([['o2']]);
    expect(deployOffline).not.toHaveBeenCalled();
    expect(markTakenDown).not.toHaveBeenCalled();
    expect(out).toEqual(summary({ checked: 2, published: ['b'], skippedLapsed: ['a'] }));
  });

  it('restores an active taken-down row with a forced publish and clears the flag', async () => {
    const { r, restoreCandidates, clearTakenDown, markPublished } = repo([], [active('o1', 'a')]);
    const publish = vi.fn(async (s: string, _o?: { force: boolean }) => ok(s));
    const deployOffline = vi.fn(async (_s: string) => {});
    const out = await sweepIos({ repo: r, publish, deployOffline }, 50, { now: () => NOW });
    expect(restoreCandidates).toHaveBeenCalledWith(50, NOW);
    expect(publish.mock.calls).toEqual([['a', { force: true }]]);
    expect(clearTakenDown.mock.calls).toEqual([['o1']]);
    expect(markPublished).not.toHaveBeenCalled();
    expect(deployOffline).not.toHaveBeenCalled();
    expect(out).toEqual(summary({ restored: ['a'] }));
  });

  it('a failed restore (no pending file, deploy failure, or throw) leaves the flag set', async () => {
    const { r, clearTakenDown } = repo([], [active('o1', 'a'), active('o2', 'b'), active('o3', 'c')]);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const publish = vi.fn(async (s: string): Promise<PublishOutcome> => {
      if (s === 'a') return { ok: false, siteId: s, reason: 'no-backup' };
      if (s === 'b') return { ok: false, siteId: s, reason: 'deploy-failed', error: 'boom' };
      throw new Error('kaboom');
    });
    const out = await sweepIos({ repo: r, publish, deployOffline: noOffline }, 50, { now: () => NOW });
    expect(clearTakenDown).not.toHaveBeenCalled();
    expect(out).toEqual(summary({ restoreFailed: ['a', 'b', 'c'] }));
    expect(err.mock.calls.flat().join(' ')).toMatch(/a.*o1/);
  });

  it('a clearTakenDown failure after a live restore counts as a failed restore (retried next sweep)', async () => {
    const { r, clearTakenDown } = repo([], [active('o1', 'a')]);
    clearTakenDown.mockRejectedValueOnce(new Error('db'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await sweepIos({ repo: r, publish: async (s) => ok(s), deployOffline: noOffline }, 50, { now: () => NOW });
    expect(out).toEqual(summary({ restoreFailed: ['a'] }));
  });

  it('runs unpublished-bound first, then restores, then takedowns', async () => {
    const log: string[] = [];
    const { r, unpublishedBound, restoreCandidates, takedownCandidates } = repo([row('o1', 'p')], [active('o2', 'r')], [lapsed('o3', 't')]);
    unpublishedBound.mockImplementation(async () => { log.push('q:unpublished'); return [row('o1', 'p')]; });
    restoreCandidates.mockImplementation(async () => { log.push('q:restore'); return [active('o2', 'r')]; });
    takedownCandidates.mockImplementation(async () => { log.push('q:takedown'); return [lapsed('o3', 't')]; });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const publish = vi.fn(async (s: string, o?: { force: boolean }) => { log.push(`publish:${s}:${o?.force ?? '-'}`); return ok(s); });
    const deployOffline = vi.fn(async (s: string) => { log.push(`offline:${s}`); });
    const out = await sweepIos({ repo: r, publish, deployOffline }, 50, { now: () => NOW });
    expect(log).toEqual(['q:unpublished', 'publish:p:-', 'q:restore', 'publish:r:true', 'q:takedown', 'offline:t']);
    expect(out).toEqual(summary({ checked: 1, published: ['p'], restored: ['r'], takenDown: ['t'] }));
  });

  it('shares one budget: a slow pass 1 means restores and takedowns are not even started', async () => {
    const { r, restoreCandidates, takedownCandidates } = repo([row('o1', 'a')], [active('o2', 'r')], [lapsed('o3', 't')]);
    let t = 0;
    const publish = vi.fn(async (s: string) => { t += 150_000; return ok(s); });
    const deployOffline = vi.fn(async (_s: string) => {});
    const out = await sweepIos({ repo: r, publish, deployOffline }, 50, { now: () => t });
    expect(publish.mock.calls).toEqual([['a']]);
    expect(restoreCandidates).not.toHaveBeenCalled();
    expect(takedownCandidates).not.toHaveBeenCalled();
    expect(deployOffline).not.toHaveBeenCalled();
    expect(out).toEqual(summary({ checked: 1, published: ['a'] }));
  });

  it('defers restores and takedowns that do not fit the budget', async () => {
    const { r, clearTakenDown, markTakenDown, takedownCandidates } = repo(
      [], [active('o1', 'r1'), active('o2', 'r2')], [lapsed('o3', 't1'), lapsed('o4', 't2')]);
    let t = 0;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // First restore takes 60 s; then each takedown takes 50 s against a 140 s budget.
    const publish = vi.fn(async (s: string) => { t += 60_000; return ok(s); });
    const deployOffline = vi.fn(async (_s: string) => { t += 50_000; });
    // r1 (0 → 60 s), r2 (60 → 120 s), t1 starts at 120 s (→ 170 s), t2 deferred.
    const out = await sweepIos({ repo: r, publish, deployOffline }, 50, { now: () => t });
    expect(clearTakenDown.mock.calls).toEqual([['o1'], ['o2']]);
    expect(takedownCandidates).toHaveBeenCalled();
    expect(deployOffline.mock.calls).toEqual([['t1']]);
    expect(markTakenDown.mock.calls.map((c) => c[0])).toEqual(['o3']);
    expect(out).toEqual(summary({ restored: ['r1', 'r2'], takenDown: ['t1'], deferred: ['t2'] }));
  });

  it('defers remaining restores once the budget runs out mid-pass', async () => {
    const { r, takedownCandidates } = repo([], [active('o1', 'r1'), active('o2', 'r2')], [lapsed('o3', 't1')]);
    let t = 0;
    const publish = vi.fn(async (s: string) => { t += 150_000; return ok(s); });
    const out = await sweepIos({ repo: r, publish, deployOffline: noOffline }, 50, { now: () => t });
    expect(publish.mock.calls).toEqual([['r1', { force: true }]]);
    expect(takedownCandidates).not.toHaveBeenCalled();
    expect(out).toEqual(summary({ restored: ['r1'], deferred: ['r2'] }));
  });
});
