// Web view-only for Apple accounts (Wave W2, server half). Switch WEB_APPLE_VIEW_ONLY, read as === '1', default off.
// Off: no route reads anything new and every answer is byte-identical to before. Only kind 'apple' is ever view-only:
// 'mixed', 'web' and 'neither' always get null. Old aibarber.org customers (site_owners rows) are not looked at here.
import { sbRest } from '../webApp/webAppServer.js';
import { accountPlan, defaultKindEnv, livePlanKindDeps, type PlanDeps } from './plan.js';
import { accountKindReading, liveKindDeps, stripeModeOf, type AccountKind, type KindDeps, type KindEnv } from './kind.js';
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
  const plan = await accountPlan(uid, env, deps);
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

/** The account's kind for the draft and domain guards: the lean kind reading (not the full plan). Throws on a lookup error. */
export async function webKindOf(uid: string, env: KindEnv = defaultKindEnv(), deps: KindDeps = liveKindDeps()): Promise<AccountKind> {
  return (await accountKindReading(uid, env, deps)).kind;
}
