// The website's custom domain: a $39/year Stripe SUBSCRIPTION (owner decision 2026-10-22), run
// through the SAME state machine as the app's (lib/ios/domainFlow.ts), keyed `stripe:<sub id>`:
// bought with Vercel auto-renew OFF, auto-renew on only while the Stripe subscription is active
// and set to renew, cancel → auto-renew off and the domain works until the paid period ends,
// then detach; resubscribe before the registration runs out → re-attach.
//
//   api/create-domain-checkout  owner only → Stripe Checkout (mode=subscription, server price)
//   api/purchase-domain         owner of the session's own site → claim the slot (idempotent)
//   api/stripe-webhook          checkout.session.completed / customer.subscription.* / invoice.paid
//                               for a domain subscription → reserve / refresh (handleDomainStripeEvent)
//
// Trust: the domain, the site and the price are fixed server-side at checkout and SIGNED
// (HMAC, DOMAIN_CHECKOUT_SECRET) into the session's and the subscription's metadata, so nothing
// a client can put into Stripe metadata (api/create-checkout-session copies cookie keys) can make
// a site subscription look like a domain purchase. Every path also checks the subscription is
// exactly one item at the domain price ($39.00 USD, yearly, or STRIPE_DOMAIN_PRICE_ID).
//
// Single use: one subscription is one slot (the row's primary key), so replaying a session never
// buys twice; it resumes or returns the stored status.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DeployAuthResult } from './deployAuth.js';
import { isComDomain } from './ios/domainNames.js';
import {
  advanceSlot, applyPayerEvent, claimSlot, precheckDomain, reserveSlot, statusBody,
  type DomainFlowDeps, type PayerStatus,
} from './ios/domainFlow.js';

export const WEB_DOMAIN_PRICE_CENTS = 3900;
export const DOMAIN_SESSION_APP = 'aibarber-domain';
const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9_]{8,200}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

/** lib/deployAuth.ts authorizeSiteOwner bound to its live deps. */
export type AuthorizeOwner = (siteId: unknown, authorization: unknown) => Promise<DeployAuthResult>;

export interface WebResult { status: number; body: Record<string, unknown> }

function denied(a: DeployAuthResult): WebResult {
  return { status: a.status || 403, body: { error: a.error || 'not-authorized' } };
}

// ─── signed metadata ───

export function domainSig(secret: string, domain: string, slug: string): string {
  return createHmac('sha256', secret).update(`v1|domain_purchase|${domain}|${slug}`).digest('hex');
}

/** The signed domain-purchase metadata, or null when it isn't one (or the signature is wrong). */
export function readDomainMetadata(md: any, secret: string): { domain: string; slug: string } | null {
  if (!md || md.type !== 'domain_purchase' || md.app !== DOMAIN_SESSION_APP) return null;
  const domain = typeof md.domain === 'string' ? md.domain : '';
  const slug = typeof md.siteId === 'string' ? md.siteId : '';
  const sig = typeof md.sig === 'string' ? md.sig : '';
  if (!isComDomain(domain) || !SLUG.test(slug) || !/^[0-9a-f]{64}$/.test(sig) || !secret) return null;
  const want = Buffer.from(domainSig(secret, domain, slug), 'hex');
  const got = Buffer.from(sig, 'hex');
  return want.length === got.length && timingSafeEqual(want, got) ? { domain, slug } : null;
}

/** Exactly one item at the domain price: $39.00 USD yearly (or the configured price id). */
export function isDomainPriceSubscription(sub: any, priceId?: string): boolean {
  const items = sub?.items?.data;
  if (!Array.isArray(items) || items.length !== 1) return false;
  const it = items[0];
  const price = it?.price;
  if ((it?.quantity ?? 1) !== 1 || !price) return false;
  if (priceId) return price.id === priceId;
  return price.currency === 'usd' && price.unit_amount === WEB_DOMAIN_PRICE_CENTS && price.recurring?.interval === 'year'
    && (price.recurring?.interval_count ?? 1) === 1;
}

/** A verified domain subscription: signed metadata + the domain price. */
export function verifyDomainSubscription(sub: any, secret: string, priceId?: string): { domain: string; slug: string; subscriptionId: string } | null {
  if (!sub || typeof sub.id !== 'string' || !sub.id.startsWith('sub_')) return null;
  const md = readDomainMetadata(sub.metadata, secret);
  if (!md || !isDomainPriceSubscription(sub, priceId)) return null;
  return { ...md, subscriptionId: sub.id };
}

/** The Stripe subscription's CURRENT state as the domain state machine's payer status. */
export function stripePayerStatus(sub: any, now: number): PayerStatus {
  const status = String(sub?.status || '');
  const periodEnd = Number(sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end);
  const active = status === 'active' || status === 'trialing';
  const ended = Number(sub?.ended_at);
  const cancelling = sub?.cancel_at_period_end === true || sub?.cancel_at != null;
  return {
    active,
    autoRenew: active && !cancelling,
    expiresAt: active && Number.isFinite(periodEnd) ? periodEnd * 1000 : null,
    // Cancelled before its period ended (an immediate cancel or a refund): the period is void.
    revoked: status === 'canceled' && Number.isFinite(ended) && Number.isFinite(periodEnd) && ended < periodEnd - 3600,
  };
}

// ─── create-domain-checkout ───

export interface CheckoutDeps {
  authorize: AuthorizeOwner;
  flow: Pick<DomainFlowDeps, 'vercel' | 'repo'>;
  secret: string;
  /** Optional configured Stripe price (env STRIPE_DOMAIN_PRICE_ID); else price_data $39/year. */
  priceId?: string;
  /** POST https://api.stripe.com/v1/checkout/sessions (form params) → the session JSON. */
  createStripeSession(params: URLSearchParams): Promise<{ ok: boolean; status: number; data: any }>;
}

/** { domain, siteId } → { url } of a $39/year Stripe subscription Checkout. Site owner only. */
export async function createDomainCheckout(body: any, origin: string, authorization: unknown, deps: CheckoutDeps): Promise<WebResult> {
  const domain = typeof body?.domain === 'string' ? body.domain.trim().toLowerCase() : '';
  if (!isComDomain(domain) || typeof body?.siteId !== 'string' || !body.siteId.trim()) {
    return { status: 400, body: { error: 'Missing or invalid fields: domain (.com), siteId' } };
  }
  if (!deps.secret) return { status: 500, body: { error: 'Server configuration error' } };
  const auth = await deps.authorize(body.siteId, authorization);
  if (!auth.ok || !auth.target) return denied(auth);
  const slug = auth.target;
  if (!deps.flow.vercel) return { status: 500, body: { error: 'Server configuration error: missing VERCEL_TOKEN' } };

  try {
    if (await deps.flow.repo.holdingSite(slug)) return { status: 409, body: { error: 'This site already has a custom domain' } };
    const pre = await precheckDomain(deps.flow, domain);
    if (pre === 'domain-taken') return { status: 409, body: { error: 'Domain is not available' } };
    if (pre) return { status: 409, body: { error: 'Domain is not available at a standard price' } };
  } catch (e: any) {
    console.error('[CreateDomainCheckout] lookup failed:', e?.code || e?.message || e);
    return { status: 503, body: { error: 'Could not check the domain right now' } };
  }

  const sig = domainSig(deps.secret, domain, slug);
  const params = new URLSearchParams();
  params.append('mode', 'subscription');
  params.append('success_url', `${origin}?domain_payment=success&session_id={CHECKOUT_SESSION_ID}`);
  params.append('cancel_url', `${origin}?domain_payment=cancelled`);
  if (deps.priceId) {
    params.append('line_items[0][price]', deps.priceId);
  } else {
    params.append('line_items[0][price_data][currency]', 'usd');
    params.append('line_items[0][price_data][unit_amount]', String(WEB_DOMAIN_PRICE_CENTS));
    params.append('line_items[0][price_data][recurring][interval]', 'year');
    params.append('line_items[0][price_data][product_data][name]', `Custom domain - ${domain}`);
  }
  params.append('line_items[0][quantity]', '1');
  for (const prefix of ['metadata', 'subscription_data[metadata]']) {
    params.append(`${prefix}[type]`, 'domain_purchase');
    // Not 'aibarber': a domain checkout must never count as a site checkout (deploy proof, pixels, publish).
    params.append(`${prefix}[app]`, DOMAIN_SESSION_APP);
    params.append(`${prefix}[domain]`, domain);
    params.append(`${prefix}[siteId]`, slug);
    params.append(`${prefix}[sig]`, sig);
  }

  const r = await deps.createStripeSession(params);
  if (!r.ok) {
    console.error('[CreateDomainCheckout] Stripe error:', r.status, r.data?.error?.type || '');
    return { status: 400, body: { error: 'Failed to create checkout session' } };
  }
  return { status: 200, body: { url: r.data?.url } };
}

// ─── purchase-domain (the browser's return from Checkout) ───

export interface WebDomainDeps {
  authorize: AuthorizeOwner;
  getStripeSession(sessionId: string): Promise<{ ok: boolean; status: number; data: any }>;
  /** GET /v1/subscriptions/{id}; null when Stripe doesn't know it. Throws on an outage. */
  getSubscription(id: string): Promise<any | null>;
  flow: DomainFlowDeps;
  secret: string;
  priceId?: string;
  /** STRIPE_SECRET_KEY is a test key: the lifecycle is simulated, nothing is bought. */
  testMode: boolean;
}

const badSession: WebResult = { status: 400, body: { error: 'Invalid checkout session' } };

/**
 * { sessionId, domain? } + the site owner's bearer → the domain status (200 live, 202 in
 * progress, 409 failed). Idempotent: one subscription is one slot.
 */
export async function purchaseDomain(body: any, authorization: unknown, deps: WebDomainDeps): Promise<WebResult> {
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!SESSION_ID.test(sessionId)) return badSession;
  const s = await deps.getStripeSession(sessionId);
  if (!s.ok || !s.data) return badSession;
  const session = s.data;

  // Ownership FIRST: nothing about the session (paid? domain?) is revealed to anyone else.
  const auth = await deps.authorize(session.metadata?.siteId, authorization);
  if (!auth.ok) return denied(auth);

  const md = readDomainMetadata(session.metadata, deps.secret);
  const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  if (
    !md || session.mode !== 'subscription' || session.status !== 'complete' || session.payment_status !== 'paid'
    || session.currency !== 'usd' || session.amount_total !== WEB_DOMAIN_PRICE_CENTS || typeof subId !== 'string'
  ) return { status: 400, body: { error: 'Not a paid domain purchase' } };
  if (auth.target !== md.slug) return { status: 403, body: { error: 'not-authorized' } };
  if (body?.domain != null && String(body.domain).trim().toLowerCase() !== md.domain) return { status: 400, body: { error: 'Session is not for this domain' } };

  let sub: any;
  try {
    sub = await deps.getSubscription(subId);
  } catch (e: any) {
    console.error('[PurchaseDomain] subscription lookup failed:', e?.message || e);
    return { status: 503, body: { error: 'Try again shortly' } };
  }
  const v = verifyDomainSubscription(sub, deps.secret, deps.priceId);
  if (!v || v.slug !== md.slug || v.domain !== md.domain) return { status: 400, body: { error: 'Not a paid domain purchase' } };
  const payer = stripePayerStatus(sub, deps.flow.now());
  if (!payer.active) return { status: 402, body: { error: 'subscription-inactive' } };
  if (!deps.testMode && (!deps.flow.vercel || !deps.flow.contact)) return { status: 503, body: { error: 'domains-unavailable' } };

  const r = await claimSlot({
    key: `stripe:${v.subscriptionId}`, source: 'stripe', environment: 'Production', simulated: deps.testMode,
    slug: v.slug, domain: v.domain, payer,
  }, deps.flow);
  return { status: r.status, body: r.body as Record<string, unknown> };
}

// ─── Stripe webhook ───

export interface DomainEventResult {
  /** Not a domain event: the caller handles it as before. */
  handled: boolean;
  status?: number;
  body?: Record<string, unknown>;
  /** Long work (the purchase) to run after answering Stripe (waitUntil). */
  background?: () => Promise<unknown>;
}

const SUB_EVENTS = new Set(['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid']);

/**
 * Domain subscriptions in the Stripe webhook. A paid checkout reserves the slot (so a closed
 * tab still gets its domain) and the purchase runs in the background; subscription and invoice
 * events re-read the subscription and apply its CURRENT state (never the event's payload).
 * Errors answer 500 so Stripe retries.
 */
export async function handleDomainStripeEvent(
  event: any,
  getDeps: () => Omit<WebDomainDeps, 'authorize' | 'getStripeSession'>,
): Promise<DomainEventResult> {
  // Recognised from the event's own metadata only (no lookups), so every other event is untouched.
  // Domain subscriptions always carry type=domain_purchase (subscription_data[metadata]); the
  // signature and the price are checked below on the subscription re-read from Stripe.
  const obj = event?.data?.object || {};
  let subId: string | null = null;
  if (event?.type === 'checkout.session.completed') {
    if (obj.metadata?.type !== 'domain_purchase' && obj.metadata?.app !== DOMAIN_SESSION_APP) return { handled: false };
    subId = typeof obj.subscription === 'string' ? obj.subscription : obj.subscription?.id ?? null;
  } else if (event?.type === 'invoice.paid') {
    const details = obj.subscription_details ?? obj.parent?.subscription_details;
    if (details?.metadata?.type !== 'domain_purchase') return { handled: false };
    subId = typeof obj.subscription === 'string' ? obj.subscription : details?.subscription ?? null;
  } else if (SUB_EVENTS.has(event?.type)) {
    if (obj.metadata?.type !== 'domain_purchase') return { handled: false };
    subId = typeof obj.id === 'string' ? obj.id : null;
  } else {
    return { handled: false };
  }
  if (!subId) return { handled: true, status: 200, body: { received: true, ignored: 'no-subscription' } };

  try {
    const deps = getDeps();
    const sub = await deps.getSubscription(subId);
    const v = verifyDomainSubscription(sub, deps.secret, deps.priceId);
    if (!v) {
      console.error(`[Stripe Webhook] ${event.type} ${subId}: not a valid domain subscription (signature / price); ignored`);
      return { handled: true, status: 200, body: { received: true, ignored: 'not-a-domain-subscription' } };
    }
    const key = `stripe:${subId}`;
    const payer = stripePayerStatus(sub, deps.flow.now());
    const existing = await deps.flow.repo.get(key);
    if (existing) {
      await applyPayerEvent(key, event.type, { ...deps.flow, payer: async () => payer });
      return { handled: true, status: 200, body: { received: true, domain: true } };
    }
    if (!payer.active) return { handled: true, status: 200, body: { received: true, ignored: 'subscription-inactive' } };
    const c = { key, source: 'stripe' as const, environment: 'Production' as const, simulated: deps.testMode, slug: v.slug, domain: v.domain, payer };
    const reserved = await reserveSlot(c, deps.flow);
    if (reserved.result) {
      // e.g. the name was taken between checkout and payment: nothing is bought; support refunds.
      console.error(`[Stripe Webhook] domain ${v.domain} for ${v.slug} (${subId}) not reserved:`, JSON.stringify(reserved.result.body));
      return { handled: true, status: 200, body: { received: true, domain: false, refused: (reserved.result.body as any)?.error } };
    }
    return {
      handled: true, status: 200, body: { received: true, domain: true },
      background: () => advanceSlot(key, payer, deps.flow),
    };
  } catch (e: any) {
    console.error(`[Stripe Webhook] domain event ${event.type} ${subId} failed:`, e?.message || e);
    return { handled: true, status: 500, body: { error: 'temporarily-unavailable' } };
  }
}

/** For admin / support: the status body of a web domain by subscription id. */
export async function webDomainStatus(subId: string, deps: Pick<DomainFlowDeps, 'repo'>) {
  return statusBody(await deps.repo.get(`stripe:${subId}`));
}
