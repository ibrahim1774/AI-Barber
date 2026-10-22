import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { unpublishedBound, restoreCandidates, takedownCandidates, markTakenDown, clearTakenDown, publishSite, writePendingSite, readPendingSite, deployRenderedSite, appleVerify } = vi.hoisted(() => ({
  unpublishedBound: vi.fn(),
  restoreCandidates: vi.fn(),
  takedownCandidates: vi.fn(),
  markTakenDown: vi.fn(async (_o: string, _at: number) => {}),
  clearTakenDown: vi.fn(async (_o: string) => {}),
  publishSite: vi.fn(async (s: string, _o?: unknown) => ({ ok: true, siteId: s })),
  writePendingSite: vi.fn(async () => {}),
  readPendingSite: vi.fn(async (_s: string): Promise<any> => null),
  deployRenderedSite: vi.fn(async (_i: { siteId: string; html: string }) => ({ deploymentUrl: 'https://x.vercel.app', uploadedImages: {} })),
  appleVerify: vi.fn(),
}));
vi.mock('../../lib/publishSite.js', () => ({ publishSite, writePendingSite, readPendingSite }));
const { runDomainSweep } = vi.hoisted(() => ({ runDomainSweep: vi.fn(async (_deadline: number): Promise<any> => ({ resumed: [] })) }));
vi.mock('../../lib/ios/domainLive.js', () => ({ runDomainSweep }));
vi.mock('../../lib/deploySite.js', () => ({ deployRenderedSite }));
vi.mock('../../lib/ios/appleVerify.js', async (orig) => ({ ...(await orig<object>()), lazyDefaultVerifier: () => appleVerify }));
vi.mock('../../lib/ios/purchases.js', () => ({
  supabasePurchases: () => ({
    unpublishedBound, markPublished: vi.fn(async () => {}),
    restoreCandidates, takedownCandidates, markTakenDown, clearTakenDown, upsertVerified: vi.fn(async () => ({})),
    markLapseChecked: vi.fn(async () => {}),
  }),
}));

import handler from '../../api/ios/sweep.js';

const mkRes = () => { const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() }; return res; };
const cron = { headers: { 'user-agent': 'vercel-cron/1.0' } };
const empty = {
  skippedLapsed: [], restored: [], restoreFailed: [], notRestored: [], takenDown: [], takedownFailed: [], takedownUncertain: [],
  stillActive: [], sandboxGatesClosed: [], appleUnavailable: [], appleUnresolvable: [], appleUnavailableCount: 0, appleUnresolvableCount: 0,
};
const appleSays = (status: number) => async (otid: string) => ({
  originalTransactionId: otid, transactionId: 't', productId: 'p', environment: 'Production', expiresAt: 0, revoked: status === 5, status,
});

describe('api/ios/sweep', () => {
  beforeEach(() => {
    delete process.env.CRON_SECRET; // the vercel-cron user agent is only accepted without a secret
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
    expect(res.json).toHaveBeenCalledWith({ ok: true, checked: 1, published: ['a'], failed: [], missing: [], deferred: [], ...empty, domains: { resumed: [] } });
  });

  it('runs the custom-domain step after the site passes, starting steps only until 140 s after the handler began', async () => {
    unpublishedBound.mockResolvedValue([]);
    runDomainSweep.mockClear();
    const before = Date.now();
    const res = mkRes();
    await handler(cron, res);
    const deadline = runDomainSweep.mock.calls[0][0];
    expect(deadline).toBeGreaterThanOrEqual(before + 140_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 140_000);
  });

  it('a domain sweep error is reported but never fails the site sweep', async () => {
    unpublishedBound.mockResolvedValue([]);
    runDomainSweep.mockResolvedValueOnce({ error: 'db down' });
    const res = mkRes();
    await handler(cron, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, domains: { error: 'db down' } }));
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

  it('M4: restore strips the pending file for the current plan before publishing (wired to the pending store)', async () => {
    unpublishedBound.mockResolvedValue([]);
    restoreCandidates.mockResolvedValue([{ original_transaction_id: 'o9', site_slug: 'a' }]);
    appleVerify.mockImplementation(async (otid: string) => ({ ...(await appleSays(1)(otid)), productId: 'com.ibrahim1774.aibarber.hosting.monthly' }));
    readPendingSite.mockResolvedValueOnce({ siteId: 'a', siteData: { shopName: 'A', shopUrl: 'https://www.aibarber.org/shop/a' } });
    await handler(cron, mkRes());
    expect(readPendingSite).toHaveBeenCalledWith('a');
    expect(writePendingSite).toHaveBeenCalledWith('a', { siteId: 'a', siteData: { shopName: 'A' } });
    expect((writePendingSite.mock.invocationCallOrder as number[])[0]).toBeLessThan((publishSite.mock.invocationCallOrder as number[])[0]);
  });

  it('500 with { error } when unpublishedBound throws', async () => {
    unpublishedBound.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = mkRes();
    await handler(cron, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'db down' });
  });

  it('Sandbox rows are always watched; only IOS_TAKEDOWN_SANDBOX=1 deploys their offline page', async () => {
    unpublishedBound.mockResolvedValue([]);
    const prev = process.env.IOS_TAKEDOWN_SANDBOX;
    try {
      delete process.env.IOS_TAKEDOWN_SANDBOX;
      takedownCandidates.mockResolvedValue([{ original_transaction_id: 's9', site_slug: 'sb', environment: 'Sandbox', expires_at: '2020-01-01T00:00:00Z', published_at: '2019-01-01T00:00:00Z' }]);
      appleVerify.mockImplementation(appleSays(2));
      await handler(cron, mkRes());
      expect(takedownCandidates).toHaveBeenLastCalledWith(50, expect.any(Number), { includeSandbox: true });
      expect(markTakenDown).toHaveBeenCalledWith('s9', expect.any(Number));
      expect(deployRenderedSite).not.toHaveBeenCalled();
      process.env.IOS_TAKEDOWN_SANDBOX = '1';
      await handler(cron, mkRes());
      expect(takedownCandidates).toHaveBeenLastCalledWith(50, expect.any(Number), { includeSandbox: true });
      expect(deployRenderedSite).toHaveBeenCalledWith(expect.objectContaining({ siteId: 'sb' }));
    } finally {
      if (prev === undefined) delete process.env.IOS_TAKEDOWN_SANDBOX; else process.env.IOS_TAKEDOWN_SANDBOX = prev;
    }
  });

  it('restore response carries the summary', async () => {
    unpublishedBound.mockResolvedValue([]);
    restoreCandidates.mockResolvedValue([{ original_transaction_id: 'o9', site_slug: 'a' }]);
    appleVerify.mockImplementation(appleSays(1));
    const res = mkRes();
    await handler(cron, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, restored: ['a'] }));
  });
});
