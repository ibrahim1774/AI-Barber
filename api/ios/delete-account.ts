import type { VercelRequest, VercelResponse } from '@vercel/node';
import { deleteAccount, liveDeleteDeps, type DeleteAccountDeps } from '../../lib/ios/deleteAccount.js';
import { liveWebDeleteDeps } from '../../lib/webApp/deleteAccount.js';
import { resumeAfterFailedDelete } from '../../lib/webApp/reliability.js';
import { alertIfLegacyCustomer } from '../../lib/webApp/legacyDeleteAlert.js';
import { liveUserOf } from '../../lib/ios/publishFlow.js';
import { nativeSingleRoute } from '../../lib/account/siteMode.js';
import { appleSubscriptionActive } from '../../lib/account/nativeRoutes.js';

// POST with `Authorization: Bearer <supabase access token>`. No body is read:
// the token alone decides which account is deleted.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });

  try {
    const h = req.headers?.authorization;
    const auth = Array.isArray(h) ? h[0] : h;
    // The 1.2 app (ACCOUNT_PLAN_V2=1 and X-PB-Build): the single route, see lib/account/nativeRoutes.ts. Everything else is today's code below, byte for byte.
    if (nativeSingleRoute(req as any)) return await nativeDelete(auth, res);
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

// Switch on only: alert (best effort) before anything is closed or deleted. closeShop runs before every deletion step.
/**
 * ACCOUNT_PLAN_V2=1 + X-PB-Build. Never refused for the account's kind. The live card plan (any kind) is cancelled first whatever APP_DELETE_CANCELS_WEB says; a cancel that fails is
 * 500 delete-failed with retryable AND cardCancelFailed and nothing is deleted. 200 adds outcome { cardPlanCanceled, appleSubscriptionActive } (read BEFORE the delete: a failed read is 503).
 */
async function nativeDelete(auth: string | undefined, res: VercelResponse) {
  const token = typeof auth === 'string' ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  let apple = false;
  if (token) {
    try {
      const u = await liveUserOf(token);
      if (u?.id) apple = await appleSubscriptionActive(u.id);
    } catch (e: any) {
      console.error('[ios/delete-account] pre-read failed (nothing done):', e?.message || e);
      return res.status(503).json({ error: 'temporarily-unavailable' });
    }
  }
  const cancelled: string[] = [];
  let cardFailed = false;
  let deletingUser: string | null = null;
  const deps = withLegacyAlert(liveWebDeleteDeps({ allowNoStripe: true, onCancelled: (ids) => cancelled.push(...ids) }));
  const close = deps.closeShop!;
  deps.closeShop = async (uid) => { deletingUser = uid; try { return await close(uid); } catch (e: any) { if (e?.cardCancel) cardFailed = true; throw e; } };
  try {
    const r = await deleteAccount(auth, deps);
    if (r.status !== 200 && deletingUser) await resumeAfterFailedDelete(deletingUser).catch((e: any) => console.error('[ios/delete-account] resume failed:', e?.message || e));
    if (r.status === 200) return res.status(200).json({ ...r.body, outcome: { cardPlanCanceled: cancelled.length > 0, appleSubscriptionActive: apple } });
    return res.status(r.status).json(cardFailed && r.status === 500 ? { ...r.body, cardCancelFailed: true } : r.body);
  } catch (e: any) {
    if (deletingUser) await resumeAfterFailedDelete(deletingUser).catch(() => {});
    console.error('[ios/delete-account] handler error:', e?.message || e);
    return res.status(500).json({ error: 'delete-failed' });
  }
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
