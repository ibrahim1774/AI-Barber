// Stripe webhook for the web app only (its own endpoint + secret). Upserts one row per subscription
// into web_app_entitlements; events without metadata.app = 'aibarber-app' are acknowledged and ignored.
import { rowFromSubscription, verifyStripeSignature } from '../../lib/webApp/stripeCore.js';
import { readRawBody, sbRest } from '../../lib/webApp/server.js';

export const config = { api: { bodyParser: false } };

const SUB_EVENTS = new Set(['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const secret = process.env.STRIPE_WEBAPP_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: 'misconfigured' });
  let event: any;
  try {
    const raw = await readRawBody(req);
    if (!verifyStripeSignature(raw, req.headers['stripe-signature'] as string, secret)) return res.status(400).json({ error: 'bad_signature' });
    event = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: 'bad_request' });
  }
  if (!SUB_EVENTS.has(event.type)) return res.status(200).json({ ignored: true });
  const row = rowFromSubscription(event.data?.object, !!event.livemode, process.env, event.type === 'customer.subscription.deleted');
  if (!row) return res.status(200).json({ ignored: true });
  try {
    await sbRest('web_app_entitlements?on_conflict=stripe_subscription_id', { method: 'POST', body: { ...row, updated_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates,return=minimal' });
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error('[web-app webhook]', e.message);
    return res.status(500).json({ error: 'store_failed' }); // Stripe retries
  }
}
