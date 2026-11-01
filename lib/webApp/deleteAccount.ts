// Account deletion for web-app (Stripe) accounts. Builds on the iOS delete flow (lib/ios/deleteAccount.ts, unchanged):
// the same ordering (close the shop -> take every site down -> purge -> delete rows and the user), with
//   - the account's web subscriptions CANCELED right after the shop is closed (no billing for a deleted account),
//   - the account's web_app_sites handled like the iOS purchases' sites (removed_at + taken_down_at on web_app_sites,
//     never on ios_purchases), so the lapse job can never bring a deleted site back.
// An account with iOS purchases too is handled by the unchanged iOS parts. Flag: WEB_APP_ENTITLEMENTS.
import { liveDeleteDeps, type DeleteAccountDeps } from '../ios/deleteAccount.js';
import { liveRemoveDeps } from '../ios/removeSiteLive.js';
import { purge, takeDown, type RemovableSite, type RemoveSiteDeps } from '../ios/removeSite.js';
import { isEntitledStatus, keyMode } from './stripeCore.js';
import { sbRest, stripeCall } from './webAppServer.js';

const WEB = 'web:';
const enc = encodeURIComponent;
export const isWebSite = (s: Pick<RemovableSite, 'original_transaction_id'>) => String(s.original_transaction_id).startsWith(WEB);

type EntRow = { stripe_subscription_id: string; status: string; environment: 'live' | 'test' };

/** Stripe says the subscription is gone / already ended: a retried delete counts that as done. Matches on error code/status, not message text. */
const alreadyGone = (e: any) => e?.status === 404 || e?.code === 'resource_missing' || e?.code === 'subscription_already_canceled';

/**
 * Which of the user's entitled web subscriptions this deployment may cancel (its own Stripe mode only).
 *  - same mode as the key: cancel
 *  - a TEST row under a live key: skip (test money; the live key cannot touch it)
 *  - a LIVE row under a test key (a staging delete on the shared DB): THROW 'live-subscription-elsewhere' so the delete is refused
 *    and live billing is never orphaned. Nothing has been cancelled when this throws.
 */
export async function planWebCancellations(userId: string): Promise<string[]> {
  const mode = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
  if (!mode) throw new Error('STRIPE_WEBAPP_SECRET_KEY missing or unrecognised');
  const rows: EntRow[] = (await sbRest(`web_app_entitlements?user_id=eq.${enc(userId)}&select=stripe_subscription_id,status,environment`)) ?? [];
  const entitled = rows.filter((r) => isEntitledStatus(r.status));
  if (mode === 'test' && entitled.some((r) => r.environment === 'live')) throw new Error('live-subscription-elsewhere');
  const skipped = entitled.filter((r) => r.environment !== mode);
  if (skipped.length) console.warn(`[web-app delete] leaving ${skipped.length} ${skipped[0].environment}-mode subscription(s) alone under a ${mode} key`);
  return entitled.filter((r) => r.environment === mode).map((r) => r.stripe_subscription_id);
}

/** Cancel every still-paying web subscription of the user in THIS deployment's Stripe mode. Throws when one cannot be canceled. */
export async function cancelWebSubscriptions(userId: string, cancel: (subId: string) => Promise<void> = (id) => stripeCall(`subscriptions/${enc(id)}`, null, 'DELETE').then(() => {})): Promise<string[]> {
  const ids = await planWebCancellations(userId); // refusal happens here, before anything is cancelled
  const done: string[] = [];
  for (const id of ids) {
    try { await cancel(id); }
    catch (e: any) { if (!alreadyGone(e)) throw e; }
    done.push(id);
  }
  return done;
}

/** Take the user's web sites offline and delete their stored copy, keeping the account and the subscription ("Take my website offline"). */
export async function removeWebSitesOf(userId: string): Promise<number> {
  const deps = liveWebDeleteDeps();
  const sites = (await deps.listSites(userId)).filter(isWebSite);
  for (const s of sites) await deps.takeDown(s);
  for (const s of sites) await deps.purge(s);
  return sites.length;
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
          await planWebCancellations(userId); // refuse BEFORE the shop is closed if a live subscription is out of this key's reach
          const r = await base.closeShop!(userId);
          if (!r.ok) return r;
          await cancelWebSubscriptions(userId);
          return r;
        }
      : undefined,
  };
}
