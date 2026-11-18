import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clientIp, iosLimiter } from '../../lib/bookings/rateLimit.js';
import { lazyDefaultVerifier } from '../../lib/ios/appleVerify.js';
import { supabasePurchases } from '../../lib/ios/purchases.js';
import { liveRemoveDeps } from '../../lib/ios/removeSiteLive.js';
import { liveUserOf } from '../../lib/ios/publishFlow.js';
import { liveDeleteAccountRows } from '../../lib/ios/removeSiteLive.js';
import { resolveSiteToRemove, takeSiteOffline } from '../../lib/ios/takeOffline.js';
import { nativeBuild, nativeSingleRoute, oldRouteKind } from '../../lib/account/siteMode.js';
import { applePurgesContent, domainFacts, expectOf, hasTransaction, memoVerify, otherSiteLive, takeOfflineSite, webSlugsOf } from '../../lib/account/nativeRoutes.js';
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
    // The 1.2 app (ACCOUNT_PLAN_V2=1 and X-PB-Build): the single route (lib/account/nativeRoutes.ts). Everything else is today's code below, byte for byte.
    if (nativeSingleRoute(req as any)) return await nativeTakeOffline(req, res, body);
    // Header-only safety for a phone that holds a stale mode (ACCOUNT_PLAN_V2 off): the 1.2 app (X-PB-Build) that says expect:'keep' ("nothing is deleted") is never purged. When this call
    // would purge, it is 409 confirm-purge with nothing done, even here. The Apple site's own checks (400/404/403) still come first. 'purge' or no expect: exactly as before.
    if (nativeBuild(req as any) && (body as { expect?: unknown } | null)?.expect === 'keep' && applePurgesContent()) {
      const p = await resolveSiteToRemove(body, { verify: memoVerify(lazyDefaultVerifier()), repo: supabasePurchases(), userOf: liveUserOf }, { authorization: req.headers?.authorization });
      return p.result ? res.status(p.result.status).json(p.result.body) : res.status(409).json({ error: 'confirm-purge' });
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

/**
 * Body { transactionId?, expect?: 'keep' | 'purge' }. kind web (or mixed with no transaction): the web site goes offline, content and phone kept, live address forgotten, whatever the
 * draft engine switch says; any transaction is ignored. apple / neither / mixed with a transaction: today's Apple flow (content purged unless SAFE_TAKE_OFFLINE=1). expect 'keep' when
 * that would purge: 409 confirm-purge, nothing done. 200 adds outcome { site, contentKept, otherSiteLive, domainDetached, domainReattachesOnPublish }. 404 no-site, 409 publish-in-progress, 503 on a failed read (nothing done).
 */
async function nativeTakeOffline(req: VercelRequest, res: VercelResponse, body: unknown) {
  const exp = expectOf(body);
  if (!exp.ok) return res.status(400).json({ error: 'bad-request' });
  const h = req.headers?.authorization;
  const raw = Array.isArray(h) ? h[0] : h;
  const token = typeof raw === 'string' ? raw.replace(/^Bearer\s+/i, '').trim() : '';
  const rdeps = { ...liveRemoveDeps(), verify: memoVerify(lazyDefaultVerifier()), repo: supabasePurchases(), userOf: liveUserOf, deleteAccountRows: liveDeleteAccountRows };
  const ctx = { authorization: req.headers?.authorization };
  const unavailable = () => res.status(503).json({ error: 'temporarily-unavailable' });
  let uid: string | null = null;
  let site: 'web' | 'apple' = 'apple';
  let other = false;
  if (token) {
    try {
      const u = await liveUserOf(token);
      if (u?.id) {
        uid = u.id;
        site = takeOfflineSite(await oldRouteKind(u.id), hasTransaction(body));
        // A web account that names a transaction: when it verifies and is bound to a site this caller may remove (its own, or a signed-out one), that Apple site is the target.
        // A transaction that does not verify, has no site or belongs to someone else is ignored (the web site is taken offline). Apple being unreachable: nothing is done.
        if (site === 'web' && hasTransaction(body)) {
          const p = await resolveSiteToRemove(body, rdeps, ctx);
          if (!p.result) site = 'apple';
          else if (p.result.status === 503) return res.status(503).json(p.result.body);
        }
      }
    } catch (e: any) {
      console.error('[ios/take-offline] kind lookup failed (nothing done):', e?.message || e);
      return unavailable();
    }
  }
  // The Apple site's own preconditions (a transaction, a site bound to it, ownership) come BEFORE any question about purging: nobody is asked to confirm what would then be refused.
  let appleSlug = '';
  if (site === 'apple') {
    try {
      const p = await resolveSiteToRemove(body, rdeps, ctx);
      if (p.result) return res.status(p.result.status).json(p.result.body);
      appleSlug = p.row!.site_slug;
    } catch (e: any) { console.error('[ios/take-offline] precondition check failed (nothing done):', e?.message || e); return unavailable(); }
  }
  // Content: the web take offline always keeps it; the Apple one purges unless SAFE_TAKE_OFFLINE=1.
  const purges = site === 'apple' && applePurgesContent();
  if (exp.value === 'keep' && purges) return res.status(409).json({ error: 'confirm-purge' });
  if (uid) {
    try { other = await otherSiteLive(uid, site); }
    catch (e: any) { console.error('[ios/take-offline] other-site lookup failed (nothing done):', e?.message || e); return unavailable(); }
  }
  let domain = { domainDetached: false, domainReattachesOnPublish: false };
  try { domain = await domainFacts(site === 'web' ? await webSlugsOf(uid!) : [appleSlug], site); }
  catch (e: any) { console.error('[ios/take-offline] domain lookup failed (nothing done):', e?.message || e); return unavailable(); }
  if (site === 'web') {
    try {
      const n = await removeWebSitesOf(uid!, { keepContent: true });
      return n ? res.status(200).json({ ok: true, outcome: { site: 'web', contentKept: true, otherSiteLive: other, ...domain } }) : res.status(404).json({ error: 'no-site' });
    } catch (e: any) {
      if (e?.message === 'publish-in-progress') return res.status(409).json({ error: 'publish-in-progress' });
      console.error('[ios/take-offline] web site take offline failed:', e?.message || e);
      return res.status(500).json({ error: 'remove-failed' });
    }
  }
  const r = await takeSiteOffline(body, rdeps, ctx);
  return res.status(r.status).json(r.status === 200 ? { ...r.body, outcome: { site: 'apple', contentKept: !purges, otherSiteLive: other, ...domain } } : r.body);
}

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization',
  );
}
