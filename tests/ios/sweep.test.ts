import { describe, it, expect, vi, afterEach } from 'vitest';
import { isIndefiniteDeployError, makeStripPending, sweepIos, type IosSweepSummary } from '../../lib/ios/sweep.js';
import type { PurchaseRow, PurchasesRepo } from '../../lib/ios/purchases.js';
import type { PublishOutcome } from '../../lib/publishSite.js';
import { VerifyFailure, makeVerifier, type VerifiedTx } from '../../lib/ios/appleVerify.js';

const row = (otid: string, slug: string): PurchaseRow => ({
  original_transaction_id: otid, product_id: 'p', environment: 'Production', site_slug: slug,
  user_id: null, expires_at: null, revoked_at: null, last_notification: null, published_at: null, taken_down_at: null, lapse_checked_at: null,
});
const ok = (siteId: string): PublishOutcome => ({ ok: true, siteId, deployedUrl: `https://${siteId}.x` });

function repo(rows: PurchaseRow[], restores: PurchaseRow[] = [], takedowns: PurchaseRow[] = []) {
  const unpublishedBound = vi.fn(async (_n: number) => rows);
  const markPublished = vi.fn(async (_o: string) => {});
  const restoreCandidates = vi.fn(async (_n: number, _now: number) => restores);
  const takedownCandidates = vi.fn(async (_n: number, _now: number) => takedowns);
  const markTakenDown = vi.fn(async (_o: string, _at: number) => {});
  const upsertVerified = vi.fn(async (_t: VerifiedTx, _o?: { checkedAt?: number }) => ({}) as PurchaseRow);
  const markLapseChecked = vi.fn(async (_o: string, _at: number) => {});
  const clearTakenDown = vi.fn(async (_o: string) => {});
  const r = { unpublishedBound, markPublished, restoreCandidates, takedownCandidates, markTakenDown, clearTakenDown, upsertVerified, markLapseChecked } as unknown as PurchasesRepo;
  return { r, unpublishedBound, markPublished, restoreCandidates, takedownCandidates, markTakenDown, clearTakenDown, upsertVerified, markLapseChecked };
}
const noOffline = async (_s: string) => {};
const neverVerify = async (_otid: string): Promise<VerifiedTx> => { throw new Error('verify should not be called'); };
const summary = (over: Partial<IosSweepSummary> = {}): IosSweepSummary => ({
  checked: 0, published: [], failed: [], missing: [], deferred: [],
  skippedLapsed: [], restored: [], restoreFailed: [], notRestored: [],
  takenDown: [], takedownFailed: [], takedownUncertain: [], stillActive: [], sandboxGatesClosed: [],
  appleUnavailable: [], appleUnresolvable: [],
  ...over,
  appleUnavailableCount: (over.appleUnavailable ?? []).length,
  appleUnresolvableCount: (over.appleUnresolvable ?? []).length,
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
    expect(takedownCandidates).toHaveBeenCalledWith(50, NOW, { includeSandbox: true });
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
    expect(upsertVerified).toHaveBeenCalledWith(expect.objectContaining({ originalTransactionId: 'o4', status: 4 }), { checkedAt: NOW });
    expect(out).toEqual(summary({ stillActive: ['g'] }));
  });

  it('a downgrade at renewal whose DID_RENEW was missed: Apple active on the LOWER product → recorded, not taken down', async () => {
    const P = 'com.ibrahim1774.aibarber.';
    const { r, markTakenDown, upsertVerified } = repo([], [], [{ ...lapsed('o5', 'h'), product_id: `${P}store.monthly` }]);
    const renewedAt = NOW - DAY;
    // The real verifier: the original transaction was Store, the latest (after the renewal) is Website.
    const verify = makeVerifier({
      bundleId: 'b',
      lookup: async (env) => (env === 'Production' ? { status: 200, signedTransactionInfo: 'orig' } : { status: 404 }),
      decode: async (_env, signed) => signed === 'orig'
        ? { bundleId: 'b', productId: `${P}store.monthly`, originalTransactionId: 'o5', transactionId: 't0', purchaseDate: NOW - 40 * DAY, expiresDate: NOW - 10 * DAY }
        : { bundleId: 'b', productId: `${P}hosting.monthly`, originalTransactionId: 'o5', transactionId: 't2', purchaseDate: renewedAt, expiresDate: NOW + 29 * DAY },
      statuses: async () => ({ status: 200, items: [{ status: 1, originalTransactionId: 'o5', signedTransactionInfo: 'latest' }] }),
    });
    const deployOffline = vi.fn(async (_s: string) => {});
    const out = await sweepIos({ repo: r, publish: vi.fn(), deployOffline, verify }, 50, { now: () => NOW });
    expect(upsertVerified).toHaveBeenCalledWith(
      expect.objectContaining({ originalTransactionId: 'o5', productId: `${P}hosting.monthly`, productPurchasedAt: renewedAt, status: 1 }),
      { checkedAt: NOW },
    );
    expect(markTakenDown).not.toHaveBeenCalled();
    expect(deployOffline).not.toHaveBeenCalled();
    expect(out).toEqual(summary({ stillActive: ['h'] }));
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

  it('takedown stamps the flag BEFORE deploying; a definite deploy failure clears it again (retried next sweep)', async () => {
    quiet();
    const log: string[] = [];
    const { r, markTakenDown, clearTakenDown } = repo([], [], [lapsed('o1', 'a'), lapsed('o2', 'b')]);
    markTakenDown.mockImplementation(async (o: string) => { log.push(`stamp:${o}`); });
    clearTakenDown.mockImplementation(async (o: string) => { log.push(`clear:${o}`); });
    const deployOffline = vi.fn(async (s: string) => { log.push(`deploy:${s}`); if (s === 'a') throw new Error('vercel 500'); });
    const out = await sweepIos({ repo: r, publish: vi.fn(), deployOffline, verify: apple({ o1: 2, o2: 2 }) }, 50, { now: () => NOW });
    expect(log).toEqual(['stamp:o1', 'deploy:a', 'clear:o1', 'stamp:o2', 'deploy:b']);
    expect(out).toEqual(summary({ takenDown: ['b'], takedownFailed: ['a'] }));
  });

  it('an offline deploy with an unknown outcome (no response from Vercel) keeps the flag', async () => {
    quiet();
    const { r, markTakenDown, clearTakenDown } = repo([], [], [lapsed('o1', 'a')]);
    const deployOffline = vi.fn(async () => { throw Object.assign(new Error('timeout of 120000ms exceeded'), { isAxiosError: true }); });
    const out = await sweepIos({ repo: r, publish: vi.fn(), deployOffline, verify: apple({ o1: 2 }) }, 50, { now: () => NOW });
    expect(markTakenDown).toHaveBeenCalledWith('o1', NOW);
    expect(clearTakenDown).not.toHaveBeenCalled();
    expect(out).toEqual(summary({ takedownUncertain: ['a'] }));
  });

  it('if stamping fails, nothing is deployed', async () => {
    quiet();
    const { r, markTakenDown } = repo([], [], [lapsed('o1', 'a')]);
    markTakenDown.mockRejectedValueOnce(new Error('db'));
    const deployOffline = vi.fn(async () => {});
    const out = await sweepIos({ repo: r, publish: vi.fn(), deployOffline, verify: apple({ o1: 2 }) }, 50, { now: () => NOW });
    expect(deployOffline).not.toHaveBeenCalled();
    expect(out).toEqual(summary({ takedownFailed: ['a'] }));
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

  it('M4: a restore first strips the pending copy for the tier Apple reports NOW (never adds links)', async () => {
    const { r } = repo([], [active('o1', 'a')]);
    const order: string[] = [];
    const publish = vi.fn(async (s: string, _o?: { force: boolean }) => { order.push('publish'); return ok(s); });
    const stripPending = vi.fn(async (_s: string, _p: string) => { order.push('strip'); });
    const out = await sweepIos({ repo: r, publish, deployOffline: noOffline, verify: apple({ o1: 1 }), stripPending }, 50, { now: () => NOW });
    expect(stripPending.mock.calls).toEqual([['a', 'p']]); // Apple's (latest) product, not the stored row's
    expect(order).toEqual(['strip', 'publish']);
    expect(out.restored).toEqual(['a']);
  });

  it('M4: a failing strip never blocks the restore (the gates stay authoritative)', async () => {
    quiet();
    const { r } = repo([], [active('o1', 'a')]);
    const stripPending = vi.fn(async () => { throw new Error('gcs down'); });
    const out = await sweepIos({ repo: r, publish: vi.fn(async (s: string) => ok(s)), deployOffline: noOffline, verify: apple({ o1: 1 }), stripPending }, 50, { now: () => NOW });
    expect(out.restored).toEqual(['a']);
  });

  it('M4: nothing is stripped when Apple says not active (no restore)', async () => {
    const { r } = repo([], [active('o1', 'a')]);
    const stripPending = vi.fn(async () => {});
    await sweepIos({ repo: r, publish: vi.fn(), deployOffline: noOffline, verify: apple({ o1: 2 }), stripPending }, 50, { now: () => NOW });
    expect(stripPending).not.toHaveBeenCalled();
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

  it('defers restores and takedowns that do not fit the budget (passes 2/3 stop starting at 120 s)', async () => {
    const { r, clearTakenDown, markTakenDown, takedownCandidates } = repo(
      [], [active('o1', 'r1'), active('o2', 'r2')], [lapsed('o3', 't1'), lapsed('o4', 't2')]);
    let t = 0;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const publish = vi.fn(async (s: string) => { t += 50_000; return ok(s); });
    const deployOffline = vi.fn(async (_s: string) => { t += 50_000; });
    // r1 (0 → 50 s), r2 (50 → 100 s), t1 starts at 100 s (→ 150 s), t2 deferred (past 120 s).
    const out = await sweepIos({ repo: r, publish, deployOffline, verify: apple({ o1: 1, o2: 1, o3: 2, o4: 2 }) }, 50, { now: () => t });
    expect(clearTakenDown.mock.calls).toEqual([['o1'], ['o2']]);
    expect(takedownCandidates).toHaveBeenCalled();
    expect(deployOffline.mock.calls).toEqual([['t1']]);
    expect(markTakenDown.mock.calls.map((c) => c[0])).toEqual(['o3']);
    expect(out).toEqual(summary({ restored: ['r1', 'r2'], takenDown: ['t1'], deferred: ['t2'] }));
  });

  it('restores and takedowns are not started after 120 s even though pass 1 may run to 140 s', async () => {
    const { r, restoreCandidates, takedownCandidates } = repo([row('o1', 'a')], [active('o2', 'r')], [lapsed('o3', 't')]);
    let t = 0;
    const publish = vi.fn(async (s: string) => { t += 125_000; return ok(s); });
    const out = await sweepIos({ repo: r, publish, deployOffline: noOffline, verify: neverVerify }, 50, { now: () => t });
    expect(restoreCandidates).not.toHaveBeenCalled();
    expect(takedownCandidates).not.toHaveBeenCalled();
    expect(out).toEqual(summary({ checked: 1, published: ['a'] }));
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

  it('an Apple call that never answers times out (≈5 s) and the row is skipped, not acted on', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { r, markTakenDown, clearTakenDown, markLapseChecked } = repo([], [active('oR', 'r')], [lapsed('oT', 't')]);
    const verify = vi.fn(() => new Promise<VerifiedTx>(() => {}));
    const publish = vi.fn();
    const out = await sweepIos({ repo: r, publish, deployOffline: noOffline, verify }, 50, { now: () => NOW, appleTimeoutMs: 10 });
    expect(publish).not.toHaveBeenCalled();
    expect(markTakenDown).not.toHaveBeenCalled();
    expect(clearTakenDown).not.toHaveBeenCalled();
    expect(markLapseChecked.mock.calls).toEqual([['oR', NOW], ['oT', NOW]]);
    expect(out).toEqual(summary({ appleUnavailable: ['r', 't'] }));
  });

  it('permanent Apple failures (not-found, bad-product, bad-bundle) are counted as unresolvable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { r, markTakenDown } = repo([], [], [lapsed('n', 'a'), lapsed('p', 'b'), lapsed('q', 'c'), lapsed('x', 'd')]);
    const verify = apple({
      n: new VerifyFailure('not-found'), p: new VerifyFailure('bad-product'), q: new VerifyFailure('bad-bundle'), x: new VerifyFailure('apple-unavailable'),
    });
    const out = await sweepIos({ repo: r, publish: vi.fn(), deployOffline: noOffline, verify }, 50, { now: () => NOW });
    expect(markTakenDown).not.toHaveBeenCalled();
    expect(out).toEqual(summary({ appleUnresolvable: ['a', 'b', 'c'], appleUnavailable: ['d'] }));
    expect(out.appleUnresolvableCount).toBe(3);
    expect(out.appleUnavailableCount).toBe(1);
  });

  it('every Apple check on a restore/takedown candidate stamps lapse_checked_at (any outcome); pass 1 does not', async () => {
    quiet();
    const looksLapsed = { ...row('o0', 'p'), expires_at: iso(NOW - 2 * DAY) };
    const { r, markLapseChecked } = repo([looksLapsed], [active('o1', 'r1'), active('o2', 'r2')], [lapsed('o3', 't1'), lapsed('o4', 't2')]);
    const verify = apple({ o0: 2, o1: 1, o2: 2, o3: 4, o4: new Error('net') });
    await sweepIos({ repo: r, publish: async (s) => ok(s), deployOffline: noOffline, verify }, 50, { now: () => NOW });
    expect(markLapseChecked.mock.calls.map((c) => c[0])).toEqual(['o1', 'o2', 'o3', 'o4']);
  });

  it('rows Apple cannot resolve rotate to the back: a lapsed row behind them is taken down on the next sweep', async () => {
    quiet();
    // Stateful fake: candidates ordered by lapse_checked_at asc nulls first, then expires_at; limit 2.
    const db: PurchaseRow[] = [
      { ...lapsed('u1', 'stuck1'), expires_at: iso(NOW - 30 * DAY) },
      { ...lapsed('u2', 'stuck2'), expires_at: iso(NOW - 29 * DAY) },
      { ...lapsed('L', 'real'), expires_at: iso(NOW - 2 * DAY) },
    ];
    const key = (x: PurchaseRow) => [x.lapse_checked_at == null ? -Infinity : Date.parse(x.lapse_checked_at), Date.parse(x.expires_at!)];
    const { r, takedownCandidates, markLapseChecked, markTakenDown } = repo([], [], []);
    takedownCandidates.mockImplementation(async (n: number) =>
      db.filter((x) => x.taken_down_at == null)
        .sort((a, b) => { const [a1, a2] = key(a); const [b1, b2] = key(b); return a1 - b1 || a2 - b2; })
        .slice(0, n));
    markLapseChecked.mockImplementation(async (o: string, at: number) => { db.find((x) => x.original_transaction_id === o)!.lapse_checked_at = iso(at); });
    markTakenDown.mockImplementation(async (o: string, at: number) => { db.find((x) => x.original_transaction_id === o)!.taken_down_at = iso(at); });
    const deployOffline = vi.fn(async (_s: string) => {});
    const verify = apple({ u1: new VerifyFailure('not-found'), u2: new VerifyFailure('not-found'), L: 2 });

    const first = await sweepIos({ repo: r, publish: vi.fn(), deployOffline, verify }, 2, { now: () => NOW });
    expect(first).toEqual(summary({ appleUnresolvable: ['stuck1', 'stuck2'] }));
    expect(deployOffline).not.toHaveBeenCalled();

    const second = await sweepIos({ repo: r, publish: vi.fn(), deployOffline, verify }, 2, { now: () => NOW + 600_000 });
    expect(deployOffline.mock.calls).toEqual([['real']]);
    expect(second.takenDown).toEqual(['real']);
  });

  it('Sandbox: takedown candidates always include Sandbox (the sweep watches them, fix round 2)', async () => {
    for (const takedownSandbox of [undefined, true]) {
      const a = repo([], [], []);
      await sweepIos({ repo: a.r, publish: vi.fn(), deployOffline: noOffline, verify: neverVerify, takedownSandbox }, 50, { now: () => NOW });
      expect(a.takedownCandidates).toHaveBeenCalledWith(50, NOW, { includeSandbox: true });
    }
  });

  it('a renewing Sandbox purchase is refreshed from Apple (fresh expiry) and left alone', async () => {
    const sbx = { ...lapsed('s2', 'ios-test-cuts'), environment: 'Sandbox' as const };
    const { r, markTakenDown, upsertVerified } = repo([], [], [sbx]);
    const deployOffline = vi.fn(async (_s: string) => {});
    const out = await sweepIos({ repo: r, publish: vi.fn(), deployOffline, verify: apple({ s2: 1 }) }, 50, { now: () => NOW });
    expect(upsertVerified).toHaveBeenCalledWith(expect.objectContaining({ originalTransactionId: 's2', expiresAt: NOW + 30 * DAY, environment: 'Production' }), { checkedAt: NOW });
    expect(markTakenDown).not.toHaveBeenCalled();
    expect(deployOffline).not.toHaveBeenCalled();
    expect(out).toEqual(summary({ stillActive: ['ios-test-cuts'] }));
  });

  it('a truly expired Sandbox purchase: gates closed (flag stamped) but the website is left up, unless takedownSandbox', async () => {
    quiet();
    const sbx = () => ({ ...lapsed('s3', 'ios-test-cuts'), environment: 'Sandbox' as const });
    const a = repo([], [], [sbx()]);
    const offA = vi.fn(async (_s: string) => {});
    const outA = await sweepIos({ repo: a.r, publish: vi.fn(), deployOffline: offA, verify: apple({ s3: 2 }) }, 50, { now: () => NOW });
    expect(a.markTakenDown.mock.calls).toEqual([['s3', NOW]]);
    expect(offA).not.toHaveBeenCalled();
    expect(outA).toEqual(summary({ sandboxGatesClosed: ['ios-test-cuts'] }));

    const b = repo([], [], [sbx()]);
    const offB = vi.fn(async (_s: string) => {});
    const outB = await sweepIos({ repo: b.r, publish: vi.fn(), deployOffline: offB, verify: apple({ s3: 2 }), takedownSandbox: true }, 50, { now: () => NOW });
    expect(offB.mock.calls).toEqual([['ios-test-cuts']]);
    expect(outB).toEqual(summary({ takenDown: ['ios-test-cuts'] }));
  });

  it('a Sandbox gate-close whose stamp fails is reported as a failed takedown', async () => {
    quiet();
    const { r, markTakenDown } = repo([], [], [{ ...lapsed('s4', 'x'), environment: 'Sandbox' as const }]);
    markTakenDown.mockRejectedValueOnce(new Error('db'));
    const out = await sweepIos({ repo: r, publish: vi.fn(), deployOffline: noOffline, verify: apple({ s4: 2 }) }, 50, { now: () => NOW });
    expect(out).toEqual(summary({ takedownFailed: ['x'] }));
  });

  it('Sandbox rows are still restored when Apple says active', async () => {
    const sbx = { ...active('s1', 'ios-test-fade'), environment: 'Sandbox' as const };
    const { r, clearTakenDown } = repo([], [sbx]);
    const out = await sweepIos({ repo: r, publish: async (s) => ok(s), deployOffline: noOffline, verify: apple({ s1: 1 }) }, 50, { now: () => NOW });
    expect(clearTakenDown).toHaveBeenCalledWith('s1');
    expect(out.restored).toEqual(['ios-test-fade']);
  });

  it('refunded then resubscribed: a revoked + taken-down row Apple says is active is restored, and the row refresh carries checkedAt (clears revoked_at)', async () => {
    const refunded = { ...active('o1', 'a'), revoked_at: iso(NOW - 5 * DAY), expires_at: iso(NOW - 5 * DAY) };
    const { r, clearTakenDown, upsertVerified } = repo([], [refunded]);
    const out = await sweepIos({ repo: r, publish: async (s) => ok(s), deployOffline: noOffline, verify: apple({ o1: 1 }) }, 50, { now: () => NOW });
    expect(upsertVerified).toHaveBeenCalledWith(expect.objectContaining({ originalTransactionId: 'o1', revoked: false, status: 1 }), { checkedAt: NOW });
    expect(clearTakenDown).toHaveBeenCalledWith('o1');
    expect(out.restored).toEqual(['a']);
  });

  it('isIndefiniteDeployError: only no-response (timeout/network) or an explicit marker', () => {
    expect(isIndefiniteDeployError(Object.assign(new Error('timeout'), { isAxiosError: true }))).toBe(true);
    expect(isIndefiniteDeployError(Object.assign(new Error('x'), { indefinite: true }))).toBe(true);
    expect(isIndefiniteDeployError(Object.assign(new Error('500'), { isAxiosError: true, response: { status: 500 } }))).toBe(false);
    expect(isIndefiniteDeployError(new Error('Vercel deployment error'))).toBe(false);
    expect(isIndefiniteDeployError(null)).toBe(false);
  });
});

describe('makeStripPending (M4)', () => {
  const P = 'com.ibrahim1774.aibarber.';
  const pendingWith = (over: Record<string, unknown>) => ({ siteId: 'a', siteData: { shopName: 'A', ...over } as any, imageUrlMap: {} });

  it('rewrites the pending file without the links the current product lacks', async () => {
    const stored = pendingWith({ bookingUrl: 'https://www.aibarber.org/book/a', shopUrl: 'https://www.aibarber.org/shop/a' });
    const writePending = vi.fn(async () => {});
    await makeStripPending({ readPending: async () => stored, writePending })('a', `${P}bookings.monthly`);
    expect(writePending).toHaveBeenCalledTimes(1);
    const written = (writePending.mock.calls[0] as any[])[1];
    expect(written.siteData.bookingUrl).toBe('https://www.aibarber.org/book/a');
    expect('shopUrl' in written.siteData).toBe(false);
    expect(written.imageUrlMap).toEqual({});
  });

  it('writes nothing when nothing changes, or there is no pending file', async () => {
    const writePending = vi.fn(async () => {});
    await makeStripPending({ readPending: async () => pendingWith({ bookingUrl: 'https://www.aibarber.org/book/a' }), writePending })('a', `${P}store.yearly`);
    await makeStripPending({ readPending: async () => null, writePending })('a', `${P}hosting.monthly`);
    expect(writePending).not.toHaveBeenCalled();
  });
});
