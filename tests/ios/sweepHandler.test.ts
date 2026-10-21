import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { unpublishedBound, restoreCandidates, takedownCandidates, markTakenDown, clearTakenDown, publishSite, writePendingSite, deployRenderedSite, appleVerify } = vi.hoisted(() => ({
  unpublishedBound: vi.fn(),
  restoreCandidates: vi.fn(),
  takedownCandidates: vi.fn(),
  markTakenDown: vi.fn(async (_o: string, _at: number) => {}),
  clearTakenDown: vi.fn(async (_o: string) => {}),
  publishSite: vi.fn(async (s: string, _o?: unknown) => ({ ok: true, siteId: s })),
  writePendingSite: vi.fn(async () => {}),
  deployRenderedSite: vi.fn(async (_i: { siteId: string; html: string }) => ({ deploymentUrl: 'https://x.vercel.app', uploadedImages: {} })),
  appleVerify: vi.fn(),
}));
vi.mock('../../lib/publishSite.js', () => ({ publishSite, writePendingSite }));
vi.mock('../../lib/deploySite.js', () => ({ deployRenderedSite }));
vi.mock('../../lib/ios/appleVerify.js', async (orig) => ({ ...(await orig<object>()), lazyDefaultVerifier: () => appleVerify }));
vi.mock('../../lib/ios/purchases.js', () => ({
  supabasePurchases: () => ({
    unpublishedBound, markPublished: vi.fn(async () => {}),
    restoreCandidates, takedownCandidates, markTakenDown, clearTakenDown, upsertVerified: vi.fn(async () => ({})),
  }),
}));

import handler from '../../api/ios/sweep.js';

const mkRes = () => { const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() }; return res; };
const cron = { headers: { 'user-agent': 'vercel-cron/1.0' } };
const empty = { skippedLapsed: [], restored: [], restoreFailed: [], notRestored: [], takenDown: [], takedownFailed: [], stillActive: [], appleUnavailable: [] };
const appleSays = (status: number) => async (otid: string) => ({
  originalTransactionId: otid, transactionId: 't', productId: 'p', environment: 'Production', expiresAt: 0, revoked: status === 5, status,
});

describe('api/ios/sweep', () => {
  beforeEach(() => {
    for (const f of [unpublishedBound, restoreCandidates, takedownCandidates, markTakenDown, clearTakenDown, publishSite, writePendingSite, deployRenderedSite]) f.mockClear();
    unpublishedBound.mockReset();
    restoreCandidates.mockReset().mockResolvedValue([]);
    takedownCandidates.mockReset().mockResolvedValue([]);
    appleVerify.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('401 when not authorized (same as the Stripe sweeper)', async () => {
    const res = mkRes();
    await handler({ headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(unpublishedBound).not.toHaveBeenCalled();
  });

  it('200 with the summary when authorized', async () => {
    unpublishedBound.mockResolvedValue([{ original_transaction_id: 'o1', site_slug: 'a' }]);
    const res = mkRes();
    await handler(cron, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true, checked: 1, published: ['a'], failed: [], missing: [], deferred: [], ...empty });
  });

  it('takedown deploys the offline page to the slug and never publishes or writes the pending file', async () => {
    unpublishedBound.mockResolvedValue([]);
    takedownCandidates.mockResolvedValue([{ original_transaction_id: 'o9', site_slug: 'fade-studio-x7k2', revoked_at: '2026-10-01T00:00:00Z' }]);
    appleVerify.mockImplementation(appleSays(2));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = mkRes();
    await handler(cron, res);
    expect(deployRenderedSite).toHaveBeenCalledTimes(1);
    const arg = deployRenderedSite.mock.calls[0][0];
    expect(arg.siteId).toBe('fade-studio-x7k2');
    expect(arg.html).toContain('This website is no longer available');
    expect(publishSite).not.toHaveBeenCalled();
    expect(writePendingSite).not.toHaveBeenCalled();
    expect(markTakenDown).toHaveBeenCalledWith('o9', expect.any(Number));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, takenDown: ['fade-studio-x7k2'] }));
  });

  it('restore force-publishes the slug', async () => {
    unpublishedBound.mockResolvedValue([]);
    restoreCandidates.mockResolvedValue([{ original_transaction_id: 'o9', site_slug: 'a' }]);
    appleVerify.mockImplementation(appleSays(1));
    const res = mkRes();
    await handler(cron, res);
    expect(appleVerify).toHaveBeenCalledWith('o9');
    expect(publishSite).toHaveBeenCalledWith('a', { force: true });
    expect(clearTakenDown).toHaveBeenCalledWith('o9');
  });

  it('500 with { error } when unpublishedBound throws', async () => {
    unpublishedBound.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = mkRes();
    await handler(cron, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'db down' });
  });
});
