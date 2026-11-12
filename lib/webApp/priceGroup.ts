// Price test (Prime Barber /10 and /20) and the free site portal (/free-site): which price group a user is in. Server truth lives in web_app_price_groups
// (migration 034). A user's group is written once and never changes; only NEW sign-ups (no Stripe history) can get a test group.
import { WEB_APP_TAG, groupConfigured, isPriceGroup, keyMode, type EntitlementRow, type PriceGroup } from './stripeCore.js';
import { sbRest, stripeCall } from './webAppServer.js';
import { appStoreStateOf } from './appStoreGuard.js';

const enc = encodeURIComponent;

/** The stored group, or null when the user has none. A missing table (migration 034 not applied: PostgREST 404) also reads as null,
 *  because no group can exist before the table does. Any other read failure throws, so callers never guess a price. */
export async function readStoredGroup(uid: string): Promise<PriceGroup | null> {
  try {
    const g = (await sbRest(`web_app_price_groups?user_id=eq.${enc(uid)}&select=price_group&limit=1`))?.[0]?.price_group;
    return isPriceGroup(g) ? g : null;
  } catch (e: any) {
    if (e?.status === 404) return null;
    throw e;
  }
}

/** True when the user has ever had a web-app entitlement or Stripe customer row, in any environment (so not a new sign-up). */
export async function hasStripeHistory(uid: string): Promise<boolean> {
  const a = await sbRest(`web_app_entitlements?user_id=eq.${enc(uid)}&select=stripe_subscription_id&limit=1`);
  if (a?.length) return true;
  const b = await sbRest(`web_app_customers?user_id=eq.${enc(uid)}&select=user_id&limit=1`);
  return !!b?.length;
}

/** Server-side on/off switch: open only with WEB_APP_PRICE_TEST_OPEN=1 AND a valid WEB_APP_PRICE_TEST_START (ISO time). Groups already stored stay honoured regardless. */
export function priceTestStart(env: Record<string, string | undefined> = process.env): number | null {
  const t = Date.parse(env.WEB_APP_PRICE_TEST_START ?? '');
  return env.WEB_APP_PRICE_TEST_OPEN === '1' && Number.isFinite(t) ? t : null;
}

/** When the auth user was created (ms), via the Supabase admin API. Throws when unreadable (callers fail closed). */
export async function userCreatedAt(uid: string): Promise<number> {
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${enc(uid)}`, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY as string, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!r.ok) throw new Error(`auth user lookup ${r.status}`);
  const t = Date.parse(((await r.json().catch(() => null)) as any)?.created_at);
  if (!Number.isFinite(t)) throw new Error('auth user has no created_at');
  return t;
}

/** A completed web-app Checkout session exists for this user (same lookup checkout.ts uses). Throws when Stripe cannot be read. */
export async function hasCompletedCheckout(uid: string, email: string | null): Promise<boolean> {
  if (!email) return false;
  const mine = await stripeCall(`checkout/sessions?customer_details[email]=${enc(email)}&limit=20`, null, 'GET');
  return (mine?.data ?? []).some((o: any) => o?.metadata?.app === WEB_APP_TAG && o?.metadata?.user_id === uid && o.status === 'complete');
}

/** Free site portal (primebarber.org/free-site): open only with WEB_APP_FREE_OPEN=1 AND a valid WEB_APP_FREE_START (ISO time). Groups already stored stay honoured regardless. */
export function freeStart(env: Record<string, string | undefined> = process.env): number | null {
  const t = Date.parse(env.WEB_APP_FREE_START ?? '');
  return env.WEB_APP_FREE_OPEN === '1' && Number.isFinite(t) ? t : null;
}

/** Prefix of the in-memory subscription id a free account carries. No web_app_entitlements row ever has it (the lapse job and webhook never see one). */
export const FREE_SUB_PREFIX = 'free:';
export const isFreeSubscriptionId = (id: unknown): boolean => typeof id === 'string' && id.startsWith(FREE_SUB_PREFIX);

/** True when the user's stored group is 'free'. Throws on a lookup failure (callers decide whether to fail open or closed). */
export async function isFree(uid: string): Promise<boolean> {
  return (await readStoredGroup(uid)) === 'free';
}

/**
 * The in-memory entitlement a free account is treated as having (hosting + bookings, store off by tier). NEVER written to
 * web_app_entitlements. Use only where an "is entitled" check should pass for free accounts, and only after isFree(uid).
 */
export function freeEntitlementOf(uid: string, environment?: 'live' | 'test'): EntitlementRow {
  const env = environment ?? keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
  if (!env) throw new Error('STRIPE_WEBAPP_SECRET_KEY missing or unrecognised');
  return {
    stripe_subscription_id: `${FREE_SUB_PREFIX}${uid}`, stripe_customer_id: '', user_id: uid, site_slug: null,
    tier: 'bookings', billing_interval: 'year', status: 'active', environment: env,
    current_period_end: '2099-12-31T00:00:00.000Z', cancel_at_period_end: false,
  };
}

/** The entitlement to use for a user: a real paid row wins (passed in), else the free one when the stored group is 'free', else null. */
export async function entitlementOrFree(uid: string, real: EntitlementRow | null, environment?: 'live' | 'test'): Promise<EntitlementRow | null> {
  if (real) {
    // Free floor: a free-group account whose paid row is hosting-only ('website') still gets at least 'bookings'; everything else stays the paid row's.
    if (real.tier === 'website' && (await isFree(uid))) return { ...real, tier: 'bookings' };
    return real;
  }
  return (await isFree(uid)) ? freeEntitlementOf(uid, environment) : null;
}

/**
 * Store a group for the user, once (first write wins; an existing group is returned untouched).
 * - 'base' is always stored as asked.
 * - 'free' is stored only when WEB_APP_FREE_OPEN=1 with a valid WEB_APP_FREE_START, the account was created after that start, and it has no
 *   entitlement/customer rows and no completed Checkout; any other (existing) account is stored 'base'. Flag off: nothing is written, 'base' is returned.
 * - A test group (g10 / g20) is stored only when the test is open, the group is fully configured, and the user is a genuinely new
 *   sign-up (created after WEB_APP_PRICE_TEST_START, no entitlement/customer rows, no completed Checkout); anyone else is stored 'base'.
 *   When the test is closed or the group is not configured nothing is written and 'base' is returned.
 * Throws when a lookup fails (never guesses).
 */
export async function assignGroup(uid: string, email: string | null, requested: PriceGroup, source: string): Promise<PriceGroup> {
  const existing = await readStoredGroup(uid);
  if (existing) return existing;
  let group: PriceGroup = requested;
  if (requested === 'free') {
    const start = freeStart();
    if (start === null) return 'base';
    const isNew = (await userCreatedAt(uid)) >= start && !(await hasStripeHistory(uid)) && !(await hasCompletedCheckout(uid, email));
    if (!isNew) group = 'base';
    else {
      // An App Store subscriber (or an iOS-linked shop) never gets the free site: publish would refuse it ('app-store-account') anyway.
      const mode = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
      if (!mode || (await appStoreStateOf(uid, mode)) !== null) group = 'base';
    }
  } else if (requested !== 'base') {
    const start = priceTestStart();
    if (start === null || !groupConfigured(requested, process.env)) return 'base';
    const isNew = (await userCreatedAt(uid)) >= start && !(await hasStripeHistory(uid)) && !(await hasCompletedCheckout(uid, email));
    if (!isNew) group = 'base';
  }
  await sbRest('web_app_price_groups?on_conflict=user_id', { method: 'POST', body: { user_id: uid, price_group: group, source }, prefer: 'resolution=ignore-duplicates,return=minimal' });
  return (await readStoredGroup(uid)) ?? group; // a lost race converges on whichever row won
}
