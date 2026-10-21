// Cron (hourly): push "N bookings today" to owners who opted in (ab_shops.daily_summary)
// when it is 8 AM in the shop's time zone. Deduped per shop per local date via ab_events.
import { authorized } from '../../lib/cronAuth.js';
import { runDailySummary, liveDailySummaryDeps } from '../../lib/bookings/notify.js';

export const config = { maxDuration: 300 };

export default async function handler(req: any, res: any) {
  if (!authorized(req)) return res.status(401).json({ error: 'Not authorized' });
  try {
    const summary = await runDailySummary(liveDailySummaryDeps());
    return res.status(200).json({ ok: true, ...summary });
  } catch (e: any) {
    console.error('[book/daily-summary] failed:', e?.message || e);
    return res.status(500).json({ error: 'daily-summary-failed' });
  }
}
