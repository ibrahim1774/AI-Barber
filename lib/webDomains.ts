// The web custom-domain flow (api/create-domain-checkout → Stripe → api/purchase-domain), with
// the money hole closed (spec 2026-10-22-custom-domains, Server, last bullet):
//
// - The price is computed HERE from Vercel's own price for the name (never the client's
//   `vercelPrice`), and the Vercel project from the site id (never the client's `projectName`).
//   Both travel to purchase-domain only inside the Stripe session's metadata, which we wrote.
// - purchase-domain is single-use per paid Checkout session: a web_domain_purchases row keyed by
//   the session id is inserted BEFORE the Vercel buy, so a replayed session id gets the stored
//   result and never a second purchase. A definite refusal (nothing bought) may be retried.
// - The buy sends what Vercel's API requires today: expectedPrice and the registrant contact
//   (server config, VERCEL_REGISTRANT_CONTACT). The old body ({ autoRenew, years }) was refused.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RegistrantContact, VercelDomains } from './ios/vercelDomains.js';

/** Our margin on top of Vercel's price, USD (unchanged from the original flow). */
export const WEB_MARKUP_USD = 5;
/** Never sell a name whose first-year or renewal price is above this (premium names). */
export const WEB_MAX_PRICE_USD = 50;

const HOST_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

export function normalizeWebDomain(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const d = v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return HOST_RE.test(d) && !/(^|\.)xn--/.test(d) ? d : null;
}

/** The Vercel project of a site: the canonical slug (lib/publishSite.ts slugify, same rules). */
export function projectOf(siteId: unknown): string | null {
  if (typeof siteId !== 'string') return null;
  const p = siteId.toLowerCase().replace(/[''`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 50).replace(/-+$/, '');
  return p || null;
}

const okPrice = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= WEB_MAX_PRICE_USD;

export interface WebResult { status: number; body: Record<string, unknown> }

export interface CheckoutDeps {
  vercel: VercelDomains | null;
  /** POST https://api.stripe.com/v1/checkout/sessions (form params) → the session JSON. */
  createStripeSession(params: URLSearchParams): Promise<{ ok: boolean; status: number; data: any }>;
}

/** { domain, siteId } (+ ignored client fields) → { url } of a Stripe Checkout priced server-side. */
export async function createDomainCheckout(body: any, origin: string, deps: CheckoutDeps): Promise<WebResult> {
  const domain = normalizeWebDomain(body?.domain);
  const project = projectOf(body?.siteId);
  if (!domain || !project) return { status: 400, body: { error: 'Missing or invalid fields: domain, siteId' } };
  if (!deps.vercel) return { status: 500, body: { error: 'Server configuration error: missing VERCEL_TOKEN' } };

  let available: boolean;
  let price: { purchasePrice: unknown; renewalPrice: unknown } | undefined;
  try {
    available = (await deps.vercel.availability([domain])).get(domain) === true;
    price = available ? (await deps.vercel.prices([domain])).get(domain) : undefined;
  } catch (e: any) {
    console.error('[CreateDomainCheckout] Vercel lookup failed:', e?.code || e?.message || e);
    return { status: 503, body: { error: 'Could not check the domain right now' } };
  }
  if (!available) return { status: 409, body: { error: 'Domain is not available' } };
  if (!price || !okPrice(price.purchasePrice) || !okPrice(price.renewalPrice)) {
    return { status: 409, body: { error: 'Domain is not available at a standard price' } };
  }
  const vercelPrice = price.purchasePrice;
  const priceInCents = Math.round((vercelPrice + WEB_MARKUP_USD) * 100);

  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('success_url', `${origin}?domain_payment=success&session_id={CHECKOUT_SESSION_ID}`);
  params.append('cancel_url', `${origin}?domain_payment=cancelled`);
  params.append('line_items[0][price_data][currency]', 'usd');
  params.append('line_items[0][price_data][product_data][name]', `Domain Registration - ${domain}`);
  params.append('line_items[0][price_data][unit_amount]', String(priceInCents));
  params.append('line_items[0][quantity]', '1');
  params.append('metadata[type]', 'domain_purchase');
  params.append('metadata[domain]', domain);
  params.append('metadata[projectName]', project);
  params.append('metadata[siteId]', String(body.siteId));
  // Server-computed; purchase-domain sends it to Vercel as expectedPrice.
  params.append('metadata[vercelPrice]', String(vercelPrice));

  const r = await deps.createStripeSession(params);
  if (!r.ok) {
    console.error('[CreateDomainCheckout] Stripe error:', r.status, r.data?.error?.type || '');
    return { status: 400, body: { error: 'Failed to create checkout session' } };
  }
  return { status: 200, body: { url: r.data?.url } };
}

// ─── purchase-domain ───

export interface WebPurchaseRow {
  stripe_session_id: string; domain: string; project: string;
  state: 'buying' | 'bought' | 'failed'; order_id: string | null; error: string | null;
}

export interface WebPurchasesRepo {
  /** Insert in state 'buying'; 'conflict' when this session already has a row. */
  insert(row: Pick<WebPurchaseRow, 'stripe_session_id' | 'domain' | 'project'>): Promise<'ok' | 'conflict'>;
  get(sessionId: string): Promise<WebPurchaseRow | null>;
  /** Conditional on the current state; null when it was not in `from`. */
  update(sessionId: string, from: WebPurchaseRow['state'], patch: Partial<WebPurchaseRow>): Promise<WebPurchaseRow | null>;
}

export interface PurchaseDeps {
  getStripeSession(sessionId: string): Promise<{ ok: boolean; status: number; data: any }>;
  repo: WebPurchasesRepo;
  vercel: VercelDomains | null;
  contact: RegistrantContact | null;
  /** STRIPE_SECRET_KEY starts with sk_test_: never buy for real. */
  testMode: boolean;
}

function storedResult(row: WebPurchaseRow): WebResult {
  if (row.state === 'bought') return { status: 200, body: { success: true, domain: row.domain, orderId: row.order_id, alreadyProcessed: true } };
  if (row.state === 'buying') return { status: 409, body: { error: 'Purchase already in progress for this payment', domain: row.domain } };
  return { status: 400, body: { error: `Domain purchase failed: ${row.error || 'unknown'}`, domain: row.domain } };
}

export async function purchaseDomain(body: any, deps: PurchaseDeps): Promise<WebResult> {
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!/^cs_[A-Za-z0-9_]{8,200}$/.test(sessionId)) return { status: 400, body: { error: 'Missing sessionId' } };

  const s = await deps.getStripeSession(sessionId);
  if (!s.ok) return { status: 400, body: { error: 'Invalid checkout session' } };
  const session = s.data || {};
  if (session.payment_status !== 'paid') return { status: 400, body: { error: `Payment not completed: ${session.payment_status}` } };
  const md = session.metadata || {};
  if (md.type !== 'domain_purchase') return { status: 400, body: { error: 'Not a domain purchase' } };
  const domain = normalizeWebDomain(md.domain);
  const project = projectOf(md.projectName);
  const expectedPrice = Number(md.vercelPrice);
  if (!domain || !project) return { status: 400, body: { error: 'Missing domain or projectName in session metadata' } };
  if (!deps.testMode && !okPrice(expectedPrice)) return { status: 400, body: { error: 'Missing price in session metadata' } };
  if (!deps.testMode && (!deps.vercel || !deps.contact)) return { status: 500, body: { error: 'Server configuration error' } };

  // Single use: the row is written BEFORE any buy.
  let row: WebPurchaseRow | null;
  if ((await deps.repo.insert({ stripe_session_id: sessionId, domain, project })) === 'conflict') {
    const existing = await deps.repo.get(sessionId);
    if (!existing) return { status: 503, body: { error: 'Try again shortly' } };
    // Only a DEFINITE earlier refusal (nothing was bought) may be retried.
    if (existing.state !== 'failed' || !existing.error?.startsWith('definite:')) return storedResult(existing);
    row = await deps.repo.update(sessionId, 'failed', { state: 'buying', error: null });
    if (!row) return storedResult((await deps.repo.get(sessionId)) ?? existing);
  }

  if (deps.testMode) {
    console.log(`[PurchaseDomain] TEST MODE: Skipping real purchase for ${domain}`);
    const orderId = `test_order_${sessionId.slice(-12)}`;
    await deps.repo.update(sessionId, 'buying', { state: 'bought', order_id: orderId });
    return { status: 200, body: { success: true, domain, orderId } };
  }

  const r = await deps.vercel!.buy(domain, { expectedPrice, autoRenew: true, contact: deps.contact! });
  if (r.ok === false) {
    console.error('[PurchaseDomain] Vercel buy error:', r.status, r.code);
    // Unknown outcome (timeout / 5xx): the row stays 'buying', so a replay can never buy again.
    if (r.definite) await deps.repo.update(sessionId, 'buying', { state: 'failed', error: `definite:${r.code}` });
    return { status: 400, body: { error: `Domain purchase failed: ${r.code}` } };
  }
  await deps.repo.update(sessionId, 'buying', { state: 'bought', order_id: r.orderId });

  try {
    await deps.vercel!.addProjectDomain(project, domain);
  } catch (e: any) {
    // Non-fatal: the domain is bought; it can be attached by hand.
    console.error('[PurchaseDomain] Add domain to project error:', e?.status || '', e?.code || e?.message || e);
  }
  return { status: 200, body: { success: true, domain, orderId: r.orderId } };
}

export function supabaseWebPurchases(client: () => SupabaseClient): WebPurchasesRepo {
  const T = 'web_domain_purchases';
  return {
    async insert(row) {
      const { error } = await client().from(T).insert({ ...row, state: 'buying' });
      if (error) {
        if ((error as { code?: string }).code === '23505') return 'conflict';
        throw new Error(`${T} insert failed: ${error.message}`);
      }
      return 'ok';
    },
    async get(id) {
      const { data, error } = await client().from(T).select('*').eq('stripe_session_id', id).maybeSingle();
      if (error) throw new Error(`${T} get failed: ${error.message}`);
      return (data as WebPurchaseRow) ?? null;
    },
    async update(id, from, patch) {
      const { data, error } = await client().from(T).update({ ...patch, updated_at: new Date().toISOString() })
        .eq('stripe_session_id', id).eq('state', from).select();
      if (error) throw new Error(`${T} update failed: ${error.message}`);
      return Array.isArray(data) && data[0] ? (data[0] as WebPurchaseRow) : null;
    },
  };
}
