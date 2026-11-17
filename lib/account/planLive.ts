// "Does this account still have a live plan?" for the blocked-purchase messages (letter, 409 body, plan check, GET): ONE source everywhere (the mayTake rule).
// Live = a real card plan (active, trialing or past_due, in the Stripe mode of the purchase's environment) or the Free group. Apple rows (Sandbox or not) never count here.
// A missing price-group table (migration 034) or any failed read counts as LIVE: the messages never claim a plan "ended" on a guess.
import { isCardPlan, liveKindDeps, stripeModeOf, type KindEnv, type EntitlementFact } from './kind.js';
import { sbRest } from '../webApp/webAppServer.js';

/** Free group, or unknown. True also for a missing table (404) and, in `planLive`, for any failed read. */
export async function isFreeOrUnknown(uid: string): Promise<boolean> {
  try {
    const rows = (await sbRest(`web_app_price_groups?user_id=eq.${encodeURIComponent(uid)}&select=price_group&limit=1`)) ?? [];
    return rows[0]?.price_group === 'free';
  } catch (e: any) {
    if (e?.status === 404) return true; // the table does not exist: cannot tell, so never "ended"
    throw e;
  }
}

export interface PlanLiveDeps {
  entitlements(uid: string, mode: 'live' | 'test'): Promise<EntitlementFact[]>;
  isFree(uid: string): Promise<boolean>;
}
export const livePlanLiveDeps = (): PlanLiveDeps => ({ entitlements: liveKindDeps().entitlements, isFree: isFreeOrUnknown });

export async function webPlanLive(uid: string, env: KindEnv, deps: PlanLiveDeps = livePlanLiveDeps()): Promise<boolean> {
  try {
    if ((await deps.entitlements(uid, stripeModeOf(env))).some(isCardPlan)) return true;
    return await deps.isFree(uid);
  } catch (e: any) {
    console.error('[plan live] lookup failed, counting the plan as live:', e?.status ?? e?.message ?? e);
    return true;
  }
}
