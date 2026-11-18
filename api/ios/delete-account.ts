import type { VercelRequest, VercelResponse } from '@vercel/node';
import { deleteAccount, liveDeleteDeps, type DeleteAccountDeps } from '../../lib/ios/deleteAccount.js';
import { hasCheckoutSessions, hasStripeHistory, liveWebDeleteDeps } from '../../lib/webApp/deleteAccount.js';
import { resumeAfterFailedDelete } from '../../lib/webApp/reliability.js';
import { alertIfLegacyCustomer } from '../../lib/webApp/legacyDeleteAlert.js';
import { liveUserOf } from '../../lib/ios/publishFlow.js';
import { nativeSingleRoute, oldRouteKind } from '../../lib/account/siteMode.js';
import { appleSubscriptionActive, hasTransaction } from '../../lib/account/nativeRoutes.js';
import { lazyDefaultVerifier } from '../../lib/ios/appleVerify.js';
import { supabasePurchases } from '../../lib/ios/purchases.js';
import { resolveSiteToRemove } from '../../lib/ios/takeOffline.js';
import type { RemovableSite } from '../../lib/ios/removeSite.js';

// POST with `Authorization: Bearer <supabase access token>`. No body is read:
// the token alone decides which account is deleted.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });

  try {
    const h = req.headers?.authorization;
    const auth = Array.isArray(h) ? h[0] : h;
    // The 1.2 app (ACCOUNT_PLAN_V2=1 and X-PB-Build): the single route, see lib/account/nativeRoutes.ts. Everything else is today's code below, byte for byte (no body is read).
    if (nativeSingleRoute(req as any)) return await nativeDelete(auth, parsedBody(req), res);
    if (process.env.APP_DELETE_CANCELS_WEB !== '1') {
      const r = await deleteAccount(auth, liveDeleteDeps());
      return res.status(r.status).json(r.body);
    }
    // Switch on: like the web handler, a delete that fails after the draft was suspended resumes it.
    let deletingUser: string | null = null;
    try {
      const deps = withLegacyAlert(liveWebDeleteDeps({ allowNoStripe: true }));
      const close = deps.closeShop!;
      deps.closeShop = async (uid) => { deletingUser = uid; return close(uid); };
      const r = await deleteAccount(auth, deps);
      if (r.status !== 200 && deletingUser) await resumeAfterFailedDelete(deletingUser).catch((e: any) => console.error('[ios/delete-account] resume failed:', e?.message || e));
      return res.status(r.status).json(r.body);
    } catch (e: any) {
      if (deletingUser) await resumeAfterFailedDelete(deletingUser).catch(() => {});
      throw e;
    }
  } catch (e: any) {
    console.error('[ios/delete-account] handler error:', e?.message || e);
    return res.status(500).json({ error: 'delete-failed' });
  }
}

/**
 * ACCOUNT_PLAN_V2=1 + X-PB-Build. Never refused for the account's kind. Order, and what a failure leaves behind:
 *   1. reads (503, nothing done): the account's Apple purchases, its kind and Stripe history, and the optional body `transactionId`.
 *   2. Stripe is asked what to cancel (read only) unless the account has no Stripe history and is Apple-only or empty. A refusal here: 500 delete-failed, nothing done.
 *   3. the draft is suspended (a publish in flight: 409 publish-in-progress, nothing done).
 *   4. the shop is closed: upcoming bookings cancelled and customers emailed, refunds started. A failure after this point can leave that done.
 *   5. the card plan (and the domain subscription) is cancelled. A failed Stripe call: 500 delete-failed with retryable and cardCancelFailed; the account is still there, bookings may already be cancelled.
 *   6. every site goes down (web sites, Apple sites of the account's purchases, and the site bound to the body `transactionId` when it verifies and has no account), then is purged, then the account is deleted.
 *      A failure here: 500 delete-failed; the card plan is already cancelled and some sites may be offline; a retry finishes the job.
 * 200 adds outcome { cardPlanCanceled (a Stripe subscription was cancelled: the site plan or the domain subscription), appleSubscriptionActive (a linked Apple purchase that may still bill) }.
 */
async function nativeDelete(auth: string | undefined, body: unknown, res: VercelResponse) {
  const token = typeof auth === 'string' ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  let apple = false;
  let skipStripe = false;
  let extra: RemovableSite | null = null;
  if (token) {
    try {
      const u = await liveUserOf(token);
      if (u?.id) {
        let verified = false;
        if (hasTransaction(body)) {
          // A purchase published signed-out (no account on it) is not in the account's list: when Apple confirms it, its site goes down and is purged with the account.
          const p = await resolveSiteToRemove(body, { verify: lazyDefaultVerifier(), repo: supabasePurchases(), userOf: liveUserOf }, { authorization: auth });
          if (!p.result) { verified = true; if (!p.row!.user_id) extra = { original_transaction_id: p.row!.original_transaction_id, site_slug: p.row!.site_slug, environment: p.row!.environment, published_at: p.row!.published_at ?? null } as RemovableSite; }
          else if (p.result.status === 503) return res.status(503).json({ error: 'temporarily-unavailable' });
        }
        apple = await appleSubscriptionActive(u.id, { transactionVerified: verified });
        const kind = await oldRouteKind(u.id);
        // Nothing to cancel: an Apple-only or empty account with no Stripe history AND no Checkout session at Stripe (a payer whose webhook has not landed has no local row yet).
        // Stripe being unreachable here is not "nothing": the normal path decides (it fails closed unless its fallback rules allow it).
        skipStripe = (kind === 'apple' || kind === 'neither') && !(await hasStripeHistory(u.id)) && (await hasCheckoutSessions(u.id)) === false;
      }
    } catch (e: any) {
      console.error('[ios/delete-account] pre-read failed (nothing done):', e?.message || e);
      return res.status(503).json({ error: 'temporarily-unavailable' });
    }
  }
  const cancelled: string[] = [];
  let cardFailed = false;
  let publishing = false;
  let deletingUser: string | null = null;
  const deps = withLegacyAlert(liveWebDeleteDeps({ allowNoStripe: true, skipStripe, onCancelled: (ids) => cancelled.push(...ids) }));
  const close = deps.closeShop!;
  deps.closeShop = async (uid) => {
    deletingUser = uid;
    try { return await close(uid); } catch (e: any) { if (e?.cardCancel) cardFailed = true; if (e?.message === 'publish-in-progress') publishing = true; throw e; }
  };
  if (extra) { const list = deps.listSites; const more = extra; deps.listSites = async (uid) => { const sites = await list(uid); return sites.some((s) => s.original_transaction_id === more.original_transaction_id) ? sites : [...sites, more]; }; }
  try {
    const r = await deleteAccount(auth, deps);
    if (r.status !== 200 && deletingUser) await resumeAfterFailedDelete(deletingUser).catch((e: any) => console.error('[ios/delete-account] resume failed:', e?.message || e));
    if (r.status === 200) return res.status(200).json({ ...r.body, outcome: { cardPlanCanceled: cancelled.length > 0, appleSubscriptionActive: apple } });
    if (publishing) return res.status(409).json({ error: 'publish-in-progress' });
    // A later step failed AFTER the card plan was cancelled: say so, so the app can tell the owner the card plan is already cancelled and to try again.
    return res.status(r.status).json(cardFailed && r.status === 500 ? { ...r.body, cardCancelFailed: true } : r.status === 500 && cancelled.length > 0 ? { ...r.body, cardPlanCanceled: true } : r.body);
  } catch (e: any) {
    if (deletingUser) await resumeAfterFailedDelete(deletingUser).catch(() => {});
    console.error('[ios/delete-account] handler error:', e?.message || e);
    return res.status(500).json({ error: 'delete-failed', ...(cancelled.length > 0 ? { cardPlanCanceled: true } : {}) });
  }
}

/** The native route's optional JSON body ({ transactionId? }); anything unreadable is no body. */
function parsedBody(req: VercelRequest): unknown {
  try { const b = req.body; return typeof b === 'string' ? JSON.parse(b) : b; } catch { return undefined; }
}

function withLegacyAlert(deps: DeleteAccountDeps): DeleteAccountDeps {
  const base = deps.closeShop;
  return { ...deps, closeShop: async (userId) => { await alertIfLegacyCustomer(userId); return base ? base.call(deps, userId) : { ok: true, bookingsCancelled: 0, ordersCancelled: 0, needsRefund: [], notCancelled: [] }; } };
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
