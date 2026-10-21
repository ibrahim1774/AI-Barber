import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';
import { platformFeeCents } from './money.js';
import type { NotifyEvent } from './notify.js';

/**
 * Stripe Connect for bookings (Standard accounts, direct charges), raw fetch only.
 *
 * Env: STRIPE_CONNECT_SECRET_KEY (AI Barber's Connect platform account) and
 * STRIPE_CONNECT_WEBHOOK_SECRET. The Primehub STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET and
 * their flows are never read or touched here.
 *
 * Charges are created ON the connected account (`Stripe-Account` header) with
 * application_fee_amount = platformFeeCents(amount, shop.platform_fee_bps).
 */

export const SITE_ORIGIN = 'https://www.aibarber.org';
const STRIPE_API = 'https://api.stripe.com/v1';
/** Card holds last about 30 minutes. Stripe rejects expires_at < 30 min from when IT receives
 *  the request; expires_at is anchored to the start of the current minute + 32 min (so 31–32 min
 *  from now), which also keeps it stable for the per-minute Idempotency-Key. */
export const CHECKOUT_HOLD_SEC = 32 * 60;
/** Per-request timeout for Stripe calls. */
export const STRIPE_TIMEOUT_MS = 10_000;
export const MIN_CHARGE_CENTS = 50;

export const manageUrl = (token: string) => `${SITE_ORIGIN}/book/manage/${encodeURIComponent(token)}`;
export const bookingPageUrl = (slug: string) => `${SITE_ORIGIN}/book/${encodeURIComponent(slug)}`;
export const stripeReturnUrl = (shopId: string, state: 'return' | 'refresh') =>
  `${SITE_ORIGIN}/stripe-return?shop=${encodeURIComponent(shopId)}&state=${state}`;

// ---------------------------------------------------------------------------
// Types (structural subsets of the ab_shops / ab_appointments rows)
// ---------------------------------------------------------------------------

export interface PayShop {
  id: string;
  slug?: string | null;
  name?: string | null;
  currency?: string | null;
  stripe_account_id: string | null;
  platform_fee_bps: number;
}

export interface PayAppointment {
  id: string;
  shop_id?: string;
  service_name: string;
  price_cents: number | null;
  manage_token: string;
  customer_email?: string | null;
  start_at?: string;
  stripe_payment_intent_id?: string | null;
  amount_paid_cents?: number | null;
  amount_refunded_cents?: number | null;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
}>;

export interface StripeOpts {
  fetch?: FetchLike;
  now?: () => number; // epoch ms
}

export class StripeApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly type?: string) {
    super(message);
    this.name = 'StripeApiError';
  }
}

// ---------------------------------------------------------------------------
// Low-level request
// ---------------------------------------------------------------------------

export async function stripeRequest(
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string | number | boolean | null | undefined> = {},
  opts: { account?: string | null; idempotencyKey?: string; fetch?: FetchLike } = {},
): Promise<any> {
  const key = process.env.STRIPE_CONNECT_SECRET_KEY;
  if (!key) throw new StripeApiError('missing STRIPE_CONNECT_SECRET_KEY', 500, 'config');
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) body.append(k, String(v));

  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (opts.account) headers['Stripe-Account'] = opts.account;
  if (opts.idempotencyKey && method === 'POST') headers['Idempotency-Key'] = opts.idempotencyKey;

  let url = `${STRIPE_API}${path}`;
  const init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal } = {
    method, headers, signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
  };
  if (method === 'GET') {
    const qs = body.toString();
    if (qs) url += `?${qs}`;
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = body.toString();
  }
  const f = opts.fetch ?? (fetch as unknown as FetchLike);
  const res = await f(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error ?? {};
    throw new StripeApiError(err.message || `Stripe ${method} ${path} failed`, res.status, err.code, err.type);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Interfaces consumed by S1
// ---------------------------------------------------------------------------

/**
 * Hosted Checkout for a card booking, on the shop's connected account. Throws when the shop
 * has no connected account or the amount is below Stripe's minimum. Card only (Apple Pay and
 * Google Pay ride on 'card'): delayed methods such as ACH would leave the hold unresolved.
 * The Idempotency-Key is per appointment + amount + minute, so a network retry within the same
 * minute returns the same session and a later call makes a new one.
 */
export async function createCardCheckout(
  shop: PayShop,
  appt: PayAppointment,
  amountCents: number,
  opts: StripeOpts = {},
): Promise<{ url: string; sessionId: string }> {
  if (!shop.stripe_account_id) throw new StripeApiError('shop has no connected Stripe account', 400, 'no-account');
  const amount = Math.floor(amountCents);
  if (!Number.isFinite(amount) || amount < MIN_CHARGE_CENTS) {
    throw new StripeApiError(`amount ${amountCents} is below the ${MIN_CHARGE_CENTS}¢ minimum`, 400, 'amount-too-small');
  }
  const isDeposit = appt.price_cents == null || amount < appt.price_cents;
  const fee = platformFeeCents(amount, shop.platform_fee_bps);
  const now = (opts.now ?? Date.now)();
  const minuteSec = Math.floor(now / 60_000) * 60;
  const meta = { appointment_id: appt.id, shop_id: shop.id, app: 'aibarber-bookings' };

  const params: Record<string, string | number | undefined> = {
    mode: 'payment',
    success_url: `${manageUrl(appt.manage_token)}?checkout=success`,
    cancel_url: `${manageUrl(appt.manage_token)}?checkout=cancelled`,
    expires_at: minuteSec + CHECKOUT_HOLD_SEC,
    'payment_method_types[0]': 'card',
    client_reference_id: appt.id,
    customer_email: appt.customer_email || undefined,
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': (shop.currency || 'usd').toLowerCase(),
    'line_items[0][price_data][unit_amount]': amount,
    'line_items[0][price_data][product_data][name]': (isDeposit ? `Deposit: ${appt.service_name}` : appt.service_name).slice(0, 250),
    'payment_intent_data[application_fee_amount]': fee > 0 ? fee : undefined,
    'payment_intent_data[description]': `${appt.service_name}${shop.name ? ` at ${shop.name}` : ''}`.slice(0, 250),
  };
  for (const [k, v] of Object.entries(meta)) {
    params[`metadata[${k}]`] = v;
    params[`payment_intent_data[metadata][${k}]`] = v;
  }

  const session = await stripeRequest('POST', '/checkout/sessions', params, {
    account: shop.stripe_account_id,
    idempotencyKey: `ab-checkout-${appt.id}-${amount}-${minuteSec}`,
    fetch: opts.fetch,
  });
  if (!session?.url || !session?.id) throw new StripeApiError('Checkout Session has no url', 502);
  return { url: session.url, sessionId: session.id };
}

/**
 * Refund (part of) a card payment on the connected account, refunding AI Barber's fee
 * proportionally (refund_application_fee=true). Clamped to what is still refundable.
 * Returns 0 without calling Stripe when there is nothing to refund.
 */
export async function refundAppointment(
  shop: PayShop,
  appt: PayAppointment,
  amountCents: number,
  opts: StripeOpts = {},
): Promise<{ refundedCents: number }> {
  const paid = Math.max(0, Math.floor(appt.amount_paid_cents ?? 0));
  const already = Math.max(0, Math.floor(appt.amount_refunded_cents ?? 0));
  const amount = Math.min(Math.floor(Number(amountCents) || 0), paid - already);
  if (amount <= 0 || !appt.stripe_payment_intent_id) return { refundedCents: 0 };
  if (!shop.stripe_account_id) throw new StripeApiError('shop has no connected Stripe account', 400, 'no-account');

  const refund = await stripeRequest('POST', '/refunds', {
    payment_intent: appt.stripe_payment_intent_id,
    amount,
    refund_application_fee: true,
    'metadata[appointment_id]': appt.id,
    'metadata[app]': 'aibarber-bookings',
  }, {
    account: shop.stripe_account_id,
    // The payment intent and already-refunded are part of the key: a second partial refund of the
    // same size is a new refund, and a refund of a different payment never replays an old one.
    idempotencyKey: `ab-refund-${appt.id}-${appt.stripe_payment_intent_id}-${already}-${amount}`,
    fetch: opts.fetch,
  });
  if (refund?.status === 'failed' || refund?.status === 'canceled') {
    throw new StripeApiError(`refund ${refund?.id} ${refund?.status}`, 502, 'refund-failed');
  }
  return { refundedCents: Number(refund?.amount) || amount };
}

/**
 * Close an unpaid Checkout Session now (e.g. the customer cancels a held card booking), so it
 * can no longer be paid. Never throws; returns false if Stripe refused (already complete/expired).
 */
export async function expireCheckoutSession(shop: PayShop, sessionId: string, opts: StripeOpts = {}): Promise<boolean> {
  if (!shop.stripe_account_id || !sessionId) return false;
  try {
    await stripeRequest('POST', `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, {}, {
      account: shop.stripe_account_id, fetch: opts.fetch,
    });
    return true;
  } catch (e: any) {
    console.warn('[bookings/payments] expire session failed:', e?.message || e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Connected-account onboarding
// ---------------------------------------------------------------------------

export interface OnboardShop extends PayShop {
  phone?: string | null;
}

export async function createStandardAccount(
  shop: OnboardShop,
  ownerEmail: string | null,
  opts: StripeOpts = {},
): Promise<string> {
  // The key covers the prefilled values, so editing the shop's name/phone between taps never hits
  // Stripe's "same key, different parameters" error.
  const paramsHash = (withPhone: boolean) => crypto.createHash('sha256')
    .update(JSON.stringify([ownerEmail, shop.name, shop.slug, withPhone ? shop.phone : null])).digest('hex').slice(0, 16);
  const create = (withPhone: boolean) => stripeRequest('POST', '/accounts', {
    type: 'standard',
    email: ownerEmail || undefined,
    'business_profile[name]': shop.name || undefined,
    'business_profile[url]': shop.slug ? bookingPageUrl(shop.slug) : undefined,
    'business_profile[support_phone]': withPhone ? shop.phone || undefined : undefined,
    'metadata[shop_id]': shop.id,
    'metadata[app]': 'aibarber-bookings',
  }, { idempotencyKey: `ab-account-${shop.id}-${paramsHash(withPhone)}`, fetch: opts.fetch });
  let acct: any;
  try {
    acct = await create(Boolean(shop.phone));
  } catch (e) {
    // The phone is free text typed by the owner; if Stripe rejects the request, try once without it
    // (the owner enters the phone in Stripe's own onboarding anyway).
    if (!(shop.phone && e instanceof StripeApiError && e.status === 400)) throw e;
    acct = await create(false);
  }
  if (!acct?.id) throw new StripeApiError('account create returned no id', 502);
  return acct.id as string;
}

export async function createAccountLink(shopId: string, accountId: string, opts: StripeOpts = {}): Promise<string> {
  const link = await stripeRequest('POST', '/account_links', {
    account: accountId,
    type: 'account_onboarding',
    refresh_url: stripeReturnUrl(shopId, 'refresh'),
    return_url: stripeReturnUrl(shopId, 'return'),
  }, { fetch: opts.fetch });
  if (!link?.url) throw new StripeApiError('account link has no url', 502);
  return link.url as string;
}

/** True when the platform key itself works: GET /v1/account (no Stripe-Account header) returns 200. */
export async function platformKeyHealthy(opts: StripeOpts = {}): Promise<boolean> {
  try {
    const a = await stripeRequest('GET', '/account', {}, { fetch: opts.fetch });
    return Boolean(a?.id);
  } catch (e: any) {
    console.error('[bookings/payments] platform key check failed:', e?.status ?? '', e?.message || e);
    return false;
  }
}

export interface AccountStatus { connected: boolean; chargesEnabled: boolean; detailsSubmitted: boolean }

/** Live account status. A 403/404 (access revoked / account gone) reads as not connected. */
export async function fetchAccountStatus(accountId: string, opts: StripeOpts = {}): Promise<AccountStatus> {
  try {
    const a = await stripeRequest('GET', `/accounts/${encodeURIComponent(accountId)}`, {}, { fetch: opts.fetch });
    return { connected: true, chargesEnabled: a?.charges_enabled === true, detailsSubmitted: a?.details_submitted === true };
  } catch (e) {
    if (e instanceof StripeApiError && (e.status === 403 || e.status === 404)) {
      return { connected: false, chargesEnabled: false, detailsSubmitted: false };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Owner endpoints (POST /api/shop/stripe/onboard, GET /api/shop/stripe/status)
// ---------------------------------------------------------------------------

export interface OwnerShopRow extends OnboardShop {
  owner_id: string;
  stripe_charges_enabled: boolean;
}

export interface OwnerStripeDeps {
  getUser(jwt: string): Promise<{ id: string; email: string | null } | null>;
  shopForOwner(userId: string): Promise<OwnerShopRow | null>;
  /** Store the id only if none is stored yet; returns the id that ends up stored. */
  saveAccountId(shopId: string, accountId: string): Promise<string>;
  setChargesEnabled(shopId: string, enabled: boolean): Promise<void>;
  /** Forget a connected account we no longer have access to (stripe_account_id = null, charges off),
   *  only if it is still the stored one. Only /onboard calls it, after platformKeyHealthy(). */
  clearAccount(shopId: string, accountId: string): Promise<void>;
  stripe?: StripeOpts;
}

type Reply = { status: number; body: object };

function bearer(authorization: string | string[] | undefined): string | null {
  const h = Array.isArray(authorization) ? authorization[0] : authorization;
  const m = typeof h === 'string' ? /^Bearer\s+(\S+)\s*$/i.exec(h) : null;
  return m ? m[1] : null;
}

async function ownerShop(authorization: string | string[] | undefined, deps: OwnerStripeDeps):
  Promise<{ user: { id: string; email: string | null }; shop: OwnerShopRow } | Reply> {
  const jwt = bearer(authorization);
  if (!jwt) return { status: 401, body: { error: 'unauthorized' } };
  let user: { id: string; email: string | null } | null = null;
  try { user = await deps.getUser(jwt); } catch { user = null; }
  if (!user?.id) return { status: 401, body: { error: 'unauthorized' } };
  const shop = await deps.shopForOwner(user.id);
  if (!shop || shop.owner_id !== user.id) return { status: 404, body: { error: 'no-shop' } };
  return { user, shop };
}

export async function stripeOnboard(authorization: string | string[] | undefined, deps: OwnerStripeDeps): Promise<Reply> {
  const r = await ownerShop(authorization, deps);
  if ('status' in r) return r;
  const { user, shop } = r;
  try {
    let accountId = shop.stripe_account_id;
    if (accountId) {
      try {
        return { status: 200, body: { url: await createAccountLink(shop.id, accountId, deps.stripe) } };
      } catch (e) {
        // A 403/404 means "this key can't see that account": revoked access, OR a wrong/mixed-up
        // platform key. Only treat it as revoked once the platform key itself is proven healthy;
        // otherwise clearing would wipe every owner's real account id. Anything else never clears.
        if (!(e instanceof StripeApiError && (e.status === 403 || e.status === 404))) throw e;
        if (!(await platformKeyHealthy(deps.stripe))) throw e;
        console.error('[shop/stripe/onboard] clearing unreachable connected account:',
          JSON.stringify({ shopId: shop.id, accountId, status: e.status, code: e.code ?? null }));
        await deps.clearAccount(shop.id, accountId);
        accountId = null;
      }
    }
    const created = await createStandardAccount(shop, user.email, deps.stripe);
    accountId = await deps.saveAccountId(shop.id, created);
    const url = await createAccountLink(shop.id, accountId, deps.stripe);
    return { status: 200, body: { url } };
  } catch (e: any) {
    console.error('[shop/stripe/onboard] failed:', e?.message || e);
    return { status: 502, body: { error: 'stripe-error' } };
  }
}

export async function stripeStatus(authorization: string | string[] | undefined, deps: OwnerStripeDeps): Promise<Reply> {
  const r = await ownerShop(authorization, deps);
  if ('status' in r) return r;
  const { shop } = r;
  if (!shop.stripe_account_id) return { status: 200, body: { connected: false, chargesEnabled: false, detailsSubmitted: false } };
  try {
    const s = await fetchAccountStatus(shop.stripe_account_id, deps.stripe);
    // Read-only on a 403/404: report connected:false but never clear or change anything, since a
    // wrong platform key also returns 403. Revocation is cleared by the deauthorized webhook, or
    // by /onboard after it has proven the platform key works.
    if (s.connected && s.chargesEnabled !== shop.stripe_charges_enabled) await deps.setChargesEnabled(shop.id, s.chargesEnabled);
    return { status: 200, body: s };
  } catch (e: any) {
    console.error('[shop/stripe/status] failed:', e?.message || e);
    return { status: 502, body: { error: 'stripe-error' } };
  }
}

export function serviceDb(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('missing Supabase configuration');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function dbFail(op: string, error: { message?: string } | null): never {
  throw new Error(`bookings/payments ${op} failed: ${error?.message ?? 'unknown'}`);
}

export function liveOwnerStripeDeps(db: SupabaseClient = serviceDb()): OwnerStripeDeps {
  return {
    async getUser(jwt) {
      const { data, error } = await db.auth.getUser(jwt);
      if (error || !data?.user) return null;
      return { id: data.user.id, email: data.user.email ?? null };
    },
    async shopForOwner(userId) {
      const { data, error } = await db.from('ab_shops').select('*').eq('owner_id', userId).maybeSingle();
      if (error) dbFail('shopForOwner', error);
      return (data as OwnerShopRow) ?? null;
    },
    async saveAccountId(shopId, accountId) {
      const { data, error } = await db.from('ab_shops').update({ stripe_account_id: accountId })
        .eq('id', shopId).is('stripe_account_id', null).select('stripe_account_id');
      if (error) dbFail('saveAccountId', error);
      if (Array.isArray(data) && data.length) return accountId;
      // Lost a race: another request stored an account first. Use that one.
      const { data: cur, error: e2 } = await db.from('ab_shops').select('stripe_account_id').eq('id', shopId).single();
      if (e2) dbFail('saveAccountId(read)', e2);
      return (cur as { stripe_account_id: string }).stripe_account_id;
    },
    async setChargesEnabled(shopId, enabled) {
      const { error } = await db.from('ab_shops').update({ stripe_charges_enabled: enabled }).eq('id', shopId);
      if (error) dbFail('setChargesEnabled', error);
    },
    async clearAccount(shopId, accountId) {
      const { error } = await db.from('ab_shops').update({ stripe_account_id: null, stripe_charges_enabled: false })
        .eq('id', shopId).eq('stripe_account_id', accountId);
      if (error) dbFail('clearAccount', error);
    },
  };
}

// ---------------------------------------------------------------------------
// Webhook (POST /api/stripe/connect-webhook)
// ---------------------------------------------------------------------------

/**
 * Stripe-Signature check without the SDK: header `t=<ts>,v1=<sig>[,v1=...]`,
 * expected = hex HMAC-SHA256(`${t}.${rawBody}`, secret); |now - t| <= tolerance.
 */
export function verifyStripeSignature(
  rawBody: Buffer | string,
  sigHeader: string | undefined,
  secret: string,
  toleranceSec = 300,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  if (!sigHeader || !secret) return false;
  const parts = sigHeader.split(',').map((p) => {
    const i = p.indexOf('=');
    return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  });
  const t = parts.find((p) => p[0] === 't')?.[1];
  const v1s = parts.filter((p) => p[0] === 'v1').map((p) => p[1]);
  if (!t || !/^\d+$/.test(t) || v1s.length === 0) return false;
  const ts = parseInt(t, 10);
  if (Math.abs(nowSec - ts) > toleranceSec) return false;
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest('hex'));
  return v1s.some((v1) => {
    const got = Buffer.from(v1);
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

export interface WebhookAppointment extends PayAppointment {
  shop_id: string;
  status: 'booked' | 'done' | 'no_show' | 'cancelled';
  payment_status: string;
  payment_method: string | null;
  stripe_checkout_session_id: string | null;
  cancelled_at?: string | null;
}

export interface WebhookDeps {
  /** True when this event id is already recorded in ab_events (dedupe_key 'stripe:<id>'). */
  eventProcessed(eventId: string): Promise<boolean>;
  /** Record the event as processed. Called only after its work succeeded; a duplicate insert is fine. */
  recordEvent(eventId: string, type: string, account: string | null): Promise<void>;
  appointmentBySession(sessionId: string): Promise<WebhookAppointment | null>;
  appointmentByPaymentIntent(pi: string): Promise<WebhookAppointment | null>;
  appointmentById(id: string): Promise<WebhookAppointment | null>;
  shop(id: string): Promise<(PayShop & { stripe_account_id: string | null }) | null>;
  /** Records the payment once: conditional on no payment intent stored yet; true when this call made the change. */
  markPaid(apptId: string, f: { paymentStatus: 'paid' | 'deposit'; amountPaidCents: number; paymentIntentId: string | null }): Promise<boolean>;
  /** Conditional on status = 'booked' and payment_status = 'awaiting'. */
  expireHold(apptId: string, nowIso: string): Promise<boolean>;
  /** Monotonic: never lowers amount_refunded_cents (events can arrive out of order). */
  setRefunded(apptId: string, amountRefundedCents: number, paymentStatus: 'refunded' | 'partially_refunded'): Promise<void>;
  setChargesEnabledForAccount(accountId: string, enabled: boolean): Promise<void>;
  /** The account revoked our access: stripe_account_id = null, charges off, so the owner can reconnect. */
  disconnectAccount(accountId: string): Promise<void>;
  refund(shop: PayShop, appt: PayAppointment, amountCents: number): Promise<{ refundedCents: number }>;
  /** Fire-and-forget (live: waitUntil). Must not block or fail the webhook response. */
  notify(event: NotifyEvent): Promise<void>;
  now(): number;
}

export interface StripeEvent {
  id: string;
  type: string;
  account?: string | null;
  /** Epoch seconds when Stripe created the event (for a completed session: when it was paid). */
  created?: number;
  data: { object: any };
}

interface Outcome { outcome: string; notify?: NotifyEvent[] }

/**
 * Process one verified event. The event id is recorded only AFTER its work succeeds, and every
 * branch is idempotent on the appointment/shop state, so a redelivery after a crash, timeout or
 * error finishes whatever was left undone. Throws so the caller returns 500 and Stripe retries.
 * Notifications are sent after the work and the record, and never block or fail the response.
 */
export async function handleConnectEvent(event: StripeEvent, deps: WebhookDeps): Promise<string> {
  if (!event?.id || !event?.type) return 'ignored:malformed';
  if (await deps.eventProcessed(event.id)) return 'duplicate';
  const r = await dispatch(event, deps);
  await deps.recordEvent(event.id, event.type, event.account ?? null);
  for (const n of r.notify ?? []) {
    try {
      void deps.notify(n).catch((e: any) => console.error('[stripe/connect-webhook] notify failed:', e?.message || e));
    } catch (e: any) {
      console.error('[stripe/connect-webhook] notify failed:', e?.message || e);
    }
  }
  return r.outcome;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function apptForEvent(
  ref: { kind: 'session'; id: string; clientReferenceId?: string | null } | { kind: 'pi'; id: string },
  account: string | null | undefined,
  deps: WebhookDeps,
) {
  let appt = ref.kind === 'session' ? await deps.appointmentBySession(ref.id) : await deps.appointmentByPaymentIntent(ref.id);
  if (!appt && ref.kind === 'session' && ref.clientReferenceId && UUID_RE.test(ref.clientReferenceId)) {
    // Fallback if the API's write of stripe_checkout_session_id never landed: the session's
    // client_reference_id is the appointment id. Only for a row not tied to another session.
    const byId = await deps.appointmentById(ref.clientReferenceId);
    if (byId && (byId.stripe_checkout_session_id == null || byId.stripe_checkout_session_id === ref.id)) appt = byId;
  }
  if (!appt) return null;
  const shop = await deps.shop(appt.shop_id);
  // The event must come from the connected account that owns this appointment's shop.
  if (!shop || !shop.stripe_account_id || !account || shop.stripe_account_id !== account) return null;
  return { appt, shop };
}

const piOf = (v: any): string | null => (typeof v === 'string' ? v : v?.id ?? null);

async function sessionPaid(event: StripeEvent, obj: any, deps: WebhookDeps): Promise<Outcome> {
  if (obj.payment_status !== 'paid') return { outcome: 'ignored:unpaid' };
  const amount = Math.max(0, Math.floor(Number(obj.amount_total) || 0));
  const pi = piOf(obj.payment_intent);
  const found = await apptForEvent({ kind: 'session', id: obj.id, clientReferenceId: obj.client_reference_id }, event.account, deps);
  if (!found) {
    // Real money with nothing to attach it to (row deleted, session id never stored, account mismatch).
    console.error('[stripe/connect-webhook] paid session without a matching appointment:',
      JSON.stringify({ session: obj.id, paymentIntent: pi, account: event.account, amountTotal: amount, clientReferenceId: obj.client_reference_id }));
    return { outcome: 'ignored:no-appointment' };
  }
  const { appt: before, shop } = found;
  const paymentStatus = before.price_cents == null || amount < before.price_cents ? 'deposit' : 'paid';
  const changed = await deps.markPaid(before.id, { paymentStatus, amountPaidCents: amount, paymentIntentId: pi });

  if (changed) {
    // `before` was read while the row held no payment: if it was cancelled then, it was cancelled
    // BEFORE the payment (e.g. the customer cancelled the held slot on the manage page, then
    // finished paying in another tab). Give the money straight back.
    if (before.status === 'cancelled') {
      return refundRemainder(shop, { ...before, stripe_payment_intent_id: pi, amount_paid_cents: amount, amount_refunded_cents: 0 }, pi, deps);
    }
    return { outcome: `paid:${paymentStatus}`, notify: [{ kind: 'booking_created', appointmentId: before.id }] };
  }

  // Not changed: a redelivery, or a concurrent delivery. Decide on the CURRENT row, not the
  // snapshot read before markPaid.
  const appt = (await deps.appointmentById(before.id)) ?? before;
  if (appt.stripe_payment_intent_id && pi && appt.stripe_payment_intent_id !== pi) {
    // A second, different payment for an appointment that is already paid: give it back.
    console.error('[stripe/connect-webhook] second payment for one appointment, refunding it:',
      JSON.stringify({ appointment: appt.id, stored: appt.stripe_payment_intent_id, extra: pi, amount }));
    await deps.refund(shop, { ...appt, stripe_payment_intent_id: pi, amount_paid_cents: amount, amount_refunded_cents: 0 }, amount);
    return { outcome: 'refunded:duplicate-payment' };
  }
  if (appt.status === 'cancelled') {
    // Only "cancelled, then paid" is refunded here. "Paid, then cancelled" went through the
    // cancel flow, which already applied the refund policy (it may keep a deposit or fee).
    const cancelledMs = appt.cancelled_at ? Date.parse(appt.cancelled_at) : NaN;
    const paidMs = Number.isFinite(event.created) ? (event.created as number) * 1000 : NaN;
    if (!Number.isFinite(cancelledMs) || !Number.isFinite(paidMs)) {
      console.error('[stripe/connect-webhook] cannot order cancel vs payment; not refunding:',
        JSON.stringify({ appointment: appt.id, cancelledAt: appt.cancelled_at ?? null, eventCreated: event.created ?? null }));
      return { outcome: 'noop:cancel-order-unknown' };
    }
    if (cancelledMs >= paidMs) return { outcome: 'noop:paid-then-cancelled' };
    return refundRemainder(shop, appt, pi, deps);
  }
  if (appt.stripe_payment_intent_id === pi) {
    // Card bookings get their confirmation once payment lands. On a redelivery the event was not
    // recorded last time, so the confirmation was not sent either.
    return { outcome: 'noop:already-recorded', notify: [{ kind: 'booking_created', appointmentId: appt.id }] };
  }
  return { outcome: 'noop:already-recorded' };
}

/** Refund whatever of this payment is not refunded yet (idempotent on the row's own totals). */
async function refundRemainder(shop: PayShop, appt: WebhookAppointment, pi: string | null, deps: WebhookDeps): Promise<Outcome> {
  const paid = Math.floor(appt.amount_paid_cents ?? 0);
  const refunded = Math.floor(appt.amount_refunded_cents ?? 0);
  if (refunded >= paid) return { outcome: 'noop:already-refunded' };
  const r = await deps.refund(shop, { ...appt, stripe_payment_intent_id: pi, amount_paid_cents: paid, amount_refunded_cents: refunded }, paid - refunded);
  const total = refunded + r.refundedCents;
  if (r.refundedCents > 0) await deps.setRefunded(appt.id, total, total >= paid ? 'refunded' : 'partially_refunded');
  return { outcome: 'refunded:cancelled-before-payment' };
}

async function dispatch(event: StripeEvent, deps: WebhookDeps): Promise<Outcome> {
  const obj = event.data?.object ?? {};
  switch (event.type) {
    case 'checkout.session.completed':
    // Card-only Checkout never produces async payments; handled defensively all the same.
    case 'checkout.session.async_payment_succeeded':
      return sessionPaid(event, obj, deps);
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed': {
      const found = await apptForEvent({ kind: 'session', id: obj.id, clientReferenceId: obj.client_reference_id }, event.account, deps);
      if (!found) return { outcome: 'ignored:no-appointment' };
      const changed = await deps.expireHold(found.appt.id, new Date(deps.now()).toISOString());
      return { outcome: changed ? 'cancelled:expired' : 'noop:not-held' };
    }
    case 'charge.refunded': {
      const pi = piOf(obj.payment_intent);
      if (!pi) return { outcome: 'ignored:no-pi' };
      const found = await apptForEvent({ kind: 'pi', id: pi }, event.account, deps);
      if (!found) return { outcome: 'ignored:no-appointment' };
      // Stripe's cumulative total, never an increment: idempotent with the API's own write.
      const refunded = Math.max(0, Math.floor(Number(obj.amount_refunded) || 0));
      const paid = Math.max(0, Math.floor(found.appt.amount_paid_cents ?? 0)) || Math.floor(Number(obj.amount_captured) || 0);
      await deps.setRefunded(found.appt.id, refunded, refunded >= paid ? 'refunded' : 'partially_refunded');
      return { outcome: 'refund:recorded' };
    }
    case 'account.updated': {
      if (!obj.id) return { outcome: 'ignored:no-account' };
      await deps.setChargesEnabledForAccount(obj.id, obj.charges_enabled === true);
      return { outcome: `account:${obj.charges_enabled === true ? 'enabled' : 'disabled'}` };
    }
    case 'account.application.deauthorized': {
      if (!event.account) return { outcome: 'ignored:no-account' };
      await deps.disconnectAccount(event.account);
      return { outcome: 'account:deauthorized' };
    }
    default:
      return { outcome: `ignored:${event.type}` };
  }
}

export function liveWebhookDeps(db: SupabaseClient = serviceDb()): WebhookDeps {
  const APPT_COLS = 'id, shop_id, status, cancelled_at, service_name, price_cents, manage_token, customer_email, start_at, payment_status, payment_method, amount_paid_cents, amount_refunded_cents, stripe_payment_intent_id, stripe_checkout_session_id';
  return {
    async eventProcessed(eventId) {
      const { data, error } = await db.from('ab_events').select('id').eq('dedupe_key', `stripe:${eventId}`).maybeSingle();
      if (error) dbFail('eventProcessed', error);
      return Boolean(data);
    },
    async recordEvent(eventId, type, account) {
      const { error } = await db.from('ab_events').insert({
        kind: `stripe:${type}`.slice(0, 200), dedupe_key: `stripe:${eventId}`, payload: { id: eventId, type, account },
      });
      if (error && (error as { code?: string }).code !== '23505') dbFail('recordEvent', error);
    },
    async appointmentBySession(sessionId) {
      const { data, error } = await db.from('ab_appointments').select(APPT_COLS).eq('stripe_checkout_session_id', sessionId).maybeSingle();
      if (error) dbFail('appointmentBySession', error);
      return (data as unknown as WebhookAppointment) ?? null;
    },
    async appointmentById(id) {
      const { data, error } = await db.from('ab_appointments').select(APPT_COLS).eq('id', id).maybeSingle();
      if (error) dbFail('appointmentById', error);
      return (data as unknown as WebhookAppointment) ?? null;
    },
    async appointmentByPaymentIntent(pi) {
      const { data, error } = await db.from('ab_appointments').select(APPT_COLS).eq('stripe_payment_intent_id', pi).maybeSingle();
      if (error) dbFail('appointmentByPaymentIntent', error);
      return (data as unknown as WebhookAppointment) ?? null;
    },
    async shop(id) {
      const { data, error } = await db.from('ab_shops').select('id, slug, name, currency, stripe_account_id, platform_fee_bps').eq('id', id).maybeSingle();
      if (error) dbFail('shop', error);
      return (data as PayShop) ?? null;
    },
    async markPaid(apptId, f) {
      const { data, error } = await db.from('ab_appointments').update({
        payment_status: f.paymentStatus,
        payment_method: 'card',
        amount_paid_cents: f.amountPaidCents,
        stripe_payment_intent_id: f.paymentIntentId,
      }).eq('id', apptId).is('stripe_payment_intent_id', null).select('id');
      if (error) dbFail('markPaid', error);
      return Array.isArray(data) && data.length > 0;
    },
    async expireHold(apptId, nowIso) {
      const { data, error } = await db.from('ab_appointments').update({
        status: 'cancelled', cancelled_by: 'customer', cancelled_at: nowIso, payment_status: 'none',
      }).eq('id', apptId).eq('status', 'booked').eq('payment_status', 'awaiting').select('id');
      if (error) dbFail('expireHold', error);
      return Array.isArray(data) && data.length > 0;
    },
    async setRefunded(apptId, amountRefundedCents, paymentStatus) {
      const { error } = await db.from('ab_appointments').update({
        amount_refunded_cents: amountRefundedCents, payment_status: paymentStatus,
      }).eq('id', apptId).lte('amount_refunded_cents', amountRefundedCents);
      if (error) dbFail('setRefunded', error);
    },
    async setChargesEnabledForAccount(accountId, enabled) {
      const { error } = await db.from('ab_shops').update({ stripe_charges_enabled: enabled }).eq('stripe_account_id', accountId);
      if (error) dbFail('setChargesEnabledForAccount', error);
    },
    async disconnectAccount(accountId) {
      const { error } = await db.from('ab_shops').update({ stripe_account_id: null, stripe_charges_enabled: false })
        .eq('stripe_account_id', accountId);
      if (error) dbFail('disconnectAccount', error);
    },
    refund: (shop, appt, amount) => refundAppointment(shop, appt, amount),
    // After the response, kept alive by waitUntil. Dynamic import: notify.ts imports this module.
    notify: async (e) => { waitUntil(import('./notify.js').then((m) => m.notify(e))); },
    now: () => Date.now(),
  };
}
