// POST { phone } + Bearer <supabase jwt> -> saves the caller's mobile number (required after payment).
// 200 { ok, phone } | 400 invalid_phone | 401 | 429 | 500 save_failed. Never says whether a number is used elsewhere.
import { keyMode } from '../../lib/webApp/stripeCore.js';
import { callerFrom, webAppCheckoutOn, webAppCors } from '../../lib/webApp/webAppServer.js';
import { saveContactPhone } from '../../lib/webApp/contactPhone.js';
import { liveContactPhoneDeps } from '../../lib/webApp/contactPhoneLive.js';
import { supabaseRateStore, withFallback } from '../../lib/bookings/rateLimit.js';
import { serviceClient } from '../../lib/bookings/repo.js';

const WRITE_LIMIT = 10;
const WINDOW_MS = 60_000;
const writes = withFallback(supabaseRateStore(() => serviceClient()));

function parseBody(req: any): unknown {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return null; } }
  return body;
}

export default async function handler(req: any, res: any) {
  if (webAppCors(req, res)) return;
  if (!webAppCheckoutOn()) return res.status(404).json({ error: 'not_found' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const mode = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
  if (!mode) return res.status(500).json({ error: 'misconfigured' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    const deps = liveContactPhoneDeps(mode);
    // Rate limit per user, after auth so anonymous traffic cannot fill the limiter with arbitrary keys.
    const caller = await callerFrom(req.headers?.authorization);
    if (!caller) return res.status(401).json({ error: 'unauthorized' });
    const allowed = await writes.hit(`web-contact-phone:${caller.id}`, WRITE_LIMIT, WINDOW_MS, Date.now());
    if (!allowed) return res.status(429).json({ error: 'rate_limited' });
    const out = await saveContactPhone(req.headers?.authorization, parseBody(req), { ...deps, callerFrom: async () => caller }, req.method);
    return res.status(out.status).json(out.body);
  } catch (e: any) {
    console.error('[web-app contact-phone]', e?.status ?? 'err');
    return res.status(500).json({ error: 'save_failed' });
  }
}
