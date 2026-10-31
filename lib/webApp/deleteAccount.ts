// Account deletion for web-app (Stripe) accounts. Builds on the iOS delete flow (lib/ios/deleteAccount.ts, unchanged):
// the same ordering (close the shop -> take every site down -> purge -> delete rows and the user), with
//   - the account's web subscriptions CANCELED right after the shop is closed (no billing for a deleted account),
//   - the account's web_app_sites handled like the iOS purchases' sites (removed_at + taken_down_at on web_app_sites,
//     never on ios_purchases), so the lapse job can never bring a deleted site back.
// An account with iOS purchases too is handled by the unchanged iOS parts. Flag: WEB_APP_ENTITLEMENTS.
import { liveDeleteDeps, type DeleteAccountDeps } from '../ios/deleteAccount.js';
import { liveRemoveDeps } from '../ios/removeSiteLive.js';
import { purge, takeDown, type RemovableSite, type RemoveSiteDeps } from '../ios/removeSite.js';
import { isEntitledStatus } from './stripeCore.js';
import { sbRest, stripeCall } from './webAppServer.js';

const WEB = 'web:';
const enc = encodeURIComponent;
export const isWebSite = (s: Pick<RemovableSite, 'original_transaction_id'>) => String(s.original_transaction_id).startsWith(WEB);

/** Cancel every still-paying web subscription of the user, in whichever Stripe mode it lives. Throws when one cannot be canceled. */
export async function cancelWebSubscriptions(userId: string, cancel: (subId: string) => Promise<void> = (id) => stripeCall(`subscriptions/${enc(id)}`, null, 'DELETE').then(() => {})): Promise<string[]> {
  const rows: Array<{ stripe_subscription_id: string; status: string }> = (await sbRest(`web_app_entitlements?user_id=eq.${enc(userId)}&select=stripe_subscription_id,status`)) ?? [];
  const done: string[] = [];
  for (const r of rows) {
    if (!isEntitledStatus(r.status)) continue;
    await cancel(r.stripe_subscription_id);
    done.push(r.stripe_subscription_id);
  }
  return done;
}

export function liveWebDeleteDeps(): DeleteAccountDeps {
  const base = liveDeleteDeps();
  const remove = liveRemoveDeps();
  const stamp = (otid: string, body: Record<string, unknown>) =>
    sbRest(`web_app_sites?stripe_subscription_id=eq.${enc(otid.slice(WEB.length))}`, { method: 'PATCH', body: { ...body, updated_at: new Date().toISOString() } }).then(() => {});
  const webRemove: RemoveSiteDeps = {
    ...remove,
    markRemoved: (otid, at) => stamp(otid, { removed_at: new Date(at).toISOString(), taken_down_at: new Date(at).toISOString() }),
    markTakenDown: (otid, at) => stamp(otid, { taken_down_at: new Date(at).toISOString() }),
  };
  return {
    ...base,
    async listSites(userId) {
      const ios = await base.listSites(userId);
      const rows: Array<{ slug: string; stripe_subscription_id: string; environment: string; published_at: string | null }> =
        (await sbRest(`web_app_sites?user_id=eq.${enc(userId)}&select=slug,stripe_subscription_id,environment,published_at`)) ?? [];
      const web = rows.map((r) => ({
        original_transaction_id: WEB + r.stripe_subscription_id,
        site_slug: r.slug,
        environment: r.environment === 'live' ? 'Production' : 'Sandbox',
        published_at: r.published_at,
      })) as RemovableSite[];
      return [...ios, ...web];
    },
    takeDown: (s) => (isWebSite(s) ? takeDown(s, webRemove) : base.takeDown(s)),
    purge: (s) => (isWebSite(s) ? purge(s, webRemove) : base.purge(s)),
    // The shop is closed first (customers told, money refunded); only then is the billing stopped.
    closeShop: base.closeShop
      ? async (userId) => {
          const r = await base.closeShop!(userId);
          if (!r.ok) return r;
          await cancelWebSubscriptions(userId);
          return r;
        }
      : undefined,
  };
}
