import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clientIp, iosLimiter } from '../../lib/bookings/rateLimit.js';
import { lazyDefaultVerifier } from '../../lib/ios/appleVerify.js';
import { supabasePurchases } from '../../lib/ios/purchases.js';
import { liveRemoveDeps } from '../../lib/ios/removeSiteLive.js';
import { liveUserOf } from '../../lib/ios/publishFlow.js';
import { takeSiteOffline } from '../../lib/ios/takeOffline.js';

// POST { transactionId } (+ optional Authorization: Bearer <token>, required only when the
// purchase is linked to an account). Removes the site bound to that App Store purchase: no
// account needed, ownership proven by Apple's verification of the transaction (lib/ios/takeOffline.ts).
export const config = { maxDuration: 300 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });

  // Destructive route: when the limiter store is down the request is refused (fail closed), because
  // every allowed call also triggers a Vercel deploy.
  let allowed = false;
  try {
    allowed = await iosLimiter.allow(clientIp(req.headers as any), 'write');
  } catch (e: any) {
    console.error('[ios/take-offline] rate limiter failed, refusing:', e?.message || e);
    return res.status(503).json({ error: 'temporarily-unavailable' });
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
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ error: 'bad-request' });
      }
    }
    const r = await takeSiteOffline(
      body,
      { ...liveRemoveDeps(), verify: lazyDefaultVerifier(), repo: supabasePurchases(), userOf: liveUserOf },
      { authorization: req.headers?.authorization },
    );
    return res.status(r.status).json(r.body);
  } catch (e: any) {
    console.error('[ios/take-offline] handler error:', e?.message || e);
    return res.status(503).json({ error: 'temporarily-unavailable' });
  }
}

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization',
  );
}
