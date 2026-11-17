// POST /api/account/kept-copy { kind: 'phone-draft' | 'account-copy-before-replace', siteData, slug?, sourceVersion? } + Bearer (native or browser).
// Stores a whole-site copy that was set aside (lane C3, migration 040). Same copy again = success, stored once. At most 50 per account (oldest out
// first). 413 above the draft size limit, 429 per-user rate limit, 503 while the table is missing. 404 unless WEB_APP_CHECKOUT and WEB_APP_RELIABILITY (as the draft endpoint).
import { modeOf, reliabilityOn } from '../../lib/webApp/reliability.js';
import { memoryStore } from '../../lib/bookings/rateLimit.js';
import { authOutage, callerFrom, webAppCheckoutOn, webAppCors } from '../../lib/webApp/webAppServer.js';
import { storeKeptCopy } from '../../lib/account/keptCopy.js';
import { siteModeOf } from '../../lib/account/siteMode.js';
import { kindEnvOf } from '../../lib/account/kind.js';

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
    // Only the rollout stores copies: the caller must be in account mode (403 otherwise, 503 when that cannot be decided).
    let mode;
    try { mode = await siteModeOf(user.id); } catch (e: any) { console.error('[kept copy] mode lookup failed:', e?.message || e); return res.status(503).json({ error: 'kept_copy_unavailable' }); }
    if (mode !== 'account') return res.status(403).json({ error: 'not-account-mode' });
    const r = await storeKeptCopy(user.id, kindEnvOf(modeOf()), req.body);
    return res.status(r.status).json(r.body);
  } catch (e: any) {
    if (authOutage(res, e)) return;
    console.error('[kept copy]', e?.message);
    return res.status(503).json({ error: 'kept_copy_unavailable' });
  }
}
