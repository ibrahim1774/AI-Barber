// One account, one kind (one-account plan, rule R1). The address holder decides:
//  - apple   : holds an Apple address (an ios_purchases row of the account with a site_slug, removed or not), or has a LIVE Apple
//              purchase tied to it and no web address (even before its first publish). Wins over a card plan.
//  - web     : holds a web address published at least once (web_app_sites.published_at not null, removed or not), or pays a card plan
//              (active / trialing / past_due) and holds no Apple address.
//  - mixed   : holds both a web address and an Apple address.
//  - neither : none of the above. Free alone never makes a web account (Free is never read here, and never counts as Stripe).
// Never use entitlementOrFree for this test. Read-only: nothing here changes how a purchase is tied to an account.
//
// Environment vocabulary: callers pass 'Production' | 'Sandbox'. web_app_* tables use the Stripe mode ('live' | 'test'), so
// 'Production' reads 'live' and 'Sandbox' reads 'test' (as liveWebDeleteDeps.listSites does). ios_purchases is read for every
// environment: a Sandbox purchase counts as live here (purchaseLive has no environment check), like the plan answer.
import { purchaseLive, type GateFields } from '../ios/lapse.js';
import { isEntitledStatus } from '../webApp/stripeCore.js';
import { sbRest } from '../webApp/webAppServer.js';

export type AccountKind = 'web' | 'apple' | 'mixed' | 'neither';
export type KindEnv = 'Production' | 'Sandbox';
export type StripeMode = 'live' | 'test';

export const stripeModeOf = (env: KindEnv): StripeMode => (env === 'Production' ? 'live' : 'test');
export const kindEnvOf = (mode: StripeMode | null | undefined): KindEnv => (mode === 'test' ? 'Sandbox' : 'Production');

/** A web_app_sites row of the account (this Stripe mode). */
export interface WebSiteFact {
  slug: string;
  published_at: string | null;
  removed_at?: string | null;
  taken_down_at?: string | null;
}
/** An ios_purchases row with user_id = the account. */
export type ApplePurchaseFact = GateFields & {
  original_transaction_id?: string | null;
  user_id?: string | null;
  site_slug: string | null;
  published_at?: string | null;
  removed_at?: string | null;
  last_notification?: string | null;
};
/** A web_app_entitlements row of the account (this Stripe mode). Free is never a row. */
export interface EntitlementFact {
  stripe_subscription_id?: string | null;
  status: string;
  tier?: string | null;
  billing_interval?: string | null;
  current_period_end?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface KindFacts {
  webSites: WebSiteFact[];
  applePurchases: ApplePurchaseFact[];
  entitlements: EntitlementFact[];
  now: number;
}

/** Why the kind is what it is. `appleAlsoPaysCard` is the alert case (A9): never untied, never emailed, settled by hand. */
export interface KindReading {
  kind: AccountKind;
  holdsWebAddress: boolean;
  holdsAppleAddress: boolean;
  liveApplePurchase: boolean;
  cardPlan: boolean;
  appleAlsoPaysCard: boolean;
}

const isFreeId = (id: unknown) => typeof id === 'string' && id.startsWith('free:');
/** A real card plan: Stripe says active, trialing or past_due. An in-memory Free row (free:<uid>) never counts. */
export const isCardPlan = (e: EntitlementFact): boolean => isEntitledStatus(e.status) && !isFreeId(e.stripe_subscription_id);

/** Pure: rule R1 over the facts. */
export function readKind(f: KindFacts): KindReading {
  const holdsWebAddress = f.webSites.some((s) => !!s.published_at);
  const holdsAppleAddress = f.applePurchases.some((p) => !!p.site_slug);
  const liveApplePurchase = f.applePurchases.some((p) => purchaseLive(p, f.now));
  const cardPlan = f.entitlements.some(isCardPlan);
  let kind: AccountKind = 'neither';
  if (holdsWebAddress && holdsAppleAddress) kind = 'mixed';
  else if (holdsAppleAddress || (liveApplePurchase && !holdsWebAddress)) kind = 'apple';
  else if (holdsWebAddress || cardPlan) kind = 'web';
  return { kind, holdsWebAddress, holdsAppleAddress, liveApplePurchase, cardPlan, appleAlsoPaysCard: kind === 'apple' && cardPlan };
}

/** Everything the kind and plan modules read. Each reader throws on a lookup error (callers decide fail open / closed). */
export interface KindDeps {
  webSites(uid: string, mode: StripeMode): Promise<WebSiteFact[]>;
  applePurchases(uid: string): Promise<ApplePurchaseFact[]>;
  entitlements(uid: string, mode: StripeMode): Promise<EntitlementFact[]>;
  now?(): number;
}

export async function loadKindFacts(uid: string, env: KindEnv, deps: KindDeps): Promise<KindFacts> {
  const mode = stripeModeOf(env);
  const [webSites, applePurchases, entitlements] = await Promise.all([deps.webSites(uid, mode), deps.applePurchases(uid), deps.entitlements(uid, mode)]);
  return { webSites, applePurchases, entitlements, now: (deps.now ?? Date.now)() };
}

export async function accountKindReading(uid: string, env: KindEnv, deps: KindDeps = liveKindDeps()): Promise<KindReading> {
  return readKind(await loadKindFacts(uid, env, deps));
}

/** The account's kind (rule R1). */
export async function accountKind(uid: string, env: KindEnv, deps: KindDeps = liveKindDeps()): Promise<AccountKind> {
  return (await accountKindReading(uid, env, deps)).kind;
}

const enc = encodeURIComponent;

/** Live readers (service-role PostgREST; sbRest reads its env only when called). */
export function liveKindDeps(): KindDeps {
  const rest = async (path: string): Promise<any[]> => ((await sbRest(path)) ?? []) as any[];
  return {
    webSites: (uid, mode) => rest(`web_app_sites?user_id=eq.${enc(uid)}&environment=eq.${mode}&select=slug,published_at,removed_at,taken_down_at&limit=50`),
    applePurchases: (uid) => rest(`ios_purchases?user_id=eq.${enc(uid)}&select=original_transaction_id,product_id,environment,expires_at,revoked_at,taken_down_at,site_slug,published_at,removed_at,last_notification,user_id&limit=50`),
    entitlements: (uid, mode) => rest(`web_app_entitlements?user_id=eq.${enc(uid)}&environment=eq.${mode}&select=stripe_subscription_id,tier,billing_interval,status,current_period_end,created_at,updated_at&order=created_at.desc&limit=50`),
    now: Date.now,
  };
}
