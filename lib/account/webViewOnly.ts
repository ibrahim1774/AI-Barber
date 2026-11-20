// Web view-only for Apple accounts (Wave W2, server half). Switch WEB_APPLE_VIEW_ONLY, read as === '1', default off.
// Off: no route reads anything new and every answer is byte-identical to before. Only kind 'apple' is ever view-only:
// 'mixed', 'web' and 'neither' always get null. The plan's legacy site_owners lookup (aibarber.org customers) runs with the switch on, but never changes the result.
import { sbRest } from '../webApp/webAppServer.js';
import { accountPlan, defaultKindEnv, livePlanKindDeps, type AccountPlan, type PlanDeps } from './plan.js';
import { accountKindReading, liveKindDeps, stripeModeOf, withoutFree, type AccountKind, type KindDeps, type KindEnv } from './kind.js';
import type { Tier } from '../ios/tiers.js';

export const webViewOnlyOn = (env: Record<string, string | undefined> = process.env): boolean => env.WEB_APPLE_VIEW_ONLY === '1';

/** The `viewOnly` field of /api/web-app/me (contract section 6e). */
export interface ViewOnly {
  reason: 'apple';
  site: { slug: string; url: string } | null;
  planActive: boolean;
  tier: Tier | null;
  cardPlan: boolean;
  oldDraft: boolean;
}

export interface ViewOnlyDeps extends PlanDeps {
  /** A web_app_drafts row exists for the account in this Stripe mode. */
  oldDraft(uid: string, mode: 'live' | 'test'): Promise<boolean>;
}

export function liveViewOnlyDeps(): ViewOnlyDeps {
  return {
    ...livePlanKindDeps(),
    oldDraft: async (uid, mode) => (((await sbRest(`web_app_drafts?user_id=eq.${encodeURIComponent(uid)}&environment=eq.${mode}&select=user_id&limit=1`)) ?? []) as any[]).length > 0,
  };
}

/** null unless the account's kind is 'apple'. Throws on a lookup error (callers decide: /me leaves the field out). */
export async function viewOnlyOf(uid: string, env: KindEnv = defaultKindEnv(), deps: ViewOnlyDeps = liveViewOnlyDeps()): Promise<ViewOnly | null> {
  return viewOnlyFromPlan(await accountPlan(uid, env, deps), uid, env, deps);
}

/** The same answer from a plan the caller already has (so /me with ACCOUNT_PLAN_V2 also on reads the plan once). */
export async function viewOnlyFromPlan(plan: AccountPlan, uid: string, env: KindEnv = defaultKindEnv(), deps: Pick<ViewOnlyDeps, 'oldDraft'> = liveViewOnlyDeps()): Promise<ViewOnly | null> {
  if (plan.kind !== 'apple') return null;
  const oldDraft = await deps.oldDraft(uid, stripeModeOf(env));
  return {
    reason: 'apple',
    site: plan.site ? { slug: plan.site.slug, url: plan.site.url } : null,
    planActive: !plan.holderPurchaseEnded,
    tier: plan.tier,
    cardPlan: plan.appleAlsoPaysCard,
    oldDraft,
  };
}

/** The account's kind for the draft, domain and publish guards: the lean kind reading (not the full plan). Throws on a lookup error.
 *  Free is never read: Free cannot change whether an account is 'apple' (apple is decided first), so FREE_IS_WEB=1 adds no read and no failure point. */
export async function webKindOf(uid: string, env: KindEnv = defaultKindEnv(), deps: KindDeps = liveKindDeps()): Promise<AccountKind> {
  return (await accountKindReading(uid, env, withoutFree(deps))).kind;
}
