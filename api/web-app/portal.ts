// POST + Bearer <supabase jwt> -> { url } to the Stripe billing portal for the caller's own customer.
// Uses a portal configuration made for the web app (STRIPE_WEBAPP_PORTAL_CONFIG: only the six base web-app prices).
// Price-test users (stored group g10 / g20) get their own configuration (STRIPE_WEBAPP_PORTAL_CONFIG_G10 / _G20, listing that group's six prices);
// when it is missing the portal fails closed (500 portal_not_configured), it never falls back to the base configuration.
import { isEntitledStatus, keyMode, portalConfigFor, tierForPriceId, type PriceGroup } from '../../lib/webApp/stripeCore.js';
import { readStoredGroup } from '../../lib/webApp/priceGroup.js';
import { callerFrom, sbRest, stripeCall, APP_ORIGIN, webAppCheckoutOn, webAppCors } from '../../lib/webApp/webAppServer.js';

export default async function handler(req: any, res: any) {
  if (webAppCors(req, res)) return;
  if (!webAppCheckoutOn()) return res.status(404).json({ error: 'not_found' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const caller = await callerFrom(req.headers.authorization);
  if (!caller) return res.status(401).json({ error: 'unauthorized' });
  const mode = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
  if (!mode) return res.status(500).json({ error: 'portal_not_configured' });
  try {
    const rows: Array<{ stripe_customer_id: string; stripe_subscription_id: string; status: string }> = (await sbRest(`web_app_entitlements?user_id=eq.${encodeURIComponent(caller.id)}&environment=eq.${mode}&select=stripe_customer_id,stripe_subscription_id,status&order=created_at.desc`)) ?? [];
    // The customer behind the paid plan first (an old canceled subscription must not pick the customer), else the newest.
    const row = rows.find((r) => isEntitledStatus(r.status)) ?? rows[0];
    const customer = row?.stripe_customer_id;
    if (!customer) {
      // A free-group account has no Stripe customer: say so distinctly (nothing to manage or cancel).
      let free = false;
      try { free = (await readStoredGroup(caller.id)) === 'free'; } catch { /* plain no_subscription */ }
      return res.status(404).json(free ? { error: 'no_subscription', plan: 'free' } : { error: 'no_subscription' });
    }
    // Price test: the group comes from the price the subscription is ACTUALLY on (like dunning) and must agree with the stored group,
    // so the portal never offers another group's prices. Fail closed ONLY when a test group (g10 / g20) is involved (the subscription's
    // price maps to one, or the stored group is one). Base-group and unrecognised-price subscribers with no stored test group keep the
    // old behaviour exactly: the base STRIPE_WEBAPP_PORTAL_CONFIG.
    const storedRaw = (await readStoredGroup(caller.id)) ?? 'base';
    const stored: PriceGroup = storedRaw === 'free' ? 'base' : storedRaw; // free behaves like base here (its paid plan is on base prices)
    let subGroup: PriceGroup | null = null;
    try {
      const sub = row.stripe_subscription_id ? await stripeCall(`subscriptions/${encodeURIComponent(row.stripe_subscription_id)}`, null, 'GET') : null;
      const priceId = sub?.items?.data?.[0]?.price?.id;
      subGroup = (priceId ? tierForPriceId(priceId, process.env)?.group : null) ?? null;
    } catch (e: any) {
      if (stored !== 'base') throw e; // a test-group user: never guess
      console.error('[web-app portal] subscription lookup failed, using the base configuration:', e?.message || e);
    }
    const group: PriceGroup = subGroup ?? 'base';
    if (stored !== group && (stored !== 'base' || group !== 'base')) { console.error(`[web-app portal] price_group_mismatch stored=${stored} subscription=${subGroup ?? 'unrecognised'}`); return res.status(409).json({ error: 'price_group_mismatch' }); }
    const config = portalConfigFor(group, process.env);
    if (!config) return res.status(500).json({ error: 'portal_not_configured' });
    const s = await stripeCall('billing_portal/sessions', { customer, configuration: config, return_url: `${APP_ORIGIN()}/app/edit` });
    return res.status(200).json({ url: s.url });
  } catch (e: any) {
    console.error('[web-app portal]', e.message);
    return res.status(502).json({ error: 'portal_failed' });
  }
}
