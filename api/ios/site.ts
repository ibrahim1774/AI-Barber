import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clientIp, iosLimiter } from '../../lib/bookings/rateLimit.js';
import { liveDeps, runIosSiteLookup } from '../../lib/ios/publishFlow.js';

// POST { transactionId } from the iOS app → the site bound to that purchase:
// { siteId, deployedUrl, siteData (real image URLs), active }.
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
    const r = await runIosSiteLookup(transactionId, liveDeps());
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
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
  );
}
