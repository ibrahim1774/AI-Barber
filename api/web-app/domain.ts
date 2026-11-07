// POST { action, siteId, ... } + Authorization: Bearer <the site owner's Supabase token>: the web app's
// custom-domain endpoint (primebarber.org). Everything the web client needs from one place, with the
// web app's CORS (the staging host included), so the app never calls the legacy first-party endpoints.
//   card      → { oneClick, card: { brand, last4, expMonth, expYear } | null }: the card a one-click buy would charge
//   buy       → one-click purchase on the plan's saved card (lib/webApp/domainOneClick.ts); 402 { fallback: true } → use checkout
//   checkout  → { url } of the hosted Stripe Checkout (the fallback), returning to /app/domain?domain_payment=...
//   purchase  → { sessionId } after that Checkout: claim the domain slot (idempotent)
//   status    → the domain's state with the DNS/TLS probe
//   portal    → a Stripe customer-portal URL to cancel the domain (works until the paid year ends)
// Off (404) unless WEB_APP_CHECKOUT=1. Owner of a web site only (authorizeSiteOwner); iOS sites buy in the app.
// One-click is switched by WEB_DOMAIN_ONECLICK (default on) and falls back to Checkout by itself.
import { STRIPE_API_VERSION } from '../../lib/stripeVersion.js';
import { authorizeSiteOwner, liveDeployAuthDeps } from '../../lib/deployAuth.js';
import { createDomainCheckout, purchaseDomain, webDomainPanelStatus, webDomainPortal } from '../../lib/webDomains.js';
import { oneClickCard, oneClickDomainPurchase } from '../../lib/webApp/domainOneClick.js';
import { liveOneClickDeps, livePanelDeps, webPlanOf } from '../../lib/webApp/domainOneClickLive.js';
import { liveWebDomainDeps } from '../../lib/ios/domainLive.js';
import { liveVercelDomains, registrantContact } from '../../lib/ios/vercelDomains.js';
import { supabaseDomains } from '../../lib/ios/domainsRepo.js';
import { serviceClient } from '../../lib/bookings/repo.js';
import { APP_ORIGIN, webAppCheckoutOn, webAppCors } from '../../lib/webApp/webAppServer.js';

export const config = { maxDuration: 300 };

export default async function handler(req: any, res: any) {
  if (webAppCors(req, res)) return;
  if (!webAppCheckoutOn()) return res.status(404).json({ error: 'not_found' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Server configuration error' });
    const body = req.body || {};
    const auth = req.headers?.authorization;
    const authDeps = liveDeployAuthDeps();
    const authorize = (siteId: unknown, authorization: unknown) => authorizeSiteOwner({ siteId, authorization }, authDeps);
    let r: { status: number; body: unknown };
    switch (body.action) {
      case 'card': r = await oneClickCard(body, auth, liveOneClickDeps(authorize)); break;
      case 'buy': r = await oneClickDomainPurchase(body, auth, liveOneClickDeps(authorize)); break;
      case 'checkout': {
        const key = process.env.STRIPE_SECRET_KEY;
        r = await createDomainCheckout({ domain: body.domain, siteId: body.siteId, app: 'web' }, APP_ORIGIN(), auth, {
          authorize,
          flow: { vercel: liveVercelDomains(), contact: registrantContact(), repo: supabaseDomains(serviceClient()) },
          secret: process.env.DOMAIN_CHECKOUT_SECRET || '',
          priceId: process.env.STRIPE_DOMAIN_PRICE_ID || undefined,
          async createStripeSession(params) {
            const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
              method: 'POST',
              headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': STRIPE_API_VERSION },
              body: params.toString(),
            });
            return { ok: response.ok, status: response.status, data: await response.json().catch(() => ({})) };
          },
        }, { returnBase: APP_ORIGIN(), customerOf: async (userId) => (await webPlanOf(userId))?.customer ?? null });
        break;
      }
      case 'purchase':
        if (!process.env.DOMAIN_CHECKOUT_SECRET) return res.status(500).json({ error: 'Server configuration error' });
        r = await purchaseDomain(body, auth, liveWebDomainDeps(authorize));
        break;
      case 'status': r = await webDomainPanelStatus(body, auth, livePanelDeps(authorize)); break;
      case 'portal': r = await webDomainPortal(body, auth, `${APP_ORIGIN()}/app/domain`, livePanelDeps(authorize)); break;
      default: return res.status(400).json({ error: 'bad-request' });
    }
    return res.status(r.status).json(r.body);
  } catch (e: any) {
    console.error('[web-app/domain] error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
