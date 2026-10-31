import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clientIp, iosLimiter } from '../../lib/bookings/rateLimit.js';
import { liveDeps, runIosSiteLookup } from '../../lib/ios/publishFlow.js';

// POST { transactionId } + Authorization: Bearer <Supabase token> → the site bound to that purchase
// (only when the purchase is linked to the caller): { siteId, deployedUrl, siteData, active, ... }.
// 401 { error: 'auth-required' } when there is no Authorization header at all (old app builds; no site data, Apple not asked);
// 401 { error: 'unauthorized' } for a present but invalid/expired token; 409 { error: 'purchase-other-account', hint } when the purchase
// belongs to another account (no site data).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });

  // Per-IP limit before anything reaches Apple (e2e M9). Fails open, like every limiter here.
  let allowed = true;
  try {
    allowed = await iosLimiter.allow(clientIp(req.headers as any), 'read');
  } catch (e: any) {
    console.error('[ios/site] rate limiter failed, allowing:', e?.message || e);
  }
  if (!allowed) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'rate-limited' });
  }

  try {
    let body: any;
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
    const transactionId = body && typeof body.transactionId === 'string' ? body.transactionId.trim() : '';
    if (!transactionId) return res.status(400).json({ error: 'bad-request' });
    const r = await runIosSiteLookup(transactionId, liveDeps(), { authorization: req.headers?.authorization });
    return res.status(r.status).json(r.body);
  } catch (e: any) {
    console.error('[ios/site] handler error:', e?.message || e);
    return res.status(503).json({ error: 'temporarily-unavailable' });
  }
}

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
  );
}
