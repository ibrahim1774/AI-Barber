import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runDomainSweep } = vi.hoisted(() => ({ runDomainSweep: vi.fn(async (_deadline: number): Promise<any> => ({ resumed: [] })) }));
vi.mock('../../lib/ios/domainLive.js', () => ({ runDomainSweep }));

import handler from '../../api/ios/domain-sweep.js';

const mkRes = () => { const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() }; return res; };
const cron = { headers: { 'user-agent': 'vercel-cron/1.0' } };

describe('api/ios/domain-sweep', () => {
  beforeEach(() => { delete process.env.CRON_SECRET; runDomainSweep.mockClear(); });

  it('401 when not a cron call; nothing runs', async () => {
    const res = mkRes();
    await handler({ headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(runDomainSweep).not.toHaveBeenCalled();
  });

  it('starts steps only in its own first 140 s', async () => {
    const before = Date.now();
    const res = mkRes();
    await handler(cron, res);
    const deadline = runDomainSweep.mock.calls[0][0];
    expect(deadline).toBeGreaterThanOrEqual(before + 140_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 140_000);
    expect(res.json).toHaveBeenCalledWith({ ok: true, resumed: [] });
  });

  it('a sweep error is a 500 (visible in cron logs)', async () => {
    runDomainSweep.mockResolvedValueOnce({ error: 'db down' });
    const res = mkRes();
    await handler(cron, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
