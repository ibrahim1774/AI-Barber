// POST: create the shop's Standard connected account if needed, then an onboarding Account Link. 200 { url }.
// 409 { error: 'stripe-account-unavailable', message } when the stored account can't be reached (403/404):
// logged + audited, never cleared here. 502 { error: 'stripe-error' } for other Stripe failures.
// Owner only: Authorization: Bearer <Supabase access token>.
import { stripeOnboard, liveOwnerStripeDeps } from '../../../lib/bookings/payments.js';

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });
  try {
    const r = await stripeOnboard(req.headers?.authorization, liveOwnerStripeDeps());
    return res.status(r.status).json(r.body);
  } catch (e: any) {
    console.error('[shop/stripe/onboard] error:', e?.message || e);
    return res.status(500).json({ error: 'internal' });
  }
}

function setCors(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
}
