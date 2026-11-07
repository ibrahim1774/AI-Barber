// One-click custom domain for the web app (primebarber.org): buy the $39/year domain on the card
// the shop already pays its plan with, no second Checkout. Hosted Checkout (lib/webDomains.ts
// createDomainCheckout) stays the fallback for no card / a declined card / SCA / one-click off.
//
// Pure over deps (Stripe call, plan lookup, the shared domain flow), like lib/webDomains.ts.
//
// Switch: env WEB_DOMAIN_ONECLICK, default ON ('0' / 'off' / 'false' turns it off and every buy
// answers 402 one-click-off so the client uses Checkout). The live wiring also turns it off by
// itself when STRIPE_SECRET_KEY and STRIPE_WEBAPP_SECRET_KEY are not the same Stripe mode, or when
// neither STRIPE_DOMAIN_PRICE_ID nor STRIPE_DOMAIN_PRODUCT_ID is set (a subscription item cannot
// carry price_data.product_data, so one-click needs a price or a product id).
//
// Trust model (unchanged from Checkout): the server signs (domain, slug) with DOMAIN_CHECKOUT_SECRET
// only AFTER authorizeSiteOwner, the price is server-fixed, the slug comes from the authorisation
// (never the body), and the only client field that reaches Stripe is a domain that passed
// isComDomain. The subscription is then claimed through the same state machine as every other
// route (claimDomainSubscription): a paid subscription never ends without a domain row or a refund.
import { isComDomain } from '../ios/domainNames.js';
import { domainsNotConfigured, missingDomainConfig, type DomainFlowDeps } from '../ios/domainFlow.js';
import {
  WEB_DOMAIN_PRICE_CENTS, claimDomainSubscription, domainSaleRefusal, domainSig, isTestMode, verifyDomainSubscription,
  DOMAIN_SESSION_APP, type AuthorizeOwner, type WebResult, type WebDomainDeps,
} from '../webDomains.js';

export type StripeFn = (method: string, path: string, opts?: { form?: Record<string, string>; idem?: string }) =>
  Promise<{ ok: boolean; status: number; data: any }>;

/** The shop's plan customer (and the plan subscription, whose card we prefer), from the web app tables. */
export interface WebPlan { customer: string; subscriptionId: string | null }

export interface CardInfo { brand: string; last4: string; expMonth: number; expYear: number }

export interface OneClickDeps {
  authorize: AuthorizeOwner;
  flow: DomainFlowDeps;
  secret: string;
  /** Configured Stripe price of the domain (STRIPE_DOMAIN_PRICE_ID). */
  priceId?: string;
  /** Stripe product for price_data when there is no price id (STRIPE_DOMAIN_PRODUCT_ID). */
  productId?: string;
  /** STRIPE_SECRET_KEY calls (the domain key). */
  stripe: StripeFn;
  planOf(userId: string): Promise<WebPlan | null>;
  cancelAndRefund(subscriptionId: string): Promise<void>;
  notifySupport?(subject: string, text: string): Promise<void>;
  testRealSubs?: ReadonlySet<string>;
  /** False = one-click off (env flag, key mismatch, no price): Checkout only. */
  enabled: boolean;
}

/** WEB_DOMAIN_ONECLICK: on unless explicitly '0' / 'off' / 'false'. */
export function oneClickFlagOn(env: Record<string, string | undefined> = process.env): boolean {
  return !['0', 'off', 'false'].includes(String(env.WEB_DOMAIN_ONECLICK ?? '').trim().toLowerCase());
}

const CUS = /^cus_[A-Za-z0-9]{6,100}$/;
const SUB = /^sub_[A-Za-z0-9]{6,200}$/;
const PM = /^(pm|card)_[A-Za-z0-9]{6,100}$/;
const idOf = (v: any): string | null => (typeof v === 'string' ? v : typeof v?.id === 'string' ? v.id : null);
const WINDOW_MS = 10 * 60_000;

const fallback = (reason: 'no-card' | 'card-failed' | 'one-click-off', detail?: string): WebResult => ({
  status: 402,
  body: { error: reason, fallback: true, ...(detail ? { reason: detail } : {}) },
});

function cardUsable(pm: any, customer: string, now: number): CardInfo | null {
  if (!pm || pm.type !== 'card' || idOf(pm.customer) !== customer || !pm.card) return null;
  const y = Number(pm.card.exp_year);
  const m = Number(pm.card.exp_month);
  const d = new Date(now);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  if (y < d.getUTCFullYear() || (y === d.getUTCFullYear() && m < d.getUTCMonth() + 1)) return null; // an expired card
  return { brand: String(pm.card.brand || 'card'), last4: String(pm.card.last4 || ''), expMonth: m, expYear: y };
}

/**
 * The card to charge: the plan subscription's default payment method, else the customer's default,
 * else the newest saved card. Only a card of THIS customer that has not expired. null = none (or the
 * customer is unknown to this Stripe account). Throws on a Stripe outage.
 */
export async function cardOnFile(plan: WebPlan, stripe: StripeFn, now: number): Promise<(CardInfo & { id: string }) | null> {
  if (!CUS.test(plan.customer)) return null;
  const tried = new Set<string>();
  const tryPm = async (id: string | null) => {
    if (!id || !PM.test(id) || tried.has(id)) return null;
    tried.add(id);
    const r = await stripe('GET', `/v1/payment_methods/${id}`);
    if (!r.ok) {
      if (r.status >= 500) throw new Error(`payment method lookup failed: ${r.status}`);
      return null;
    }
    const c = cardUsable(r.data, plan.customer, now);
    return c ? { ...c, id } : null;
  };

  if (plan.subscriptionId && SUB.test(plan.subscriptionId)) {
    const s = await stripe('GET', `/v1/subscriptions/${plan.subscriptionId}`);
    if (!s.ok && s.status >= 500) throw new Error(`subscription lookup failed: ${s.status}`);
    if (s.ok && idOf(s.data?.customer) === plan.customer) {
      const hit = await tryPm(idOf(s.data?.default_payment_method));
      if (hit) return hit;
    }
  }
  const c = await stripe('GET', `/v1/customers/${plan.customer}`);
  if (!c.ok) {
    if (c.status >= 500) throw new Error(`customer lookup failed: ${c.status}`);
    return null; // 404 resource_missing: the customer lives in another Stripe account
  }
  if (c.data?.deleted === true) return null;
  const def = await tryPm(idOf(c.data?.invoice_settings?.default_payment_method));
  if (def) return def;
  const list = await stripe('GET', `/v1/payment_methods?customer=${plan.customer}&type=card&limit=10`);
  if (!list.ok) {
    if (list.status >= 500) throw new Error(`payment methods lookup failed: ${list.status}`);
    return null;
  }
  for (const pm of list.data?.data ?? []) {
    const info = typeof pm?.id === 'string' && PM.test(pm.id) ? cardUsable(pm, plan.customer, now) : null;
    if (info) return { ...info, id: pm.id };
  }
  return null;
}

/** { siteId } → the card a one-click buy would charge (or none), for the confirm sheet. Owner of a web site only. */
export async function oneClickCard(body: any, authorization: unknown, deps: OneClickDeps): Promise<WebResult> {
  if (typeof body?.siteId !== 'string' || !body.siteId.trim()) return { status: 400, body: { error: 'Missing or invalid fields: siteId' } };
  const auth = await deps.authorize(body.siteId, authorization);
  if (!auth.ok || !auth.target) return { status: auth.status || 403, body: { error: auth.error || 'not-authorized' } };
  if (auth.actor === 'app-owner') return { status: 403, body: { error: 'app-site' } };
  if (auth.actor !== 'web-user' || !auth.userId) return { status: 403, body: { error: 'owner-only' } };
  if (!deps.enabled || (!deps.priceId && !deps.productId)) return { status: 200, body: { oneClick: false, card: null } };
  try {
    const plan = await deps.planOf(auth.userId);
    const card = plan ? await cardOnFile(plan, deps.stripe, deps.flow.now()) : null;
    return { status: 200, body: { oneClick: !!card, card: card ? { brand: card.brand, last4: card.last4, expMonth: card.expMonth, expYear: card.expYear } : null } };
  } catch (e: any) {
    console.error('[web-domain/card] lookup failed:', e?.message || e); // no card details in logs
    return { status: 503, body: { error: 'Try again shortly' } };
  }
}

/** Stripe's error → a SAFE reason code for the client (never Stripe's message). */
function failReason(data: any): 'authentication' | 'declined' | 'no-card' | 'unavailable' {
  const err = data?.error || {};
  const code = String(err.code || '');
  if (/requires_action|authentication/.test(code) || err.payment_intent?.status === 'requires_action') return 'authentication';
  if (code === 'resource_missing') return 'no-card';
  if (err.type === 'card_error') return 'declined';
  return 'unavailable';
}

/** The subscription's form: signed metadata, server price, the saved card, no client field but the domain. */
export function oneClickForm(args: {
  customer: string; paymentMethod: string; domain: string; slug: string; secret: string; priceId?: string; productId?: string;
}): Record<string, string> {
  const f: Record<string, string> = {
    customer: args.customer,
    default_payment_method: args.paymentMethod,
    collection_method: 'charge_automatically',
    payment_behavior: 'error_if_incomplete',
    off_session: 'true',
    description: `Custom domain - ${args.domain}`,
    'metadata[type]': 'domain_purchase',
    'metadata[app]': DOMAIN_SESSION_APP,
    'metadata[domain]': args.domain,
    'metadata[siteId]': args.slug,
    'metadata[sig]': domainSig(args.secret, args.domain, args.slug),
    'metadata[oneclick]': '1', // reporting only (the Purchase event); never trusted for anything else
    'expand[0]': 'latest_invoice',
  };
  if (args.priceId) {
    f['items[0][price]'] = args.priceId;
  } else {
    f['items[0][price_data][currency]'] = 'usd';
    f['items[0][price_data][unit_amount]'] = String(WEB_DOMAIN_PRICE_CENTS);
    f['items[0][price_data][recurring][interval]'] = 'year';
    f['items[0][price_data][product]'] = args.productId || '';
  }
  f['items[0][quantity]'] = '1';
  return f;
}

/**
 * { domain, siteId } → buy the domain on the plan's saved card. Owner of a web site only.
 * 200/202 the domain status · 402 { fallback: true, error: no-card | card-failed | one-click-off,
 * reason? } (nothing was charged: the client offers hosted Checkout) · 409 refused / refunded ·
 * 503 try again (a subscription created meanwhile is claimed by the next call or the webhook).
 */
export async function oneClickDomainPurchase(body: any, authorization: unknown, deps: OneClickDeps): Promise<WebResult> {
  const domain = typeof body?.domain === 'string' ? body.domain.trim().toLowerCase() : '';
  if (!isComDomain(domain) || typeof body?.siteId !== 'string' || !body.siteId.trim()) {
    return { status: 400, body: { error: 'Missing or invalid fields: domain (.com), siteId' } };
  }
  if (!deps.enabled || (!deps.priceId && !deps.productId)) return fallback('one-click-off');
  const missing = missingDomainConfig({ vercel: deps.flow.vercel, contact: deps.flow.contact, secret: deps.secret }, true);
  if (missing.length) {
    const r = domainsNotConfigured(missing);
    return { status: r.status, body: r.body as Record<string, unknown> };
  }
  const auth = await deps.authorize(body.siteId, authorization);
  if (!auth.ok || !auth.target) return { status: auth.status || 403, body: { error: auth.error || 'not-authorized' } };
  // An iOS site buys in the app; the admin does not spend their own card on a customer's site.
  if (auth.actor === 'app-owner') return { status: 403, body: { error: 'app-site' } };
  if (auth.actor !== 'web-user' || !auth.userId) return { status: 403, body: { error: 'owner-only' } };
  const slug = auth.target;

  const refusal = await domainSaleRefusal(deps.flow, slug, domain);
  if (refusal) return refusal;

  const claimDeps: Pick<WebDomainDeps, 'flow' | 'cancelAndRefund' | 'notifySupport'> = {
    flow: deps.flow, cancelAndRefund: deps.cancelAndRefund, notifySupport: deps.notifySupport,
  };

  let plan: WebPlan | null;
  let card: (CardInfo & { id: string }) | null;
  try {
    plan = await deps.planOf(auth.userId);
    card = plan ? await cardOnFile(plan, deps.stripe, deps.flow.now()) : null;
  } catch (e: any) {
    console.error('[web-domain/buy] card lookup failed:', e?.message || e);
    return { status: 503, body: { error: 'Try again shortly' } };
  }
  if (!plan || !card) return fallback('no-card');

  // A paid, verified domain subscription of THIS site that never got its row (the process died
  // after Stripe took the money, the webhook is late): claim it instead of charging twice.
  try {
    const list = await deps.stripe('GET', `/v1/subscriptions?customer=${plan.customer}&status=active&limit=100`);
    if (!list.ok) throw new Error(`subscription list failed: ${list.status}`);
    for (const s of list.data?.data ?? []) {
      const v = verifyDomainSubscription(s, deps.secret, deps.priceId);
      if (!v || v.slug !== slug) continue;
      if (await deps.flow.repo.get(`stripe:${v.subscriptionId}`)) continue; // already has its row
      return claimDomainSubscription(s, v, isTestMode(s) && !(deps.testRealSubs?.has(v.subscriptionId) ?? false), claimDeps);
    }
  } catch (e: any) {
    console.error('[web-domain/buy] existing subscription check failed:', e?.message || e);
    return { status: 503, body: { error: 'Try again shortly' } };
  }

  // The charge. Same key for a double click; a new window (10 min) or another card is a new attempt.
  const form = oneClickForm({ customer: plan.customer, paymentMethod: card.id, domain, slug, secret: deps.secret, priceId: deps.priceId, productId: deps.productId });
  const idem = `domain-oneclick:${slug}:${domain}:${card.id}:${Math.floor(deps.flow.now() / WINDOW_MS)}`;
  let created: { ok: boolean; status: number; data: any } | null = null;
  for (let attempt = 0; attempt < 2 && !created; attempt++) {
    try {
      const r = await deps.stripe('POST', '/v1/subscriptions', { form, idem });
      if (r.ok || r.status < 500) created = r;
    } catch { /* timeout / network: ask again under the same key (Stripe replays the first outcome) */ }
  }
  if (!created) {
    console.error('[web-domain/buy] subscription create outcome unknown; the webhook or the next call claims it');
    return { status: 503, body: { error: 'Try again shortly', message: 'We could not confirm the payment yet. You will not be charged twice; try again in a minute.' } };
  }
  if (!created.ok) {
    const reason = failReason(created.data);
    console.error(`[web-domain/buy] charge not made: ${created.status} ${created.data?.error?.code || created.data?.error?.type || ''}`);
    return reason === 'no-card' ? fallback('no-card') : fallback('card-failed', reason);
  }

  const sub = created.data;
  const invoice = sub?.latest_invoice;
  const paid = sub?.status === 'active' && typeof invoice === 'object' && invoice?.status === 'paid';
  if (!paid) {
    // Should not happen with error_if_incomplete. Never leave it: refund if anything was paid, else cancel.
    await dropUnpaid(sub, invoice, deps);
    return fallback('card-failed', 'unavailable');
  }
  const v = verifyDomainSubscription(sub, deps.secret, deps.priceId);
  if (!v || v.slug !== slug || v.domain !== domain) {
    // Paid but not a valid domain subscription (a wrong STRIPE_DOMAIN_PRICE_ID): refund it, tell support.
    return refundUnverifiable(sub, domain, slug, deps);
  }
  return claimDomainSubscription(sub, v, isTestMode(sub) && !(deps.testRealSubs?.has(v.subscriptionId) ?? false), claimDeps);
}

async function dropUnpaid(sub: any, invoice: any, deps: OneClickDeps): Promise<void> {
  const id = typeof sub?.id === 'string' ? sub.id : null;
  if (!id) return;
  try {
    if (typeof invoice === 'object' && invoice?.status === 'paid') await deps.cancelAndRefund(id);
    else await deps.stripe('DELETE', `/v1/subscriptions/${id}`, { idem: `domain-cancel-${id}` });
  } catch (e: any) {
    console.error(`[web-domain/buy] ALERT could not clean up subscription ${id}:`, e?.message || e);
    await Promise.resolve(deps.notifySupport?.('Domain one-click: cleanup failed',
      `A one-click domain subscription did not complete and could not be cancelled/refunded automatically.\n\nSubscription: ${id}\nAmount: $39.00`)).catch(() => {});
  }
}

async function refundUnverifiable(sub: any, domain: string, slug: string, deps: OneClickDeps): Promise<WebResult> {
  const id = typeof sub?.id === 'string' ? sub.id : '';
  try {
    await deps.cancelAndRefund(id);
  } catch (e: any) {
    console.error(`[web-domain/buy] ALERT refund of unverifiable one-click subscription ${id} failed:`, e?.message || e);
    await Promise.resolve(deps.notifySupport?.('Domain one-click: refund needed',
      `A one-click domain subscription was paid but failed verification and the automatic refund failed. Refund it by hand.\n\nDomain: ${domain}\nSite: ${slug}\nSubscription: ${id}\nAmount: $39.00`)).catch(() => {});
    return { status: 503, body: { error: 'Try again shortly' } };
  }
  console.error(`[web-domain/buy] REFUNDED ${id}: one-click subscription failed signature / price verification`);
  await Promise.resolve(deps.notifySupport?.('Domain one-click refunded: could not be verified',
    `A one-click domain subscription failed verification (check STRIPE_DOMAIN_PRICE_ID / DOMAIN_CHECKOUT_SECRET). It was cancelled and refunded in full.\n\nDomain: ${domain}\nSite: ${slug}\nSubscription: ${id}\nAmount refunded: $39.00`)).catch(() => {});
  return { status: 409, body: { error: 'domain-unavailable', refunded: true, domain, message: `We could not set up ${domain}. Your $39 has been refunded in full and the subscription cancelled.` } };
}
