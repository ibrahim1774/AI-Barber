// POST + Bearer <supabase jwt> -> { url } to the Stripe billing portal for the caller's own customer.
import { callerFrom, sbRest, stripeCall, APP_ORIGIN, webAppCheckoutOn } from '../../lib/webApp/server.js';

export default async function handler(req: any, res: any) {
  if (!webAppCheckoutOn()) return res.status(404).json({ error: 'not_found' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const caller = await callerFrom(req.headers.authorization);
  if (!caller) return res.status(401).json({ error: 'unauthorized' });
  try {
    const rows = await sbRest(`web_app_entitlements?user_id=eq.${encodeURIComponent(caller.id)}&select=stripe_customer_id&order=created_at.desc&limit=1`);
    const customer = rows?.[0]?.stripe_customer_id;
    if (!customer) return res.status(404).json({ error: 'no_subscription' });
    const s = await stripeCall('billing_portal/sessions', { customer, return_url: `${APP_ORIGIN()}/app/edit` });
    return res.status(200).json({ url: s.url });
  } catch (e: any) {
    console.error('[web-app portal]', e.message);
    return res.status(502).json({ error: 'portal_failed' });
  }
}
