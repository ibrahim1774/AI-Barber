import { resumeAfterFailedDelete } from '../../lib/webApp/reliability.js';
// POST + Authorization: Bearer <supabase jwt> -> deletes the caller's account, the web twin of /api/ios/delete-account
// (see lib/webApp/deleteAccount.ts). 404 unless WEB_APP_ENTITLEMENTS=1.
import { deleteAccount } from '../../lib/ios/deleteAccount.js';
import { liveWebDeleteDeps } from '../../lib/webApp/deleteAccount.js';
import { webAppCors, webAppEntitlementsOn } from '../../lib/webApp/webAppServer.js';

export const config = { maxDuration: 300 };

export default async function handler(req: any, res: any) {
  if (webAppCors(req, res)) return;
  if (!webAppEntitlementsOn()) return res.status(404).json({ error: 'not_found' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });
  let deletingUser: string | null = null;
  try {
    const deps = liveWebDeleteDeps();
    if (deps.closeShop) { const close = deps.closeShop; deps.closeShop = async uid => { deletingUser = uid; return close(uid); }; }
    const r = await deleteAccount(req.headers?.authorization, deps);
    if (r.status !== 200 && deletingUser) await resumeAfterFailedDelete(deletingUser);
    return res.status(r.status).json(r.body);
  } catch (e: any) {
    if (deletingUser) await resumeAfterFailedDelete(deletingUser).catch(() => {});
    console.error('[web-app/delete-account] handler error:', e?.message || e);
    return res.status(500).json({ error: 'delete-failed' });
  }
}
