import { createDomainCheckout } from '../lib/webDomains.js';
import { liveVercelDomains } from '../lib/ios/vercelDomains.js';

// POST { domain, siteId } → { url } of a Stripe Checkout for the domain. The price comes from
// Vercel's own price for the name and the project from the site id, both server-side; any
// `vercelPrice` / `projectName` the client sends is ignored (lib/webDomains.ts).
export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') return res.status(405).end();

  try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return res.status(500).json({ error: 'Server configuration error: missing STRIPE_SECRET_KEY' });
    }
    // Determine origin for success/cancel URLs
    const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, '') || 'http://localhost:3000';
    const r = await createDomainCheckout(req.body, origin, {
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
    console.error('[CreateDomainCheckout] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal error' });
  }
}
