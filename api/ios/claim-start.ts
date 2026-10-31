import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clientIp, iosLimiter } from '../../lib/bookings/rateLimit.js';
import { liveDeps, liveUserOf } from '../../lib/ios/publishFlow.js';
import { runClaimStart } from '../../lib/ios/claimStart.js';

// POST { transactionId } (Authorization optional) -> 200 { ok, state, claimExpiresAt } | 402 | 409 | 404 | 503.
// See lib/ios/claimStart.ts and ownership-server-report.md.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });

  let allowed = true;
  try {
    allowed = await iosLimiter.allow(clientIp(req.headers as any), 'write');
  } catch (e: any) {
    console.error('[ios/claim-start] rate limiter failed, allowing:', e?.message || e);
  }
  if (!allowed) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'rate-limited' });
  }
  try {
    let body: unknown;
    try {
      body = req.body;
    } catch {
      return res.status(400).json({ error: 'bad-request' });
    }
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad-request' }); }
    }
    const d = liveDeps();
    const r = await runClaimStart(body, { verify: d.verify, repo: d.repo, userOf: liveUserOf, now: d.now }, { authorization: req.headers?.authorization });
    return res.status(r.status).json(r.body);
  } catch (e: any) {
    console.error('[ios/claim-start] handler error:', e?.message || e);
    return res.status(503).json({ error: 'temporarily-unavailable' });
  }
}
