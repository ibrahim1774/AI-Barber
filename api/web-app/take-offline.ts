// POST + Authorization: Bearer <supabase jwt> -> takes the caller's web-app site offline for good (the account and the
// subscription stay). The web twin of /api/ios/take-offline. 404 unless WEB_APP_ENTITLEMENTS=1.
import { nativeBuild, nativeDeleteGate } from '../../lib/account/siteMode.js';
import { reliabilityOn } from '../../lib/webApp/reliability.js';
import { removeWebSitesOf } from '../../lib/webApp/deleteAccount.js';
import { callerFrom, webAppCors, webAppEntitlementsOn, authOutage } from '../../lib/webApp/webAppServer.js';

export const config = { maxDuration: 300 };

export default async function handler(req: any, res: any) {
  if (webAppCors(req, res)) return;
  if (!webAppEntitlementsOn()) return res.status(404).json({ error: 'not_found' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });
  try {
    const caller = await callerFrom(req.headers?.authorization);
    if (!caller) return res.status(401).json({ error: 'unauthorized' });
    // A native caller (X-PB-Build) must have a web account (mode account or web-only; device keeps /api/ios/take-offline, 403 not-account-mode); a browser (no header) is asked nothing.
    const gate = await nativeDeleteGate(req, caller.id);
    if (gate) return res.status(gate.status).json(gate.body);
    // The keep-content take offline forgets the live address on the draft row, which needs the draft engine: without it, refuse plainly rather than half-do it.
    if (nativeBuild(req) && !reliabilityOn()) return res.status(503).json({ error: 'temporarily-unavailable' });
    // The 1.2 app in account mode (the gate above passed for a native caller) never deletes the stored copy or photos; the web's own take offline is unchanged.
    const n = await removeWebSitesOf(caller.id, nativeBuild(req) ? { keepContent: true } : undefined);
    return n ? res.status(200).json({ ok: true }) : res.status(404).json({ error: 'no-site' });
  } catch (e: any) {
    if (authOutage(res, e)) return;
    // A publish is running: suspendWork refused before touching anything. The app is told so (409); the browser's answer is unchanged (500 remove-failed).
    if (nativeBuild(req) && e?.message === 'publish-in-progress') return res.status(409).json({ error: 'publish-in-progress' });
    console.error('[web-app/take-offline] failed:', e?.message || e);
    return res.status(500).json({ error: 'remove-failed' });
  }
}
