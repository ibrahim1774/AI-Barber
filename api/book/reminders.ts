// Cron (every 15 min): email a reminder for booked appointments 23–25 h ahead whose
// reminder_sent_at is null, stamping it. Claim-then-send, so overlapping runs never double-send.
import { authorized } from '../../lib/cronAuth.js';
import { runReminders, liveReminderDeps } from '../../lib/bookings/notify.js';

export const config = { maxDuration: 300 };

export default async function handler(req: any, res: any) {
  if (!authorized(req)) return res.status(401).json({ error: 'Not authorized' });
  try {
    const summary = await runReminders(liveReminderDeps());
    return res.status(200).json({ ok: true, ...summary });
  } catch (e: any) {
    console.error('[book/reminders] failed:', e?.message || e);
    return res.status(500).json({ error: 'reminders-failed' });
  }
}
