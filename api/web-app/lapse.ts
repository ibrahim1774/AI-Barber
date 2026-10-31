// Cron (every 10 min): takes down web-app sites whose subscription ended, restores them when paid again.
// 200 { skipped: true } unless WEB_APP_ENTITLEMENTS=1. See lib/webApp/lapse.ts.
import { authorized } from '../../lib/cronAuth.js';
import { liveWebSweepDeps, sweepWebApp } from '../../lib/webApp/lapse.js';
import { webAppEntitlementsOn } from '../../lib/webApp/webAppServer.js';

export const config = { maxDuration: 300 };

export default async function handler(req: any, res: any) {
  if (!authorized(req)) return res.status(401).json({ error: 'Not authorized' });
  if (!webAppEntitlementsOn()) return res.status(200).json({ skipped: true });
  try {
    const summary = await sweepWebApp(await liveWebSweepDeps());
    return res.status(200).json({ ok: true, ...summary });
  } catch (err: any) {
    console.error('[Sweeper:web] threw:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'web-app sweep failed' });
  }
}
