// POST: start "connect an existing Stripe account" (Connect OAuth). 200 { url } -> connect.stripe.com/oauth/authorize.
// 503 { error: 'connect-existing-unavailable' } when STRIPE_CONNECT_CLIENT_ID is unset; 403 { error: 'web-only' } for non-web owners.
// Owner only: Authorization: Bearer <Supabase access token>.
import { liveOwnerStripeDeps } from '../../../lib/bookings/payments.js';
import { stripeConnectExisting } from '../../../lib/bookings/stripeOauth.js';

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });
  try {
    const r = await stripeConnectExisting(req.headers?.authorization, liveOwnerStripeDeps());
    return res.status(r.status).json(r.body);
  } catch (e: any) {
    console.error('[shop/stripe/connect-existing] error:', e?.message || e);
    return res.status(500).json({ error: 'internal' });
  }
}

function setCors(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
}
