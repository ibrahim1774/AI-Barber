import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

const { runReminders, runDailySummary, stripeOnboard, stripeStatus } = vi.hoisted(() => ({
  runReminders: vi.fn(), runDailySummary: vi.fn(), stripeOnboard: vi.fn(), stripeStatus: vi.fn(),
}));
vi.mock('../../lib/bookings/notify.js', () => ({
  runReminders, runDailySummary, liveReminderDeps: () => ({}), liveDailySummaryDeps: () => ({}),
}));
vi.mock('../../lib/bookings/payments.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/bookings/payments.js')>()),
  stripeOnboard, stripeStatus, liveOwnerStripeDeps: () => ({}),
}));

const { expireStaleCardHolds, retryPendingRefunds } = vi.hoisted(() => ({
  expireStaleCardHolds: vi.fn(),
  retryPendingRefunds: vi.fn(),
}));
vi.mock('../../lib/bookings/core.js', () => ({ expireStaleCardHolds, retryPendingRefunds }));
vi.mock('../../lib/bookings/live.js', () => ({ liveDeps: () => ({}) }));
import { handleWebhook } from '../../api/stripe/connect-webhook.js';
import reminders from '../../api/book/reminders.js';
import dailySummary from '../../api/book/daily-summary.js';
import onboard from '../../api/shop/stripe/onboard.js';
import status from '../../api/shop/stripe/status.js';
import type { WebhookDeps } from '../../lib/bookings/payments.js';

const mkRes = () => { const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn(), end: vi.fn(), setHeader: vi.fn() }; return res; };
const cron = { headers: { 'user-agent': 'vercel-cron/1.0' } };

function rawReq(body: string, headers: Record<string, string>, method = 'POST') {
  const req: any = new EventEmitter();
  req.method = method;
  req.headers = headers;
  setTimeout(() => { req.emit('data', Buffer.from(body)); req.emit('end'); }, 0);
  return req;
}
const sign = (body: string, secret: string, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

const saved = { ...process.env };
beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect'; });
afterEach(() => { process.env = { ...saved }; vi.restoreAllMocks(); });

describe('api/stripe/connect-webhook', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'account.updated', account: 'acct_1', data: { object: { id: 'acct_1', charges_enabled: true } } });
  const deps = () => {
    const d = {
      eventProcessed: vi.fn(async () => false), recordEvent: vi.fn(async () => {}),
      setChargesEnabledForAccount: vi.fn(async () => {}),
    } as unknown as WebhookDeps;
    return d;
  };

  it('verifies the signature over the raw body and processes the event', async () => {
    const d = deps();
    const res = mkRes();
    await handleWebhook(rawReq(body, { 'stripe-signature': sign(body, 'whsec_connect') }), res, () => d);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true, outcome: 'account:enabled' });
    expect(d.setChargesEnabledForAccount).toHaveBeenCalledWith('acct_1', true);
  });

  it('400 on a bad or Primehub-secret signature; nothing processed', async () => {
    const d = deps();
    const res = mkRes();
    await handleWebhook(rawReq(body, { 'stripe-signature': sign(body, 'whsec_primehub') }), res, () => d);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(d.eventProcessed).not.toHaveBeenCalled();
  });

  it('400 on a stale timestamp', async () => {
    const res = mkRes();
    await handleWebhook(rawReq(body, { 'stripe-signature': sign(body, 'whsec_connect', Math.floor(Date.now() / 1000) - 600) }), res, deps);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('500 when the secret is missing, 405 on GET', async () => {
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    const res = mkRes();
    await handleWebhook(rawReq(body, {}), res, deps);
    expect(res.status).toHaveBeenCalledWith(500);
    const res2 = mkRes();
    await handleWebhook({ method: 'GET', headers: {} }, res2, deps);
    expect(res2.status).toHaveBeenCalledWith(405);
  });

  it('500 (so Stripe retries) when processing fails', async () => {
    const d = deps();
    (d as any).setChargesEnabledForAccount = vi.fn().mockRejectedValue(new Error('db'));
    const res = mkRes();
    await handleWebhook(rawReq(body, { 'stripe-signature': sign(body, 'whsec_connect') }), res, () => d);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(d.recordEvent).not.toHaveBeenCalled();
  });
});

describe('crons', () => {
  it('reminders: 401 unauthorized, 200 summary', async () => {
    const res = mkRes();
    await reminders({ headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    runReminders.mockResolvedValue({ due: 2, sent: 2, failed: 0 });
    expireStaleCardHolds.mockResolvedValue({ expired: 1 });
    retryPendingRefunds.mockResolvedValue({ retried: 1, refunded: 1, failed: 0, stuck: 0 });
    const res2 = mkRes();
    await reminders(cron, res2);
    expect(res2.json).toHaveBeenCalledWith({
      ok: true, due: 2, sent: 2, failed: 0,
      holds: { expired: 1 }, refunds: { retried: 1, refunded: 1, failed: 0, stuck: 0 },
    });
    expect(expireStaleCardHolds).toHaveBeenCalledWith({}, 50);
  });

  it('reminders: a failing sweep is logged and never blocks the reminders', async () => {
    runReminders.mockResolvedValue({ due: 1, sent: 1, failed: 0 });
    expireStaleCardHolds.mockRejectedValue(new Error('db down'));
    retryPendingRefunds.mockResolvedValue({ retried: 0, refunded: 0, failed: 0, stuck: 0 });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = mkRes();
    await reminders(cron, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ sent: 1, holds: { error: true } }));
    err.mockRestore();
  });

  it('daily-summary: 401 unauthorized, 200 summary, 500 on failure', async () => {
    const res = mkRes();
    await dailySummary({ headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    runDailySummary.mockResolvedValue({ shops: 1, pushed: 1 });
    const res2 = mkRes();
    await dailySummary(cron, res2);
    expect(res2.json).toHaveBeenCalledWith({ ok: true, shops: 1, pushed: 1 });
    runDailySummary.mockRejectedValue(new Error('x'));
    const res3 = mkRes();
    await dailySummary(cron, res3);
    expect(res3.status).toHaveBeenCalledWith(500);
  });
});

describe('owner Stripe endpoints', () => {
  it('onboard: POST only, passes the Authorization header through', async () => {
    stripeOnboard.mockResolvedValue({ status: 200, body: { url: 'u' } });
    const res = mkRes();
    await onboard({ method: 'POST', headers: { authorization: 'Bearer t' } }, res);
    expect(stripeOnboard).toHaveBeenCalledWith('Bearer t', {});
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ url: 'u' });
    const res2 = mkRes();
    await onboard({ method: 'GET', headers: {} }, res2);
    expect(res2.status).toHaveBeenCalledWith(405);
  });

  it('status: GET only', async () => {
    stripeStatus.mockResolvedValue({ status: 401, body: { error: 'unauthorized' } });
    const res = mkRes();
    await status({ method: 'GET', headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    const res2 = mkRes();
    await status({ method: 'POST', headers: {} }, res2);
    expect(res2.status).toHaveBeenCalledWith(405);
  });
});

describe('vercel.json + stripe-return page', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8'));

  it('crons for reminders (15 min) and daily summary (hourly)', () => {
    expect(cfg.crons).toEqual(expect.arrayContaining([
      { path: '/api/book/reminders', schedule: '*/15 * * * *' },
      { path: '/api/book/daily-summary', schedule: '0 * * * *' },
    ]));
  });

  it('/stripe-return rewrites come before the SPA catch-all', () => {
    const srcs = cfg.rewrites.map((r: any) => r.source);
    const catchAll = srcs.indexOf('/((?!api/.*).*)');
    for (const s of ['/stripe-return', '/stripe-return/']) {
      const i = srcs.indexOf(s);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(catchAll);
      expect(cfg.rewrites[i].destination).toBe('/stripe-return.html');
    }
  });

  it('stripe-return.html deep-links to aibarber://get-paid with an allow-listed state', () => {
    const html = fs.readFileSync(path.join(process.cwd(), 'public/stripe-return.html'), 'utf8');
    expect(html).toContain("'aibarber://get-paid?state='");
    expect(html).toContain("state !== 'return' && state !== 'refresh'");
    expect(html).toContain('encodeURIComponent(state)');
  });
});
