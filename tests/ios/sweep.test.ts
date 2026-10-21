import { describe, it, expect, vi, afterEach } from 'vitest';
import { sweepIos, type IosSweepSummary } from '../../lib/ios/sweep.js';
import type { PurchaseRow, PurchasesRepo } from '../../lib/ios/purchases.js';
import type { PublishOutcome } from '../../lib/publishSite.js';
import { VerifyFailure, type VerifiedTx } from '../../lib/ios/appleVerify.js';

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
  const upsertVerified = vi.fn(async (_t: VerifiedTx) => ({}) as PurchaseRow);
  const clearTakenDown = vi.fn(async (_o: string) => {});
  const r = { unpublishedBound, markPublished, restoreCandidates, takedownCandidates, markTakenDown, clearTakenDown, upsertVerified } as unknown as PurchasesRepo;
  return { r, unpublishedBound, markPublished, restoreCandidates, takedownCandidates, markTakenDown, clearTakenDown, upsertVerified };
}
const noOffline = async (_s: string) => {};
const neverVerify = async (_otid: string): Promise<VerifiedTx> => { throw new Error('verify should not be called'); };
const summary = (over: Partial<IosSweepSummary> = {}): IosSweepSummary => ({
  checked: 0, published: [], failed: [], missing: [], deferred: [],
  skippedLapsed: [], restored: [], restoreFailed: [], notRestored: [],
  takenDown: [], takedownFailed: [], stillActive: [], appleUnavailable: [],
  ...over,
});

describe('sweepIos', () => {
  afterEach(() => vi.restoreAllMocks());

  it('publishes bound unpublished rows', async () => {
    const { r, markPublished, unpublishedBound } = repo([row('o1', 'a'), row('o2', 'b')]);
    const publish = vi.fn(async (s: string) => ok(s));
    const out = await sweepIos({ repo: r, publish, deployOffline: noOffline, verify: neverVerify });
    expect(unpublishedBound).toHaveBeenCalledWith(50);
    expect(publish.mock.calls).toEqual([['a'], ['b']]);
    expect(markPublished.mock.calls).toEqual([['o1'], ['o2']]);
    expect(out).toEqual(summary({ checked: 2, published: ['a', 'b'], failed: [], missing: [], deferred: [] }));
  });

  it('leaves failures for next run', async () => {
    const { r, markPublished } = repo([row('o1', 'a')]);
    const publish = vi.fn(async (s: string): Promise<PublishOutcome> => ({ ok: false, siteId: s, reason: 'deploy-failed', error: 'boom' }));
    const out = await sweepIos({ repo: r, publish, deployOffline: noOffline, verify: neverVerify });
    expect(markPublished).not.toHaveBeenCalled();
    expect(out).toEqual(summary({ checked: 1, published: [], failed: ['a'], missing: [], deferred: [] }));
  });

  it('no rows → zero work', async () => {
    const { r } = repo([]);
    const publish = vi.fn();
    expect(await sweepIos({ repo: r, publish, deployOffline: noOffline, verify: neverVerify })).toEqual(summary({ checked: 0, published: [], failed: [], missing: [], deferred: [] }));
    expect(publish).not.toHaveBeenCalled();
  });

  it('no-backup is reported as missing, not failed', async () => {
    const { r, markPublished } = repo([row('o1', 'a')]);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const publish = vi.fn(async (s: string): Promise<PublishOutcome> => ({ ok: false, siteId: s, reason: 'no-backup' }));
    const out = await sweepIos({ repo: r, publish, deployOffline: noOffline, verify: neverVerify });
    expect(out).toEqual(summary({ checked: 1, published: [], failed: [], missing: ['a'], deferred: [] }));
    expect(markPublished).not.toHaveBeenCalled();
    expect(err.mock.calls.flat().join(' ')).toMatch(/a.*o1|o1.*a/);
    err.mockRestore();
  });

  it('a thrown publish for one row does not stop the next', async () => {
    const { r, markPublished } = repo([row('o1', 'a'), row('o2', 'b')]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const publish = vi.fn(async (s: string) => { if (s === 'a') throw new Error('kaboom'); return ok(s); });
    const out = await sweepIos({ repo: r, publish, deployOffline: noOffline, verify: neverVerify });
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
    const out = await sweepIos({ repo: r, publish, deployOffline: noOffline, verify: neverVerify }, 50, { deadlineMs: 200_000, now: () => t });
    expect(publish.mock.calls).toEqual([['a']]);
    expect(markPublished.mock.calls).toEqual([['o1']]);
    expect(out).toEqual(summary({ checked: 3, published: ['a'], failed: [], missing: [], deferred: ['b', 'c'] }));
  });

  it('default start deadline is 140 s: a ~150 s deploy leaves no time to start another', async () => {
    const { r } = repo([row('o1', 'a'), row('o2', 'b'), row('o3', 'c')]);
    let t = 0;
    const publish = vi.fn(async (s: string) => { t += 150_000; return ok(s); });
    const out = await sweepIos({ repo: r, publish, deployOffline: noOffline, verify: neverVerify }, 50, { now: () => t });
    expect(publish.mock.calls).toEqual([['a']]);
    expect(out).toEqual(summary({ checked: 3, published: ['a'], failed: [], missing: [], deferred: ['b', 'c'] }));
  });

  it('a markPublished throw is isolated per row', async () => {
    const { r, markPublished } = repo([row('o1', 'a'), row('o2', 'b')]);
    markPublished.mockRejectedValueOnce(new Error('db'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await sweepIos({ repo: r, publish: async (s) => ok(s), deployOffline: noOffline, verify: neverVerify });
    expect(out).toEqual(summary({ checked: 2, published: ['b'], failed: ['a'], missing: [], deferred: [] }));
  });

  it('ok with alreadyLive still marks published', async () => {
    const { r, markPublished } = repo([row('o1', 'a')]);
    const out = await sweepIos({ repo: r, publish: async (s) => ({ ok: true, siteId: s, alreadyLive: true }), deployOffline: noOffline, verify: neverVerify });
    expect(markPublished).toHaveBeenCalledWith('o1');
    expect(out.published).toEqual(['a']);
  });
});

describe('sweepIos lapse takedown / restore (Apple decides)', () => {
  afterEach(() => vi.restoreAllMocks());

  const NOW = 1_800_000_000_000;
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const iso = (ms: number) => new Date(ms).toISOString();
  const lapsed = (otid: string, slug: string): PurchaseRow => ({
    ...row(otid, slug), expires_at: iso(NOW - 2 * DAY), published_at: iso(NOW - 30 * DAY),
  });
  const active = (otid: string, slug: string): PurchaseRow => ({
    ...row(otid, slug), expires_at: iso(NOW + 30 * DAY), published_at: iso(NOW - 60 * DAY), taken_down_at: iso(NOW - DAY),
  });
  /** Apple status per otid: 1 active, 2 expired, 3 billing retry, 4 billing grace, 5 revoked; an Error = lookup failed. */
  const apple = (by: Record<string, number | Error>) => vi.fn(async (otid: string): Promise<VerifiedTx> => {
    const st = by[otid];
    if (st instanceof Error) throw st;
    if (st == null) throw new Error(`unexpected verify(${otid})`);
    return {
      originalTransactionId: otid, transactionId: `t-${otid}`, productId: 'p', environment: 'Production',
      expiresAt: st === 1 ? NOW + 30 * DAY : NOW - 2 * DAY, revoked: st === 5, status: st,
    };
  });
  const quiet = () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  };

  it('Apple says expired / billing retry / revoked → taken down: offline page deployed, flag stamped, publish never called', async () => {
    quiet();
    const { r, markTakenDown, takedownCandidates, clearTakenDown } = repo([], [], [lapsed('o2', 'a'), lapsed('o3', 'b'), lapsed('o5', 'c')]);
    const publish = vi.fn(async (s: string) => ok(s));
    const deployOffline = vi.fn(async (_s: string) => {});
    const verify = apple({ o2: 2, o3: 3, o5: 5 });
    const out = await sweepIos({ repo: r, publish, deployOffline, verify }, 50, { now: () => NOW });
    expect(takedownCandidates).toHaveBeenCalledWith(50, NOW);
    expect(verify.mock.calls).toEqual([['o2'], ['o3'], ['o5']]);
    expect(deployOffline.mock.calls).toEqual([['a'], ['b'], ['c']]);
    expect(markTakenDown.mock.calls).toEqual([['o2', NOW], ['o3', NOW], ['o5', NOW]]);
    expect(publish).not.toHaveBeenCalled();
    expect(clearTakenDown).not.toHaveBeenCalled();
    expect(out).toEqual(summary({ takenDown: ['a', 'b', 'c'] }));
  });

  it('billing grace (status 4) past expiry → NOT taken down; the row is refreshed from Apple', async () => {
    const { r, markTakenDown, upsertVerified } = repo([], [], [lapsed('o4', 'g')]);
    const deployOffline = vi.fn(async (_s: string) => {});
    const verify = apple({ o4: 4 });
    const out = await sweepIos({ repo: r, publish: vi.fn(), deployOffline, verify }, 50, { now: () => NOW });
    expect(deployOffline).not.toHaveBeenCalled();
    expect(markTakenDown).not.toHaveBeenCalled();
    expect(upsertVerified).toHaveBeenCalledWith(expect.objectContaining({ originalTransactionId: 'o4', status: 4 }));
    expect(out).toEqual(summary({ stillActive: ['g'] }));
  });

  it('Apple says active (renewal notification missed) → not taken down', async () => {
    const { r, markTakenDown } = repo([], [], [lapsed('o1', 'a')]);
    const out = await sweepIos({ repo: r, publish: vi.fn(), deployOffline: noOffline, verify: apple({ o1: 1 }) }, 50, { now: () => NOW });
    expect(markTakenDown).not.toHaveBeenCalled();
    expect(out).toEqual(summary({ stillActive: ['a'] }));
  });

  it('Apple lookup error → no action on that row (no takedown, no restore), others still handled', async () => {
    quiet();
    const { r, markTakenDown, clearTakenDown } = repo([], [active('oR', 'r')], [lapsed('oX', 'x'), lapsed('o2', 'y')]);
    const publish = vi.fn(async (s: string) => ok(s));
    const deployOffline = vi.fn(async (_s: string) => {});
    const verify = apple({ oR: new VerifyFailure('apple-unavailable'), oX: new Error('network'), o2: 2 });
    const out = await sweepIos({ repo: r, publish, deployOffline, verify }, 50, { now: () => NOW });
    expect(publish).not.toHaveBeenCalled();
    expect(clearTakenDown).not.toHaveBeenCalled();
    expect(deployOffline.mock.calls).toEqual([['y']]);
    expect(markTakenDown.mock.calls).toEqual([['o2', NOW]]);
    expect(out).toEqual(summary({ appleUnavailable: ['r', 'x'], takenDown: ['y'] }));
  });

  it('a failing row refresh never blocks the decision', async () => {
    quiet();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { r, upsertVerified, markTakenDown } = repo([], [], [lapsed('o2', 'a')]);
    upsertVerified.mockRejectedValueOnce(new Error('db'));
    const out = await sweepIos({ repo: r, publish: vi.fn(), deployOffline: noOffline, verify: apple({ o2: 2 }) }, 50, { now: () => NOW });
    expect(markTakenDown).toHaveBeenCalledWith('o2', NOW);
    expect(out.takenDown).toEqual(['a']);
  });

  it('a failed takedown is not stamped and is retried next sweep', async () => {
    quiet();
    const { r, markTakenDown } = repo([], [], [lapsed('o1', 'a'), lapsed('o2', 'b')]);
    const deployOffline = vi.fn(async (s: string) => { if (s === 'a') throw new Error('vercel down'); });
    const out = await sweepIos({ repo: r, publish: vi.fn(), deployOffline, verify: apple({ o1: 2, o2: 2 }) }, 50, { now: () => NOW });
    expect(markTakenDown.mock.calls).toEqual([['o2', NOW]]);
    expect(out).toEqual(summary({ takenDown: ['b'], takedownFailed: ['a'] }));
  });

  it('restores an Apple-active taken-down row with a forced publish and clears the flag', async () => {
    const { r, restoreCandidates, clearTakenDown, markPublished } = repo([], [active('o1', 'a')]);
    const publish = vi.fn(async (s: string, _o?: { force: boolean }) => ok(s));
    const deployOffline = vi.fn(async (_s: string) => {});
    const verify = apple({ o1: 1 });
    const out = await sweepIos({ repo: r, publish, deployOffline, verify }, 50, { now: () => NOW });
    expect(restoreCandidates).toHaveBeenCalledWith(50, NOW);
    expect(verify.mock.calls).toEqual([['o1']]);
    expect(publish.mock.calls).toEqual([['a', { force: true }]]);
    expect(clearTakenDown.mock.calls).toEqual([['o1']]);
    expect(markPublished).not.toHaveBeenCalled();
    expect(deployOffline).not.toHaveBeenCalled();
    expect(out).toEqual(summary({ restored: ['a'] }));
  });

  it('billing grace (4) also counts as active for a restore', async () => {
    const { r, clearTakenDown } = repo([], [active('o4', 'a')]);
    const out = await sweepIos({ repo: r, publish: async (s) => ok(s), deployOffline: noOffline, verify: apple({ o4: 4 }) }, 50, { now: () => NOW });
    expect(clearTakenDown).toHaveBeenCalledWith('o4');
    expect(out.restored).toEqual(['a']);
  });

  it('restore requires Apple active: a row that looks active but Apple says expired/retry/revoked stays down', async () => {
    const { r, clearTakenDown } = repo([], [active('o2', 'a'), active('o3', 'b'), active('o5', 'c')]);
    const publish = vi.fn(async (s: string) => ok(s));
    const out = await sweepIos({ repo: r, publish, deployOffline: noOffline, verify: apple({ o2: 2, o3: 3, o5: 5 }) }, 50, { now: () => NOW });
    expect(publish).not.toHaveBeenCalled();
    expect(clearTakenDown).not.toHaveBeenCalled();
    expect(out).toEqual(summary({ notRestored: ['a', 'b', 'c'] }));
  });

  it('a failed restore (no pending file, deploy failure, or throw) leaves the flag set', async () => {
    const { r, clearTakenDown } = repo([], [active('o1', 'a'), active('o2', 'b'), active('o3', 'c')]);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const publish = vi.fn(async (s: string): Promise<PublishOutcome> => {
      if (s === 'a') return { ok: false, siteId: s, reason: 'no-backup' };
      if (s === 'b') return { ok: false, siteId: s, reason: 'deploy-failed', error: 'boom' };
      throw new Error('kaboom');
    });
    const out = await sweepIos({ repo: r, publish, deployOffline: noOffline, verify: apple({ o1: 1, o2: 1, o3: 1 }) }, 50, { now: () => NOW });
    expect(clearTakenDown).not.toHaveBeenCalled();
    expect(out).toEqual(summary({ restoreFailed: ['a', 'b', 'c'] }));
    expect(err.mock.calls.flat().join(' ')).toMatch(/a.*o1/);
  });

  it('a clearTakenDown failure after a live restore counts as a failed restore (retried next sweep)', async () => {
    const { r, clearTakenDown } = repo([], [active('o1', 'a')]);
    clearTakenDown.mockRejectedValueOnce(new Error('db'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await sweepIos({ repo: r, publish: async (s) => ok(s), deployOffline: noOffline, verify: apple({ o1: 1 }) }, 50, { now: () => NOW });
    expect(out).toEqual(summary({ restoreFailed: ['a'] }));
  });

  it('pass 1: an unpublished row that looks lapsed is published only if Apple says active', async () => {
    quiet();
    const looksLapsed = (otid: string, slug: string) => ({ ...row(otid, slug), expires_at: iso(NOW - 2 * DAY) });
    const { r, markPublished, markTakenDown } = repo([looksLapsed('o2', 'a'), looksLapsed('o4', 'g'), looksLapsed('oX', 'x'), row('oN', 'n')]);
    const publish = vi.fn(async (s: string) => ok(s));
    const deployOffline = vi.fn(async (_s: string) => {});
    const verify = apple({ o2: 2, o4: 4, oX: new Error('network') });
    const out = await sweepIos({ repo: r, publish, deployOffline, verify }, 50, { now: () => NOW });
    // 'n' has no expiry → not a candidate → Apple not asked; 'g' is in billing grace → published.
    expect(verify.mock.calls).toEqual([['o2'], ['o4'], ['oX']]);
    expect(publish.mock.calls).toEqual([['g'], ['n']]);
    expect(markPublished.mock.calls).toEqual([['o4'], ['oN']]);
    expect(deployOffline).not.toHaveBeenCalled();
    expect(markTakenDown).not.toHaveBeenCalled();
    expect(out).toEqual(summary({ checked: 4, published: ['g', 'n'], skippedLapsed: ['a'], appleUnavailable: ['x'] }));
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
    const v = apple({ o2: 1, o3: 2 });
    const verify = vi.fn(async (otid: string) => { log.push(`apple:${otid}`); return v(otid); });
    const out = await sweepIos({ repo: r, publish, deployOffline, verify }, 50, { now: () => NOW });
    expect(log).toEqual(['q:unpublished', 'publish:p:-', 'q:restore', 'apple:o2', 'publish:r:true', 'q:takedown', 'apple:o3', 'offline:t']);
    expect(out).toEqual(summary({ checked: 1, published: ['p'], restored: ['r'], takenDown: ['t'] }));
  });

  it('shares one budget: a slow pass 1 means restores and takedowns are not even started', async () => {
    const { r, restoreCandidates, takedownCandidates } = repo([row('o1', 'a')], [active('o2', 'r')], [lapsed('o3', 't')]);
    let t = 0;
    const publish = vi.fn(async (s: string) => { t += 150_000; return ok(s); });
    const deployOffline = vi.fn(async (_s: string) => {});
    const out = await sweepIos({ repo: r, publish, deployOffline, verify: neverVerify }, 50, { now: () => t });
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
    const publish = vi.fn(async (s: string) => { t += 60_000; return ok(s); });
    const deployOffline = vi.fn(async (_s: string) => { t += 50_000; });
    // r1 (0 → 60 s), r2 (60 → 120 s), t1 starts at 120 s (→ 170 s), t2 deferred.
    const out = await sweepIos({ repo: r, publish, deployOffline, verify: apple({ o1: 1, o2: 1, o3: 2, o4: 2 }) }, 50, { now: () => t });
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
    const out = await sweepIos({ repo: r, publish, deployOffline: noOffline, verify: apple({ o1: 1, o2: 1 }) }, 50, { now: () => t });
    expect(publish.mock.calls).toEqual([['r1', { force: true }]]);
    expect(takedownCandidates).not.toHaveBeenCalled();
    expect(out).toEqual(summary({ restored: ['r1'], deferred: ['r2'] }));
  });
});
