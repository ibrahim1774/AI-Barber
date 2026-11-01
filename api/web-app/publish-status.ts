import { dispatchJob } from '../../lib/webApp/publishJobs.js';
import { enc, modeOf, readDraft, reliabilityOn } from '../../lib/webApp/reliability.js';
import { memoryStore } from '../../lib/bookings/rateLimit.js';
import { callerFrom, sbRest, webAppCors, webAppEntitlementsOn } from '../../lib/webApp/webAppServer.js';

export const config = { maxDuration: 300 };
/** POST re-dispatches a failed job: at most this many per user per minute (per instance), and never before its backoff has passed. */
export const RETRY_POSTS_PER_MINUTE = 6;
const retryStore = memoryStore();

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
    const job = (await sbRest(`web_app_publish_intents?id=eq.${enc(draft.latest_intent_id)}&user_id=eq.${enc(user.id)}&environment=eq.${modeOf()}&select=id,status,revision,result,next_attempt_at&limit=1`))?.[0];
    if (req.method === 'POST' && job && ['failed','queued'].includes(job.status) && !draft.suspended) {
      if (!(await retryStore.hit(`publish-status:${user.id}`, RETRY_POSTS_PER_MINUTE, 60_000, Date.now()))) {
        res.setHeader('Retry-After', '60');
        return res.status(429).json({ error: 'rate_limited' });
      }
      // The backoff set after the last attempt is respected; the cron or a later poll retries when it is due.
      if (Date.parse(job.next_attempt_at ?? '') <= Date.now()) dispatchJob(job.id);
    }
    const { next_attempt_at: _due, ...visible } = job ?? ({} as any);
    return res.status(200).json({ intent: job ? visible : null });
  } catch { return res.status(503).json({ error: 'status_unavailable' }); }
}
