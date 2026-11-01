import { dispatchJob } from '../../lib/webApp/publishJobs.js';
import { enc, modeOf, readDraft, reliabilityOn } from '../../lib/webApp/reliability.js';
import { callerFrom, sbRest, webAppCors, webAppEntitlementsOn } from '../../lib/webApp/webAppServer.js';

export const config = { maxDuration: 300 };

export default async function handler(req: any, res: any) {
  if (webAppCors(req, res)) return;
  if (!reliabilityOn() || !webAppEntitlementsOn()) return res.status(404).json({ error: 'not_found' });
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const user = await callerFrom(req.headers.authorization);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const draft = await readDraft(user.id);
    res.setHeader('Cache-Control', 'no-store');
    if (!draft?.latest_intent_id) return res.status(200).json({ intent: null });
    const job = (await sbRest(`web_app_publish_intents?id=eq.${enc(draft.latest_intent_id)}&user_id=eq.${enc(user.id)}&environment=eq.${modeOf()}&select=id,status,revision,result&limit=1`))?.[0];
    if (req.method === 'POST' && job && ['failed','queued'].includes(job.status) && !draft.suspended) dispatchJob(job.id);
    return res.status(200).json({ intent: job ?? null });
  } catch { return res.status(503).json({ error: 'status_unavailable' }); }
}
