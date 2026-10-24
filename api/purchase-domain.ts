import { purchaseDomain } from '../lib/webDomains.js';
import { liveWebDomainDeps } from '../lib/ios/domainLive.js';
import { authorizeSiteOwner, liveDeployAuthDeps } from '../lib/deployAuth.js';
import { setFirstPartyCors } from '../lib/webCors.js';

// POST { sessionId, domain? } + Authorization: Bearer <Supabase access token of the site's owner>
// after the $39/year domain Checkout: claims the domain slot for that subscription through the
// shared state machine (buy with auto-renew off, attach). Owner of the session's own site only,
// checked before anything about the session is revealed. Idempotent: one subscription is one
// slot; a replay resumes or returns the status, never buys again (lib/webDomains.ts). The Stripe
// webhook does the same for a closed tab.
export const config = { maxDuration: 300 };

export default async function handler(req: any, res: any) {
  const origin = setFirstPartyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(origin ? 200 : 403).end();
    return;
  }
  if (req.method !== 'POST') return res.status(405).end();

  try {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.DOMAIN_CHECKOUT_SECRET) {
      return res.status(500).json({ error: 'Server configuration error' });
    }
    const authDeps = liveDeployAuthDeps();
    const r = await purchaseDomain(req.body, req.headers?.authorization,
      liveWebDomainDeps((siteId, authorization) => authorizeSiteOwner({ siteId, authorization }, authDeps)));
    return res.status(r.status).json(r.body);
  } catch (error: any) {
    console.error('[PurchaseDomain] Error:', error?.message || error);
    return res.status(500).json({ error: 'Internal error' });
  }
}
