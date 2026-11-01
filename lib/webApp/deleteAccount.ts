import { markSiteOffline, suspendWork } from './reliability.js';
// Account deletion for web-app (Stripe) accounts. Builds on the iOS delete flow (lib/ios/deleteAccount.ts, unchanged):
// the same ordering (close the shop -> take every site down -> purge -> delete rows and the user), with
//   - the account's web subscriptions CANCELED right after the shop is closed (no billing for a deleted account),
//   - the account's web_app_sites handled like the iOS purchases' sites (removed_at + taken_down_at on web_app_sites,
//     never on ios_purchases), so the lapse job can never bring a deleted site back.
// DEPLOY GATE: migration 024 (web_app_customers) must be applied BEFORE turning on ANY web-app flag, WEB_APP_ENTITLEMENTS included:
// this flow reads and deletes web_app_customers.
// An account with iOS purchases too is handled by the unchanged iOS parts. Flag: WEB_APP_ENTITLEMENTS.
import { liveDeleteDeps, type DeleteAccountDeps } from '../ios/deleteAccount.js';
import { liveRemoveDeps } from '../ios/removeSiteLive.js';
import { purge, takeDown, type RemovableSite, type RemoveSiteDeps } from '../ios/removeSite.js';
import { WEB_APP_TAG, isEntitledStatus, keyMode } from './stripeCore.js';
import { sbRest, stripeCall } from './webAppServer.js';

const WEB = 'web:';
const enc = encodeURIComponent;
export const isWebSite = (s: Pick<RemovableSite, 'original_transaction_id'>) => String(s.original_transaction_id).startsWith(WEB);

type EntRow = { stripe_subscription_id: string; stripe_customer_id?: string | null; status: string; environment: 'live' | 'test' };

/** Stripe says the subscription does not exist any more. A retried delete counts that as done. */
const missing = (e: any) => e?.status === 404 || e?.code === 'resource_missing';

/**
 * Which of the user's entitled web subscriptions this deployment may cancel (its own Stripe mode only).
 *  - same mode as the key: cancel
 *  - a TEST row under a live key: skip (test money; the live key cannot touch it)
 *  - a LIVE row under a test key (a staging delete on the shared DB): THROW 'live-subscription-elsewhere' so the delete is refused
 *    and live billing is never orphaned. Nothing has been cancelled when this throws.
 * Also lists the tagged subscriptions of the stored Stripe customer(s) in this mode, so one that was paid but whose webhook has
 * not landed (no row yet) is cancelled too.
 */
export async function planWebCancellations(userId: string, listForCustomer: (customerId: string) => Promise<any[]> = defaultList): Promise<string[]> {
  const mode = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
  if (!mode) throw new Error('STRIPE_WEBAPP_SECRET_KEY missing or unrecognised');
  const rows: EntRow[] = (await sbRest(`web_app_entitlements?user_id=eq.${enc(userId)}&select=stripe_subscription_id,stripe_customer_id,status,environment`)) ?? [];
  const entitled = rows.filter((r) => isEntitledStatus(r.status));
  if (mode === 'test' && entitled.some((r) => r.environment === 'live')) throw new Error('live-subscription-elsewhere');
  const skipped = entitled.filter((r) => r.environment !== mode);
  if (skipped.length) console.warn(`[web-app delete] leaving ${skipped.length} ${skipped[0].environment}-mode subscription(s) alone under a ${mode} key`);
  const ids = new Set(entitled.filter((r) => r.environment === mode).map((r) => r.stripe_subscription_id));
  const stored: Array<{ stripe_customer_id: string }> = (await sbRest(`web_app_customers?user_id=eq.${enc(userId)}&environment=eq.${mode}&select=stripe_customer_id`)) ?? [];
  const customers = new Set([...stored.map((c) => c.stripe_customer_id), ...rows.filter((r) => r.environment === mode).map((r) => r.stripe_customer_id)].filter((c): c is string => !!c));
  for (const c of customers) {
    for (const sub of await listForCustomer(c)) {
      if (sub?.metadata?.app === WEB_APP_TAG && typeof sub.id === 'string' && (isEntitledStatus(String(sub.status)) || sub.status === 'unpaid' || sub.status === 'paused' || sub.status === 'incomplete')) ids.add(sub.id);
    }
  }
  return [...ids];
}

async function defaultList(customerId: string): Promise<any[]> {
  return (await stripeCall(`subscriptions?customer=${enc(customerId)}&status=all&limit=20`, null, 'GET'))?.data ?? [];
}

/** Cancel every still-paying web subscription of the user in THIS deployment's Stripe mode. Throws when one cannot be canceled. */
export async function cancelWebSubscriptions(
  userId: string,
  cancel: (subId: string) => Promise<void> = (id) => stripeCall(`subscriptions/${enc(id)}`, null, 'DELETE').then(() => {}),
  statusOf: (subId: string) => Promise<string> = async (id) => String((await stripeCall(`subscriptions/${enc(id)}`, null, 'GET')).status),
  listForCustomer?: (customerId: string) => Promise<any[]>,
): Promise<string[]> {
  const ids = await planWebCancellations(userId, listForCustomer); // refusal happens here, before anything is cancelled
  const done: string[] = [];
  for (const id of ids) {
    try { await cancel(id); }
    catch (e: any) {
      if (!missing(e)) {
        // Any other error: ask Stripe. Already canceled counts as done (no reliance on a particular error code).
        let st: string | null = null;
        try { st = await statusOf(id); } catch (e2: any) { if (!missing(e2)) throw e; }
        if (st !== null && st !== 'canceled') throw e;
      }
    }
    done.push(id);
  }
  return done;
}

/** Cancel the web subscriptions, and only AFTER that succeeded forget the user's stored Stripe customers (web_app_customers). */
export async function cancelThenForgetCustomers(userId: string, cancel?: Parameters<typeof cancelWebSubscriptions>[1]): Promise<string[]> {
  const done = await cancelWebSubscriptions(userId, cancel);
  await sbRest(`web_app_customers?user_id=eq.${enc(userId)}`, { method: 'DELETE' });
  return done;
}

/** Take the user's web sites offline and delete their stored copy, keeping the account and the subscription ("Take my website offline"). */
export async function removeWebSitesOf(userId: string): Promise<number> {
  await suspendWork(userId);
  const deps = liveWebDeleteDeps();
  const sites = (await deps.listSites(userId)).filter(isWebSite);
  for (const s of sites) await deps.takeDown(s);
  for (const s of sites) await deps.purge(s);
  await markSiteOffline(userId);
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
          await suspendWork(userId, 'deleting');
          const r = await base.closeShop!(userId);
          if (!r.ok) return r;
          await cancelThenForgetCustomers(userId);
          return r;
        }
      : undefined,
  };
}
