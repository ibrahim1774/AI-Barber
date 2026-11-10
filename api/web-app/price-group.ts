// POST { group: 'base' | 'g10' | 'g20' } + Bearer <supabase jwt> -> { ok, group } (the group STORED for the caller).
// Write-once: the first group a user gets stays (first visit wins). A user who already has any web-app subscription or Stripe
// customer row (any environment) is stored as 'base': only new sign-ups get test prices.
// 400 bad_group | 401 | 404 (flag off) | 405 | 429 | 502 save_failed (also while migration 034 is not applied).
import { isPriceGroup } from '../../lib/webApp/stripeCore.js';
import { assignGroup } from '../../lib/webApp/priceGroup.js';
import { memoryStore } from '../../lib/bookings/rateLimit.js';
import { callerFrom, webAppCheckoutOn, webAppCors } from '../../lib/webApp/webAppServer.js';

export const PRICE_GROUP_PER_MINUTE = 20;
const limiter = memoryStore();

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
    const stored = await assignGroup(caller.id, group, 'client');
    return res.status(200).json({ ok: true, group: stored });
  } catch (e: any) {
    console.error('[web-app price-group]', e?.message || e);
    return res.status(502).json({ error: 'save_failed' });
  }
}
