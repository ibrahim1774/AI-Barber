// Production wiring for custom domains: the app endpoints, the website endpoints, the App Store
// notification sink, the Stripe webhook routing and the domain sweep.
//
// Env:
//   VERCEL_TOKEN               (existing) needs registrar + project scope on the team that owns the site projects
//   VERCEL_DOMAINS_TEAM_ID     optional; only if the token's default scope is NOT that team (deploys send no teamId)
//   VERCEL_REGISTRANT_CONTACT  JSON registrant contact (lib/ios/vercelDomains.ts registrantContact); no purchase without it
//   DOMAINS_SANDBOX_REAL_OTIDS optional, comma-separated Sandbox originalTransactionIds allowed to buy for real (internal tests)
//   DOMAIN_CHECKOUT_SECRET     HMAC key signing the website's domain checkout metadata (lib/webDomains.ts)
//   STRIPE_DOMAIN_PRICE_ID     optional Stripe price for the $39/year domain; else price_data
import { liveGetUser } from '../bookings/auth.js';
import { publicLimiter } from '../bookings/rateLimit.js';
import { serviceClient, supabaseBookingRepo } from '../bookings/repo.js';
import { publishSite, readPendingSite } from '../publishSite.js';
import { VerifyFailure, lazyDefaultVerifier } from './appleVerify.js';
import { PayerFailure, appleStatus, projectFor, applyDomainNotification, sweepDomains, type DomainFlowDeps, type DomainSweepSummary, type PayerStatus } from './domainFlow.js';
import { makeDomainHooks, makeRefreshBase } from './domainHooks.js';
import { findShopForSite, liveSiteBaseDeps, refreshSiteBase } from '../siteSubpages.js';
import { isMissingSiteColumn } from '../siteColumns.js';
import { STRIPE_API_VERSION } from '../stripeVersion.js';
import { sendEmail } from '../bookings/email.js';
import { supabaseDomains, type DomainRow } from './domainsRepo.js';
import type { DomainNotificationSink } from './notifications.js';
import { supabasePurchases } from './purchases.js';
import { DOMAIN_PRODUCT_ID } from './tiers.js';
import { liveVercelDomains, registrantContact } from './vercelDomains.js';
import { stripePayerStatus, type WebDomainDeps } from '../webDomains.js';

export function sandboxRealOtids(raw: string | undefined = process.env.DOMAINS_SANDBOX_REAL_OTIDS): Set<string> {
  return new Set((raw || '').split(',').map((s) => s.trim()).filter(Boolean));
}

async function probeHttps(domain: string): Promise<boolean> {
  try {
    const r = await fetch(`https://${domain}/`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5_000) });
    return r.status > 0 && r.status < 500;
  } catch {
    return false; // no certificate yet, DNS not propagated, …
  }
}

/** GET /v1/subscriptions/{id}: the subscription, null when Stripe doesn't know it. Throws on an outage. */
export async function stripeSubscription(id: string): Promise<any | null> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not set');
  if (!/^sub_[A-Za-z0-9]{6,200}$/.test(id)) return null;
  const r = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${key}`, 'Stripe-Version': STRIPE_API_VERSION }, signal: AbortSignal.timeout(8_000),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Stripe subscription lookup failed: ${r.status}`);
  return r.json();
}

async function stripe(method: string, path: string, opts: { form?: Record<string, string>; idem?: string } = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not set');
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, 'Stripe-Version': STRIPE_API_VERSION };
  if (opts.form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (opts.idem) headers['Idempotency-Key'] = opts.idem;
  const r = await fetch(`https://api.stripe.com${path}`, {
    method, headers, body: opts.form ? new URLSearchParams(opts.form).toString() : undefined, signal: AbortSignal.timeout(10_000),
  });
  const data: any = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, data };
}

export type StripeCall = (method: string, path: string, opts?: { form?: Record<string, string>; idem?: string }) =>
  Promise<{ ok: boolean; status: number; data: any }>;

const idOf = (v: any): string | null => (typeof v === 'string' ? v : typeof v?.id === 'string' ? v.id : null);

/**
 * Cancel a domain subscription NOW and refund its latest payment in full. Idempotent: the
 * refund carries an Idempotency-Key per subscription, an already-cancelled subscription is fine,
 * and an already-refunded charge (charge_already_refunded) counts as done. Finds the payment
 * without the `latest_invoice.payment_intent` expand: the invoice's payment_intent / charge
 * (older API), else GET /v1/invoice_payments?invoice=… (basil and later).
 */
export function makeCancelAndRefund(call: StripeCall) {
  return async (subId: string): Promise<void> => {
    if (!/^sub_[A-Za-z0-9]{6,200}$/.test(subId)) throw new Error('bad subscription id');
    const sub = await call('GET', `/v1/subscriptions/${subId}`);
    if (!sub.ok) throw new Error(`subscription lookup failed: ${sub.status}`);
    const invId = idOf(sub.data?.latest_invoice);
    if (!invId) throw new Error('no invoice to refund');
    const inv = await call('GET', `/v1/invoices/${encodeURIComponent(invId)}`);
    if (!inv.ok) throw new Error(`invoice lookup failed: ${inv.status}`);
    let pi = idOf(inv.data?.payment_intent);
    let charge = idOf(inv.data?.charge);
    if (!pi && !charge) {
      const pays = await call('GET', `/v1/invoice_payments?invoice=${encodeURIComponent(invId)}&limit=10`);
      if (!pays.ok) throw new Error(`invoice payments lookup failed: ${pays.status}`);
      const paid = (pays.data?.data || []).find((p: any) => p?.status === 'paid') ?? pays.data?.data?.[0];
      pi = idOf(paid?.payment?.payment_intent);
      charge = idOf(paid?.payment?.charge);
    }
    if (!pi && !charge) throw new Error('no payment to refund on the latest invoice');
    const form = pi ? { payment_intent: pi } : { charge: charge! };
    let ref = await call('POST', '/v1/refunds', { form, idem: `domain-refund-${subId}` });
    // L3: Stripe replays a cached 5xx for the same idempotency key for 24 hours. After one, ask
    // again under a fresh key; if the first attempt did refund, the answer is charge_already_refunded (done).
    if (!ref.ok && ref.status >= 500) ref = await call('POST', '/v1/refunds', { form, idem: `domain-refund-${subId}-r${Date.now().toString(36)}` });
    if (!ref.ok && ref.data?.error?.code !== 'charge_already_refunded') throw new Error(`refund failed: ${ref.status} ${ref.data?.error?.code || ''}`);
    if (sub.data?.status !== 'canceled') {
      const del = await call('DELETE', `/v1/subscriptions/${subId}`, { idem: `domain-cancel-${subId}` });
      if (!del.ok && del.status !== 404) throw new Error(`cancel failed: ${del.status}`);
    }
  };
}

export const stripeCancelAndRefund = (subId: string) => makeCancelAndRefund(stripe)(subId);

/** The payer of a domain row, asked NOW: Apple (domain verifier, latest renewal info) or Stripe. */
export function makePayer(verifyDomain: (id: string) => Promise<any>, getSubscription: (id: string) => Promise<any | null>, now: () => number) {
  return async (row: Pick<DomainRow, 'original_transaction_id' | 'source'>): Promise<PayerStatus> => {
    if (row.source === 'stripe') {
      const id = row.original_transaction_id.replace(/^stripe:/, '');
      let sub: any;
      try {
        sub = await getSubscription(id);
      } catch (e: any) {
        throw new PayerFailure(false, e?.message || 'stripe-unavailable');
      }
      if (!sub) throw new PayerFailure(true, 'subscription-not-found');
      return stripePayerStatus(sub, now());
    }
    try {
      return appleStatus(await verifyDomain(row.original_transaction_id), now());
    } catch (e: any) {
      if (e instanceof VerifyFailure && e.code !== 'apple-unavailable') throw new PayerFailure(true, e.code);
      throw new PayerFailure(false, e?.code || e?.message || 'apple-unavailable');
    }
  };
}

export function liveDomainDeps(): DomainFlowDeps {
  const client = serviceClient();
  const purchases = supabasePurchases(client);
  const shops = supabaseBookingRepo(client);
  // The domain product ONLY (never a site product), with the Apple account's other purchases and
  // the CURRENT renewal status.
  const verifyDomain = lazyDefaultVerifier({ products: [DOMAIN_PRODUCT_ID], includeAccount: true, includeRenewal: true });
  return {
    repo: supabaseDomains(client),
    vercel: liveVercelDomains(),
    contact: registrantContact(),
    verifyDomain,
    // The site verifier: the six site products only (never the domain product).
    verifySite: lazyDefaultVerifier(),
    payer: makePayer(verifyDomain, stripeSubscription, Date.now),
    sitePurchase: (otid) => purchases.get(otid),
    siteRemoved: async (slug) => (await purchases.findBySlug(slug))?.removed_at != null,
    getUser: liveGetUser(client),
    shopOtidOf: async (userId) => (await shops.shopByOwner(userId))?.ios_otid ?? null,
    hooks: makeDomainHooks({
      findBySlug: (slug) => purchases.findBySlug(slug),
      readPending: readPendingSite,
      publish: (slug, opts) => publishSite(slug, opts),
      now: Date.now,
      takedownSandbox: process.env.IOS_TAKEDOWN_SANDBOX === '1',
      // publishSite refreshes ab_shops.site_base_url after each deploy; when no deploy happens:
      refreshBase: makeRefreshBase({ findShop: findShopForSite, refreshSiteBase, siteBaseDeps: liveSiteBaseDeps, projectFor }),
    }),
    limiter: publicLimiter,
    now: Date.now,
    sandboxRealOtids: sandboxRealOtids(),
    probeHttps,
    notifySupport: (subject, text) => notifySupportEmail(subject, text),
    // B1: a website purchase that ends without a domain is refunded (fail(), and the sweep retries).
    cancelAndRefund: (subId) => stripeCancelAndRefund(subId),
    base: {
      async read(slug) {
        const shop = await findShopForSite(slug);
        if (!shop) return undefined;
        const { data, error } = await client.from('ab_shops').select('site_base_url').eq('id', shop.id).maybeSingle();
        if (error) {
          if (isMissingSiteColumn(error)) return undefined; // 011 not applied: nothing to check
          throw new Error(`ab_shops read failed: ${error.message}`);
        }
        return (data as any)?.site_base_url ?? null;
      },
      refresh: makeRefreshBase({ findShop: findShopForSite, refreshSiteBase, siteBaseDeps: liveSiteBaseDeps, projectFor }),
      async clear(slug) {
        const shop = await findShopForSite(slug);
        if (!shop) return;
        const { error } = await client.from('ab_shops').update({ site_base_url: null }).eq('id', shop.id);
        if (error && !isMissingSiteColumn(error)) throw new Error(`ab_shops update failed: ${error.message}`);
      },
    },
  };
}

/** The website domain flow's deps (purchase-domain, the Stripe webhook). */
export function liveWebDomainDeps(authorize: WebDomainDeps['authorize']): WebDomainDeps {
  const key = process.env.STRIPE_SECRET_KEY || '';
  return {
    authorize,
    async getStripeSession(sessionId) {
      const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
        headers: { Authorization: `Bearer ${key}`, 'Stripe-Version': STRIPE_API_VERSION }, signal: AbortSignal.timeout(8_000),
      });
      return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) };
    },
    getSubscription: stripeSubscription,
    flow: liveDomainDeps(),
    secret: process.env.DOMAIN_CHECKOUT_SECRET || '',
    priceId: process.env.STRIPE_DOMAIN_PRICE_ID || undefined,
    cancelAndRefund: (subId) => stripeCancelAndRefund(subId),
    notifySupport: (subject, text) => notifySupportEmail(subject, text),
  };
}

/** The domain half of App Store Server Notifications (lib/ios/notifications.ts routes the domain product here). */
export function liveDomainNotificationSink(): DomainNotificationSink {
  let deps: DomainFlowDeps | undefined;
  return {
    applyNotification: (n) => applyDomainNotification(n, (deps ??= liveDomainDeps())),
  };
}

/** The domain sweep (/api/ios/domain-sweep). Never throws. */
export async function runDomainSweep(deadline: number): Promise<DomainSweepSummary | { error: string }> {
  try {
    return await sweepDomains(liveDomainDeps(), { deadline });
  } catch (e: any) {
    console.error('[Sweeper:domains] threw:', e?.message || e);
    return { error: e?.message || 'domain sweep failed' };
  }
}

/** An email to support (domain refunds / refusals): domain, site and amount only, no customer PII. */
export async function notifySupportEmail(subject: string, text: string): Promise<void> {
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const r = await sendEmail({ to: 'support@davoxa.com', subject, text, html: `<pre>${esc(text)}</pre>`, fromName: 'Prime Barber domains' });
  // S1: only a delivered email counts. Throwing makes alertOnce skip its once-only marker, so the next sweep retries.
  if (r !== 'sent') throw new Error(`support email not sent (${r}): ${subject}`);
}
