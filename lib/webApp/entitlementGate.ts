// Web app (Stripe) subscriptions seen by the tier gates, as if they were iOS purchases.
//
// A web subscriber has no ios_purchases row and must never get one (the iOS sweep and lapse
// would ask Apple about it and take the site down). Instead, when WEB_APP_ENTITLEMENTS=1 and a
// shop has no iOS link (ab_shops.ios_otid null), the gates read the owner's web_app_entitlements
// row and see it through a synthesized, in-memory PurchaseRow. Flag off, or a shop with an iOS
// link: exactly the iOS lookup, nothing else is consulted.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PurchaseRow } from '../ios/purchases.js';
import { isEntitledStatus, keyMode, type EntitlementRow, type Interval, type Tier } from './stripeCore.js';
import { freeEntitlementOf } from './priceGroup.js';

export const webAppEntitlementsOn = (): boolean => process.env.WEB_APP_ENTITLEMENTS === '1';

/** The iOS product id whose tier/entitlements match (lib/ios/tiers.ts). `website` is `hosting` there. */
export function webProductId(tier: Tier, interval: Interval): string {
  return `com.ibrahim1774.aibarber.${tier === 'website' ? 'hosting' : tier}.${interval === 'year' ? 'yearly' : 'monthly'}`;
}

export type WebEntitlementRecord = EntitlementRow & { updated_at: string };

/**
 * The gate row for a web entitlement. `site` is the bound web_app_sites row (or null). Not entitled
 * (canceled, unpaid, invalid_price ...) or the site taken down: taken_down_at is set, which closes
 * every gate. site_slug and published_at stay null so the purchaseLive expiry check backs up a late webhook.
 */
export function synthPurchaseRow(e: WebEntitlementRecord, site: { taken_down_at: string | null } | null): PurchaseRow {
  const down = !isEntitledStatus(e.status) || !!site?.taken_down_at;
  return {
    original_transaction_id: `web:${e.stripe_subscription_id}`,
    product_id: webProductId(e.tier, e.billing_interval),
    environment: e.environment === 'live' ? 'Production' : 'Sandbox',
    site_slug: null,
    user_id: e.user_id,
    expires_at: e.current_period_end,
    revoked_at: null,
    last_notification: null,
    published_at: null,
    taken_down_at: down ? (site?.taken_down_at ?? e.updated_at) : null,
    lapse_checked_at: null,
  };
}

const ts = (s: string | null | undefined) => Date.parse(s ?? '') || 0;

/** Newest entitled row of this Stripe mode, else the newest row of it. */
export function pickWebRow(rows: WebEntitlementRecord[], mode: 'live' | 'test' | null): WebEntitlementRecord | null {
  if (!mode) return null;
  const mine = rows.filter((r) => r.environment === mode).sort((a, b) => ts(b.updated_at) - ts(a.updated_at));
  return mine.find((r) => isEntitledStatus(r.status)) ?? mine[0] ?? null;
}

/** The synthesized gate row of a user's web subscription, or null. Throws on a lookup error. */
export async function fetchWebEntitlementOf(db: SupabaseClient, userId: string): Promise<PurchaseRow | null> {
  const mode = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
  if (!mode) return null;
  const { data, error } = await db.from('web_app_entitlements').select('*').eq('user_id', userId).eq('environment', mode);
  if (error) throw new Error(`web_app_entitlements lookup failed: ${error.message}`);
  let row = pickWebRow((data ?? []) as WebEntitlementRecord[], mode);
  // Free-group account (stored group 'free', no paid entitled row): the in-memory free entitlement (hosting + bookings), never stored.
  // Also read it for a hosting-only ('website') paid row: the free floor lifts it to 'bookings'.
  if (!row || !isEntitledStatus(row.status) || row.tier === 'website') {
    const { data: g, error: ge } = await db.from('web_app_price_groups').select('price_group').eq('user_id', userId).maybeSingle();
    // A missing table (migration 034 not applied) reads as no group; any other failure throws so a gate never guesses.
    if (ge && !/does not exist|not find the table|PGRST205|42P01/i.test(`${ge.code ?? ''} ${ge.message ?? ''}`)) throw new Error(`web_app_price_groups lookup failed: ${ge.message}`);
    if ((g as { price_group?: string } | null)?.price_group === 'free') {
      if (!row || !isEntitledStatus(row.status)) row = { ...freeEntitlementOf(userId, mode), updated_at: new Date().toISOString() };
      else row = { ...row, tier: 'bookings' }; // paid row wins for everything else (id, status, period); only the tier is floored
    }
  }
  if (!row) return null;
  const { data: site, error: e2 } = await db.from('web_app_sites').select('taken_down_at').eq('stripe_subscription_id', row.stripe_subscription_id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (e2) throw new Error(`web_app_sites lookup failed: ${e2.message}`);
  return synthPurchaseRow(row, (site as { taken_down_at: string | null } | null) ?? null);
}

/**
 * The purchase row behind a shop's gates. A shop with an iOS link always uses iOS. Without one, and
 * only with the flag on, the owner's web subscription. Flag off: exactly the old lookup.
 */
export async function gateRow<R>(
  repo: { purchase(otid: string): Promise<R | null>; webEntitlementOf?(userId: string): Promise<R | null> },
  shop: { ios_otid: string | null; owner_id: string },
): Promise<R | null> {
  if (shop.ios_otid) return repo.purchase(shop.ios_otid);
  if (!webAppEntitlementsOn() || !repo.webEntitlementOf) return null;
  return repo.webEntitlementOf(shop.owner_id);
}
