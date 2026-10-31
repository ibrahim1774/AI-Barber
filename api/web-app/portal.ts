// POST + Bearer <supabase jwt> -> { url } to the Stripe billing portal for the caller's own customer.
// Uses a portal configuration made for the web app (STRIPE_WEBAPP_PORTAL_CONFIG: only the six web-app prices).
import { keyMode } from '../../lib/webApp/stripeCore.js';
import { callerFrom, sbRest, stripeCall, APP_ORIGIN, webAppCheckoutOn, webAppCors } from '../../lib/webApp/webAppServer.js';

export default async function handler(req: any, res: any) {
  if (webAppCors(req, res)) return;
  if (!webAppCheckoutOn()) return res.status(404).json({ error: 'not_found' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const caller = await callerFrom(req.headers.authorization);
  if (!caller) return res.status(401).json({ error: 'unauthorized' });
  const config = process.env.STRIPE_WEBAPP_PORTAL_CONFIG;
  const mode = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
  if (!config || !mode) return res.status(500).json({ error: 'portal_not_configured' });
  try {
    const rows = await sbRest(`web_app_entitlements?user_id=eq.${encodeURIComponent(caller.id)}&environment=eq.${mode}&select=stripe_customer_id&order=created_at.desc&limit=1`);
    const customer = rows?.[0]?.stripe_customer_id;
    if (!customer) return res.status(404).json({ error: 'no_subscription' });
    const s = await stripeCall('billing_portal/sessions', { customer, configuration: config, return_url: `${APP_ORIGIN()}/app/edit` });
    return res.status(200).json({ url: s.url });
  } catch (e: any) {
    console.error('[web-app portal]', e.message);
    return res.status(502).json({ error: 'portal_failed' });
  }
}
