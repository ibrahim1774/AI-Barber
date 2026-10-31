// POST { tier, interval, siteSlug? } + Bearer <supabase jwt> -> { url } for a Stripe Checkout subscription,
// or { url } to the billing portal when the user already has a paid plan (no double billing).
// Off (404) unless WEB_APP_CHECKOUT=1. Everything created is tagged metadata.app = 'aibarber-app'.
import { WEB_APP_TAG, isEntitledStatus, isInterval, isTier, keyMode, priceIdFor } from '../../lib/webApp/stripeCore.js';
import { APP_ORIGIN, callerFrom, sbRest, stripeCall, webAppCheckoutOn, webAppCors } from '../../lib/webApp/webAppServer.js';

export default async function handler(req: any, res: any) {
  if (webAppCors(req, res)) return;
  if (!webAppCheckoutOn()) return res.status(404).json({ error: 'not_found' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const caller = await callerFrom(req.headers.authorization);
  if (!caller) return res.status(401).json({ error: 'unauthorized' });
  const { tier, interval, siteSlug } = req.body ?? {};
  if (!isTier(tier) || !isInterval(interval)) return res.status(400).json({ error: 'bad_plan' });
  const price = priceIdFor(tier, interval, process.env);
  const mode = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
  if (!price || !mode) return res.status(500).json({ error: 'price_not_configured' });
  try {
    const uid = encodeURIComponent(caller.id);
    const rows: any[] = (await sbRest(`web_app_entitlements?user_id=eq.${uid}&environment=eq.${mode}&select=stripe_customer_id,status&order=created_at.desc`)) ?? [];
    if (rows.some((r) => isEntitledStatus(r.status))) return res.status(409).json({ error: 'already_subscribed' }); // manage it in the portal
    // Only a site this user owns can be attached to the subscription.
    let slug = '';
    if (typeof siteSlug === 'string' && /^[a-z0-9-]{1,63}$/.test(siteSlug)) {
      const own = await sbRest(`site_owners?slug=eq.${encodeURIComponent(siteSlug)}&user_id=eq.${uid}&select=slug&limit=1`);
      if (own?.length) slug = siteSlug;
    }
    // Reuse this user's Stripe customer; otherwise create one (tagged) so the portal and webhook can always find it.
    let customer: string | undefined = rows[0]?.stripe_customer_id;
    if (!customer) {
      const c = await stripeCall('customers', { ...(caller.email ? { email: caller.email } : {}), 'metadata[app]': WEB_APP_TAG, 'metadata[user_id]': caller.id });
      customer = c.id as string;
    }
    const meta = { app: WEB_APP_TAG, user_id: caller.id, site_slug: slug, tier };
    const session = await stripeCall('checkout/sessions', {
      mode: 'subscription',
      customer,
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      client_reference_id: caller.id,
      success_url: `${APP_ORIGIN()}/app/edit?paid=1`,
      cancel_url: `${APP_ORIGIN()}/app/edit?paid=0`,
      ...Object.fromEntries(Object.entries(meta).flatMap(([k, v]) => [[`metadata[${k}]`, v], [`subscription_data[metadata][${k}]`, v]])),
    });
    return res.status(200).json({ url: session.url });
  } catch (e: any) {
    console.error('[web-app checkout]', e.message);
    return res.status(502).json({ error: 'checkout_failed' });
  }
}
