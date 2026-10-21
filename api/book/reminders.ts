// Cron (every 15 min): email a reminder for booked appointments 23–25 h ahead whose
// reminder_sent_at is null, stamping it once sent. Each reminder is claimed first (ab_events) so
// overlapping runs never double-send; a claim whose run died goes stale after 10 min and is retried.
// The run stops claiming new work well before maxDuration (REMINDER_BUDGET_MS).
import { authorized } from '../../lib/cronAuth.js';
import { runReminders, liveReminderDeps } from '../../lib/bookings/notify.js';

export const config = { maxDuration: 300 };

export default async function handler(req: any, res: any) {
  if (!authorized(req)) return res.status(401).json({ error: 'Not authorized' });
  try {
    // TODO(merge, S1): wire S1's exported orphaned-card-hold sweep here, e.g. `await expireOrphanedCardHolds();` (not imported on purpose: S1 owns it).
    const summary = await runReminders(liveReminderDeps());
    return res.status(200).json({ ok: true, ...summary });
  } catch (e: any) {
    console.error('[book/reminders] failed:', e?.message || e);
    return res.status(500).json({ error: 'reminders-failed' });
  }
}
