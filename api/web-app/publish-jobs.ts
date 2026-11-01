import { authorizedStrict } from '../../lib/cronAuth.js';
import { reliabilityOn } from '../../lib/webApp/reliability.js';
import { webAppEntitlementsOn } from '../../lib/webApp/webAppServer.js';
import { sweepJobs } from '../../lib/webApp/publishJobs.js';
export const config = { maxDuration: 300 };
export default async function handler(req: any, res: any) {
  if (!reliabilityOn() || !webAppEntitlementsOn()) return res.status(200).json({ skipped: true });
  if (authorizedStrict(req) !== 'ok') return res.status(401).json({ error: 'unauthorized' });
  try { return res.status(200).json(await sweepJobs()); }
  catch { return res.status(503).json({ error: 'retry_unavailable' }); }
}
