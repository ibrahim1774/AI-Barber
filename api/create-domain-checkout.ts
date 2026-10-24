import { STRIPE_API_VERSION } from '../lib/stripeVersion.js';
import { createDomainCheckout } from '../lib/webDomains.js';
import { authorizeSiteOwner, liveDeployAuthDeps } from '../lib/deployAuth.js';
import { liveVercelDomains, registrantContact } from '../lib/ios/vercelDomains.js';
import { supabaseDomains } from '../lib/ios/domainsRepo.js';
import { serviceClient } from '../lib/bookings/repo.js';
import { FIRST_PARTY_ORIGINS, setFirstPartyCors } from '../lib/webCors.js';

// POST { domain, siteId } + Authorization: Bearer <Supabase access token of the site's owner>
// → { url } of a $39/year Stripe subscription Checkout for the domain (lib/webDomains.ts).
// Owner only (lib/deployAuth.ts authorizeSiteOwner); the site is the authorised slug and the
// domain, site and price are fixed and signed server-side. First-party origin only.
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
      flow: { vercel: liveVercelDomains(), contact: registrantContact(), repo: supabaseDomains(serviceClient()) },
      secret: process.env.DOMAIN_CHECKOUT_SECRET || '',
      priceId: process.env.STRIPE_DOMAIN_PRICE_ID || undefined,
      async createStripeSession(params) {
        const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': STRIPE_API_VERSION },
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
