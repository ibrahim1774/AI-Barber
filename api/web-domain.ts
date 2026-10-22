import { webDomainPanelStatus, webDomainPortal } from '../lib/webDomains.js';
import { authorizeSiteOwner, liveDeployAuthDeps } from '../lib/deployAuth.js';
import { supabaseDomains } from '../lib/ios/domainsRepo.js';
import { serviceClient } from '../lib/bookings/repo.js';
import { stripeSubscription } from '../lib/ios/domainLive.js';
import { FIRST_PARTY_ORIGINS, setFirstPartyCors } from '../lib/webCors.js';

// POST { action: 'status' | 'portal', siteId } + Authorization: Bearer <the site owner's token>.
// status → the website domain's state for the dashboard; portal → a Stripe customer-portal URL
// to cancel the $39/year domain (it keeps working until the paid year ends). Owner only.
export default async function handler(req: any, res: any) {
  const origin = setFirstPartyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(origin ? 200 : 403).end();
    return;
  }
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return res.status(500).json({ error: 'Server configuration error' });
    const authDeps = liveDeployAuthDeps();
    const deps = {
      authorize: (siteId: unknown, authorization: unknown) => authorizeSiteOwner({ siteId, authorization }, authDeps),
      flow: { repo: supabaseDomains(serviceClient()) },
      getSubscription: stripeSubscription,
      async createPortalSession(customer: string, returnUrl: string) {
        const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ customer, return_url: returnUrl }).toString(),
        });
        return { ok: r.ok, data: await r.json().catch(() => null) };
      },
    };
    const body = req.body || {};
    const r = body.action === 'portal'
      ? await webDomainPortal(body, req.headers?.authorization, origin || FIRST_PARTY_ORIGINS[0], deps)
      : await webDomainPanelStatus(body, req.headers?.authorization, deps);
    return res.status(r.status).json(r.body);
  } catch (e: any) {
    console.error('[web-domain] error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
