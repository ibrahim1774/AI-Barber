import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clientIp, iosLimiter } from '../../lib/bookings/rateLimit.js';
import { lazyDefaultVerifier } from '../../lib/ios/appleVerify.js';
import { supabasePurchases } from '../../lib/ios/purchases.js';
import { liveRemoveDeps } from '../../lib/ios/removeSiteLive.js';
import { liveUserOf } from '../../lib/ios/publishFlow.js';
import { liveDeleteAccountRows } from '../../lib/ios/removeSiteLive.js';
import { takeSiteOffline } from '../../lib/ios/takeOffline.js';
import { iosDestructiveRoute } from '../../lib/account/siteMode.js';
import { removeWebSitesOf } from '../../lib/webApp/deleteAccount.js';

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
    // ACCOUNT_PLAN_V2 only: a web or mixed account takes its site offline through the account route (409 use-account-take-offline here). Off: nothing is read.
    const route = await iosDestructiveRoute(req as any, liveUserOf, 'take-offline');
    if (route.action === 'respond') return res.status(route.status).json(route.body);
    if (route.action === 'webTakeOffline') {
      // Switch-order window: the account route does not exist yet, so a web account takes its site offline here (keep content, same as /api/web-app/take-offline).
      try {
        const n = await removeWebSitesOf(route.userId, { keepContent: true });
        return n ? res.status(200).json({ ok: true }) : res.status(404).json({ error: 'no-site' });
      } catch (e: any) {
        if (e?.message === 'publish-in-progress') return res.status(409).json({ error: 'publish-in-progress' });
        console.error('[ios/take-offline] web site take offline failed:', e?.message || e);
        return res.status(500).json({ error: 'remove-failed' });
      }
    }
    const r = await takeSiteOffline(
      body,
      { ...liveRemoveDeps(), verify: lazyDefaultVerifier(), repo: supabasePurchases(), userOf: liveUserOf, deleteAccountRows: liveDeleteAccountRows },
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
