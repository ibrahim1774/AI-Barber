import { forgetLiveAddress, markSiteOffline, reliabilityOn, suspendWork } from './reliability.js';
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
import { purge, purgeOffline, safeTakeOfflineOn, takeDown, type RemovableSite, type RemoveSiteDeps } from '../ios/removeSite.js';
import { WEB_APP_TAG, isEntitledStatus, keyMode } from './stripeCore.js';
import { sbRest, stripeCall } from './webAppServer.js';
import { forgetSession, storedSessionId } from './checkoutSessions.js';
import { emailOfUser } from './userExists.js';
import { alertOwner } from './emails.js';

const WEB = 'web:';
const enc = encodeURIComponent;
export const isWebSite = (s: Pick<RemovableSite, 'original_transaction_id'>) => String(s.original_transaction_id).startsWith(WEB);

type EntRow = { stripe_subscription_id: string; stripe_customer_id?: string | null; status: string; environment: 'live' | 'test' };

/** Stripe says the subscription does not exist any more. A retried delete counts that as done. */
const missing = (e: any) => e?.status === 404 || e?.code === 'resource_missing';

/**
 * A first-time payer has no stored customer until the webhook lands. Stripe still knows their Checkout sessions (found by the
 * account email, filtered to this user): COMPLETED ones name the customer Stripe created; OPEN ones are still payable.
 * Throws on a Stripe error so the delete is retried rather than leaving billing behind. No email = nothing to look up.
 */
export async function sessionsOfUser(userId: string, lookupEmail: (id: string) => Promise<string | null> = emailOfUser): Promise<{ customers: string[]; open: string[] }> {
  const mode = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
  const stored = mode ? await storedSessionId(userId, mode) : null; // found by id, so it works without an email
  const email = await lookupEmail(userId);
  if (!email) return { customers: [], open: stored ? [stored] : [] };
  const list = await stripeCall(`checkout/sessions?customer_details[email]=${enc(email)}&limit=100`, null, 'GET');
  const customers = new Set<string>(); const open: string[] = [];
  for (const o of list?.data ?? []) {
    if (o?.metadata?.app !== WEB_APP_TAG || o?.metadata?.user_id !== userId) continue;
    if (o.status === 'complete') { const c = typeof o.customer === 'string' ? o.customer : o.customer?.id; if (c) customers.add(c); }
    else if (o.status === 'open' && typeof o.id === 'string') open.push(o.id);
  }
  if (stored && !open.includes(stored)) open.push(stored);
  return { customers: [...customers], open };
}

/**
 * Which of the user's entitled web subscriptions this deployment may cancel (its own Stripe mode only).
 *  - same mode as the key: cancel
 *  - a TEST row under a live key: skip (test money; the live key cannot touch it)
 *  - a LIVE row under a test key (a staging delete on the shared DB): THROW 'live-subscription-elsewhere' so the delete is refused
 *    and live billing is never orphaned. Nothing has been cancelled when this throws.
 * Also lists the tagged subscriptions of the stored Stripe customer(s) in this mode, so one that was paid but whose webhook has
 * not landed (no row yet) is cancelled too.
 */
export async function planWebCancellations(userId: string, listForCustomer: (customerId: string) => Promise<any[]> = defaultList, discover: typeof sessionsOfUser = sessionsOfUser): Promise<string[]> {
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
  for (const c of (await discover(userId)).customers) customers.add(c);
  for (const c of customers) {
    for (const sub of await listForCustomer(c)) {
      // The domain subscription sits on the same customer since one-click: it must stop billing with the account.
      const isDomain = sub?.metadata?.type === 'domain_purchase' && sub?.metadata?.app === 'aibarber-domain';
      if ((sub?.metadata?.app === WEB_APP_TAG || isDomain) && typeof sub.id === 'string' && (isEntitledStatus(String(sub.status)) || sub.status === 'unpaid' || sub.status === 'paused' || sub.status === 'incomplete')) ids.add(sub.id);
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
  discover: typeof sessionsOfUser = sessionsOfUser,
  expire: (sessionId: string) => Promise<unknown> = (id) => stripeCall(`checkout/sessions/${enc(id)}/expire`, {}, 'POST'),
): Promise<string[]> {
  const ids = await planWebCancellations(userId, listForCustomer, discover); // refusal happens here, before anything is cancelled
  // Nobody may pay for a deleted account mid-delete: expire the user's still-open sessions (best effort; an already-expired one is fine).
  for (const sid of (await discover(userId)).open) await Promise.resolve(expire(sid)).catch((e: any) => console.error('[web-app delete] expire failed:', e?.message || e));
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
  const mode = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
  if (mode) await forgetSession(userId, mode);
  await sbRest(`web_app_customers?user_id=eq.${enc(userId)}`, { method: 'DELETE' });
  return done;
}

/**
 * Take the user's web sites offline and delete their stored copy, keeping the account and the subscription ("Take my website offline").
 * `opts.keepContent` (ONLY the native app's account-mode take offline, api/web-app/take-offline.ts with X-PB-Build): never deletes the stored copy or photos,
 * whatever SAFE_TAKE_OFFLINE says (the domain is detached and the stored address forgotten, exactly the SAFE_TAKE_OFFLINE path). The browser and old builds
 * pass nothing and get today's behaviour.
 */
export async function removeWebSitesOf(userId: string, opts: { keepContent?: boolean } = {}): Promise<number> {
  await suspendWork(userId);
  const deps = liveWebDeleteDeps({ keepPhone: !!opts.keepContent });
  const sites = (await deps.listSites(userId)).filter(isWebSite);
  for (const s of sites) await deps.takeDown(s);
  if (opts.keepContent || safeTakeOfflineOn()) { const rm = liveRemoveDeps(); for (const s of sites) await purgeOffline(s, rm); } // keeps the stored copy
  else for (const s of sites) await deps.purge(s);
  await markSiteOffline(userId);
  // The keep-content take offline forgets the draft's live address itself, whatever WEB_APP_RELIABILITY says (best effort: no draft row or table means nothing to forget).
  // A failure is logged; native draft GET/PUT and publish also treat a site whose web_app_sites row is removed or taken down as not live (lib/account/siteOffline.ts), so a stale
  // address cannot come back if the draft engine is turned on later.
  if (opts.keepContent && !reliabilityOn()) await forgetLiveAddress(userId).catch((e: any) => console.error('[take offline] could not forget the draft live address:', e?.status ?? e?.message ?? e));
  return sites.length;
}

/**
 * True when the user has any row in web_app_entitlements, web_app_customers or web_app_checkout_sessions.
 * web_app_price_groups is NOT Stripe history (it is written at web sign-up). A read error throws (fail closed).
 */
export async function hasStripeHistory(userId: string): Promise<boolean> {
  for (const t of ['web_app_entitlements', 'web_app_customers', 'web_app_checkout_sessions']) {
    const rows = await sbRest(`${t}?user_id=eq.${enc(userId)}&select=user_id&limit=1`);
    if (Array.isArray(rows) && rows.length > 0) return true;
  }
  return false;
}

const STRIPE_PLAN_TIMEOUT_MS = 8000;
/** Thrown for a failure of Stripe itself (down, slow, bad key, key missing). Anything else (a database read) stays a hard failure. */
class StripeDown extends Error { constructor(public reason: string) { super(reason); } }
const readRows = async (path: string) => { const r = await sbRest(path); return Array.isArray(r) && r.length > 0; };

/**
 * iOS in-app delete only (`allowNoStripe`, passed by api/ios/delete-account.ts when APP_DELETE_CANCELS_WEB=1).
 * Stripe is ALWAYS asked first (8 s). If it answers, today's behaviour. If the key is missing or Stripe is down/slow, the delete may
 * go on WITHOUT Stripe only when the account has no Stripe history (entitlements, customers, sessions) AND (it holds an ios_purchases row
 * OR has no web sign-up: no price-group row, no draft row). The owner is alerted whenever that happens. Everything else, and any read
 * error, fails closed.
 */
async function planWithStripeFallback(userId: string): Promise<{ withoutStripe: string | null }> {
  if (!keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY)) return { withoutStripe: await mayGoWithoutStripe(userId, 'Stripe key missing') };
  let emailReadFailed = false;
  const down = <A extends any[], T>(f: (...a: A) => Promise<T>) => async (...a: A): Promise<T> => { try { return await f(...a); } catch (e: any) { throw new StripeDown(`Stripe call failed: ${e?.message || e}`); } };
  const list = down(async (c: string): Promise<any[]> => (await stripeCall(`subscriptions?customer=${enc(c)}&status=all&limit=20`, null, 'GET'))?.data ?? []);
  const discover: typeof sessionsOfUser = (uid) => sessionsOfUser(uid, async (id) => { try { return await emailOfUser(id); } catch (e) { emailReadFailed = true; throw e; } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      planWebCancellations(userId, list, async (uid) => { try { return await discover(uid); } catch (e: any) { throw emailReadFailed ? e : new StripeDown(`Stripe call failed: ${e?.message || e}`); } }),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new StripeDown('Stripe timed out')), STRIPE_PLAN_TIMEOUT_MS); }),
    ]);
    return { withoutStripe: null };
  } catch (e: any) {
    if (!(e instanceof StripeDown)) throw e;
    return { withoutStripe: await mayGoWithoutStripe(userId, e.reason) };
  } finally { if (timer) clearTimeout(timer); }
}

async function mayGoWithoutStripe(userId: string, reason: string): Promise<string> {
  const enc1 = enc(userId);
  if (await hasStripeHistory(userId)) throw new Error(`delete refused: ${reason} and the account has Stripe history`);
  const apple = await readRows(`ios_purchases?user_id=eq.${enc1}&select=original_transaction_id&limit=1`);
  if (!apple) {
    const webSignup = (await readRows(`web_app_price_groups?user_id=eq.${enc1}&select=user_id&limit=1`)) || (await readRows(`web_app_drafts?user_id=eq.${enc1}&select=user_id&limit=1`));
    if (webSignup) throw new Error(`delete refused: ${reason} and the account has a web sign-up and no Apple purchase`);
  }
  await alertOwner('Account deleted without asking Stripe', [`user: ${userId}`, `reason: ${reason}`, apple ? 'The account holds an Apple purchase.' : 'The account has no web sign-up.', 'No Stripe history was found locally. Check Stripe for this customer if in doubt.']).catch((e: any) => console.error('[ios/delete-account] no-Stripe alert failed:', e?.message || e));
  return reason;
}

/** `keepPhone` (the native keep-content take offline only): the removal stamp leaves the saved contact phone alone, so "nothing is deleted" is fully true. */
export function liveWebDeleteDeps(opts: { allowNoStripe?: boolean; keepPhone?: boolean; onCancelled?: (subscriptionIds: string[]) => void } = {}): DeleteAccountDeps {
  const base = liveDeleteDeps();
  const remove = liveRemoveDeps();
  const stamp = (otid: string, body: Record<string, unknown>) =>
    sbRest(`web_app_sites?stripe_subscription_id=eq.${enc(otid.slice(WEB.length))}`, { method: 'PATCH', body: { ...body, updated_at: new Date().toISOString() } }).then(() => {});
  const webRemove: RemoveSiteDeps = {
    ...remove,
    markRemoved: (otid, at) => stamp(otid, { removed_at: new Date(at).toISOString(), taken_down_at: new Date(at).toISOString() })
      // Drop the stored mobile number too. Separate and best effort: the columns come with migration 032, and a missing column must never break account deletion.
      // (Not for keepPhone: the keep-content take offline keeps the number.)
      .then(() => (opts.keepPhone ? undefined : stamp(otid, { contact_phone: null, contact_phone_at: null }).catch(() => {}))),
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
    // The account's price-group row goes with the user (best effort: a leftover row is harmless and must never fail the delete).
    async deleteUser(userId) {
      await base.deleteUser(userId);
      await sbRest(`web_app_price_groups?user_id=eq.${enc(userId)}`, { method: 'DELETE' }).catch((e: any) => console.error('[web-app delete] price group row left behind:', e?.message || e));
    },
    takeDown: (s) => (isWebSite(s) ? takeDown(s, webRemove) : base.takeDown(s)),
    purge: (s) => (isWebSite(s) ? purge(s, webRemove) : base.purge(s)),
    // The shop is closed first (customers told, money refunded); only then is the billing stopped.
    closeShop: base.closeShop
      ? async (userId) => {
          if (opts.allowNoStripe) {
            // A failure of the card-plan part (asking Stripe, or cancelling) is tagged `cardCancel` so the native delete route can tell the app (`cardCancelFailed`): nothing was deleted.
            const card = <T>(p: Promise<T>): Promise<T> => p.catch((e: any) => { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { cardCancel: true }); });
            const { withoutStripe } = await card(planWithStripeFallback(userId)); // refuses (throws) unless Stripe answered or the fallback rules allow it
            await suspendWork(userId, 'deleting');
            const r = await base.closeShop!(userId);
            if (!r.ok || withoutStripe) return r;
            const cancelled = await card(cancelThenForgetCustomers(userId)); // (not inside an optional call: its argument must always be evaluated)
            opts.onCancelled?.(cancelled);
            return r;
          }
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
