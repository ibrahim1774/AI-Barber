import { prepareIntent, reliabilityOn, modeOf, enc } from '../../lib/webApp/reliability.js';
import { runJob, dispatchJob } from '../../lib/webApp/publishJobs.js';
import { callerFrom, sbRest } from '../../lib/webApp/webAppServer.js';
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
    if (reliabilityOn()) {
      const caller = await callerFrom(req.headers?.authorization);
      if (!caller) return res.status(401).json({ error: 'unauthorized' });
      const ent = (await sbRest(`web_app_entitlements?user_id=eq.${enc(caller.id)}&environment=eq.${modeOf()}&status=in.(active,trialing,past_due)&select=stripe_subscription_id&order=created_at.desc&limit=1`))?.[0];
      if (!ent) return res.status(402).json({ error: 'subscription-inactive' });
      const input = body as any;
      const job = await prepareIntent(caller.id, input?.draftId, input?.revision, 'publish', input?.baseVersion ?? null, input?.siteData);
      await sbRest(`web_app_publish_intents?id=eq.${job.id}&status=in.(queued,failed,awaiting_payment)`, { method: 'PATCH', body: { stripe_subscription_id: ent.stripe_subscription_id, status: 'queued' } });
      await runJob(job.id);
      const finished = (await sbRest(`web_app_publish_intents?id=eq.${job.id}&select=status,result&limit=1`))?.[0];
      if (finished?.status === 'live') return res.status(200).json(finished.result.body);
      // A refusal the user can act on (400 logo-folder / render refusal, 403, 409) is passed through as it is.
      const refused = Number(finished?.result?.status);
      if (refused >= 400 && refused < 500) return res.status(refused).json(finished.result.body);
      dispatchJob(job.id);
      return res.status(503).json({ error: 'publish_retry_required', intentId: job.id });
    }
    const r = await runWebPublish((body ?? {}) as any, liveWebPublishDeps(), { authorization: req.headers?.authorization });
    return res.status(r.status).json(r.body);
  } catch (e: any) {
    console.error('[web-app/publish] handler error:', e?.message || e);
    return res.status(e?.status === 409 ? 409 : e?.status === 400 ? 400 : 503).json({ error: e?.status === 409 ? 'publish_in_progress_or_draft_changed' : e?.status === 400 ? 'invalid_draft' : 'temporarily-unavailable' });
  }
}
