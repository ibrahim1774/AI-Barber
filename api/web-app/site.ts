// POST + Authorization: Bearer <supabase jwt> -> the caller's web-app site (the web twin of /api/ios/site). 404 unless WEB_APP_ENTITLEMENTS=1.
import { liveWebPublishDeps, runWebSiteLookup } from '../../lib/webApp/publishFlow.js';
import { isEntitledStatus } from '../../lib/webApp/stripeCore.js';
import { sbRest, webAppCors, webAppEntitlementsOn } from '../../lib/webApp/webAppServer.js';

export default async function handler(req: any, res: any) {
  if (webAppCors(req, res)) return;
  if (!webAppEntitlementsOn()) return res.status(404).json({ error: 'not_found' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });
  try {
    const deps = liveWebPublishDeps();
    const r = await runWebSiteLookup({
      environment: deps.environment, userOf: deps.userOf, sites: deps.sites, readPending: deps.readPending,
      // Any entitled subscription of this mode counts (an older canceled one must not hide a newer active one); else the newest.
      subscriptionOf: async (uid) => {
        const rows: Array<{ status: string }> = (await sbRest(`web_app_entitlements?user_id=eq.${encodeURIComponent(uid)}&environment=eq.${deps.environment}&select=status&order=updated_at.desc`)) ?? [];
        return rows.find((r) => isEntitledStatus(r.status)) ?? rows[0] ?? null;
      },
    }, { authorization: req.headers?.authorization });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(r.status).json(r.body);
  } catch (e: any) {
    console.error('[web-app/site] handler error:', e?.message || e);
    return res.status(503).json({ error: 'temporarily-unavailable' });
  }
}
