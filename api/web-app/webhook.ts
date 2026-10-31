// Stripe webhook for the web app only (its own endpoint + secret). Upserts one row per subscription
// into web_app_entitlements. The row is built from the subscription's CURRENT state fetched from Stripe,
// never from the event body, so late or replayed events can't bring back a canceled subscription.
// Events without metadata.app = 'aibarber-app' are acknowledged and ignored.
import { keyMode, rowFromSubscription, verifyStripeSignature } from '../../lib/webApp/stripeCore.js';
import { readRawBody, sbRest, stripeCall } from '../../lib/webApp/webAppServer.js';

export const config = { api: { bodyParser: false } };

const SUB_EVENTS = new Set(['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const secret = process.env.STRIPE_WEBAPP_WEBHOOK_SECRET;
  const mode = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
  if (!secret || !mode) return res.status(500).json({ error: 'misconfigured' });
  let event: any;
  try {
    const raw = await readRawBody(req);
    if (!verifyStripeSignature(raw, req.headers['stripe-signature'] as string, secret)) return res.status(400).json({ error: 'bad_signature' });
    event = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: 'bad_request' });
  }
  if (!SUB_EVENTS.has(event.type)) return res.status(200).json({ ignored: true });
  // Only the mode this deployment's key belongs to (a test event can never grant access in live, or the reverse).
  if ((mode === 'live') !== !!event.livemode) return res.status(200).json({ ignored: true });
  const evSub = event.data?.object;
  if (evSub?.metadata?.app !== 'aibarber-app' || typeof evSub.id !== 'string') return res.status(200).json({ ignored: true });
  try {
    let sub: any;
    try { sub = await stripeCall(`subscriptions/${encodeURIComponent(evSub.id)}`, null, 'GET'); }
    catch { sub = { ...evSub, status: 'canceled' }; } // gone from Stripe: treat as ended
    const row = rowFromSubscription(sub, mode === 'live', process.env, sub.status === 'canceled');
    if (!row) return res.status(200).json({ ignored: true });
    await sbRest('web_app_entitlements?on_conflict=stripe_subscription_id', { method: 'POST', body: { ...row, updated_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates,return=minimal' });
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error('[web-app webhook]', e.message);
    return res.status(500).json({ error: 'store_failed' }); // Stripe retries
  }
}
