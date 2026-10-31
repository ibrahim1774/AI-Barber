// POST { siteData, baseVersion? } + Authorization: Bearer <supabase jwt>. Publishes the caller's web-app site.
// Same response shapes as POST /api/ios/publish (see lib/webApp/publishFlow.ts). 404 unless WEB_APP_ENTITLEMENTS=1.
import { clientIp, iosLimiter } from '../../lib/bookings/rateLimit.js';
import { liveWebPublishDeps, runWebPublish } from '../../lib/webApp/publishFlow.js';
import { webAppEntitlementsOn } from '../../lib/webApp/webAppServer.js';

export const config = { maxDuration: 300 };

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type, Authorization');
  if (!webAppEntitlementsOn()) return res.status(404).json({ error: 'not_found' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });
  let allowed = true;
  try { allowed = await iosLimiter.allow(clientIp(req.headers as any), 'write'); }
  catch (e: any) { console.error('[web-app/publish] rate limiter failed, allowing:', e?.message || e); }
  if (!allowed) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'rate-limited' }); }
  try {
    let body: unknown;
    try { body = req.body; } catch { return res.status(400).json({ error: 'bad-request' }); }
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad-request' }); } }
    const r = await runWebPublish((body ?? {}) as any, liveWebPublishDeps(), { authorization: req.headers?.authorization });
    return res.status(r.status).json(r.body);
  } catch (e: any) {
    console.error('[web-app/publish] handler error:', e?.message || e);
    return res.status(503).json({ error: 'temporarily-unavailable' });
  }
}
