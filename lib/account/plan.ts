// The one plan answer for an account (one-account plan, Lane B1): kind (lib/account/kind.ts), the plan that applies, the address,
// whether the purchase holding an Apple address has ended, the legacy mark, and the site mode. Read-only.
//
// Which plan applies: a LIVE Apple purchase first, then a LIVE card plan, then Free (stored price group 'free'), then, only to
// describe an ended plan, the newest Apple purchase, then the newest card row. Free is source 'free', never 'stripe'.
// Apple Sandbox counts as paid here (purchaseLive has no environment check); appStoreGuard.counts() is untouched and still
// decides checkout.
//
// Two readings (see lib/account/kind.ts): `source` / `status` / `active` / `test` are the PAID reading (every ios_purchases row, so Apple
// Sandbox counts as paid, question 16). `kind`, `site`, `webSite` and `holderPurchaseEnded` are the DECISION reading (Apple rows filtered
// like appStoreGuard.counts()): a Sandbox row never changes them in production.
//
// Known limits (read before building on this):
//  - appleGrace / appleRetry / paymentProblem for Apple are APPROXIMATIONS: ios_purchases.last_notification stores only the notification
//    type, so grace is "live but the stored expiry has passed" and retry is "last type was DID_FAIL_TO_RENEW". The sweep and
//    lib/ios/txStatus.ts are the authority. Tighten before any payment-problem copy is shown to a user.
//  - kind 'web' can come with source 'apple' (a live Apple purchase with no address, plus a published web address). Never derive the
//    kind from `source`, and later waves must not branch on `source` for kind.
//  - For kind 'mixed', `site` is the Apple address and `webSite` the web one: check both.
//
// Legacy mark: the account owns a site_owners row (user_id = the account) whose checkout_session_id does NOT start with 'webapp:'
// (null included: admin and backfill rows). New web-app publishes also write site_owners rows, with checkout_session_id
// 'webapp:<subscription>' (lib/webApp/publishFlow.ts), so those do not mark a legacy customer.
import { entitlementActive, purchaseLive } from '../ios/lapse.js';
import { siteUrlOf } from '../ios/siteAddress.js';
import { tierOf, type Tier } from '../ios/tiers.js';
import { webProductId } from '../webApp/entitlementGate.js';
import { readStoredGroup } from '../webApp/priceGroup.js';
import { sbRest } from '../webApp/webAppServer.js';
import type { Interval, Tier as WebTier } from '../webApp/stripeCore.js';
import { keyMode } from '../webApp/stripeCore.js';
import {
  countedApplePurchases, isCardPlan, liveKindDeps, loadKindFacts, readKind, stripeModeOf,
  type AccountKind, type ApplePurchaseFact, type EntitlementFact, type KindDeps, type KindEnv, type KindFacts, type KindReading, type WebSiteFact,
} from './kind.js';

export type PlanSource = 'apple' | 'stripe' | 'free';
export type SiteHolder = 'apple' | 'web';
import { siteModeFromKind, type SiteMode } from './siteMode.js';
export type { SiteMode };

export interface AccountSite { slug: string; url: string; holder: SiteHolder }

export interface AccountPlan {
  kind: AccountKind;
  /** The plan that applies; null when the account has none (and never had a recorded one). */
  source: PlanSource | null;
  tier: Tier | null;
  /** Apple: 'active' | 'grace' | 'expired' | 'revoked'. Stripe: Stripe's status. Free: 'active'. null with no plan. */
  status: string | null;
  /** The plan is live (the gates would open). */
  active: boolean;
  /** Stripe past_due, or Apple grace / retry. */
  paymentProblem: boolean;
  /** Apple billing grace: live (not revoked, not taken down) although the stored expiry has passed. */
  appleGrace: boolean;
  /** Apple billing retry: the last Apple notification was DID_FAIL_TO_RENEW. */
  appleRetry: boolean;
  /** The plan is a test one (Apple Sandbox or Stripe test mode). */
  test: boolean;
  /** Legacy mark (see the header). */
  legacy: boolean;
  /** The account's address; null when it holds none. For `mixed` it is the Apple one (the other is in `webSite`). */
  site: AccountSite | null;
  /** `mixed` only: the web address. */
  webSite: AccountSite | null;
  /** The purchase holding the Apple address has ended (not live). False when there is no Apple address. */
  holderPurchaseEnded: boolean;
  /** planFromFacts leaves `device`; accountPlan sets it from the kind and ACCOUNT_DRAFTS_IOS (lib/account/siteMode.ts): account / web-only / device. */
  siteMode: SiteMode;
  /** The alert case: an Apple account that also pays a card plan (A9). */
  appleAlsoPaysCard: boolean;
}

/** Everything read for a plan: the kind readers plus Free and the legacy mark. */
export interface PlanDeps extends KindDeps {
  /** The stored price group is 'free'. */
  isFree(uid: string): Promise<boolean>;
  /** The account owns a site_owners row that is not from a web-app publish. */
  legacyOwner(uid: string): Promise<boolean>;
}

export interface PlanFacts extends KindFacts {
  mode: 'live' | 'test';
  free: boolean;
  legacy: boolean;
}

const ms = (s: string | null | undefined): number => Date.parse(s ?? '') || 0;
const pastExpiry = (p: { expires_at?: string | null }, now: number) => {
  const t = Date.parse(p.expires_at ?? '');
  return Number.isFinite(t) && t <= now;
};

const newestBy = <T>(rows: T[], key: (r: T) => number): T | null => rows.reduce<T | null>((best, r) => (best && key(best) >= key(r) ? best : r), null);

/** The newest Apple purchase to describe: a live one first (latest expiry), else the newest by expiry. */
function pickApple(purchases: ApplePurchaseFact[], now: number): ApplePurchaseFact | null {
  const live = purchases.filter((p) => purchaseLive(p, now));
  return newestBy(live.length ? live : purchases, (p) => ms(p.expires_at));
}

/** Card row to describe: entitled rows first (active, then trialing, then past_due; newest within), else the newest row. Free rows never count. */
function pickCard(rows: EntitlementFact[], isLive: (r: EntitlementFact) => boolean): EntitlementFact | null {
  const real = rows.filter((r) => !(typeof r.stripe_subscription_id === 'string' && r.stripe_subscription_id.startsWith('free:')));
  const live = real.filter(isLive);
  const rank = (r: EntitlementFact) => (r.status === 'active' ? 2 : r.status === 'trialing' ? 1 : 0);
  if (live.length) return live.reduce((b, r) => (rank(r) > rank(b) || (rank(r) === rank(b) && ms(r.created_at) > ms(b.created_at)) ? r : b));
  return newestBy(real, (r) => ms(r.created_at) || ms(r.updated_at));
}

/** The address a purchase or site row holds, preferring one not removed, then published, then newest. */
function pickAddress<T extends { removed_at?: string | null; published_at?: string | null }>(rows: T[], slugOf: (r: T) => string | null): T | null {
  const withSlug = rows.filter((r) => !!slugOf(r));
  const rank = (r: T) => (r.removed_at ? 0 : 2) + (r.published_at ? 1 : 0);
  return withSlug.reduce<T | null>((b, r) => (b && rank(b) >= rank(r) ? b : r), null);
}

const stripeTier = (r: EntitlementFact, free: boolean): Tier | null => {
  if (!r.tier || !r.billing_interval) return null;
  const t = tierOf(webProductId(r.tier as WebTier, r.billing_interval as Interval));
  return free && t === 'website' ? 'bookings' : t; // the free floor, as /api/web-app/me
};

/** Pure: the plan answer from the facts. */
export function planFromFacts(f: PlanFacts): AccountPlan {
  const reading: KindReading = readKind(f);
  const now = f.now;
  const apple = pickApple(f.applePurchases, now); // PAID reading: all rows
  const appleLive = !!apple && purchaseLive(apple, now);
  const card = pickCard(f.entitlements, isCardPlan);
  const cardLive = !!card && isCardPlan(card);

  let source: PlanSource | null = null;
  if (appleLive) source = 'apple';
  else if (cardLive) source = 'stripe';
  else if (f.free) source = 'free';
  else if (apple) source = 'apple';
  else if (card) source = 'stripe';

  let tier: Tier | null = null;
  let status: string | null = null;
  let active = false;
  let test = false;
  if (source === 'apple' && apple) {
    tier = tierOf(apple.product_id);
    active = appleLive;
    status = apple.revoked_at ? 'revoked' : appleLive ? (pastExpiry(apple, now) ? 'grace' : 'active') : 'expired';
    test = apple.environment === 'Sandbox';
  } else if (source === 'stripe' && card) {
    tier = stripeTier(card, f.free);
    active = cardLive;
    status = card.status;
    test = f.mode === 'test';
  } else if (source === 'free') {
    tier = 'bookings';
    active = true;
    status = 'active';
    test = f.mode === 'test';
  }
  const appleGrace = source === 'apple' && !!apple && appleLive && pastExpiry(apple, now);
  const appleRetry = source === 'apple' && apple?.last_notification === 'DID_FAIL_TO_RENEW';
  const paymentProblem = source === 'stripe' ? card?.status === 'past_due' : appleGrace || appleRetry;

  const holder = pickAddress(countedApplePurchases(f.applePurchases, f.env), (p) => p.site_slug); // DECISION reading
  const webRow = pickAddress(f.webSites.filter((s) => !!s.published_at), (s) => s.slug);
  const appleSite: AccountSite | null = holder?.site_slug ? { slug: holder.site_slug, url: siteUrlOf(holder.site_slug), holder: 'apple' } : null;
  const webSite: AccountSite | null = webRow ? { slug: webRow.slug, url: siteUrlOf(webRow.slug), holder: 'web' } : null;
  const mixed = reading.kind === 'mixed';
  return {
    kind: reading.kind,
    source, tier, status, active, paymentProblem, appleGrace, appleRetry, test,
    legacy: f.legacy,
    site: mixed ? appleSite : appleSite ?? webSite,
    webSite: mixed ? webSite : null,
    holderPurchaseEnded: !!holder && !purchaseLive(holder, now),
    siteMode: 'device',
    appleAlsoPaysCard: reading.appleAlsoPaysCard,
  };
}

/** The plan entitlements an Apple-sourced plan grants (same rule as the gates). Handy for callers; not used by the answer. */
export const appleGrants = (p: ApplePurchaseFact, ent: 'hosting' | 'bookings' | 'store', now = Date.now()) => entitlementActive(p, ent, now);

export async function loadPlanFacts(uid: string, env: KindEnv, deps: PlanDeps): Promise<PlanFacts> {
  const [base, free, legacy] = await Promise.all([loadKindFacts(uid, env, deps), deps.isFree(uid), deps.legacyOwner(uid)]);
  return { ...base, mode: stripeModeOf(env), free, legacy };
}

/** The account's plan answer. `env` defaults to this deployment's Stripe mode (live = Production). */
export async function accountPlan(uid: string, env: KindEnv = defaultKindEnv(), deps: PlanDeps = livePlanKindDeps()): Promise<AccountPlan> {
  const p = planFromFacts(await loadPlanFacts(uid, env, deps));
  return { ...p, siteMode: siteModeFromKind(p.kind, uid) };
}

/**
 * This deployment's environment from the Stripe key (keyMode). THROWS when the key is missing or unknown: callers must not assume
 * Production. getPlan and /me catch it (old answer, logged); Move fails closed (503).
 */
export function defaultKindEnv(): KindEnv {
  const mode = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
  if (!mode) throw new Error('STRIPE_WEBAPP_SECRET_KEY missing or unknown: environment cannot be decided');
  return mode === 'live' ? 'Production' : 'Sandbox';
}

/**
 * Lean "does this account have a live plan?" for owner emails: Apple live (PAID reading), a real card plan in this mode, or Free.
 * Reads only those three things (never site_owners or the sites). One failing read never hides a plan another read found; it throws only
 * when nothing is live AND something could not be read (the caller fails closed).
 */
export async function hasLivePlan(uid: string, env: KindEnv = defaultKindEnv(), deps: Pick<PlanDeps, 'applePurchases' | 'entitlements' | 'isFree' | 'now'> = livePlanKindDeps()): Promise<boolean> {
  const mode = stripeModeOf(env);
  const now = (deps.now ?? Date.now)();
  const [a, c, f] = await Promise.allSettled([deps.applePurchases(uid), deps.entitlements(uid, mode), deps.isFree(uid)]);
  if (a.status === 'fulfilled' && a.value.some((p) => purchaseLive(p, now))) return true;
  if (c.status === 'fulfilled' && c.value.some(isCardPlan)) return true;
  if (f.status === 'fulfilled' && f.value === true) return true;
  const failed = [a, c, f].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
  if (failed) throw failed.reason;
  return false;
}

export function livePlanKindDeps(): PlanDeps {
  const base = liveKindDeps();
  const rest = async (path: string): Promise<any[]> => ((await sbRest(path)) ?? []) as any[];
  return {
    ...base,
    isFree: async (uid) => (await readStoredGroup(uid)) === 'free',
    // Fails soft: a site_owners problem only means legacy=false (logged), never a failed plan answer.
    legacyOwner: async (uid) => {
      try {
        const rows = await rest(`site_owners?user_id=eq.${encodeURIComponent(uid)}&select=slug,checkout_session_id&limit=50`);
        return rows.some((r) => !(typeof r.checkout_session_id === 'string' && r.checkout_session_id.startsWith('webapp:')));
      } catch (e: any) {
        console.error('[account plan] legacy lookup failed, reading legacy=false:', e?.message || e);
        return false;
      }
    },
  };
}
