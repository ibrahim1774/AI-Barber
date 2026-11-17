// POST /api/account/kept-copy { kind: 'phone-draft' | 'account-copy-before-replace', siteData, slug?, sourceVersion? } + Bearer (native or browser).
// Stores a whole-site copy that was set aside (lane C3, migration 040). Same copy again = success, stored once. At most 50 per account (oldest out
// first). 413 above the draft size limit, 429 per-user rate limit, 503 while the table is missing. 404 unless WEB_APP_CHECKOUT and WEB_APP_RELIABILITY (as the draft endpoint).
import { modeOf, reliabilityOn } from '../../lib/webApp/reliability.js';
import { memoryStore } from '../../lib/bookings/rateLimit.js';
import { callerFrom, webAppCheckoutOn, webAppCors } from '../../lib/webApp/webAppServer.js';
import { storeKeptCopy } from '../../lib/account/keptCopy.js';

export const KEPT_WRITES_PER_MINUTE = 30;
const store = memoryStore();

export default async function handler(req: any, res: any) {
  if (webAppCors(req, res)) return;
  if (!webAppCheckoutOn() || !reliabilityOn()) return res.status(404).json({ error: 'not_found' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const user = await callerFrom(req.headers.authorization);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    res.setHeader('Cache-Control', 'no-store');
    if (!(await store.hit(`kept-copy:${user.id}`, KEPT_WRITES_PER_MINUTE, 60_000, Date.now()))) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ error: 'rate_limited' });
    }
    const r = await storeKeptCopy(user.id, modeOf(), req.body);
    return res.status(r.status).json(r.body);
  } catch (e: any) {
    console.error('[kept copy]', e?.message);
    return res.status(503).json({ error: 'kept_copy_unavailable' });
  }
}
