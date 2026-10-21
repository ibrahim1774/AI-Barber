// GET: 200 { connected, chargesEnabled, detailsSubmitted }, refreshed from Stripe (and synced to ab_shops.stripe_charges_enabled).
// Owner only: Authorization: Bearer <Supabase access token>.
import { stripeStatus, liveOwnerStripeDeps } from '../../../lib/bookings/payments.js';

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method-not-allowed' });
  try {
    const r = await stripeStatus(req.headers?.authorization, liveOwnerStripeDeps());
    return res.status(r.status).json(r.body);
  } catch (e: any) {
    console.error('[shop/stripe/status] error:', e?.message || e);
    return res.status(500).json({ error: 'internal' });
  }
}

function setCors(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,GET');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
}
