// Custom domains from the app (spec 2026-10-22-custom-domains, Server).
//
// The barber's yearly `domain` subscription (Apple, its own subscription group) is a "domain
// slot": one .com, registered on AI Barber's Vercel account and attached (apex + www → apex)
// to the barber's site project. The ios_domains row IS a state machine; every step is
// idempotent and recorded BEFORE and AFTER its side effect, so a crash anywhere is resumed by
// the next claim call (the app retries) or by the iOS sweep, without buying twice or losing
// the domain:
//
//   reserved ──buy──▶ buying ──orderId──▶ ordered ──completed──▶ bought ──attach──▶ attached ──link──▶ live
//      │                │  (crash / unknown outcome: owned? → bought; after 30 min not ours:
//      │                │   available → reserved (retry), taken → failed)
//      ▼                ▼
//    failed (taken | price | registrar | subscription-inactive | registration-expired): the slot
//    is unused; claim may point the same row at another (or the same) name.
//
//   live/attached/bought ──Apple period over (sweep asks Apple)──▶ detaching ──remove + unlink──▶ detached
//   detached/detaching ──resubscribe before the registration runs out──▶ bought (re-attach)
//   any registered state ──admin "transferred"──▶ transferred (never touched again)
//
// Sandbox purchases (App Review, TestFlight) are SIMULATED: the row walks the same states but
// Vercel is never called (no purchase, no attach) and the site is not republished. Only otids
// listed in DOMAINS_SANDBOX_REAL_OTIDS use the real registrar from Sandbox.
//
// Pure over injected deps; lib/ios/domainLive.ts wires Apple, Supabase and Vercel.
import { createHash } from 'node:crypto';
import type { FlowResult } from '../bookings/core.js';
import type { GetUser } from '../bookings/auth.js';
import { authenticate } from '../bookings/auth.js';
import { VerifyFailure, type VerifiedTx } from './appleVerify.js';
import { isActive } from './txStatus.js';
import { GRACE_MS } from './lapse.js';
import { withTimeout } from './timeout.js';
import { candidateDomains, eligiblePrice, isComDomain, normalizeLabel } from './domainNames.js';
import {
  DomainConflict, OWNED_STATES, type DomainRow, type DomainState, type DomainsRepo,
} from './domainsRepo.js';
import type { DomainNotification } from './notifications.js';
import type { RegistrantContact, VercelDomains } from './vercelDomains.js';

export interface DomainHooks {
  /** The site's public address becomes https://{domain}; republish (lib/ios/domainHooks.ts). Throws when it must be retried. */
  onDomainLinked(slug: string, domain: string): Promise<unknown>;
  /** Back to {slug}.vercel.app; republish. Throws when it must be retried. */
  onDomainUnlinked(slug: string): Promise<unknown>;
}

export interface DomainFlowDeps {
  repo: DomainsRepo;
  /** Null when VERCEL_TOKEN is missing. */
  vercel: VercelDomains | null;
  /** Null when VERCEL_REGISTRANT_CONTACT is missing or invalid: no real purchase can be made. */
  contact: RegistrantContact | null;
  /** Apple, domain product ONLY, with accountOriginalTransactionIds. */
  verifyDomain(transactionId: string): Promise<VerifiedTx>;
  /** Apple, the six site products only (the normal site verifier). */
  verifySite(transactionId: string): Promise<VerifiedTx>;
  /** The ios_purchases row of a site purchase. */
  sitePurchase(otid: string): Promise<{ original_transaction_id: string; site_slug: string | null } | null>;
  /** Signed-in fallback proof: the Supabase user … */
  getUser?: GetUser;
  /** … owns the shop linked (ab_shops.ios_otid, set by an authenticated, Apple-verified call) to this purchase. */
  shopOtidOf?(userId: string): Promise<string | null>;
  hooks: DomainHooks;
  /** Shared rate limiter (lib/bookings/rateLimit.ts). Fails open. */
  limiter?: { allow(key: string, kind: 'read' | 'write'): Promise<boolean> };
  now(): number;
  sleep?(ms: number): Promise<void>;
  /** Sandbox otids that may use the REAL registrar (internal testing only). Default: none. */
  sandboxRealOtids?: ReadonlySet<string>;
  /** Live probe of the domain over HTTPS (status only). */
  probeHttps?(domain: string): Promise<boolean>;
}

/** A claim holds the row this long (the function's 300 s budget); the sweep skips leased rows. */
export const LEASE_MS = 290_000;
/** An uncertain buy (crash / timeout, no order id) is only retried after this long. */
export const BUY_UNCERTAIN_MS = 30 * 60_000;
const YEAR_MS = 365 * 24 * 3600_000;
const MAX_STEPS = 12;

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (v: string | null | undefined) => (v ? Date.parse(v) : NaN);
const errMsg = (e: unknown) => String((e as any)?.code || (e as Error)?.message || e).slice(0, 300);
const TX_RE = /^\d{1,32}$/;

/** The Vercel project for a site: the slug (lib/deploySite.ts names projects this way). */
export function projectFor(slug: string): string {
  return slug.toLowerCase().replace(/[''`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 50).replace(/-+$/, '');
}

// ─── public status ───

export interface DomainStatusBody {
  domain: string | null;
  /** registering | linking | live | cancelled-until:<ISO> | failed:<reason> | expired | transferred | none */
  state: string;
  url?: string;
  paidUntil?: string | null;
  autoRenew?: boolean;
  sandbox?: true;
  /** Set on failed:*: the slot is unused, claim another (or the same) name without paying again. */
  canRetry?: boolean;
  vercel?: { verified: boolean | null; dnsOk: boolean | null; ssl: 'ready' | 'pending' | null };
}

export function publicState(row: DomainRow): string {
  switch (row.state) {
    case 'reserved': case 'buying': case 'ordered': return 'registering';
    case 'bought': case 'attached': return 'linking';
    case 'live': return row.auto_renew || !row.paid_until ? 'live' : `cancelled-until:${new Date(row.paid_until).toISOString()}`;
    case 'detaching': case 'detached': return 'expired';
    case 'failed': return `failed:${row.failure_reason || 'unknown'}`;
    case 'transferred': return 'transferred';
    default: return 'unknown';
  }
}

export function statusBody(row: DomainRow | null): DomainStatusBody {
  if (!row) return { domain: null, state: 'none' };
  const b: DomainStatusBody = {
    domain: row.domain,
    state: publicState(row),
    paidUntil: row.paid_until ? new Date(row.paid_until).toISOString() : null,
    autoRenew: row.auto_renew,
  };
  if (row.state === 'live') b.url = `https://${row.domain}`;
  if (row.simulated) b.sandbox = true;
  if (row.state === 'failed') b.canRetry = true;
  return b;
}

// ─── the state machine ───

type Next = 'continue' | 'wait' | 'done';
interface Ctx {
  /** The claim just asked Apple: the subscription is active. Otherwise reserved rows ask first. */
  appleActive?: boolean;
}

async function move(deps: DomainFlowDeps, row: DomainRow, from: DomainState[], patch: Partial<DomainRow>): Promise<{ row: DomainRow; next: Next }> {
  const moved = await deps.repo.update(row.original_transaction_id, from, patch);
  if (moved) return { row: moved, next: 'continue' };
  // Someone else moved it (should not happen under the lease): re-read and re-evaluate.
  const fresh = await deps.repo.get(row.original_transaction_id);
  return { row: fresh ?? row, next: fresh ? 'continue' : 'done' };
}

async function wait(deps: DomainFlowDeps, row: DomainRow, lastError: string | null): Promise<{ row: DomainRow; next: Next }> {
  if (lastError !== row.last_error) {
    const r = await deps.repo.update(row.original_transaction_id, [row.state], { last_error: lastError });
    if (r) row = r;
  }
  return { row, next: 'wait' };
}

const fail = (deps: DomainFlowDeps, row: DomainRow, reason: string, lastError: string | null = null) =>
  move(deps, row, ['reserved', 'buying', 'ordered'], { state: 'failed', failure_reason: reason, last_error: lastError });

/** The registration exists on our account: record it (from reserved, buying or ordered). */
async function toBought(deps: DomainFlowDeps, row: DomainRow, owned: { boughtAt: number | null; expiresAt: number | null; renew: boolean }) {
  return move(deps, row, ['reserved', 'buying', 'ordered'], {
    state: 'bought',
    vercel_bought_at: iso(owned.boughtAt ?? deps.now()),
    registration_expires_at: owned.expiresAt != null ? iso(owned.expiresAt) : null,
    auto_renew_synced: owned.renew === row.auto_renew,
    last_error: null,
  });
}

function registrar(deps: DomainFlowDeps): VercelDomains {
  if (!deps.vercel) throw Object.assign(new Error('registrar-not-configured'), { code: 'registrar-not-configured' });
  return deps.vercel;
}

/** One step from the row's current state. Throws only on repo errors. */
export async function step(row: DomainRow, deps: DomainFlowDeps, ctx: Ctx = {}): Promise<{ row: DomainRow; next: Next }> {
  const now = deps.now();
  const sim = row.simulated;
  try {
    switch (row.state) {
      case 'reserved': {
        if (!ctx.appleActive) {
          let tx: VerifiedTx;
          try {
            tx = await withTimeout(deps.verifyDomain(row.original_transaction_id), 8_000, 'Apple verify');
          } catch (e: any) {
            if (e instanceof VerifyFailure && e.code !== 'apple-unavailable') return fail(deps, row, 'subscription-inactive', e.code);
            return wait(deps, row, `apple: ${errMsg(e)}`);
          }
          if (!isActive(tx, now)) return fail(deps, row, 'subscription-inactive');
          if (tx.expiresAt != null) await deps.repo.extendPaidUntil(row.original_transaction_id, tx.expiresAt);
        }
        if (sim) return toBought(deps, row, { boughtAt: now, expiresAt: now + YEAR_MS, renew: row.auto_renew });
        if (!deps.contact) return wait(deps, row, 'registrar-not-configured');
        const v = registrar(deps);
        // Already ours (a buy whose response was lost)? Then never buy again.
        const owned = await v.owned(row.domain);
        if (owned) return toBought(deps, row, owned);
        const available = (await v.availability([row.domain])).get(row.domain) === true;
        if (!available) return fail(deps, row, 'taken');
        const price = (await v.prices([row.domain])).get(row.domain);
        if (!eligiblePrice(price)) return fail(deps, row, 'price');
        const expectedPrice = price!.purchasePrice as number;
        // Recorded BEFORE the call: a crash during it leaves `buying`, never a second blind buy.
        const buying = await deps.repo.update(row.original_transaction_id, ['reserved'], {
          state: 'buying', buy_started_at: iso(now), expected_price: expectedPrice, last_error: null,
        });
        if (!buying) return move(deps, row, ['reserved'], {});
        row = buying;
        const r = await v.buy(row.domain, { expectedPrice, autoRenew: row.auto_renew, contact: deps.contact });
        if (r.ok === true) return move(deps, row, ['buying'], { state: 'ordered', order_id: r.orderId });
        if (!r.definite) return wait(deps, row, `buy: ${r.code} (outcome unknown)`);
        if (r.code === 'domain_not_available') {
          const mine = await v.owned(row.domain);
          return mine ? toBought(deps, row, mine) : fail(deps, row, 'taken', r.code);
        }
        if (r.code === 'expected_price_mismatch' || r.code === 'order_too_expensive') return fail(deps, row, 'price', r.code);
        // Any other definite refusal (contact data, token scope, TLD): nothing was bought. Back to
        // reserved so it is retried once the configuration is fixed; the slot is not burned.
        const back = await move(deps, row, ['buying'], { state: 'reserved', buy_started_at: null, last_error: `buy: ${r.code}` });
        return { row: back.row, next: 'wait' };
      }

      case 'buying': {
        if (sim) return toBought(deps, row, { boughtAt: now, expiresAt: now + YEAR_MS, renew: row.auto_renew });
        const v = registrar(deps);
        const owned = await v.owned(row.domain);
        if (owned) return toBought(deps, row, owned);
        if (!(now - ms(row.buy_started_at) >= BUY_UNCERTAIN_MS)) return wait(deps, row, row.last_error);
        // Long enough for any real order to have registered it: not ours, so no order went through.
        const available = (await v.availability([row.domain])).get(row.domain) === true;
        if (available) return move(deps, row, ['buying'], { state: 'reserved', buy_started_at: null });
        return fail(deps, row, 'taken');
      }

      case 'ordered': {
        if (sim) return toBought(deps, row, { boughtAt: now, expiresAt: now + YEAR_MS, renew: row.auto_renew });
        if (!row.order_id) return move(deps, row, ['ordered'], { state: 'buying', buy_started_at: row.buy_started_at ?? iso(now) });
        const v = registrar(deps);
        const o = await v.order(row.order_id, row.domain);
        const lineFailed = o.domainStatus === 'failed' || o.domainStatus === 'refunded' || o.domainStatus === 'refund-failed';
        if (o.status === 'completed' && !lineFailed) {
          const owned = await v.owned(row.domain);
          return owned ? toBought(deps, row, owned) : wait(deps, row, 'order completed; domain not visible yet');
        }
        if (o.status === 'failed' || lineFailed) {
          const owned = await v.owned(row.domain);
          if (owned) return toBought(deps, row, owned);
          return fail(deps, row, o.errorCode === 'price-mismatch' ? 'price' : 'registrar', `order: ${o.errorCode || o.domainStatus || o.status}`);
        }
        return wait(deps, row, null); // draft / purchasing / pending
      }

      case 'bought': {
        if (!sim) {
          const v = registrar(deps);
          const project = projectFor(row.site_slug);
          await v.addProjectDomain(project, row.domain);
          await v.addProjectDomain(project, `www.${row.domain}`, row.domain);
        }
        return move(deps, row, ['bought'], { state: 'attached', last_error: null });
      }

      case 'attached': {
        // Sandbox: the address is not real, so the site keeps its vercel.app links.
        if (!sim) await deps.hooks.onDomainLinked(row.site_slug, row.domain);
        return move(deps, row, ['attached'], { state: 'live', linked_at: iso(now), last_error: null });
      }

      case 'detaching': {
        if (!sim) {
          const v = registrar(deps);
          const project = projectFor(row.site_slug);
          await v.removeProjectDomain(project, `www.${row.domain}`);
          await v.removeProjectDomain(project, row.domain);
          await deps.hooks.onDomainUnlinked(row.site_slug);
        }
        return move(deps, row, ['detaching'], { state: 'detached', detached_at: iso(now), last_error: null });
      }

      default:
        return { row, next: 'done' }; // live, detached, failed, transferred
    }
  } catch (e) {
    if (e instanceof DomainConflict) throw e;
    if ((e as any)?.message?.startsWith?.('ios_domains ')) throw e; // repo errors surface
    console.error(`[domains] ${row.domain} (${row.original_transaction_id}) ${row.state}: ${errMsg(e)}`);
    return wait(deps, row, errMsg(e));
  }
}

/** Apply the desired Vercel auto-renew (from Apple). Best effort; the sweep retries. */
export async function syncAutoRenew(row: DomainRow, deps: DomainFlowDeps): Promise<DomainRow> {
  if (row.auto_renew_synced || !OWNED_STATES.includes(row.state)) return row;
  try {
    const expired = Number.isFinite(ms(row.registration_expires_at)) && ms(row.registration_expires_at) <= deps.now();
    if (!row.simulated && !expired) await registrar(deps).setAutoRenew(row.domain, row.auto_renew);
    // Only if auto_renew did not change meanwhile (a notification landing during the call).
    const r = await deps.repo.update(row.original_transaction_id, null, { auto_renew_synced: true }, { auto_renew: row.auto_renew });
    return r ?? row;
  } catch (e) {
    console.error(`[domains] ${row.domain}: auto-renew ${row.auto_renew ? 'on' : 'off'} failed (retried by the sweep): ${errMsg(e)}`);
    return row;
  }
}

/** Run steps until the row has to wait or is finished (or the deadline / step cap is hit). */
export async function advance(row: DomainRow, deps: DomainFlowDeps, ctx: Ctx = {}, deadline = Infinity): Promise<DomainRow> {
  for (let i = 0; i < MAX_STEPS && deps.now() < deadline; i++) {
    const r = await step(row, deps, ctx);
    row = r.row;
    if (r.next !== 'continue') break;
  }
  return syncAutoRenew(row, deps);
}

// ─── shared helpers ───

const bad = (field: string): FlowResult => ({ status: 400, body: { error: 'invalid', field } });
const rateLimited: FlowResult = { status: 429, body: { error: 'rate-limited' }, headers: { 'Retry-After': '60' } };
const unavailable: FlowResult = { status: 503, body: { error: 'temporarily-unavailable' } };
const VERIFY_STATUS = { 'not-found': 404, 'bad-bundle': 400, 'bad-product': 400, 'apple-unavailable': 503 } as const;

async function allowed(deps: DomainFlowDeps, key: string, kind: 'read' | 'write'): Promise<boolean> {
  if (!deps.limiter) return true;
  try {
    return await deps.limiter.allow(key, kind);
  } catch (e: any) {
    console.error('[domains] rate limiter failed, allowing:', e?.message || e); // fail open
    return true;
  }
}

const hashKey = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// ─── POST /api/ios/domain/search ───

export interface SearchResult { domain: string; available: boolean; eligible: boolean }

/**
 * { transactionId?, q } → { results: [{ domain, available, eligible }] }. Never asks Apple: the
 * transactionId is only a (hashed) rate-limit key, so the answer is the same whether or not it
 * exists. The exact .com first, then close suggestions. eligible = available and Vercel's
 * first-year AND renewal price ≤ $15 (never premium). Per-IP limits run in the handler.
 */
export async function runDomainSearch(body: unknown, deps: Pick<DomainFlowDeps, 'vercel' | 'limiter'>): Promise<FlowResult> {
  if (!isObj(body)) return bad('q');
  const label = normalizeLabel(body.q);
  if (!label) return bad('q');
  const tx = body.transactionId;
  if (tx != null && (typeof tx !== 'string' || tx.length > 64)) return bad('transactionId');
  if (typeof tx === 'string' && tx.trim() && !(await allowed(deps as DomainFlowDeps, `domain-search-tx:${hashKey(tx.trim())}`, 'write'))) return rateLimited;
  if (!deps.vercel) return unavailable;
  const domains = candidateDomains(label);
  try {
    const avail = await deps.vercel.availability(domains);
    const open = domains.filter((d) => avail.get(d) === true);
    const prices = open.length ? await deps.vercel.prices(open) : new Map();
    const results: SearchResult[] = domains.map((d) => {
      const available = avail.get(d) === true;
      return { domain: d, available, eligible: available && eligiblePrice(prices.get(d)) };
    });
    return { status: 200, body: { results } };
  } catch (e) {
    console.error('[domains/search] Vercel lookup failed:', errMsg(e));
    return unavailable;
  }
}

// ─── POST /api/ios/domain/claim ───

async function verifyOrResult(fn: () => Promise<VerifiedTx>, tag: string): Promise<VerifiedTx | FlowResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof VerifyFailure) return { status: VERIFY_STATUS[e.code], body: { error: e.code } };
    console.error(`[domains/claim] ${tag} verify threw:`, errMsg(e));
    return { status: 503, body: { error: 'apple-unavailable' } };
  }
}
const isResult = (v: unknown): v is FlowResult => isObj(v) && typeof (v as any).status === 'number' && 'body' in v;

/** Available and price-eligible now? null when fine. Throws on Vercel errors. */
async function precheck(deps: DomainFlowDeps, domain: string): Promise<'domain-taken' | 'domain-not-eligible' | null> {
  const v = registrar(deps);
  if (!((await v.availability([domain])).get(domain) === true)) return 'domain-taken';
  if (!eligiblePrice((await v.prices([domain])).get(domain))) return 'domain-not-eligible';
  return null;
}

function resultFor(row: DomainRow): FlowResult {
  const body = statusBody(row);
  if (row.state === 'live') return { status: 200, body };
  if (row.state === 'failed') return { status: 409, body: { error: 'claim-failed', ...body } };
  return { status: 202, body };
}

/**
 * { transactionId (domain subscription), siteTransactionId (the site's plan), domain } →
 * status body (200 live, 202 in progress, 409 failed / refused). Idempotent: calling again with
 * the same domain resumes wherever the last attempt stopped.
 */
export async function runDomainClaim(body: unknown, authorization: string | string[] | undefined, deps: DomainFlowDeps): Promise<FlowResult> {
  if (!isObj(body)) return bad('body');
  const transactionId = typeof body.transactionId === 'string' ? body.transactionId.trim() : '';
  const siteTransactionId = typeof body.siteTransactionId === 'string' ? body.siteTransactionId.trim() : '';
  const domain = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : '';
  if (!TX_RE.test(transactionId)) return bad('transactionId');
  if (!TX_RE.test(siteTransactionId)) return bad('siteTransactionId');
  if (!isComDomain(domain)) return bad('domain');
  if (!(await allowed(deps, `domain-claim-tx:${hashKey(transactionId)}`, 'write'))) return rateLimited;

  // 1. The domain subscription: Apple-verified, the domain product only, active.
  const dtx = await verifyOrResult(() => deps.verifyDomain(transactionId), 'domain');
  if (isResult(dtx)) return dtx;
  if (!isActive(dtx, deps.now())) return { status: 402, body: { error: 'subscription-inactive' } };
  const otid = dtx.originalTransactionId;
  const simulated = dtx.environment === 'Sandbox' && !(deps.sandboxRealOtids?.has(otid) ?? false);
  if (!simulated && (!deps.vercel || !deps.contact)) {
    console.error('[domains/claim] registrar not configured (VERCEL_TOKEN / VERCEL_REGISTRANT_CONTACT)');
    return { status: 503, body: { error: 'domains-unavailable' } };
  }

  // 2. The site: Apple-verified site purchase, bound to a slug.
  const stx = await verifyOrResult(() => deps.verifySite(siteTransactionId), 'site');
  if (isResult(stx)) return stx;
  const siteOtid = stx.originalTransactionId;
  let site: Awaited<ReturnType<DomainFlowDeps['sitePurchase']>>;
  try {
    site = await deps.sitePurchase(siteOtid);
  } catch (e) {
    console.error('[domains/claim] site lookup failed:', errMsg(e));
    return unavailable;
  }
  if (!site?.site_slug) return { status: 404, body: { error: 'no-site' } };
  const slug = site.site_slug;

  // 3. Same purchaser: Apple lists the site purchase under the same Apple account, or the
  //    signed-in owner's shop is linked to it.
  let owner = (dtx.accountOriginalTransactionIds ?? []).includes(siteOtid);
  if (!owner && authorization && deps.getUser && deps.shopOtidOf) {
    const a = await authenticate(authorization, deps.getUser);
    if (a.ok === true) owner = (await deps.shopOtidOf(a.user.id).catch(() => null)) === siteOtid;
  }
  if (!owner) return { status: 403, body: { error: 'not-owner' } };

  try {
    let row = await deps.repo.get(otid);
    const now = deps.now();
    if (row) {
      // One domain subscription, one site, forever.
      if (row.site_slug !== slug) return { status: 409, body: { error: 'slot-bound-to-other-site' } };
      if (row.state === 'transferred') return { status: 409, body: { error: 'transferred', ...statusBody(row) } };
      if (row.state === 'failed') {
        if (!simulated || deps.vercel) {
          const pre = await precheck(deps, domain);
          if (pre) return { status: 409, body: { error: pre } };
        }
        const holder = await deps.repo.holdingSite(slug);
        if (holder && holder.original_transaction_id !== otid) return { status: 409, body: { error: 'site-has-domain' } };
        try {
          row = await deps.repo.update(otid, ['failed'], {
            state: 'reserved', domain, failure_reason: null, last_error: null, order_id: null, buy_started_at: null,
            expected_price: null, environment: dtx.environment, simulated,
          }) ?? (await deps.repo.get(otid));
        } catch (e) {
          if (e instanceof DomainConflict) return { status: 409, body: { error: 'domain-taken' } };
          throw e;
        }
      } else if (row.domain !== domain) {
        return { status: 409, body: { error: 'slot-in-use', ...statusBody(row) } };
      } else if (row.state === 'detached' || row.state === 'detaching') {
        // Resubscribed: re-attach while the registration is still ours.
        if (Number.isFinite(ms(row.registration_expires_at)) && ms(row.registration_expires_at) > now) {
          row = await deps.repo.update(otid, ['detached', 'detaching'], {
            state: 'bought', auto_renew: true, auto_renew_synced: false, detached_at: null, revoked_at: null,
          }) ?? (await deps.repo.get(otid));
        } else {
          row = await deps.repo.update(otid, ['detached', 'detaching'], { state: 'failed', failure_reason: 'registration-expired' }) ?? row;
          return resultFor(row!);
        }
      }
    } else {
      const holder = await deps.repo.holdingSite(slug);
      if (holder) return { status: 409, body: { error: 'site-has-domain' } };
      if (!simulated || deps.vercel) {
        const pre = await precheck(deps, domain);
        if (pre) return { status: 409, body: { error: pre } };
      }
      const ins = await deps.repo.insertReserved({
        original_transaction_id: otid, environment: dtx.environment, site_slug: slug, domain, simulated,
        paid_until: dtx.expiresAt != null ? iso(dtx.expiresAt) : null,
      });
      row = await deps.repo.get(otid);
      if (ins === 'conflict' && (!row || row.domain !== domain || row.site_slug !== slug)) {
        return { status: 409, body: { error: row ? 'slot-in-use' : 'domain-taken' } };
      }
    }
    if (!row) return unavailable;
    if (dtx.expiresAt != null) await deps.repo.extendPaidUntil(otid, dtx.expiresAt);

    if (!(await deps.repo.acquireLease(otid, deps.now(), LEASE_MS))) return { status: 202, body: statusBody(row) };
    try {
      row = await advance(row, deps, { appleActive: true }, deps.now() + 240_000);
    } finally {
      await deps.repo.releaseLease(otid).catch((e) => console.error(`[domains/claim] ${otid}: releasing the lease failed:`, errMsg(e)));
    }
    return resultFor(row);
  } catch (e) {
    console.error(`[domains/claim] ${otid}: unexpected error:`, errMsg(e));
    return unavailable;
  }
}

// ─── GET/POST /api/ios/domain/status ───

export async function runDomainStatus(transactionIdRaw: unknown, deps: DomainFlowDeps): Promise<FlowResult> {
  const transactionId = typeof transactionIdRaw === 'string' ? transactionIdRaw.trim() : '';
  if (!TX_RE.test(transactionId)) return bad('transactionId');
  const tx = await verifyOrResult(() => deps.verifyDomain(transactionId), 'status');
  if (isResult(tx)) return tx;
  try {
    const row = await deps.repo.get(tx.originalTransactionId);
    const body = statusBody(row);
    if (row && !row.simulated && (row.state === 'live' || row.state === 'attached') && deps.vercel) {
      body.vercel = await probe(row, deps);
    }
    return { status: 200, body };
  } catch (e) {
    console.error('[domains/status] failed:', errMsg(e));
    return unavailable;
  }
}

async function probe(row: DomainRow, deps: DomainFlowDeps): Promise<NonNullable<DomainStatusBody['vercel']>> {
  const v = deps.vercel!;
  const [pd, cfg, https] = await Promise.all([
    withTimeout(v.projectDomain(projectFor(row.site_slug), row.domain), 5_000, 'project domain').catch(() => null),
    withTimeout(v.domainConfig(row.domain), 5_000, 'domain config').catch(() => null),
    deps.probeHttps ? withTimeout(deps.probeHttps(row.domain), 6_000, 'https').catch(() => false) : Promise.resolve(null),
  ]);
  return {
    verified: pd ? pd.verified : null,
    dnsOk: cfg ? !cfg.misconfigured : null,
    ssl: https == null ? null : https ? 'ready' : 'pending',
  };
}

// ─── App Store Server Notifications (domain product) ───

const RENEWING = new Set(['SUBSCRIBED', 'DID_RENEW', 'REFUND_REVERSED']);

/**
 * Records Apple's word on the domain subscription. DB only (Apple wants a fast 200); the sweep
 * applies Vercel side effects (auto-renew, detach). Re-attach on resubscribe is a state move to
 * `bought`, which the sweep (or the app's claim retry) carries out.
 */
export async function applyDomainNotification(n: DomainNotification, deps: Pick<DomainFlowDeps, 'repo' | 'now'>): Promise<{ ok: boolean; ignored?: string }> {
  const row = await deps.repo.get(n.otid);
  if (!row) {
    console.log(`[domains/notification] ${n.type} for ${n.otid}: no domain claimed yet; nothing to do`);
    return { ok: true, ignored: 'no-domain' };
  }
  if (row.state === 'transferred') return { ok: true, ignored: 'transferred' };
  if (n.expiresAt != null) await deps.repo.extendPaidUntil(n.otid, n.expiresAt);

  const patch: Partial<DomainRow> = { last_notification: n.subtype ? `${n.type}:${n.subtype}` : n.type };
  let wantRenew: boolean | null = null;
  if (n.type === 'DID_CHANGE_RENEWAL_STATUS') {
    if (n.subtype === 'AUTO_RENEW_DISABLED') wantRenew = false;
    if (n.subtype === 'AUTO_RENEW_ENABLED') wantRenew = true;
  } else if (n.revokedAt != null) {
    patch.revoked_at = iso(n.revokedAt);
    wantRenew = false;
  } else if (n.type === 'EXPIRED' || n.type === 'GRACE_PERIOD_EXPIRED') {
    wantRenew = false;
  } else if (RENEWING.has(n.type)) {
    patch.revoked_at = null;
    wantRenew = true;
  }
  if (wantRenew !== null && wantRenew !== row.auto_renew) {
    patch.auto_renew = wantRenew;
    patch.auto_renew_synced = false;
  }
  const updated = await deps.repo.update(n.otid, null, patch);

  // Resubscribed after the domain was detached: re-attach while the registration is ours.
  if (RENEWING.has(n.type) && n.revokedAt == null && updated && (updated.state === 'detached' || updated.state === 'detaching')) {
    const regOk = Number.isFinite(ms(updated.registration_expires_at)) && ms(updated.registration_expires_at) > deps.now();
    await deps.repo.update(n.otid, ['detached', 'detaching'], regOk
      ? { state: 'bought', detached_at: null }
      : { state: 'failed', failure_reason: 'registration-expired' });
  }
  return { ok: true };
}

// ─── sweep (runs inside the existing /api/ios/sweep cron) ───

export interface DomainSweepSummary {
  resumed: string[];
  live: string[];
  failed: string[];
  waiting: string[];
  detached: string[];
  stillActive: string[];
  autoRenewSynced: string[];
  appleUnavailable: string[];
  deferred: string[];
  errors: string[];
}

export async function sweepDomains(
  deps: DomainFlowDeps,
  opts: { deadline: number; limit?: number; appleTimeoutMs?: number },
): Promise<DomainSweepSummary> {
  const limit = opts.limit ?? 25;
  const out: DomainSweepSummary = {
    resumed: [], live: [], failed: [], waiting: [], detached: [], stillActive: [], autoRenewSynced: [], appleUnavailable: [], deferred: [], errors: [],
  };
  const outOfTime = () => deps.now() >= opts.deadline;

  async function runLeased(row: DomainRow, ctx: Ctx = {}) {
    const otid = row.original_transaction_id;
    if (!(await deps.repo.acquireLease(otid, deps.now(), LEASE_MS))) return null;
    try {
      const fresh = (await deps.repo.get(otid)) ?? row;
      return await advance(fresh, deps, ctx, opts.deadline);
    } finally {
      await deps.repo.releaseLease(otid).catch(() => {});
    }
  }

  // 1. Lapses first (cheap Apple calls): the Apple period ended → detach.
  try {
    const now = deps.now();
    for (const row of await deps.repo.lapseCandidates(limit, now - GRACE_MS)) {
      if (outOfTime()) { out.deferred.push(row.domain); continue; }
      const otid = row.original_transaction_id;
      let tx: VerifiedTx | null = null;
      try {
        tx = await withTimeout(deps.verifyDomain(otid), opts.appleTimeoutMs ?? 5_000, 'Apple verify');
      } catch (e: any) {
        if (!(e instanceof VerifyFailure) || e.code === 'apple-unavailable') {
          out.appleUnavailable.push(row.domain);
          await deps.repo.update(otid, null, { lapse_checked_at: iso(deps.now()) }).catch(() => {});
          continue;
        }
        // not-found / bad-product: Apple will never vouch for it; treat as ended.
      }
      await deps.repo.update(otid, null, { lapse_checked_at: iso(deps.now()) }).catch(() => {});
      if (tx && isActive(tx, deps.now())) {
        if (tx.expiresAt != null) await deps.repo.extendPaidUntil(otid, tx.expiresAt);
        if (row.revoked_at && !tx.revoked) await deps.repo.update(otid, null, { revoked_at: null });
        out.stillActive.push(row.domain);
        continue;
      }
      const moved = await deps.repo.update(otid, ['bought', 'attached', 'live'], {
        state: 'detaching', auto_renew: false, auto_renew_synced: row.auto_renew === false ? row.auto_renew_synced : false,
      });
      if (!moved) continue;
      const done = await runLeased(moved);
      if (done?.state === 'detached') out.detached.push(row.domain);
      else out.waiting.push(row.domain);
    }
  } catch (e) {
    console.error('[domains/sweep] lapse pass failed:', errMsg(e));
    out.errors.push(`lapse: ${errMsg(e)}`);
  }

  // 2. Resume every row with a step still due (crashed claims, pending orders, re-attaches).
  try {
    for (const row of await deps.repo.resumable(limit, deps.now())) {
      if (outOfTime()) { out.deferred.push(row.domain); continue; }
      out.resumed.push(row.domain);
      const done = await runLeased(row);
      if (!done) continue;
      if (done.state === 'live') out.live.push(done.domain);
      else if (done.state === 'failed') out.failed.push(done.domain);
      else if (done.state === 'detached') out.detached.push(done.domain);
      else out.waiting.push(done.domain);
    }
  } catch (e) {
    console.error('[domains/sweep] resume pass failed:', errMsg(e));
    out.errors.push(`resume: ${errMsg(e)}`);
  }

  // 3. Vercel auto-renew follows Apple's renewal status.
  try {
    for (const row of await deps.repo.autoRenewUnsynced(limit)) {
      if (outOfTime()) { out.deferred.push(row.domain); continue; }
      const r = await syncAutoRenew(row, deps);
      if (r.auto_renew_synced) out.autoRenewSynced.push(row.domain);
    }
  } catch (e) {
    console.error('[domains/sweep] auto-renew pass failed:', errMsg(e));
    out.errors.push(`auto-renew: ${errMsg(e)}`);
  }
  return out;
}

// ─── admin ───

/** Manual transfer to the barber is done in Vercel: stop the lifecycle from touching the domain. */
export async function markTransferred(slug: string, by: string, deps: Pick<DomainFlowDeps, 'repo' | 'now'>): Promise<{ ok: boolean; error?: string; domain?: string }> {
  const row = (await deps.repo.all()).find((r) => r.site_slug === slug && OWNED_STATES.includes(r.state));
  if (!row) return { ok: false, error: 'no-domain' };
  const moved = await deps.repo.update(row.original_transaction_id, OWNED_STATES, {
    state: 'transferred', transferred_at: iso(deps.now()), transferred_by: by,
  });
  return moved ? { ok: true, domain: moved.domain } : { ok: false, error: 'conflict' };
}
