// Live wiring of the web app's custom-domain endpoints (api/web-app/domain.ts, and the plan-customer
// lookup of api/create-domain-checkout for `app: 'web'`). The logic is in lib/webApp/domainOneClick.ts
// and lib/webDomains.ts; this file only binds Stripe (STRIPE_SECRET_KEY, the domain key), Supabase and Vercel.
import { STRIPE_API_VERSION } from '../stripeVersion.js';
import { liveDomainDeps, domainTestRealSites, notifySupportEmail, probeHttps, stripe, stripeCancelAndRefund, stripeSubscription } from '../ios/domainLive.js';
import { liveVercelDomains } from '../ios/vercelDomains.js';
import { supabaseDomains } from '../ios/domainsRepo.js';
import { serviceClient } from '../bookings/repo.js';
import { isEntitledStatus, keyMode } from './stripeCore.js';
import { sbRest } from './webAppServer.js';
import { oneClickFlagOn, type OneClickDeps, type WebPlan } from './domainOneClick.js';
import { domainPortalForm, type AuthorizeOwner, type PanelDeps } from '../webDomains.js';
import { liveManualDeps } from './domainManualEnv.js';

/**
 * The shop's PAID plan customer (the entitled web_app_entitlements row of this Stripe mode) and the
 * plan subscription. null when the user has no entitled plan: nothing is charged to a lapsed customer.
 */
export async function webPlanOf(userId: string): Promise<WebPlan | null> {
  const mode = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
  if (!mode) return null;
  const rows: Array<{ stripe_customer_id: string | null; stripe_subscription_id: string; status: string }> =
    (await sbRest(`web_app_entitlements?user_id=eq.${encodeURIComponent(userId)}&environment=eq.${mode}&select=stripe_customer_id,stripe_subscription_id,status&order=updated_at.desc`)) ?? [];
  const ent = rows.find((r) => isEntitledStatus(r.status) && r.stripe_customer_id);
  return ent ? { customer: ent.stripe_customer_id as string, subscriptionId: ent.stripe_subscription_id } : null;
}

/** The web site `slug` belongs to exactly this user (web_app_sites.user_id). Throws on an outage (the caller answers 503). */
export async function ownsWebSite(slug: string, userId: string): Promise<boolean> {
  const rows: Array<{ user_id: string | null }> = (await sbRest(`web_app_sites?slug=eq.${encodeURIComponent(slug)}&select=user_id&limit=1`)) ?? [];
  return rows.length === 1 && rows[0].user_id === userId;
}

/**
 * One-click is possible only when both Stripe keys are the same mode (the plan's customer must be
 * visible to the domain key; Step 0 confirms the same ACCOUNT, a Stripe 404 on the customer falls
 * back to Checkout anyway) and a price (or product) is configured. WEB_DOMAIN_ONECLICK=0 turns it off.
 */
export function oneClickEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const mode = keyMode(env.STRIPE_SECRET_KEY);
  return oneClickFlagOn(env) && !!mode && mode === keyMode(env.STRIPE_WEBAPP_SECRET_KEY) && !!(env.STRIPE_DOMAIN_PRICE_ID || env.STRIPE_DOMAIN_PRODUCT_ID);
}

/** POST /v1/subscriptions/<id> cancel_at_period_end (the domain key). Only ever the one domain subscription. */
export async function stripeSetRenewal(subscriptionId: string, cancelAtPeriodEnd: boolean, idempotencyKey: string) {
  const r = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY || ''}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': STRIPE_API_VERSION, 'Idempotency-Key': idempotencyKey },
    body: new URLSearchParams({ cancel_at_period_end: String(cancelAtPeriodEnd) }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) };
}

export function liveOneClickDeps(authorize: AuthorizeOwner): OneClickDeps {
  return {
    authorize,
    flow: liveDomainDeps(),
    secret: process.env.DOMAIN_CHECKOUT_SECRET || '',
    priceId: process.env.STRIPE_DOMAIN_PRICE_ID || undefined,
    productId: process.env.STRIPE_DOMAIN_PRODUCT_ID || undefined,
    stripe,
    planOf: webPlanOf,
    ownsWebSite,
    cancelAndRefund: (id) => stripeCancelAndRefund(id),
    notifySupport: (subject, text) => notifySupportEmail(subject, text),
    testRealSites: domainTestRealSites(),
    manual: liveManualDeps({ getSubscription: stripeSubscription }),
    enabled: oneClickEnabled(),
  };
}

/** The status / portal panel deps (the same as api/web-domain.ts). */
export function livePanelDeps(authorize: AuthorizeOwner): PanelDeps {
  const key = process.env.STRIPE_SECRET_KEY || '';
  return {
    authorize,
    flow: { repo: supabaseDomains(serviceClient()), vercel: liveVercelDomains(), probeHttps },
    getSubscription: stripeSubscription,
    setRenewal: (id, cancel, idem) => stripeSetRenewal(id, cancel, idem),
    async createPortalSession(customer, returnUrl, subscriptionId) {
      const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': STRIPE_API_VERSION },
        body: domainPortalForm(customer, returnUrl, subscriptionId),
      });
      return { ok: r.ok, data: await r.json().catch(() => null) };
    },
  };
}
