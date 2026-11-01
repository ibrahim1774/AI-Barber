// GET + Bearer <supabase jwt> -> the caller's web-app subscription: { entitled, tier, interval, status, subscriptionId }.
// Read-only; the answer comes from web_app_entitlements for this deployment's Stripe mode.
import { isEntitledStatus, keyMode } from '../../lib/webApp/stripeCore.js';
import { appStoreStateOf, type AppStoreState } from '../../lib/webApp/appStoreGuard.js';
import { callerFrom, sbRest, webAppCheckoutOn, webAppCors } from '../../lib/webApp/webAppServer.js';

export default async function handler(req: any, res: any) {
  if (webAppCors(req, res)) return;
  if (!webAppCheckoutOn()) return res.status(404).json({ error: 'not_found' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const mode = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
  if (!mode) return res.status(500).json({ error: 'misconfigured' });
  try {
    const caller = await callerFrom(req.headers.authorization);
    if (!caller) return res.status(401).json({ error: 'unauthorized' });
    const rows: any[] = (await sbRest(`web_app_entitlements?user_id=eq.${encodeURIComponent(caller.id)}&environment=eq.${mode}&select=stripe_subscription_id,tier,billing_interval,status,current_period_end&order=created_at.desc`)) ?? [];
    const live = rows.find((r) => isEntitledStatus(r.status));
    const row = live ?? rows[0];
    // Read-only App Store lookup; fails open (null) so /me never breaks on it.
    let appStore: AppStoreState = null;
    try { appStore = await appStoreStateOf(caller.id, mode); } catch (e: any) { console.error('[web-app me] app store lookup failed:', e?.message || e); }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ appStore, entitled: !!live, tier: row?.tier ?? null, interval: row?.billing_interval ?? null, status: row?.status ?? null, subscriptionId: row?.stripe_subscription_id ?? null });
  } catch (e: any) {
    console.error('[web-app me]', e.message);
    return res.status(502).json({ error: 'lookup_failed' });
  }
}
