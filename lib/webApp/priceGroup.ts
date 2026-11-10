// Price test (Prime Barber /10 and /20): which price group a user is in. Server truth lives in web_app_price_groups
// (migration 034). A user's group is written once and never changes; only NEW sign-ups (no Stripe history) can get a test group.
import { WEB_APP_TAG, groupConfigured, isPriceGroup, type PriceGroup } from './stripeCore.js';
import { sbRest, stripeCall } from './webAppServer.js';

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

/**
 * Store a group for the user, once (first write wins; an existing group is returned untouched).
 * - 'base' is always stored as asked.
 * - A test group (g10 / g20) is stored only when the test is open, the group is fully configured, and the user is a genuinely new
 *   sign-up (created after WEB_APP_PRICE_TEST_START, no entitlement/customer rows, no completed Checkout); anyone else is stored 'base'.
 *   When the test is closed or the group is not configured nothing is written and 'base' is returned.
 * Throws when a lookup fails (never guesses).
 */
export async function assignGroup(uid: string, email: string | null, requested: PriceGroup, source: string): Promise<PriceGroup> {
  const existing = await readStoredGroup(uid);
  if (existing) return existing;
  let group: PriceGroup = requested;
  if (requested !== 'base') {
    const start = priceTestStart();
    if (start === null || !groupConfigured(requested, process.env)) return 'base';
    const isNew = (await userCreatedAt(uid)) >= start && !(await hasStripeHistory(uid)) && !(await hasCompletedCheckout(uid, email));
    if (!isNew) group = 'base';
  }
  await sbRest('web_app_price_groups?on_conflict=user_id', { method: 'POST', body: { user_id: uid, price_group: group, source }, prefer: 'resolution=ignore-duplicates,return=minimal' });
  return (await readStoredGroup(uid)) ?? group; // a lost race converges on whichever row won
}
