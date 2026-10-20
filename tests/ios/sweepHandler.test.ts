import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const unpublishedBound = vi.fn();
vi.mock('../../lib/publishSite.js', () => ({ publishSite: vi.fn(async (s: string) => ({ ok: true, siteId: s })) }));
vi.mock('../../lib/ios/purchases.js', () => ({
  supabasePurchases: () => ({ unpublishedBound, markPublished: vi.fn(async () => {}) }),
}));

import handler from '../../api/ios/sweep.js';

const mkRes = () => { const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() }; return res; };
const cron = { headers: { 'user-agent': 'vercel-cron/1.0' } };

describe('api/ios/sweep', () => {
  beforeEach(() => { unpublishedBound.mockReset(); });
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
    expect(res.json).toHaveBeenCalledWith({ ok: true, checked: 1, published: ['a'], failed: [], missing: [], deferred: [] });
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
