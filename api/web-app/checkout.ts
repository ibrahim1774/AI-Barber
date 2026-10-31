// POST { tier, interval, siteSlug? } + Bearer <supabase jwt> -> { url } for a Stripe Checkout subscription.
// Off (404) unless WEB_APP_CHECKOUT=1. Everything created is tagged metadata.app = 'aibarber-app'.
import { WEB_APP_TAG, isInterval, isTier, priceIdFor } from '../../lib/webApp/stripeCore.js';
import { APP_ORIGIN, callerFrom, sbRest, stripeCall, webAppCheckoutOn } from '../../lib/webApp/server.js';

export default async function handler(req: any, res: any) {
  if (!webAppCheckoutOn()) return res.status(404).json({ error: 'not_found' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const caller = await callerFrom(req.headers.authorization);
  if (!caller) return res.status(401).json({ error: 'unauthorized' });
  const { tier, interval, siteSlug } = req.body ?? {};
  if (!isTier(tier) || !isInterval(interval)) return res.status(400).json({ error: 'bad_plan' });
  const price = priceIdFor(tier, interval, process.env);
  if (!price) return res.status(500).json({ error: 'price_not_configured' });
  const slug = typeof siteSlug === 'string' && /^[a-z0-9-]{1,63}$/.test(siteSlug) ? siteSlug : '';
  try {
    // Reuse this user's Stripe customer when they already have one (never take a customer id from the client).
    const rows = await sbRest(`web_app_entitlements?user_id=eq.${encodeURIComponent(caller.id)}&select=stripe_customer_id&limit=1`);
    const customer: string | undefined = rows?.[0]?.stripe_customer_id;
    const meta = { app: WEB_APP_TAG, user_id: caller.id, site_slug: slug, tier };
    const body: Record<string, string> = {
      mode: 'subscription',
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      client_reference_id: caller.id,
      success_url: `${APP_ORIGIN()}/app/edit?paid=1`,
      cancel_url: `${APP_ORIGIN()}/app/edit?paid=0`,
      ...Object.fromEntries(Object.entries(meta).flatMap(([k, v]) => [[`metadata[${k}]`, v], [`subscription_data[metadata][${k}]`, v]])),
    };
    if (customer) body.customer = customer; else if (caller.email) body.customer_email = caller.email;
    const session = await stripeCall('checkout/sessions', body);
    return res.status(200).json({ url: session.url });
  } catch (e: any) {
    console.error('[web-app checkout]', e.message);
    return res.status(502).json({ error: 'checkout_failed' });
  }
}
