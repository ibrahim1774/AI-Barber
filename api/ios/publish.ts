import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clientIp, iosLimiter } from '../../lib/bookings/rateLimit.js';
import { liveDeps, runIosPublish } from '../../lib/ios/publishFlow.js';

// A publish can deploy twice (the I2 redeploy of a newer copy); vercel.json also sets 300 s.
export const config = { maxDuration: 300 };

// POST { transactionId, siteData, baseVersion? } from the iOS app, with an optional
// Authorization: Bearer <Supabase access token>: a verified token links an unlinked purchase to
// that account (the body's userId is ignored; e2e I6).
// First call for a purchase picks + binds a slug and publishes; later calls
// redeploy the bound slug. Requires an active App Store subscription.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });

  // Per-IP limit before anything reaches Apple (e2e M9). Fails open, like every limiter here.
  let allowed = true;
  try {
    allowed = await iosLimiter.allow(clientIp(req.headers as any), 'write');
  } catch (e: any) {
    console.error('[ios/publish] rate limiter failed, allowing:', e?.message || e);
  }
  if (!allowed) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'rate-limited' });
  }

  try {
    let body: unknown;
    try {
      body = req.body; // @vercel/node parses lazily and throws on malformed JSON
    } catch {
      return res.status(400).json({ error: 'bad-request' });
    }
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ error: 'bad-request' });
      }
    }
    const r = await runIosPublish(body as any, liveDeps(), { authorization: req.headers?.authorization });
    return res.status(r.status).json(r.body);
  } catch (e: any) {
    console.error('[ios/publish] handler error:', e?.message || e);
    return res.status(503).json({ error: 'temporarily-unavailable' });
  }
}

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization',
  );
}
