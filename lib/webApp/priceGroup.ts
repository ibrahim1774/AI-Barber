// Price test (Prime Barber /10 and /20): which price group a user is in. Server truth lives in web_app_price_groups
// (migration 034). A user's group is written once and never changes; only NEW sign-ups (no Stripe history) can get a test group.
import { isPriceGroup, type PriceGroup } from './stripeCore.js';
import { sbRest } from './webAppServer.js';

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

/**
 * Store a group for the user, once. An existing group always wins (first visit wins). A user with Stripe history gets 'base'.
 * Returns the group that is stored afterwards. Throws when Supabase fails (or the table is missing: the migration must be applied).
 */
export async function assignGroup(uid: string, requested: PriceGroup, source: string): Promise<PriceGroup> {
  const existing = await readStoredGroup(uid);
  if (existing) return existing;
  const group: PriceGroup = requested !== 'base' && (await hasStripeHistory(uid)) ? 'base' : requested;
  await sbRest('web_app_price_groups?on_conflict=user_id', { method: 'POST', body: { user_id: uid, price_group: group, source }, prefer: 'resolution=ignore-duplicates,return=minimal' });
  return (await readStoredGroup(uid)) ?? group; // a lost race converges on whichever row won
}
