// Cron (every 10 min): enrolls every new sign-up, sends the unpaid sign-up reminders, and posts each new sign-up once to the
// Google Sheet (Make webhook). Its own function and 300 s budget: it used to run at the end of /api/web-app/lapse, after four
// other sweeps, and was skipped whenever they left under 20 s of the budget (no enrollment since 2026-11-08).
// Gates: WEB_APP_ENTITLEMENTS=1 (like lapse), WEB_APP_NUDGES=1 + WEB_APP_NUDGES_SINCE (mails), MAKE_SIGNUP_WEBHOOK_URL +
// MAKE_SIGNUP_SINCE (sheet). Answers 200 with the summaries so a skipped step is visible (skippedReason). See lib/webApp/signupNudges.ts.
import { authorizedStrict } from '../../lib/cronAuth.js';
import { enrollSignups, liveSignupNudgeDeps, sweepSignupNudges } from '../../lib/webApp/signupNudges.js';
import { liveSignupSheetDeps, sweepSignupSheet } from '../../lib/webApp/signupSheet.js';
import { keyMode } from '../../lib/webApp/stripeCore.js';
import { webAppEntitlementsOn } from '../../lib/webApp/webAppServer.js';

export const config = { maxDuration: 300 };
export const NUDGE_DEADLINE_MS = 170_000;
export const SHEET_DEADLINE_MS = 80_000;

export default async function handler(req: any, res: any) {
  if (!webAppEntitlementsOn()) return res.status(200).json({ skipped: true });
  const auth = authorizedStrict(req);
  if (auth === 'no-secret') {
    console.error('[web-app nudges] CRON_SECRET not set; refusing');
    return res.status(503).json({ error: 'cron-secret-missing' });
  }
  if (auth === 'denied') return res.status(401).json({ error: 'Not authorized' });
  const mode = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
  if (!mode) return res.status(200).json({ skipped: true, skippedReason: 'no_mode' });

  const t0 = Date.now();
  let nudges: unknown = null;
  let sheet: unknown = null;
  let enrolled: unknown = null;
  const nudgesOn = process.env.WEB_APP_NUDGES === '1';
  try {
    if (nudgesOn) {
      nudges = await sweepSignupNudges(liveSignupNudgeDeps(mode), { mode, deadlineMs: NUDGE_DEADLINE_MS });
    }
  } catch (e: any) { console.error('[web-app nudges] sweep threw', e?.message || e); nudges = { error: true }; }
  try {
    if (process.env.MAKE_SIGNUP_WEBHOOK_URL) {
      // With the mails off (or their sweep skipped / failed before enrolling), the sheet still needs a row per sign-up: enroll them stopped (as before_launch), never mailable.
      if (!nudgesOn || (nudges as any)?.skippedReason || (nudges as any)?.error) enrolled = await enrollSignups(liveSignupNudgeDeps(mode), { since: Number.POSITIVE_INFINITY, deadline: SHEET_DEADLINE_MS });
      sheet = await sweepSignupSheet(liveSignupSheetDeps(mode), { deadlineMs: Math.max(20_000, SHEET_DEADLINE_MS - (Date.now() - t0)) });
    }
  } catch (e: any) { console.error('[web-app sheet] sweep threw', e?.message || e); sheet = { error: true }; }
  const summary = { ok: true, nudges, sheet, ...(enrolled ? { enrolled } : {}), ms: Date.now() - t0 };
  console.log('[web-app nudges] run', JSON.stringify(summary));
  return res.status(200).json(summary);
}
