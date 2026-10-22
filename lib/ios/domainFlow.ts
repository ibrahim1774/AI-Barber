// Custom domains (spec 2026-10-22-custom-domains, Server), from the app (Apple yearly
// subscription) and the website (Stripe $39/year subscription), through ONE state machine.
//
// A domain subscription is a "domain slot": one .com, registered on AI Barber's Vercel account
// and attached (apex + www → apex) to the site's project. The ios_domains row IS the state
// machine; every step is idempotent and recorded BEFORE and AFTER its side effect, so a crash
// anywhere is resumed by the next claim call or by the domain sweep, without buying twice or
// losing the domain:
//
//   reserved ──buy (auto-renew OFF)──▶ buying ──orderId──▶ ordered ──completed──▶ bought ──attach──▶ attached ──link──▶ live
//     │  buying with an unknown outcome: ours (Vercel says so) → bought; otherwise it STAYS
//     │  buying (admin-visible) until an admin releases it: never re-bought on availability alone.
//     ▼
//   failed (taken | price | registrar | subscription-inactive | registration-expired): the slot
//   is unused; claim may point the row at another (or the same) name. A slot is only freed when
//   nothing was bought, or Vercel confirms the registration is gone.
//
//   bought/attached/live ──period over (payer says inactive)──▶ detaching ──remove──▶ unlinking ──republish──▶ detached
//   detached ──paid again, and Vercel confirms the registration is still ours──▶ bought (re-attach)
//                                    (a newer domain on the same site wins: this one stays detached)
//   any registered state ──admin "transferred"──▶ transferred (never touched again)
//
// Money rules:
// - Every buy is made with Vercel auto-renew OFF. Auto-renew is then turned on only while the
//   payer's CURRENT renewal status (Apple's latest signedRenewalInfo / the Stripe subscription,
//   re-fetched, never a notification payload) says it renews.
// - Every auto-renew / expiry / slot decision reads Vercel LIVE (owned()); the stored
//   registration_expires_at is display only.
// - Sandbox (and Stripe test mode) rows are SIMULATED: Vercel is never called. Only otids in
//   DOMAINS_SANDBOX_REAL_OTIDS use the real registrar from Sandbox.
//
// Pure over injected deps; lib/ios/domainLive.ts wires Apple, Stripe, Supabase and Vercel.
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
  ATTACHED_STATES, DomainConflict, OWNED_STATES, SITE_HOLDING_STATES,
  type DomainRow, type DomainSource, type DomainState, type DomainsRepo,
} from './domainsRepo.js';
import type { DomainNotification } from './notifications.js';
import { VercelApiError, type RegistrantContact, type VercelDomains } from './vercelDomains.js';

export interface DomainHooks {
  /** The site's public address becomes https://{domain}; republish (lib/ios/domainHooks.ts). Throws when it must be retried. */
  onDomainLinked(slug: string, domain: string): Promise<unknown>;
  /** Back to {slug}.vercel.app; republish. Throws when it must be retried. */
  onDomainUnlinked(slug: string): Promise<unknown>;
}

/** The payer's CURRENT state for a domain subscription (Apple or Stripe), freshly fetched. */
export interface PayerStatus {
  active: boolean;
  /** Will it renew? null = unknown (treated as "no"). */
  autoRenew: boolean | null;
  /** End of the current paid period. */
  expiresAt: number | null;
  revoked: boolean;
}

/** The payer could not answer. `permanent`: it never will (unknown purchase). */
export class PayerFailure extends Error {
  constructor(public permanent: boolean, public code: string) {
    super(code);
    this.name = 'PayerFailure';
  }
}

export interface DomainFlowDeps {
  repo: DomainsRepo;
  /** Null when VERCEL_TOKEN is missing. */
  vercel: VercelDomains | null;
  /** Null when VERCEL_REGISTRANT_CONTACT is missing or invalid: no real purchase can be made. */
  contact: RegistrantContact | null;
  /** Apple, domain product ONLY, with accountOriginalTransactionIds and autoRenew. */
  verifyDomain(transactionId: string): Promise<VerifiedTx>;
  /** Apple, the six site products only (the normal site verifier). */
  verifySite(transactionId: string): Promise<VerifiedTx>;
  /** The payer's current status for a row (Apple by otid, Stripe by subscription). Throws PayerFailure. */
  payer(row: Pick<DomainRow, 'original_transaction_id' | 'source'>): Promise<PayerStatus>;
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
  /** Sandbox otids that may use the REAL registrar (internal testing only). Default: none. */
  sandboxRealOtids?: ReadonlySet<string>;
  /** Live probe of the domain over HTTPS (status only). */
  probeHttps?(domain: string): Promise<boolean>;
  /**
   * The shop's stored public base (ab_shops.site_base_url) for a site: undefined when the site
   * has no shop (web sites) or the column doesn't exist yet; then nothing is checked. `refresh`
   * re-derives it from the project's domains (site-subpages refreshSiteBase), without a deploy.
   */
  base?: { read(slug: string): Promise<string | null | undefined>; refresh(slug: string): Promise<unknown> };
}

/** A claim holds the row this long (the function's 300 s budget); the sweep skips leased rows. */
export const LEASE_MS = 290_000;
/** A claim call only STARTS steps this long (one slow republish still ends inside 300 s). */
export const CLAIM_STEP_CUTOFF_MS = 140_000;
/** The sweep re-asks every registered row's payer at least this often (renewal status drift). */
export const PAYER_REFRESH_MS = 12 * 3600_000;
const YEAR_MS = 365 * 24 * 3600_000;
const MAX_STEPS = 12;

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (v: string | null | undefined) => (v ? Date.parse(v) : NaN);
const errMsg = (e: unknown) => String((e as any)?.code || (e as Error)?.message || e).slice(0, 300);
const TX_RE = /^\d{1,32}$/;
const STOPPED: readonly DomainState[] = ['detaching', 'unlinking', 'detached', 'failed', 'transferred'];
export const BASE_PENDING = 'base URL not yet the domain; retried by the sweep';
export const RENEWAL_UNKNOWN = 'ALERT: renewal status unknown at the payer; Vercel auto-renew left as it is';

/** The Vercel project for a site: the slug (lib/deploySite.ts names projects this way). */
export function projectFor(slug: string): string {
  return slug.toLowerCase().replace(/[''`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 50).replace(/-+$/, '');
}

export function appleStatus(tx: VerifiedTx, now: number): PayerStatus {
  return { active: isActive(tx, now), autoRenew: tx.autoRenew ?? null, expiresAt: tx.expiresAt, revoked: tx.revoked };
}

/** Vercel auto-renew we want: paid, renewing (per the payer NOW), and the domain still in use. */
export function desiredAutoRenew(state: DomainState, s: PayerStatus): boolean {
  return s.active && s.autoRenew === true && !STOPPED.includes(state);
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
    case 'detaching': case 'unlinking': case 'detached': return 'expired';
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

// ─── payer refresh ───

/**
 * Record the payer's CURRENT word: paid_until (max), revocation, and the desired auto-renew.
 * The update is conditional on the state it was computed for, so a concurrent transition
 * (e.g. to detaching) is never overwritten with a stale desire.
 */
export async function refreshFromPayer(row: DomainRow, s: PayerStatus, deps: Pick<DomainFlowDeps, 'repo' | 'now'>): Promise<DomainRow> {
  const otid = row.original_transaction_id;
  if (s.expiresAt != null) await deps.repo.extendPaidUntil(otid, s.expiresAt);
  for (let i = 0; i < 2; i++) {
    // Apple's renewal status unknown while the subscription is active: keep the current setting
    // (never a fresh change either way) and flag it for the admin.
    const unknown = s.active && s.autoRenew == null && !STOPPED.includes(row.state);
    const want = unknown ? row.auto_renew : desiredAutoRenew(row.state, s);
    const patch: Partial<DomainRow> = {
      payer_checked_at: iso(deps.now()),
      revoked_at: s.revoked ? (row.revoked_at ?? iso(deps.now())) : null,
    };
    if (unknown) {
      patch.last_error = RENEWAL_UNKNOWN;
      console.error(`[domains] ALERT ${row.domain} (${otid}): the payer's renewal status is unknown; Vercel auto-renew left as it is`);
    } else if (row.last_error === RENEWAL_UNKNOWN) {
      patch.last_error = null;
    }
    if (want !== row.auto_renew) {
      patch.auto_renew = want;
      patch.auto_renew_synced = false;
    }
    const r = await deps.repo.update(otid, [row.state], patch);
    if (r) return r;
    const fresh = await deps.repo.get(otid);
    if (!fresh) return row;
    row = fresh;
  }
  return row;
}

async function askPayer(row: DomainRow, deps: DomainFlowDeps, timeoutMs = 8_000): Promise<PayerStatus> {
  return withTimeout(deps.payer(row), timeoutMs, 'payer status');
}

// ─── the state machine ───

type Next = 'continue' | 'wait' | 'done';
interface Ctx {
  /** The caller just asked the payer (claim): use this instead of asking again. */
  payer?: PayerStatus;
}

async function move(deps: DomainFlowDeps, row: DomainRow, from: DomainState[], patch: Partial<DomainRow>): Promise<{ row: DomainRow; next: Next }> {
  const moved = await deps.repo.update(row.original_transaction_id, from, patch);
  if (moved) return { row: moved, next: 'continue' };
  // Someone else moved it (should not happen under the lease): re-read and re-evaluate.
  const fresh = await deps.repo.get(row.original_transaction_id);
  return { row: fresh ?? row, next: fresh && fresh.state !== row.state ? 'continue' : 'done' };
}

async function wait(deps: DomainFlowDeps, row: DomainRow, lastError: string | null): Promise<{ row: DomainRow; next: Next }> {
  if (lastError !== row.last_error) {
    const r = await deps.repo.update(row.original_transaction_id, [row.state], { last_error: lastError });
    if (r) row = r;
  }
  return { row, next: 'wait' };
}

/** Free the slot: only from states where nothing of ours is registered. */
const fail = (deps: DomainFlowDeps, row: DomainRow, reason: string, lastError: string | null = null) =>
  move(deps, row, ['reserved', 'buying', 'ordered'], { state: 'failed', failure_reason: reason, last_error: lastError, auto_renew: false });

/** The registration exists on our account (Vercel said so just now): record it. */
async function toBought(deps: DomainFlowDeps, row: DomainRow, owned: { boughtAt: number; expiresAt: number; renew: boolean }) {
  return move(deps, row, ['reserved', 'buying', 'ordered'], {
    state: 'bought',
    vercel_bought_at: iso(owned.boughtAt),
    registration_expires_at: iso(owned.expiresAt),
    // Always re-checked by syncAutoRenew right after (it may need to cover the paid period).
    auto_renew_synced: false,
    last_error: null,
  });
}

function registrar(deps: DomainFlowDeps): VercelDomains {
  if (!deps.vercel) throw Object.assign(new Error('registrar-not-configured'), { code: 'registrar-not-configured' });
  return deps.vercel;
}

const simOwned = (deps: DomainFlowDeps) => ({ boughtAt: deps.now(), expiresAt: deps.now() + YEAR_MS, renew: false });

/** One step from the row's current state. Throws only on repo errors. */
export async function step(row: DomainRow, deps: DomainFlowDeps, ctx: Ctx = {}): Promise<{ row: DomainRow; next: Next }> {
  const sim = row.simulated;
  try {
    switch (row.state) {
      case 'reserved': {
        let s = ctx.payer;
        if (!s) {
          try {
            s = await askPayer(row, deps);
          } catch (e: any) {
            if (e instanceof PayerFailure && e.permanent) return fail(deps, row, 'subscription-inactive', e.code);
            return wait(deps, row, `payer: ${errMsg(e)}`);
          }
          row = await refreshFromPayer(row, s, deps);
        }
        if (!s.active) return fail(deps, row, 'subscription-inactive');
        if (sim) return toBought(deps, row, simOwned(deps));
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
          state: 'buying', buy_started_at: iso(deps.now()), expected_price: expectedPrice, last_error: null,
        });
        if (!buying) return move(deps, row, ['reserved'], {});
        row = buying;
        // Auto-renew OFF at purchase: it is turned on only once recorded, and only while the payer renews.
        const r = await v.buy(row.domain, { expectedPrice, autoRenew: false, contact: deps.contact });
        if (r.ok === true) return move(deps, row, ['buying'], { state: 'ordered', order_id: r.orderId });
        if (!r.definite) return wait(deps, row, `buy outcome unknown (${r.code}): waiting for Vercel to show it; an admin releases it if it never does`);
        if (r.code === 'domain_not_available') {
          const mine = await v.owned(row.domain);
          return mine ? toBought(deps, row, mine) : fail(deps, row, 'taken', r.code);
        }
        if (r.code === 'expected_price_mismatch' || r.code === 'order_too_expensive') return fail(deps, row, 'price', r.code);
        // Any other definite refusal (contact data, token scope): nothing was bought. Back to
        // reserved so it is retried once the configuration is fixed; the slot is not burned.
        const back = await move(deps, row, ['buying'], { state: 'reserved', buy_started_at: null, last_error: `buy: ${r.code}` });
        return { row: back.row, next: 'wait' };
      }

      case 'buying': {
        if (sim) return toBought(deps, row, simOwned(deps));
        // The buy's outcome is unknown. Ours now? Recorded. Otherwise stay here: availability
        // alone never proves no order of ours is in flight, so this is never re-bought
        // automatically (admin: lib/admin/sites.ts domainBuyRelease after checking Vercel).
        const owned = await registrar(deps).owned(row.domain);
        if (owned) return toBought(deps, row, owned);
        return wait(deps, row, row.last_error || 'buy outcome unknown: not in our Vercel account; admin must check Vercel and release');
      }

      case 'ordered': {
        if (sim) return toBought(deps, row, simOwned(deps));
        if (!row.order_id) return move(deps, row, ['ordered'], { state: 'buying', buy_started_at: row.buy_started_at ?? iso(deps.now()) });
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
        return move(deps, row, ['attached'], { state: 'live', linked_at: iso(deps.now()), dns_ready_at: null, last_error: null });
      }

      case 'detaching': {
        if (!sim) {
          const v = registrar(deps);
          const project = projectFor(row.site_slug);
          await v.removeProjectDomain(project, `www.${row.domain}`);
          await v.removeProjectDomain(project, row.domain);
        }
        return move(deps, row, ['detaching'], { state: 'unlinking', last_error: null });
      }

      case 'unlinking': {
        if (!sim) {
          await deps.hooks.onDomainUnlinked(row.site_slug);
          // The shop's public base must no longer be the domain (emails, payment returns).
          if (deps.base && (await deps.base.read(row.site_slug)) === `https://${row.domain}`) {
            await deps.base.refresh(row.site_slug);
            if ((await deps.base.read(row.site_slug)) === `https://${row.domain}`) {
              return wait(deps, row, 'base URL still points at the detached domain; retried');
            }
          }
        }
        return move(deps, row, ['unlinking'], { state: 'detached', detached_at: iso(deps.now()), last_error: null });
      }

      case 'detached': {
        // Re-attach only when paid again AND Vercel confirms the registration is still ours.
        let s = ctx.payer;
        if (!s) {
          if (!(ms(row.paid_until) > deps.now()) || row.revoked_at) return { row, next: 'done' };
          try {
            s = await askPayer(row, deps);
          } catch (e) {
            return wait(deps, row, `payer: ${errMsg(e)}`);
          }
          row = await refreshFromPayer(row, s, deps);
        }
        if (!s.active) return { row, next: 'done' };
        let owned: Awaited<ReturnType<VercelDomains['owned']>> = null;
        if (sim) owned = simOwned(deps);
        else owned = await registrar(deps).owned(row.domain); // throws on errors: never read as "gone"
        if (!owned) {
          // Confirmed gone from our account: only now is the slot freed.
          return move(deps, row, ['detached'], { state: 'failed', failure_reason: 'registration-expired', auto_renew: false });
        }
        try {
          return await move(deps, row, ['detached'], {
            state: 'bought', detached_at: null, registration_expires_at: iso(owned.expiresAt),
            auto_renew: desiredAutoRenew('bought', s), auto_renew_synced: false, last_error: null,
          });
        } catch (e) {
          if (!(e instanceof DomainConflict)) throw e;
          // The site took a newer domain meanwhile: newer wins; this one stays detached, not renewing.
          const r = await deps.repo.update(row.original_transaction_id, ['detached'], {
            last_error: 'the site has a newer domain; this one stays detached', auto_renew: false, auto_renew_synced: false,
          });
          return { row: r ?? row, next: 'done' };
        }
      }

      default:
        return { row, next: 'done' }; // live, failed, transferred
    }
  } catch (e) {
    if (e instanceof DomainConflict) throw e;
    if ((e as any)?.message?.startsWith?.('ios_domains ')) throw e; // repo errors surface
    console.error(`[domains] ${row.domain} (${row.original_transaction_id}) ${row.state}: ${errMsg(e)}`);
    return wait(deps, row, errMsg(e));
  }
}

/**
 * Make Vercel's auto-renew match the desired one, reading Vercel LIVE (never the stored expiry):
 * gone or expired at Vercel → nothing to renew; otherwise PATCH when it differs. Marks the row
 * synced only after Vercel confirmed (a read or a successful PATCH), and only if auto_renew did
 * not change meanwhile.
 */
export async function syncAutoRenew(row: DomainRow, deps: DomainFlowDeps): Promise<DomainRow> {
  if (!OWNED_STATES.includes(row.state)) return row;
  const markSynced = async (extra: Partial<DomainRow> = {}) =>
    (await deps.repo.update(row.original_transaction_id, OWNED_STATES, { auto_renew_synced: true, ...extra }, { auto_renew: row.auto_renew })) ?? row;
  if (row.simulated) return row.auto_renew_synced ? row : markSynced();
  try {
    const v = registrar(deps);
    const owned = await v.owned(row.domain);
    const gone = (e: unknown) => e instanceof VercelApiError
      && (e.code === 'domain_not_found' || e.code === 'domain_not_registered' || e.code === 'domain_not_renewable');
    // Keep the registration through the period already paid: if it would end before paid_until,
    // Vercel renews it once even when the subscriber turned renewal off.
    const coverPaid = !row.auto_renew && !!owned && ATTACHED_STATES.includes(row.state)
      && ms(row.paid_until) > owned.expiresAt;
    if (coverPaid) {
      if (!owned!.renew) await v.setAutoRenew(row.domain, true);
      // Not marked synced: once the registration outlasts paid_until, the next pass turns it off.
      const r = await deps.repo.update(row.original_transaction_id, null, { registration_expires_at: iso(owned!.expiresAt) });
      return r ?? row;
    }
    if (!row.auto_renew) {
      // OFF is always sent unless Vercel already shows it off: a registration just past its
      // expiry reads as "not ours" but may still be renewable in the registry's grace window.
      if (!owned || owned.renew) {
        try {
          await v.setAutoRenew(row.domain, false);
        } catch (e) {
          if (!gone(e)) throw e;
        }
      }
      return markSynced(owned ? { registration_expires_at: iso(owned.expiresAt) } : {});
    }
    if (!owned) return markSynced(); // not ours / expired: nothing to turn on
    if (!owned.renew) {
      try {
        await v.setAutoRenew(row.domain, true);
      } catch (e) {
        if (!gone(e)) throw e;
      }
    }
    return markSynced({ registration_expires_at: iso(owned.expiresAt) });
  } catch (e) {
    console.error(`[domains] ${row.domain}: auto-renew ${row.auto_renew ? 'on' : 'off'} failed (retried by the sweep): ${errMsg(e)}`);
    if (row.auto_renew_synced) await deps.repo.update(row.original_transaction_id, null, { auto_renew_synced: false }).catch(() => {});
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
  return row.auto_renew_synced ? row : syncAutoRenew(row, deps);
}

/** Run `fn` holding the row's lease; null when someone else holds it. */
async function leased<T>(otid: string, deps: Pick<DomainFlowDeps, 'repo' | 'now'>, fn: () => Promise<T>): Promise<T | null> {
  const token = await deps.repo.acquireLease(otid, deps.now(), LEASE_MS);
  if (!token) return null;
  try {
    return await fn();
  } finally {
    await deps.repo.releaseLease(otid, token).catch((e) => console.error(`[domains] ${otid}: releasing the lease failed:`, errMsg(e)));
  }
}

// ─── shared helpers ───

const bad = (field: string): FlowResult => ({ status: 400, body: { error: 'invalid', field } });
const rateLimited: FlowResult = { status: 429, body: { error: 'rate-limited' }, headers: { 'Retry-After': '60' } };
const unavailable: FlowResult = { status: 503, body: { error: 'temporarily-unavailable' } };
const VERIFY_STATUS = { 'not-found': 404, 'bad-bundle': 400, 'bad-product': 400, 'apple-unavailable': 503 } as const;

async function allowed(deps: Pick<DomainFlowDeps, 'limiter'>, key: string, kind: 'read' | 'write'): Promise<boolean> {
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
 * exists. eligible = available and Vercel's first-year AND renewal price ≤ $15.
 */
export async function runDomainSearch(body: unknown, deps: Pick<DomainFlowDeps, 'vercel' | 'limiter'>, ip?: string): Promise<FlowResult> {
  // Own buckets (not the bookings' shared write:<ip> one): 10/min per IP, shared across instances.
  if (ip && !(await allowed(deps, `domain-search-ip:${ip}`, 'write'))) return rateLimited;
  if (!isObj(body)) return bad('q');
  const label = normalizeLabel(body.q);
  if (!label) return bad('q');
  const tx = body.transactionId;
  if (tx != null && (typeof tx !== 'string' || tx.length > 64)) return bad('transactionId');
  if (typeof tx === 'string' && tx.trim() && !(await allowed(deps, `domain-search-tx:${hashKey(tx.trim())}`, 'write'))) return rateLimited;
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

// ─── claim (shared by the app and the website) ───

/** Available and price-eligible now? null when fine. Throws on Vercel errors. */
export async function precheckDomain(deps: Pick<DomainFlowDeps, 'vercel'>, domain: string): Promise<'domain-taken' | 'domain-not-eligible' | null> {
  const v = deps.vercel;
  if (!v) throw Object.assign(new Error('registrar-not-configured'), { code: 'registrar-not-configured' });
  if (!((await v.availability([domain])).get(domain) === true)) return 'domain-taken';
  if (!eligiblePrice((await v.prices([domain])).get(domain))) return 'domain-not-eligible';
  return null;
}

/** A detached row of this site holding this name, whose registration Vercel says is still ours. */
export async function ownDetached(deps: Pick<DomainFlowDeps, 'repo' | 'vercel'>, slug: string, domain: string): Promise<DomainRow | null> {
  const row = await deps.repo.byDomain(domain);
  if (!row || row.site_slug !== slug || row.state !== 'detached' || row.simulated || !deps.vercel) return null;
  return (await deps.vercel.owned(domain)) ? row : null;
}

export function resultFor(row: DomainRow): FlowResult {
  const body = statusBody(row);
  if (row.state === 'live') return { status: 200, body };
  if (row.state === 'failed') return { status: 409, body: { error: 'claim-failed', ...body } };
  return { status: 202, body };
}

export interface SlotClaim {
  key: string;
  source: DomainSource;
  environment: 'Production' | 'Sandbox';
  simulated: boolean;
  slug: string;
  domain: string;
  /** The payer's current status, just fetched by the caller. */
  payer: PayerStatus;
}

/**
 * Reserve (or resume / repoint) the slot `c.key` for `c.domain` on `c.slug`. The caller has
 * proven payment and ownership. Returns the row, or the refusal. Throws on repo / Vercel errors.
 */
export async function reserveSlot(c: SlotClaim, deps: DomainFlowDeps): Promise<{ row: DomainRow; result?: undefined } | { result: FlowResult; row?: undefined }> {
  const { key, slug, domain } = c;
  let row = await deps.repo.get(key);
  const precheckNeeded = !c.simulated || !!deps.vercel;
  if (row) {
    // One domain subscription, one site, forever.
    if (row.site_slug !== slug) return { result: { status: 409, body: { error: 'slot-bound-to-other-site' } } };
    if (row.state === 'transferred') return { result: { status: 409, body: { error: 'transferred', ...statusBody(row) } } };
    if (row.state === 'failed') {
      if (precheckNeeded) {
        const pre = await precheckDomain(deps, domain);
        if (pre) return { result: { status: 409, body: { error: pre } } };
      }
      const holder = await deps.repo.holdingSite(slug);
      if (holder && holder.original_transaction_id !== key) return { result: { status: 409, body: { error: 'site-has-domain' } } };
      try {
        row = (await deps.repo.update(key, ['failed'], {
          state: 'reserved', domain, failure_reason: null, last_error: null, order_id: null, buy_started_at: null,
          expected_price: null, environment: c.environment, simulated: c.simulated, auto_renew: desiredAutoRenew('reserved', c.payer),
        })) ?? (await deps.repo.get(key));
      } catch (e) {
        if (e instanceof DomainConflict) return { result: { status: 409, body: { error: 'domain-taken' } } };
        throw e;
      }
    } else if (row.domain !== domain) {
      return { result: { status: 409, body: { error: 'slot-in-use', ...statusBody(row) } } };
    }
  } else {
    const holder = await deps.repo.holdingSite(slug);
    if (holder) return { result: { status: 409, body: { error: 'site-has-domain' } } };
    if (precheckNeeded) {
      const pre = await precheckDomain(deps, domain);
      // The same site re-buying its OWN detached name (still registered to us): the old slot
      // hands the registration over; the new one records it as bought without a purchase.
      const own = pre === 'domain-taken' ? await ownDetached(deps, slug, domain) : null;
      if (pre && !own) return { result: { status: 409, body: { error: pre } } };
      if (own) {
        await deps.repo.update(own.original_transaction_id, ['detached'], {
          state: 'failed', failure_reason: 'moved-to-new-subscription', auto_renew: false,
          last_error: `registration handed over to ${key}`,
        });
      }
    }
    const ins = await deps.repo.insertReserved({
      original_transaction_id: key, source: c.source, environment: c.environment, site_slug: slug, domain,
      simulated: c.simulated, auto_renew: desiredAutoRenew('reserved', c.payer),
      paid_until: c.payer.expiresAt != null ? iso(c.payer.expiresAt) : null,
    });
    row = await deps.repo.get(key);
    if (ins === 'conflict' && (!row || row.domain !== domain || row.site_slug !== slug)) {
      // Lost a race: say which constraint.
      const h = await deps.repo.holdingSite(slug);
      if (h && h.original_transaction_id !== key) return { result: { status: 409, body: { error: 'site-has-domain' } } };
      return { result: { status: 409, body: { error: row ? 'slot-in-use' : 'domain-taken' } } };
    }
  }
  if (!row) return { result: unavailable };
  return { row };
}

/** Advance a reserved slot under its lease (202 when someone else holds it). */
export async function advanceSlot(key: string, payer: PayerStatus, deps: DomainFlowDeps): Promise<FlowResult> {
  const done = await leased(key, deps, async () => {
    const cur = await deps.repo.get(key);
    if (!cur) return null;
    const fresh = await refreshFromPayer(cur, payer, deps);
    return advance(fresh, deps, { payer }, deps.now() + CLAIM_STEP_CUTOFF_MS);
  });
  if (!done) {
    const cur = await deps.repo.get(key);
    return { status: 202, body: statusBody(cur) };
  }
  return resultFor(done);
}

export async function claimSlot(c: SlotClaim, deps: DomainFlowDeps): Promise<FlowResult> {
  try {
    const r = await reserveSlot(c, deps);
    if (r.result) return r.result;
    return await advanceSlot(c.key, c.payer, deps);
  } catch (e) {
    console.error(`[domains/claim] ${c.key}: unexpected error:`, errMsg(e));
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

/**
 * { transactionId (domain subscription), siteTransactionId (the site's plan), domain } →
 * status body (200 live, 202 in progress, 409 failed / refused). Idempotent: calling again with
 * the same domain resumes wherever the last attempt stopped.
 */
export async function runDomainClaim(body: unknown, authorization: string | string[] | undefined, deps: DomainFlowDeps, ip?: string): Promise<FlowResult> {
  if (ip && !(await allowed(deps, `domain-claim-ip:${ip}`, 'write'))) return rateLimited;
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
  const payer = appleStatus(dtx, deps.now());
  if (!payer.active) return { status: 402, body: { error: 'subscription-inactive' } };
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
  // A Sandbox (TestFlight / App Review) domain never binds to a Production site, or the reverse.
  if (stx.environment !== dtx.environment) return { status: 403, body: { error: 'environment-mismatch' } };
  let site: Awaited<ReturnType<DomainFlowDeps['sitePurchase']>>;
  try {
    site = await deps.sitePurchase(siteOtid);
  } catch (e) {
    console.error('[domains/claim] site lookup failed:', errMsg(e));
    return unavailable;
  }
  if (!site?.site_slug) return { status: 404, body: { error: 'no-site' } };

  // 3. Same purchaser: Apple lists the site purchase under the same Apple account, or the
  //    signed-in owner's shop is linked to it.
  let owner = (dtx.accountOriginalTransactionIds ?? []).includes(siteOtid);
  if (!owner && authorization && deps.getUser && deps.shopOtidOf) {
    const a = await authenticate(authorization, deps.getUser);
    if (a.ok === true) owner = (await deps.shopOtidOf(a.user.id).catch(() => null)) === siteOtid;
  }
  if (!owner) return { status: 403, body: { error: 'not-owner' } };

  return claimSlot({ key: otid, source: 'apple', environment: dtx.environment, simulated, slug: site.site_slug, domain, payer }, deps);
}

// ─── GET/POST /api/ios/domain/status ───

export async function runDomainStatus(transactionIdRaw: unknown, deps: DomainFlowDeps): Promise<FlowResult> {
  const transactionId = typeof transactionIdRaw === 'string' ? transactionIdRaw.trim() : '';
  if (!TX_RE.test(transactionId)) return bad('transactionId');
  const tx = await verifyOrResult(() => deps.verifyDomain(transactionId), 'status');
  if (isResult(tx)) return tx;
  try {
    const row = await deps.repo.get(tx.originalTransactionId);
    return { status: 200, body: await statusWithProbe(row, deps) };
  } catch (e) {
    console.error('[domains/status] failed:', errMsg(e));
    return unavailable;
  }
}

export async function statusWithProbe(row: DomainRow | null, deps: DomainFlowDeps): Promise<DomainStatusBody> {
  const body = statusBody(row);
  if (row && !row.simulated && (row.state === 'live' || row.state === 'attached') && deps.vercel) body.vercel = await probe(row, deps);
  return body;
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

// ─── payer events: App Store Server Notifications / Stripe subscription events ───

/**
 * A payer event for a domain subscription (any type, any order). The event's own payload is
 * never trusted for state: the payer's CURRENT status is re-fetched and applied, so a late,
 * older event (a DID_RENEW after a cancel) can never turn auto-renew back on. DB only (a fast
 * answer); the sweep applies Vercel side effects. Throws when the payer can't be asked, so the
 * sender retries.
 */
export async function applyPayerEvent(key: string, label: string, deps: Pick<DomainFlowDeps, 'repo' | 'now' | 'payer'>): Promise<{ ok: boolean; ignored?: string }> {
  const row = await deps.repo.get(key);
  if (!row) {
    console.log(`[domains/event] ${label} for ${key}: no domain claimed yet; nothing to do (a claim reads the payer itself)`);
    return { ok: true, ignored: 'no-domain' };
  }
  if (row.state === 'transferred') return { ok: true, ignored: 'transferred' };
  const s = await withTimeout(deps.payer(row), 8_000, 'payer status');
  await refreshFromPayer(row, s, deps);
  await deps.repo.update(key, null, { last_notification: label }).catch(() => {});
  return { ok: true };
}

/** App Store Server Notifications for the domain product (lib/ios/notifications.ts routes them here). */
export function applyDomainNotification(n: DomainNotification, deps: Pick<DomainFlowDeps, 'repo' | 'now' | 'payer'>) {
  return applyPayerEvent(n.otid, n.subtype ? `${n.type}:${n.subtype}` : n.type, deps);
}

// ─── sweep (its own cron: /api/ios/domain-sweep) ───

export interface DomainSweepSummary {
  resumed: string[];
  live: string[];
  failed: string[];
  waiting: string[];
  detached: string[];
  reattached: string[];
  stillActive: string[];
  refreshed: string[];
  autoRenewSynced: string[];
  relinked: string[];
  payerUnavailable: string[];
  deferred: string[];
  errors: string[];
}

export async function sweepDomains(
  deps: DomainFlowDeps,
  opts: { deadline: number; limit?: number; payerTimeoutMs?: number },
): Promise<DomainSweepSummary> {
  const limit = opts.limit ?? 25;
  const out: DomainSweepSummary = {
    resumed: [], live: [], failed: [], waiting: [], detached: [], reattached: [], stillActive: [], refreshed: [],
    autoRenewSynced: [], relinked: [], payerUnavailable: [], deferred: [], errors: [],
  };
  const outOfTime = () => deps.now() >= opts.deadline;
  const pass = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      console.error(`[domains/sweep] ${name} pass failed:`, errMsg(e));
      out.errors.push(`${name}: ${errMsg(e)}`);
    }
  };
  const tally = (r: DomainRow | null) => {
    if (!r) return;
    if (r.state === 'live') out.live.push(r.domain);
    else if (r.state === 'failed') out.failed.push(r.domain);
    else if (r.state === 'detached') out.detached.push(r.domain);
    else out.waiting.push(r.domain);
  };
  /** The payer's status, or null (recorded as unavailable). Permanent failures read as "ended". */
  async function payerOf(row: DomainRow): Promise<PayerStatus | null> {
    try {
      return await askPayer(row, deps, opts.payerTimeoutMs ?? 5_000);
    } catch (e: any) {
      if (e instanceof PayerFailure && e.permanent) return { active: false, autoRenew: false, expiresAt: null, revoked: false };
      out.payerUnavailable.push(row.domain);
      await deps.repo.update(row.original_transaction_id, null, { payer_checked_at: iso(deps.now()) }).catch(() => {});
      return null;
    }
  }

  /**
   * Vercel CONFIRMS the registration is gone (a read, not an error):
   * - still attached and paid (N1): unlink it and fail the row, so the app offers "pick another
   *   name" on the same slot instead of a dead domain;
   * - detached and the payer ended (N7): nothing left to watch; failed, never re-checked.
   */
  async function settleGone(row: DomainRow, s: PayerStatus): Promise<DomainRow> {
    let owned;
    try {
      owned = await deps.vercel!.owned(row.domain);
    } catch {
      return row;
    }
    if (owned) return row;
    if (ATTACHED_STATES.includes(row.state) && s.active) {
      console.error(`[domains] ALERT ${row.domain} (${row.original_transaction_id}): paid, but the registration is gone at Vercel; unlinking, the slot is reusable`);
      try {
        const project = projectFor(row.site_slug);
        await deps.vercel!.removeProjectDomain(project, `www.${row.domain}`);
        await deps.vercel!.removeProjectDomain(project, row.domain);
        await deps.hooks.onDomainUnlinked(row.site_slug);
      } catch (e) {
        console.error(`[domains] ${row.domain}: unlinking the expired registration failed; retried:`, errMsg(e));
        return row;
      }
      return (await deps.repo.update(row.original_transaction_id, ATTACHED_STATES, {
        state: 'failed', failure_reason: 'registration-expired', auto_renew: false,
        last_error: 'ALERT: the registration expired at Vercel while paid; the barber can pick a name again',
      })) ?? row;
    }
    if (row.state === 'detached' && !s.active) {
      return (await deps.repo.update(row.original_transaction_id, ['detached'], { state: 'failed', failure_reason: 'registration-expired', auto_renew: false })) ?? row;
    }
    return row;
  }

  // 1. Lapses: the paid period ended (payer confirms) → detach, under the row's lease.
  await pass('lapse', async () => {
    for (const cand of await deps.repo.lapseCandidates(limit, deps.now() - GRACE_MS)) {
      if (outOfTime()) { out.deferred.push(cand.domain); continue; }
      const otid = cand.original_transaction_id;
      const r = await leased(otid, deps, async () => {
        let row = (await deps.repo.get(otid)) ?? cand;
        if (!ATTACHED_STATES.includes(row.state)) return row;
        const s = await payerOf(row);
        if (!s) return null;
        row = await refreshFromPayer(row, s, deps);
        if (s.active) {
          out.stillActive.push(row.domain);
          return deps.vercel && !row.simulated ? settleGone(row, s) : row;
        }
        const moved = await deps.repo.update(otid, ATTACHED_STATES, { state: 'detaching', auto_renew: false, auto_renew_synced: false });
        if (!moved) return row;
        return advance(moved, deps, {}, opts.deadline);
      });
      if (r === null) out.deferred.push(cand.domain);
      else if (r.state === 'detached') out.detached.push(r.domain);
      else if (r.state === 'detaching' || r.state === 'unlinking') out.waiting.push(r.domain);
    }
  });

  // 2. Resume every row with a step still due (crashed claims, pending orders, detaches).
  await pass('resume', async () => {
    for (const cand of await deps.repo.resumable(limit, deps.now())) {
      if (outOfTime()) { out.deferred.push(cand.domain); continue; }
      out.resumed.push(cand.domain);
      tally(await leased(cand.original_transaction_id, deps, async () =>
        advance((await deps.repo.get(cand.original_transaction_id)) ?? cand, deps, {}, opts.deadline)));
    }
  });

  // 3. Re-attach detached rows that are paid again (Vercel confirms the registration first).
  await pass('reattach', async () => {
    for (const cand of await deps.repo.reattachCandidates(limit, deps.now())) {
      if (outOfTime()) { out.deferred.push(cand.domain); continue; }
      const r = await leased(cand.original_transaction_id, deps, async () =>
        advance((await deps.repo.get(cand.original_transaction_id)) ?? cand, deps, {}, opts.deadline));
      if (r && r.state === 'live') out.reattached.push(r.domain);
      else tally(r);
    }
  });

  // 4. Every registered row: re-ask the payer (renewal status drift, missed events) and make
  //    Vercel's auto-renew match, read live (a multi-year or auto-renewed registration too).
  await pass('refresh', async () => {
    for (const cand of await deps.repo.payerStale(limit, deps.now() - PAYER_REFRESH_MS)) {
      if (outOfTime()) { out.deferred.push(cand.domain); continue; }
      const otid = cand.original_transaction_id;
      await leased(otid, deps, async () => {
        let row = (await deps.repo.get(otid)) ?? cand;
        const s = await payerOf(row);
        if (s) row = await refreshFromPayer(row, s, deps);
        row = await syncAutoRenew({ ...row, auto_renew_synced: false }, deps);
        if (s && !row.simulated && deps.vercel) row = await settleGone(row, s);
        out.refreshed.push(row.domain);
      });
    }
  });

  // 5. Rows whose desired auto-renew changed since (events).
  await pass('auto-renew', async () => {
    for (const row of await deps.repo.autoRenewUnsynced(limit)) {
      if (outOfTime()) { out.deferred.push(row.domain); continue; }
      const r = await syncAutoRenew(row, deps);
      if (r.auto_renew_synced) out.autoRenewSynced.push(row.domain);
    }
  });

  // 6. Once Vercel reports the domain verified with correct DNS, republish once more so the
  //    site (and site-subpages' base URL, derived from the project's verified domains) uses it.
  await pass('dns', async () => {
    if (!deps.vercel) return;
    for (const cand of await deps.repo.awaitingDns(limit)) {
      if (outOfTime()) { out.deferred.push(cand.domain); continue; }
      await leased(cand.original_transaction_id, deps, async () => {
        const row = (await deps.repo.get(cand.original_transaction_id)) ?? cand;
        if (row.state !== 'live' || row.dns_ready_at) return;
        const [pd, cfg] = await Promise.all([
          deps.vercel!.projectDomain(projectFor(row.site_slug), row.domain),
          deps.vercel!.domainConfig(row.domain),
        ]);
        if (!pd?.verified || !cfg || cfg.misconfigured) return;
        const want = `https://${row.domain}`;
        // First time: republish (publishSite refreshes the base). Later sweeps: refresh the base
        // only, until it really is the domain (a Vercel blip during the refresh keeps the old one).
        if (row.last_error === BASE_PENDING && deps.base) await deps.base.refresh(row.site_slug);
        else await deps.hooks.onDomainLinked(row.site_slug, row.domain);
        const base = deps.base ? await deps.base.read(row.site_slug) : undefined;
        if (base !== undefined && base !== want) {
          await deps.repo.update(row.original_transaction_id, ['live'], { last_error: BASE_PENDING });
          return;
        }
        await deps.repo.update(row.original_transaction_id, ['live'], {
          dns_ready_at: iso(deps.now()), ...(row.last_error === BASE_PENDING ? { last_error: null } : {}),
        });
        out.relinked.push(row.domain);
      });
    }
  });
  return out;
}

// ─── admin ───

/** Manual transfer to the barber is done in Vercel: stop the lifecycle from touching the domain. */
export async function markTransferred(slug: string, by: string, deps: Pick<DomainFlowDeps, 'repo' | 'now'>): Promise<{ ok: boolean; error?: string; domain?: string }> {
  const all = (await deps.repo.all()).filter((r) => r.site_slug === slug && OWNED_STATES.includes(r.state));
  // The site's live (holding) row first; an old detached one only when it is the only one.
  const row = all.find((r) => SITE_HOLDING_STATES.includes(r.state)) ?? all.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  if (!row) return { ok: false, error: 'no-domain' };
  const moved = await deps.repo.update(row.original_transaction_id, OWNED_STATES, {
    state: 'transferred', transferred_at: iso(deps.now()), transferred_by: by,
  });
  return moved ? { ok: true, domain: moved.domain } : { ok: false, error: 'conflict' };
}

/**
 * A buy whose outcome stayed unknown (`buying`, not in our Vercel account). After checking
 * Vercel by hand, an admin either retries the purchase or abandons it (frees the slot).
 */
export async function releaseStuckBuy(slug: string, to: 'retry' | 'abandon', by: string, deps: Pick<DomainFlowDeps, 'repo' | 'now'>): Promise<{ ok: boolean; error?: string; domain?: string }> {
  const row = (await deps.repo.all()).find((r) => r.site_slug === slug && r.state === 'buying');
  if (!row) return { ok: false, error: 'no-domain' };
  const patch: Partial<DomainRow> = to === 'retry'
    ? { state: 'reserved', buy_started_at: null, last_error: `released for retry by ${by}` }
    : { state: 'failed', failure_reason: 'registrar', last_error: `abandoned by ${by}`, auto_renew: false };
  const moved = await deps.repo.update(row.original_transaction_id, ['buying'], patch);
  return moved ? { ok: true, domain: moved.domain } : { ok: false, error: 'conflict' };
}
