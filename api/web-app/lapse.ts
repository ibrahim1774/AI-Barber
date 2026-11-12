// Cron (every 10 min): takes down web-app sites whose subscription ended, restores them when paid again.
// 200 { skipped: true } unless WEB_APP_ENTITLEMENTS=1. See lib/webApp/lapse.ts.
// (Sign-up reminders and the sign-up sheet log run in their own cron, /api/web-app/nudges.)
import { authorizedStrict } from '../../lib/cronAuth.js';
import { liveIosOverlapDeps, liveWebSweepDeps, sweepIosOverlap, sweepWebApp } from '../../lib/webApp/lapse.js';
import { sweepDunning } from '../../lib/webApp/dunning.js';
import { sweepDuplicates } from '../../lib/webApp/duplicates.js';
import { keyMode } from '../../lib/webApp/stripeCore.js';
import { webAppCheckoutOn, webAppEntitlementsOn } from '../../lib/webApp/webAppServer.js';

export const config = { maxDuration: 300 };

export default async function handler(req: any, res: any) {
  // Flag first: with WEB_APP_ENTITLEMENTS off this answers exactly as before, secret or not.
  if (!webAppEntitlementsOn()) return res.status(200).json({ skipped: true });
  // Web-app cron: the Bearer secret is required (no user-agent fallback). Fails closed when it is not configured.
  const auth = authorizedStrict(req);
  if (auth === 'no-secret') {
    console.error('[web-app lapse] CRON_SECRET not set; refusing');
    return res.status(503).json({ error: 'cron-secret-missing' });
  }
  if (auth === 'denied') return res.status(401).json({ error: 'Not authorized' });
  try {
    const summary = await sweepWebApp(await liveWebSweepDeps());
    const dunning = await sweepDunning().catch((e: any) => { console.error('[web-app dunning]', e?.message || e); return null; });
    // Backstops, best effort and independent of each other (an error in one never fails the sweep).
    const mode = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
    const duplicates = mode && webAppCheckoutOn() ? await sweepDuplicates(mode).catch((e: any) => { console.error('[web-app dup sweep]', e?.message || e); return null; }) : null;
    const iosOverlap = mode ? await sweepIosOverlap(liveIosOverlapDeps(mode)).catch((e: any) => { console.error('[web-app ios-overlap]', e?.message || e); return null; }) : null;
    // Domain backstop: a plan-end that failed earlier (Stripe outage) is retried. Best effort, idempotent.
    const domainRenewal = mode ? await import('../../lib/webApp/domainPlanEnd.js').then(async (m) => m.sweepDomainRenewal(await m.livePlanEndDeps(mode))).catch((e: any) => { console.error('[web-app domain renewal backstop]', e?.message || e); return null; }) : null;
    return res.status(200).json({ ok: true, ...summary, dunning, duplicates, iosOverlap, domainRenewal });
  } catch (err: any) {
    console.error('[Sweeper:web] threw:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'web-app sweep failed' });
  }
}
