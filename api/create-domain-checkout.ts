import { createDomainCheckout } from '../lib/webDomains.js';
import { authorizeSiteOwner, liveDeployAuthDeps } from '../lib/deployAuth.js';
import { liveVercelDomains } from '../lib/ios/vercelDomains.js';
import { FIRST_PARTY_ORIGINS, setFirstPartyCors } from '../lib/webCors.js';

// POST { domain, siteId } + Authorization: Bearer <Supabase access token of the site's owner>
// → { url } of a Stripe Checkout for the domain. Owner only (lib/deployAuth.ts
// authorizeSiteOwner); the project is the authorised slug and the price is Vercel's own price,
// both server-side. First-party origin only (lib/webCors.ts).
export default async function handler(req: any, res: any) {
  const origin = setFirstPartyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(origin ? 200 : 403).end();
    return;
  }
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return res.status(500).json({ error: 'Server configuration error: missing STRIPE_SECRET_KEY' });
    }
    const authDeps = liveDeployAuthDeps();
    const r = await createDomainCheckout(req.body, origin || FIRST_PARTY_ORIGINS[0], req.headers?.authorization, {
      authorize: (siteId, authorization) => authorizeSiteOwner({ siteId, authorization }, authDeps),
      vercel: liveVercelDomains(),
      async createStripeSession(params) {
        const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
        return { ok: response.ok, status: response.status, data: await response.json().catch(() => ({})) };
      },
    });
    return res.status(r.status).json(r.body);
  } catch (error: any) {
    console.error('[CreateDomainCheckout] Error:', error?.message || error);
    return res.status(500).json({ error: 'Internal error' });
  }
}
