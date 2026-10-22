// Cron (every 15 min): email a reminder for booked appointments 23–25 h ahead whose
// reminder_sent_at is null, stamping it once sent. Each reminder is claimed first (ab_events) so
// overlapping runs never double-send; a claim whose run died goes stale after 10 min and is retried.
// The run stops claiming new work well before maxDuration (REMINDER_BUDGET_MS).
import { authorized } from '../../lib/cronAuth.js';
import { runReminders, liveReminderDeps, REMINDER_BUDGET_MS } from '../../lib/bookings/notify.js';
import { expireStaleCardHolds, retryPendingRefunds } from '../../lib/bookings/core.js';
import { liveDeps } from '../../lib/bookings/live.js';
import { expireStaleOrderHolds, retryPendingOrderRefunds } from '../../lib/store/core.js';
import { liveStoreDeps } from '../../lib/store/live.js';

// Housekeeping runs FIRST, in small batches, each sweep in its own try block: they are small,
// so they never starve behind the reminders' time budget, and a failing runReminders can't skip
// them. Whatever doesn't fit runs next time. Both sweeps are compare-and-set, so a run killed
// mid-way leaves nothing half-done.
const SWEEP_LIMIT = 50;
// One shared wall-clock budget for all the sweeps (~60 s from the handler's start); every sweep
// stops picking up new rows past it, and the reminders get whatever is left of theirs.
const SWEEP_BUDGET_MS = 60_000;

async function sweep(name: string, run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (e: any) {
    console.error(`[book/reminders] ${name} failed:`, e?.message || e);
    return { error: true };
  }
}

export const config = { maxDuration: 300 };

export default async function handler(req: any, res: any) {
  if (!authorized(req)) return res.status(401).json({ error: 'Not authorized' });
  const started = Date.now();
  const budget = { deadline: started + SWEEP_BUDGET_MS };
  // Every sweep takes the shared budget (e2e I4): with Stripe timing out, the booking sweeps used
  // to run past maxDuration before the reminders started.
  const holds = await sweep('card-hold sweep', () => expireStaleCardHolds(liveDeps(), SWEEP_LIMIT, budget));
  const refunds = await sweep('refund retry', () => retryPendingRefunds(liveDeps(), undefined, budget));
  // Store orders (Phase 3): orphaned card holds (50 per run) and owed owner refunds (25 per run).
  const orderHolds = await sweep('order-hold sweep', () => expireStaleOrderHolds(liveStoreDeps(), SWEEP_LIMIT, budget));
  const orderRefunds = await sweep('order refund retry', () => retryPendingOrderRefunds(liveStoreDeps(), undefined, budget));
  try {
    const summary = await runReminders(liveReminderDeps(), { budgetMs: Math.max(0, REMINDER_BUDGET_MS - (Date.now() - started)) });
    return res.status(200).json({ ok: true, ...summary, holds, refunds, orderHolds, orderRefunds });
  } catch (e: any) {
    console.error('[book/reminders] failed:', e?.message || e);
    return res.status(500).json({ error: 'reminders-failed' });
  }
}
