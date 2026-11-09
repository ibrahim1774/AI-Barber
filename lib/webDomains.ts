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
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DeployAuthResult } from './deployAuth.js';
import { isComDomain } from './ios/domainNames.js';
import { newCheckoutMethodParams } from './checkoutPaymentMethods.js';
import { claimManualDomain, webStatusBody, webStatusWithProbe, fulfilManually, manualClaim, type ManualDeps } from './webApp/domainManual.js';
import {
  WEB_REFUND_REASONS, advanceSlot, alertOnce, applyPayerEvent, domainsNotConfigured, missingDomainConfig, ownDetached,
  precheckDomain, refundWebRow, reserveSlot,
  type DomainFlowDeps, type PayerStatus,
} from './ios/domainFlow.js';

export const WEB_DOMAIN_PRICE_CENTS = 3900;
export const DOMAIN_SESSION_APP = 'aibarber-domain';
/** lib/pixelMeta.ts plan slug of the domain sale (Meta Purchase content, Triple Whale). */
export const DOMAIN_PURCHASE_PLAN = 'domain-yearly';
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
  // Only 'active' is paid: we offer no trial, and a trialing subscription must never buy a domain.
  const active = status === 'active';
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
  flow: Pick<DomainFlowDeps, 'vercel' | 'contact' | 'repo'>;
  secret: string;
  /** Optional configured Stripe price (env STRIPE_DOMAIN_PRICE_ID); else price_data $39/year. */
  priceId?: string;
  /** POST https://api.stripe.com/v1/checkout/sessions (form params) → the session JSON. */
  createStripeSession(params: URLSearchParams): Promise<{ ok: boolean; status: number; data: any }>;
  /** B1: the slug is a web-app site (a web_app_sites row). Such sites always get a manual order. Throws on an outage (= manual). */
  isWebAppSite?(slug: string): Promise<boolean>;
}

/**
 * The site-and-name checks both purchase routes share (hosted Checkout and one-click), run BEFORE
 * any Stripe write: the site must not already hold a domain, the name must be available (or be
 * this site's own detached name) at a standard price. null = fine to sell.
 */
export async function domainSaleRefusal(flow: Pick<DomainFlowDeps, 'vercel' | 'repo'>, slug: string, domain: string): Promise<WebResult | null> {
  try {
    if (await flow.repo.holdingSite(slug)) return { status: 409, body: { error: 'This site already has a custom domain' } };
    const pre = await precheckDomain(flow, domain);
    // The same site may buy back its OWN detached name (still registered to us).
    if (pre === 'domain-taken' && !(await ownDetached(flow, slug, domain))) return { status: 409, body: { error: 'Domain is not available' } };
    if (pre && pre !== 'domain-taken') return { status: 409, body: { error: 'Domain is not available at a standard price' } };
  } catch (e: any) {
    console.error('[CreateDomainCheckout] lookup failed:', e?.code || e?.message || e);
    return { status: 503, body: { error: 'Could not check the domain right now' } };
  }
  return null;
}

export interface WebCheckoutOptions {
  /** The web app's own return page base (WEB_APP_ORIGIN); set = the request asked for the web app's flow (`app: 'web'`). */
  returnBase?: string;
  /** The plan's Stripe customer, so the domain subscription lands next to the plan. Web app only. */
  customerOf?(userId: string): Promise<string | null>;
}

/**
 * { domain, siteId } → { url } of a $39/year Stripe subscription Checkout. Site owner only.
 * `web` (api/web-app/domain, or api/create-domain-checkout for `app: 'web'`): return to the web
 * app's /app/domain page and reuse the plan's customer. Without it the form is exactly the old
 * site's (the legacy dashboard keeps `${origin}?domain_payment=...`).
 */
export async function createDomainCheckout(body: any, origin: string, authorization: unknown, deps: CheckoutDeps, web?: WebCheckoutOptions): Promise<WebResult> {
  const domain = typeof body?.domain === 'string' ? body.domain.trim().toLowerCase() : '';
  if (!isComDomain(domain) || typeof body?.siteId !== 'string' || !body.siteId.trim()) {
    return { status: 400, body: { error: 'Missing or invalid fields: domain (.com), siteId' } };
  }
  // B2: fail closed BEFORE any money moves. Without the signing secret, the Vercel token or a
  // valid registrant contact a purchase could never complete, so no checkout is created.
  const missing = missingDomainConfig({ vercel: deps.flow.vercel, contact: deps.flow.contact, secret: deps.secret }, true);
  if (missing.length) {
    const r = domainsNotConfigured(missing);
    return { status: r.status, body: r.body as Record<string, unknown> };
  }
  const auth = await deps.authorize(body.siteId, authorization);
  if (!auth.ok || !auth.target) return denied(auth);
  const slug = auth.target;
  const webFlow = body?.app === 'web' && !!web?.returnBase;
  // An iOS site buys its domain in the app.
  if (webFlow && auth.actor === 'app-owner') return { status: 403, body: { error: 'app-site' } };

  const refusal = await domainSaleRefusal(deps.flow, slug, domain);
  if (refusal) return refusal;

  // B1: manual or automatic is decided by the SITE (a web_app_sites row), never by the request body: a web-app
  // account that omits `app: 'web'` still gets a manual order. A failed lookup counts as manual (fail closed).
  let manualOrder = webFlow;
  if (!manualOrder && deps.isWebAppSite) {
    try { manualOrder = await deps.isWebAppSite(slug); } catch { manualOrder = true; }
  }

  let customer: string | null = null;
  if (webFlow && web?.customerOf && auth.userId && auth.actor === 'web-user') {
    try { customer = await web.customerOf(auth.userId); } catch { customer = null; } // no customer: Checkout asks for the card
  }

  const sig = domainSig(deps.secret, domain, slug);
  const params = new URLSearchParams();
  params.append('mode', 'subscription');
  if (webFlow) {
    params.append('success_url', `${web!.returnBase}/app/domain?domain_payment=success&session_id={CHECKOUT_SESSION_ID}`);
    params.append('cancel_url', `${web!.returnBase}/app/domain?domain_payment=cancelled`);
  } else {
    params.append('success_url', `${origin}?domain_payment=success&session_id={CHECKOUT_SESSION_ID}`);
    params.append('cancel_url', `${origin}?domain_payment=cancelled`);
  }
  if (deps.priceId) {
    params.append('line_items[0][price]', deps.priceId);
  } else {
    params.append('line_items[0][price_data][currency]', 'usd');
    params.append('line_items[0][price_data][unit_amount]', String(WEB_DOMAIN_PRICE_CENTS));
    params.append('line_items[0][price_data][recurring][interval]', 'year');
    params.append('line_items[0][price_data][product_data][name]', `Custom domain - ${domain}`);
  }
  params.append('line_items[0][quantity]', '1');
  for (const [k, v] of Object.entries(newCheckoutMethodParams())) params.append(k, v);
  for (const prefix of ['metadata', 'subscription_data[metadata]']) {
    params.append(`${prefix}[type]`, 'domain_purchase');
    // Not 'aibarber': a domain checkout must never count as a site checkout (deploy proof, pixels, publish).
    params.append(`${prefix}[app]`, DOMAIN_SESSION_APP);
    params.append(`${prefix}[domain]`, domain);
    params.append(`${prefix}[siteId]`, slug);
    params.append(`${prefix}[sig]`, sig);
    // The web app's orders are set up by hand (lib/webApp/domainManual.ts); the legacy dashboard's stay automatic.
    if (manualOrder) params.append(`${prefix}[fulfil]`, 'manual');
  }

  if (customer) params.append('customer', customer);
  let r = await deps.createStripeSession(params);
  if (!r.ok && customer && r.data?.error?.code === 'resource_missing') {
    // The plan's customer is not known to this Stripe account: Checkout without it (asks for the card).
    params.delete('customer');
    r = await deps.createStripeSession(params);
  }
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
  /**
   * Cancel the subscription now and refund its payment in full (idempotent: Stripe idempotency
   * keys per subscription). A paid slot refused before anything was bought (N2).
   */
  cancelAndRefund(subscriptionId: string): Promise<void>;
  /** Email support@davoxa.com (domain, site, amount only). Best effort. */
  notifySupport?(subject: string, text: string): Promise<void>;
  /**
   * Staging only (env DOMAINS_TEST_REAL_SITES, honoured only with DOMAINS_BUY_DISABLED=1 off production):
   * test-mode subscription ids that run the real attach/link path instead of the simulation.
   */
  testRealSites?: ReadonlySet<string>;
  /**
   * Manual fulfilment of web-app domain orders (lib/webApp/domainManual.ts): subscriptions asking for it
   * (metadata fulfil=manual) are parked in `awaiting_setup`; the system never buys them. Without it such a
   * subscription is refused (fail closed), never bought automatically.
   */
  manual?: ManualDeps;
}

/** Stripe test mode, from Stripe's own livemode flag (never the key prefix). */
export const isTestMode = (...objs: any[]) => objs.some((o) => o && o.livemode === false);

/** A test-mode subscription is simulated (Vercel never called) unless it is on the staging list. */
const simulatedSub = (slug: string, deps: Pick<WebDomainDeps, 'testRealSites'>, ...objs: any[]) =>
  isTestMode(...objs) && !(deps.testRealSites?.has(slug) ?? false);

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
  return claimDomainSubscription(sub, v, simulatedSub(v.slug, deps, session, sub), deps);
}

/**
 * A verified, paid domain subscription → its slot (reserve, then advance): the claim every route
 * shares (Checkout return, one-click). Refusals after payment are refunded, never left paid
 * without a domain. 200 live, 202 in progress, 409 failed / refunded, 503 try again.
 */
export async function claimDomainSubscription(
  sub: any,
  v: { domain: string; slug: string; subscriptionId: string },
  simulated: boolean,
  deps: Pick<WebDomainDeps, 'flow' | 'cancelAndRefund' | 'notifySupport' | 'manual'>,
): Promise<WebResult> {
  // The web app's orders are fulfilled by hand: park them, never buy. (The legacy dashboard keeps its automatic purchase.)
  if (await fulfilManually(sub, v.slug, deps.manual)) {
    if (!deps.manual) return { status: 503, body: { error: 'domains-unavailable' } };
    return claimManualDomain(sub, v, simulated, { ...deps, manual: deps.manual });
  }
  const payer = stripePayerStatus(sub, deps.flow.now());
  if (!payer.active) return { status: 402, body: { error: 'subscription-inactive' } };
  if (!simulated && (!deps.flow.vercel || !deps.flow.contact)) return { status: 503, body: { error: 'domains-unavailable' } };
  const existing = await deps.flow.repo.get(`stripe:${v.subscriptionId}`);
  if (existing?.refunded_at) return refundedResult(existing.domain, existing.failure_reason);
  if (existing && existing.state === 'failed' && !existing.vercel_bought_at && REFUND_REASONS.has(existing.failure_reason || '')) {
    return (await finishRefund(existing, deps)) ? refundedResult(existing.domain, existing.failure_reason) : { status: 503, body: { error: 'Try again shortly' } };
  }

  const c = {
    key: `stripe:${v.subscriptionId}`, source: 'stripe' as const, environment: 'Production' as const, simulated,
    slug: v.slug, domain: v.domain, payer,
  };
  let reserved;
  try {
    reserved = await reserveSlot(c, deps.flow);
  } catch (e: any) {
    console.error('[PurchaseDomain] reserve failed:', e?.code || e?.message || e);
    return { status: 503, body: { error: 'Try again shortly' } };
  }
  if (reserved.result) {
    const refused = await recordRefusedPaidSlot(c, reserved.result, deps);
    if (refused.refunded) return refundedResult(c.domain);
    if (!refused.refundable) {
      return { status: 409, body: { error: refused.code, refunded: false, needsSupport: true, message: 'We could not set up this domain. Our team has been notified and will contact you; email support@davoxa.com with any questions.' } };
    }
    return { status: 503, body: { error: 'Try again shortly' } }; // the refund is retried
  }
  const r = await advanceSlot(c.key, payer, deps.flow);
  if (r.status === 409) {
    // The buy ended without a domain and the flow already refunded it (B1): say so.
    const row = await deps.flow.repo.get(c.key);
    if (row?.refunded_at) return refundedResult(c.domain, row.failure_reason);
  }
  return { status: r.status, body: r.body as Record<string, unknown> };
}

const REFUSAL_REASON: Record<string, string> = {
  'domain-taken': 'taken', 'domain-not-eligible': 'price', 'site-has-domain': 'site-has-domain',
};
const REFUND_REASONS = WEB_REFUND_REASONS;

export function refundedResult(domain: string, reason?: string | null): WebResult {
  const why = !reason || ['taken', 'price', 'refused', 'site-has-domain'].includes(reason)
    ? `${domain} was taken just before your payment went through.`
    : `We could not register ${domain}.`;
  return {
    status: 409,
    body: {
      error: 'domain-taken', refunded: true, domain,
      message: `${why} Your $39 has been refunded in full and the subscription cancelled; please pick another name.`,
    },
  };
}

/** Cancel + refund (idempotent at Stripe), then stamp the row. True once refunded. */
export function finishRefund(row: { original_transaction_id: string; domain: string; site_slug?: string; failure_reason?: string | null }, deps: Pick<WebDomainDeps, 'cancelAndRefund' | 'flow' | 'notifySupport'>): Promise<boolean> {
  return refundWebRow(row, {
    repo: deps.flow.repo, now: deps.flow.now, cancelAndRefund: deps.cancelAndRefund,
    notifySupport: deps.notifySupport ?? deps.flow.notifySupport,
  });
}

/**
 * A paid website subscription refused before anything was bought (the name was taken between
 * checkout and payment, or a second checkout for a site that already has a domain): persist it
 * as a FAILED row (admin-visible), then cancel the subscription and refund it in full.
 */
export async function recordRefusedPaidSlot(
  c: { key: string; slug: string; domain: string; simulated: boolean },
  result: { body: unknown },
  deps: Pick<WebDomainDeps, 'cancelAndRefund' | 'flow' | 'notifySupport'>,
): Promise<{ code: string; refunded: boolean; refundable: boolean }> {
  const code = String((result.body as any)?.error || 'refused');
  const reason = REFUSAL_REASON[code] || 'refused';
  await deps.flow.repo.insertFailed({
    original_transaction_id: c.key, source: 'stripe', environment: 'Production', site_slug: c.slug, domain: c.domain,
    simulated: c.simulated, auto_renew: false,
  }, reason);
  const row = await deps.flow.repo.get(c.key);
  if (row?.refunded_at) return { code, refunded: true, refundable: true };
  if (row && row.state !== 'failed') {
    // Not a refusal we can refund (the slot is in use, e.g. transferred): flag it, final answer.
    console.error(`[domains/web] ALERT ${c.key} (${c.domain}): refused (${code}) but the slot is ${row.state}; support must look`);
    await alertOnce(row, `needs-support:${code}`, `Domain needs support: ${c.domain}`,
      `A paid website domain checkout was refused (${code}) while its slot is ${row.state}. No automatic refund.\n\nDomain: ${c.domain}\nSite: ${c.slug}\nSubscription: ${c.key.replace(/^stripe:/, '')}\nAmount: $39.00`,
      { repo: deps.flow.repo, now: deps.flow.now, notifySupport: deps.notifySupport });
    return { code, refunded: false, refundable: false };
  }
  return { code, refunded: await finishRefund({ original_transaction_id: c.key, domain: c.domain, site_slug: c.slug, failure_reason: reason }, deps), refundable: true };
}

// ─── Stripe webhook ───

export interface DomainEventResult {
  /** Not a domain event: the caller handles it as before. */
  handled: boolean;
  status?: number;
  body?: Record<string, unknown>;
  /** Long work (the purchase) to run after answering Stripe (waitUntil). */
  background?: () => Promise<unknown>;
  /** A paid, verified domain checkout: report its Purchase like a site checkout. */
  purchase?: boolean;
  /** One-click sales have no Checkout session: the object to report instead (id = the subscription, amount, currency). */
  purchaseObject?: { id: string; amount_total: number; currency: string };
}

/** S5: a manual claim still failing this long after its Stripe event alerts support. */
export const STUCK_CLAIM_ALERT_MS = 6 * 3600_000;
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
    // Without the secret no new purchase can be verified: 500 so Stripe retries once it is set.
    if (!deps.secret) throw new Error('DOMAIN_CHECKOUT_SECRET is not set');
    const key = `stripe:${subId}`;
    const sub = await deps.getSubscription(subId);
    const existing = await deps.flow.repo.get(key);
    // A completed, paid checkout for a verified domain subscription is a sale (Meta dedupes on the session id).
    const purchase = event.type === 'checkout.session.completed' && obj.payment_status === 'paid'
      && (!!existing || !!verifyDomainSubscription(sub, deps.secret, deps.priceId));
    // A one-click sale (a server-created subscription, paid at creation) has no Checkout session:
    // its created event is the sale, reported once per subscription (the id is Meta's event id).
    const oneClickSale = event.type === 'customer.subscription.created' && sub?.metadata?.oneclick === '1' && sub?.status === 'active'
      && (!!existing || !!verifyDomainSubscription(sub, deps.secret, deps.priceId));
    const sale = oneClickSale ? { purchase: true, purchaseObject: { id: subId, amount_total: WEB_DOMAIN_PRICE_CENTS, currency: 'usd' } } : { purchase };
    if (existing) {
      // A refused paid slot whose refund did not go through yet: finish it.
      if (existing.state === 'failed' && !existing.refunded_at && !existing.vercel_bought_at && REFUND_REASONS.has(existing.failure_reason || '')) {
        const r = await finishRefund(existing, deps);
        return r ? { handled: true, status: 200, body: { received: true, domain: false, refunded: true } } : { handled: true, status: 500, body: { error: 'refund-pending' } };
      }
      // The row is the proof (it was created from a verified purchase): apply the subscription's
      // CURRENT state, whatever happened to the signing secret since.
      if (!sub) throw new Error('subscription not found at Stripe');
      const payer = stripePayerStatus(sub, deps.flow.now());
      await applyPayerEvent(key, event.type, { ...deps.flow, payer: async () => payer });
      return { handled: true, status: 200, body: { received: true, domain: true }, ...sale };
    }
    const v = verifyDomainSubscription(sub, deps.secret, deps.priceId);
    if (!v) {
      console.error(`[Stripe Webhook] ${event.type} ${subId}: not a valid domain subscription (signature / price); ignored`);
      // M2: a PAID domain checkout we cannot verify (a deployment with another DOMAIN_CHECKOUT_SECRET,
      // a rotated secret, a changed STRIPE_DOMAIN_PRICE_ID) will never get its domain and no row
      // exists to track it: refund it now and tell support, never a silent 200.
      if (sub && event.type === 'checkout.session.completed' && obj.payment_status === 'paid' && obj.metadata?.app === DOMAIN_SESSION_APP) {
        try {
          await deps.cancelAndRefund(subId);
        } catch (e: any) {
          console.error(`[domains/web] ALERT refund of unverifiable paid domain checkout ${subId} failed; Stripe retries:`, e?.message || e);
          return { handled: true, status: 500, body: { error: 'refund-pending' } };
        }
        console.error(`[domains/web] REFUNDED ${subId}: paid domain checkout failed signature / price verification`);
        const md = obj.metadata || {};
        await Promise.resolve(deps.notifySupport?.('Domain checkout refunded: could not be verified',
          `A paid $39.00 website domain checkout failed signature / price verification (DOMAIN_CHECKOUT_SECRET differs between deployments, was rotated, or STRIPE_DOMAIN_PRICE_ID changed). No domain was bought; the subscription was cancelled and refunded in full.\n\nDomain: ${typeof md.domain === 'string' ? md.domain.slice(0, 80) : '—'}\nSite: ${typeof md.siteId === 'string' ? md.siteId.slice(0, 80) : '—'}\nSubscription: ${subId}\nCheckout session: ${typeof obj.id === 'string' ? obj.id : '—'}\nAmount refunded: $39.00`))
          .catch((e: any) => console.error('[domains/web] support email failed:', e?.message || e));
        return { handled: true, status: 200, body: { received: true, ignored: 'not-a-domain-subscription', refunded: true } };
      }
      return { handled: true, status: 200, body: { received: true, ignored: 'not-a-domain-subscription' } };
    }
    const payer = stripePayerStatus(sub, deps.flow.now());
    if (!payer.active) return { handled: true, status: 200, body: { received: true, ignored: 'subscription-inactive' } };
    const c = { key, source: 'stripe' as const, environment: 'Production' as const, simulated: simulatedSub(v.slug, deps, obj, sub), slug: v.slug, domain: v.domain, payer };
    if (await fulfilManually(sub, v.slug, deps.manual)) {
      // Manual fulfilment: park the paid order, no purchase, no background work, no mail here (a fast 200;
      // the web sweep sends the order and customer emails within 10 minutes). Fail closed without the manual wiring.
      if (!deps.manual) throw new Error('manual domain fulfilment is not wired');
      const r = await manualClaim(sub, v, c.simulated, { ...deps, manual: deps.manual });
      if (r.kind === 'row') return { handled: true, status: 200, body: { received: true, domain: true }, ...sale };
      if (r.kind === 'refunded') return { handled: true, status: 200, body: { received: true, domain: false, refused: 'refunded', refunded: true }, purchase };
      if (r.kind === 'needs-support') return { handled: true, status: 200, body: { received: true, domain: false, refused: r.code, needsSupport: true }, purchase };
      if (r.kind === 'inactive') return { handled: true, status: 200, body: { received: true, ignored: 'subscription-inactive' } };
      // S5: a paid subscription that still cannot be claimed hours after the event (migration 030 not applied, a DB
      // outage, a missing registrar token) would silently run out of Stripe retries (~3 days): tell support, subject + id only.
      // Sent on the failing deliveries between 6 and 48 hours old (a few mails at most, never the customer's data).
      const ageMs = deps.flow.now() - Number(event.created) * 1000;
      if (Number.isFinite(ageMs) && ageMs >= STUCK_CLAIM_ALERT_MS && ageMs < 8 * STUCK_CLAIM_ALERT_MS) {
        await Promise.resolve(deps.notifySupport?.('Paid domain order cannot be claimed',
          `A paid $39.00 website domain order has not been claimed for over ${Math.round(STUCK_CLAIM_ALERT_MS / 3600_000)} hours (${r.kind}). Check that migration 030 is applied and the database and Vercel token are healthy; Stripe keeps retrying for about 3 days, after that the order has no row and no refund.\n\nSubscription: ${subId}`))
          .catch((e: any) => console.error('[domains/web] stuck-claim support email failed:', e?.message || e));
      }
      return { handled: true, status: 500, body: { error: r.kind === 'unavailable' ? 'domains-unavailable' : 'temporarily-unavailable' } };
    }
    const reserved = await reserveSlot(c, deps.flow);
    if (reserved.result) {
      const refused = await recordRefusedPaidSlot(c, reserved.result, deps);
      // 500 until the refund went through, so Stripe retries (the existing-row path finishes it).
      if (!refused.refunded && !refused.refundable) return { handled: true, status: 200, body: { received: true, domain: false, refused: refused.code, needsSupport: true }, purchase };
      if (!refused.refunded) return { handled: true, status: 500, body: { error: 'refund-pending' } };
      return { handled: true, status: 200, body: { received: true, domain: false, refused: refused.code, refunded: true }, purchase };
    }
    return {
      handled: true, status: 200, body: { received: true, domain: true }, ...sale,
      background: () => advanceSlot(key, payer, deps.flow),
    };
  } catch (e: any) {
    console.error(`[Stripe Webhook] domain event ${event.type} ${subId} failed:`, e?.message || e);
    return { handled: true, status: 500, body: { error: 'temporarily-unavailable' } };
  }
}

/** For admin / support: the status body of a web domain by subscription id. */
export async function webDomainStatus(subId: string, deps: Pick<DomainFlowDeps, 'repo'>) {
  return webStatusBody(await deps.repo.get(`stripe:${subId}`));
}

// ─── the website's domain panel (api/web-domain) ───

export interface PanelDeps {
  authorize: AuthorizeOwner;
  flow: Pick<DomainFlowDeps, 'repo'> & Partial<Pick<DomainFlowDeps, 'vercel' | 'probeHttps'>>;
  getSubscription(id: string): Promise<any | null>;
  /** POST /v1/billing_portal/sessions → { url }. */
  createPortalSession(customer: string, returnUrl: string, subscriptionId: string): Promise<{ ok: boolean; data: any }>;
  /** POST /v1/subscriptions/<id> cancel_at_period_end=<bool> (Idempotency-Key). Only the one domain subscription. */
  /** Does the owner of this site have an active hosting plan right now? Resume needs one. Absent = no (fail closed). */
  hasActivePlan?(siteSlug: string): Promise<boolean>;
  setRenewal?(subscriptionId: string, cancelAtPeriodEnd: boolean, idempotencyKey: string): Promise<{ ok: boolean; status: number; data: any }>;
}

/**
 * The form body for the domain portal session. flow_data subscription_cancel deep-links the
 * portal to cancelling THIS one subscription only (the domain renewal), so the customer cannot
 * reach the hosting plan's cancel or any plan switch from here. After cancelling (or backing
 * out) the customer returns to the domain screen.
 */
export function domainPortalForm(customer: string, returnUrl: string, subscriptionId: string): string {
  return new URLSearchParams({
    customer,
    return_url: returnUrl,
    'flow_data[type]': 'subscription_cancel',
    'flow_data[subscription_cancel][subscription]': subscriptionId,
    'flow_data[after_completion][type]': 'redirect',
    'flow_data[after_completion][redirect][return_url]': returnUrl,
  }).toString();
}

/** The site's website-bought domain row: the one holding the site, else the most recent. */
export async function webRowFor(slug: string, deps: Pick<PanelDeps, 'flow'>) {
  const rows = (await deps.flow.repo.all()).filter((r) => r.site_slug === slug && r.source === 'stripe');
  const holding = rows.find((r) => !['failed', 'detached', 'transferred'].includes(r.state));
  return holding ?? rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
}

/** { siteId } + the owner's bearer → the domain status for the dashboard (or state 'none'). */
export async function webDomainPanelStatus(body: any, authorization: unknown, deps: PanelDeps): Promise<WebResult> {
  const auth = await deps.authorize(body?.siteId, authorization);
  if (!auth.ok || !auth.target) return denied(auth);
  const row = await webRowFor(auth.target, deps);
  return { status: 200, body: { ...(row && deps.flow.vercel ? await webStatusWithProbe(row, deps.flow as DomainFlowDeps) : webStatusBody(row)), ...(row?.refunded_at ? { refunded: true } : {}) } };
}

/**
 * { siteId } + the owner's bearer → a Stripe customer-portal URL for the domain subscription
 * (cancel there: the domain keeps working until the paid year ends). Owner only; only the
 * customer of THIS site's domain subscription.
 */
export async function webDomainPortal(body: any, authorization: unknown, returnUrl: string, deps: PanelDeps): Promise<WebResult> {
  const auth = await deps.authorize(body?.siteId, authorization);
  if (!auth.ok || !auth.target) return denied(auth);
  const row = await webRowFor(auth.target, deps);
  if (!row || row.refunded_at) return { status: 404, body: { error: 'no-domain-subscription' } };
  const subId = row.original_transaction_id.replace(/^stripe:/, '');
  if (!subId) return { status: 404, body: { error: 'no-domain-subscription' } };
  const sub = await deps.getSubscription(subId);
  const customer = typeof sub?.customer === 'string' ? sub.customer : sub?.customer?.id;
  if (!customer) return { status: 404, body: { error: 'no-domain-subscription' } };
  const r = await deps.createPortalSession(customer, returnUrl, subId);
  if (!r.ok || !r.data?.url) return { status: 502, body: { error: 'portal-unavailable' } };
  return { status: 200, body: { url: r.data.url } };
}

/**
 * { siteId } + the owner's bearer → turn renewal off (cancel_at_period_end=true) or back on (false) on
 * THIS site's domain subscription only: the hosting plan is never touched. The domain keeps working
 * until the paid year ends. Same owner / row / mode rules as the portal: refunded, empty id, other
 * Stripe mode → 404. Returns the fresh status body.
 */
export async function webDomainRenewal(action: 'cancel-renewal' | 'resume-renewal', body: any, authorization: unknown, deps: PanelDeps, now: () => number = Date.now): Promise<WebResult> {
  const auth = await deps.authorize(body?.siteId, authorization);
  if (!auth.ok || !auth.target) return denied(auth);
  const row = await webRowFor(auth.target, deps);
  if (!row || row.refunded_at || ['failed', 'detached', 'transferred'].includes(row.state)) return { status: 404, body: { error: 'no-domain-subscription' } };
  const subId = row.original_transaction_id.replace(/^stripe:/, '');
  if (!subId) return { status: 404, body: { error: 'no-domain-subscription' } };
  const sub = await deps.getSubscription(subId);
  if (!sub) return { status: 404, body: { error: 'no-domain-subscription' } };
  const cancel = action === 'cancel-renewal';
  const periodEnd = Number(sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? 0) * 1000;
  const active = sub.status === 'active' || sub.status === 'trialing';
  if (!active || (periodEnd && periodEnd <= now())) {
    return { status: 409, body: { error: cancel ? 'not-active' : 'not-resumable' } };
  }
  // Resuming a domain with no hosting plan would bill $39/year for a site that is offline: the plan comes first.
  if (!cancel && !(await deps.hasActivePlan?.(auth.target))) return { status: 409, body: { error: 'plan-required' } };
  if (!deps.setRenewal) return { status: 502, body: { error: 'renewal-unavailable' } };
  const r = await deps.setRenewal(subId, cancel, randomUUID());
  if (!r.ok) {
    console.error(`[web-domain] ${action} failed: stripe ${r.status} ${r.data?.error?.code || r.data?.error?.type || 'unknown'}`);
    return { status: 502, body: { error: 'renewal-unavailable' } };
  }
  const after = await deps.getSubscription(subId);
  if (!after || !!after.cancel_at_period_end !== cancel) {
    console.error(`[web-domain] ${action}: Stripe did not confirm cancel_at_period_end=${cancel}`);
    return { status: 502, body: { error: 'renewal-unavailable' } };
  }
  const want = !cancel;
  const patchFor = (r: typeof row) => {
    const marks = { ...(r.alerts_sent ?? {}) };
    if (cancel) marks['renewal-off-customer'] = new Date(now()).toISOString(); // the customer's own choice: a new plan never turns it back on
    else { delete marks['renewal-off-customer']; delete marks['renewal-off-plan-ended']; delete marks['plan-ended-mail']; }
    const patch: Partial<typeof row> = { auto_renew: want, alerts_sent: marks };
    if (r.state === 'live' || r.state === 'manual_live') patch.auto_renew_synced = false;
    return patch;
  };
  let updated = await deps.flow.repo.update(row.original_transaction_id, [row.state], patchFor(row));
  if (!updated) {
    // The row moved under us (a state change): Stripe is already right, so write the markers on the CURRENT row and report its real state.
    const fresh = await deps.flow.repo.get(row.original_transaction_id);
    if (fresh && !['failed', 'detached', 'transferred'].includes(fresh.state)) updated = await deps.flow.repo.update(fresh.original_transaction_id, [fresh.state], patchFor(fresh)) ?? await deps.flow.repo.update(fresh.original_transaction_id, null, patchFor(fresh));
    if (!updated) {
      console.error(`[web-domain] ${action}: the row changed state and the renewal marker was not stored (${row.original_transaction_id})`);
      updated = fresh ?? row;
    }
  }
  return { status: 200, body: { ...webStatusBody(updated) } };
}
