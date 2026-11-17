import type { VercelRequest, VercelResponse } from '@vercel/node';
import { deleteAccount, liveDeleteDeps, type DeleteAccountDeps } from '../../lib/ios/deleteAccount.js';
import { liveWebDeleteDeps } from '../../lib/webApp/deleteAccount.js';
import { resumeAfterFailedDelete } from '../../lib/webApp/reliability.js';
import { alertIfLegacyCustomer } from '../../lib/webApp/legacyDeleteAlert.js';
import { liveUserOf } from '../../lib/ios/publishFlow.js';
import { iosDestructiveRoute } from '../../lib/account/siteMode.js';

// POST with `Authorization: Bearer <supabase access token>`. No body is read:
// the token alone decides which account is deleted.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });

  try {
    const h = req.headers?.authorization;
    const auth = Array.isArray(h) ? h[0] : h;
    // ACCOUNT_PLAN_V2 + X-PB-Build only: a web account is sent to the account delete route (409 use-account-delete) while that route exists, and the iOS delete cancels the
    // card plan itself (the same branch as APP_DELETE_CANCELS_WEB) when it does not, or for a two-site account. Everyone else: today's behaviour.
    const route = await iosDestructiveRoute(req as any, liveUserOf, 'delete');
    if (route.action === 'respond') return res.status(route.status).json(route.body);
    if (process.env.APP_DELETE_CANCELS_WEB !== '1' && route.action !== 'forceCancel') {
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
