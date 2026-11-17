// api/ios/sweep.ts "not live yet" email step (F7): after the takedown sweep, raced against 60 s, per-request timeouts, off = origin/main.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { takedownCandidates, sweepIosNotLive, liveIosEmailDeps, order } = vi.hoisted(() => ({
  takedownCandidates: vi.fn(),
  sweepIosNotLive: vi.fn(),
  liveIosEmailDeps: vi.fn(),
  order: [] as string[],
}));
vi.mock('../../lib/deploySite.js', () => ({ deployRenderedSite: vi.fn() }));
vi.mock('../../lib/ios/appleVerify.js', async (orig) => ({ ...(await orig<object>()), lazyDefaultVerifier: () => vi.fn() }));
vi.mock('../../lib/ios/purchases.js', () => ({
  supabasePurchases: () => ({
    unpublishedBound: vi.fn(async () => []), markPublished: vi.fn(async () => {}),
    restoreCandidates: vi.fn(async () => []),
    takedownCandidates: (...a: unknown[]) => { order.push('takedown'); return takedownCandidates(...a); },
    markTakenDown: vi.fn(), clearTakenDown: vi.fn(), upsertVerified: vi.fn(), markLapseChecked: vi.fn(async () => {}),
  }),
}));
vi.mock('../../lib/ios/emailFlows.js', () => ({
  sweepIosNotLive: (...a: unknown[]) => { order.push('email'); return sweepIosNotLive(...a); },
  liveIosEmailDeps: (...a: unknown[]) => liveIosEmailDeps(...a),
}));

import handler from '../../api/ios/sweep.js';

const mkRes = () => { const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() }; return res; };
const cron = { headers: { 'user-agent': 'vercel-cron/1.0' } };

describe('api/ios/sweep not-live email step', () => {
  beforeEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.IOS_EMAIL_NOT_LIVE;
    order.length = 0;
    takedownCandidates.mockReset().mockResolvedValue([]);
    sweepIosNotLive.mockReset().mockResolvedValue({ sent: 1, stopped: 0, skipped: 0, errors: 0 });
    liveIosEmailDeps.mockReset().mockReturnValue({ fake: true });
  });
  afterEach(() => { vi.useRealTimers(); delete process.env.IOS_EMAIL_NOT_LIVE; });

  it('switch unset or not "1": the email code is never reached and the answer has no iosEmail key (as on origin/main)', async () => {
    for (const v of [undefined, '0', 'true', '']) {
      if (v === undefined) delete process.env.IOS_EMAIL_NOT_LIVE; else process.env.IOS_EMAIL_NOT_LIVE = v;
      const res = mkRes();
      await handler(cron, res);
      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.ok).toBe(true);
      expect('iosEmail' in body).toBe(false);
    }
    expect(sweepIosNotLive).not.toHaveBeenCalled();
    expect(liveIosEmailDeps).not.toHaveBeenCalled();
    expect(order).toEqual(['takedown', 'takedown', 'takedown', 'takedown']);
  });

  it('switch on: the takedown sweep runs first, then the email step with per-request timeouts; the answer carries iosEmail', async () => {
    process.env.IOS_EMAIL_NOT_LIVE = '1';
    const res = mkRes();
    await handler(cron, res);
    expect(order).toEqual(['takedown', 'email']);
    expect(liveIosEmailDeps).toHaveBeenCalledWith(undefined, undefined, { requestTimeoutMs: 10_000 });
    expect(res.json.mock.calls[0][0]).toEqual(expect.objectContaining({ ok: true, iosEmail: { sent: 1, stopped: 0, skipped: 0, errors: 0 } }));
  });

  it('a hung email step is cut off after 60 s: the answer is still the sweep summary (200)', async () => {
    process.env.IOS_EMAIL_NOT_LIVE = '1';
    sweepIosNotLive.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const res = mkRes();
    const done = handler(cron, res);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(res.json).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_500);
    await done;
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toEqual(expect.objectContaining({ ok: true, iosEmail: { timedOut: true } }));
  });

  it('a throwing email step cannot fail the response', async () => {
    process.env.IOS_EMAIL_NOT_LIVE = '1';
    sweepIosNotLive.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = mkRes();
    await handler(cron, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect('iosEmail' in res.json.mock.calls[0][0]).toBe(false);
  });
});

describe('liveIosEmailDeps request timeout', async () => {
  const real = await vi.importActual<typeof import('../../lib/ios/emailFlows.js')>('../../lib/ios/emailFlows.js');
  it('with requestTimeoutMs every REST call carries timeoutMs; without it none does', async () => {
    const calls: any[] = [];
    const rest: any = async (path: string, init: any = {}) => { calls.push({ path, ...init }); return []; };
    const on = real.liveIosEmailDeps(rest, {}, { requestTimeoutMs: 10_000 });
    await on.activeRows(5); await on.stampChecked('u', 'x'); await on.isSuppressed('a@b.co');
    expect(calls.length).toBe(3);
    expect(calls.every((c) => c.timeoutMs === 10_000)).toBe(true);
    calls.length = 0;
    const off = real.liveIosEmailDeps(rest, {});
    await off.activeRows(5); await off.stampChecked('u', 'x');
    expect(calls.some((c) => 'timeoutMs' in c)).toBe(false);
  });
});
