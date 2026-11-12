// POST { group: 'base' | 'g10' | 'g20' | 'free' } + Bearer <supabase jwt> -> { ok, group } (the group STORED for the caller).
// Write-once: the first group a user gets stays (first visit wins). 'base' is stored as asked. A test group is stored only while
// WEB_APP_PRICE_TEST_OPEN=1 (+ WEB_APP_PRICE_TEST_START), when that group is fully configured, and for a NEW sign-up (created after
// the start time, no Stripe history, no completed Checkout); otherwise 'base' is returned (stored for existing users, not written when
// the test is closed or unconfigured). Groups already stored are always honoured.
// 'free' (primebarber.org/free-site) is stored only while WEB_APP_FREE_OPEN=1 (+ WEB_APP_FREE_START) for a NEW sign-up (same rules as a test group, no price
// configuration needed); anyone else is stored 'base'. A new free assignment is limited per IP (FREE_PER_IP_PER_HOUR).
// 400 bad_group | 401 | 404 (flag off) | 405 | 429 | 502 save_failed (also while migration 034 is not applied).
import { isPriceGroup } from '../../lib/webApp/stripeCore.js';
import { assignGroup, readStoredGroup } from '../../lib/webApp/priceGroup.js';
import { clientIp, memoryStore } from '../../lib/bookings/rateLimit.js';
import { callerFrom, webAppCheckoutOn, webAppCors } from '../../lib/webApp/webAppServer.js';

export const PRICE_GROUP_PER_MINUTE = 20;
const limiter = memoryStore();
/** Abuse control for the free portal: at most this many NEW free assignments' attempts per IP per hour (an already stored group is never limited). */
export const FREE_PER_IP_PER_HOUR = 10;
const freeLimiter = memoryStore();

export default async function handler(req: any, res: any) {
  if (webAppCors(req, res)) return;
  if (!webAppCheckoutOn()) return res.status(404).json({ error: 'not_found' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    const caller = await callerFrom(req.headers?.authorization);
    if (!caller) return res.status(401).json({ error: 'unauthorized' });
    // Per user, after auth, so anonymous traffic cannot fill the limiter with arbitrary keys.
    if (!(await limiter.hit(`price-group:${caller.id}`, PRICE_GROUP_PER_MINUTE, 60_000, Date.now()))) return res.status(429).json({ error: 'rate_limited' });
    const group = req.body?.group;
    if (!isPriceGroup(group)) return res.status(400).json({ error: 'bad_group' });
    if (group === 'free' && !(await readStoredGroup(caller.id))) {
      if (!(await freeLimiter.hit(`price-group-free:${clientIp(req.headers as any)}`, FREE_PER_IP_PER_HOUR, 3_600_000, Date.now()))) return res.status(429).json({ error: 'rate_limited' });
    }
    const stored = await assignGroup(caller.id, caller.email, group, 'client');
    return res.status(200).json({ ok: true, group: stored });
  } catch (e: any) {
    console.error('[web-app price-group]', e?.message || e);
    return res.status(502).json({ error: 'save_failed' });
  }
}
