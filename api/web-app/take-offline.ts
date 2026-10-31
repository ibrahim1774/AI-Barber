// POST + Authorization: Bearer <supabase jwt> -> takes the caller's web-app site offline for good (the account and the
// subscription stay). The web twin of /api/ios/take-offline. 404 unless WEB_APP_ENTITLEMENTS=1.
import { removeWebSitesOf } from '../../lib/webApp/deleteAccount.js';
import { callerFrom, webAppCors, webAppEntitlementsOn } from '../../lib/webApp/webAppServer.js';

export const config = { maxDuration: 300 };

export default async function handler(req: any, res: any) {
  if (webAppCors(req, res)) return;
  if (!webAppEntitlementsOn()) return res.status(404).json({ error: 'not_found' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });
  try {
    const caller = await callerFrom(req.headers?.authorization);
    if (!caller) return res.status(401).json({ error: 'unauthorized' });
    const n = await removeWebSitesOf(caller.id);
    return n ? res.status(200).json({ ok: true }) : res.status(404).json({ error: 'no-site' });
  } catch (e: any) {
    console.error('[web-app/take-offline] failed:', e?.message || e);
    return res.status(500).json({ error: 'remove-failed' });
  }
}
