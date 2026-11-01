// Does this account already pay (or is it still tied) through the iOS App Store? READ-ONLY: only GETs on
// ab_shops / ios_purchases, never a write. The web side only refuses or warns; it never links to an iOS purchase.
import { purchaseLive, type GateFields } from '../ios/lapse.js';
import { sbRest } from './webAppServer.js';

export type AppStoreState = 'active' | 'linked' | null;
export type IosPurchaseRow = GateFields & { original_transaction_id?: string | null };

/** Live deployments only count Production purchases; test (staging) deployments also count Sandbox ones. */
function counts(row: IosPurchaseRow, mode: 'live' | 'test'): boolean {
  return mode === 'live' ? row.environment === 'Production' : row.environment === 'Production' || row.environment === 'Sandbox';
}

/**
 * Pure decision. `shop` is the caller's ab_shops row, `shopPurchase` the purchase its ios_otid points at,
 * `ownPurchases` every ios_purchases row whose user_id is the caller.
 *  - 'active': some counted purchase is live right now.
 *  - 'linked': the shop is tied to a counted iOS purchase that has lapsed (a web payment would not reopen its gates).
 */
export function appStoreStateFrom(
  shop: { ios_otid: string | null } | null,
  shopPurchase: IosPurchaseRow | null,
  ownPurchases: IosPurchaseRow[],
  mode: 'live' | 'test',
  now: number,
): AppStoreState {
  if (ownPurchases.some((p) => counts(p, mode) && purchaseLive(p, now))) return 'active';
  if (shop?.ios_otid && shopPurchase && counts(shopPurchase, mode)) return purchaseLive(shopPurchase, now) ? 'active' : 'linked';
  return null;
}

const COLS = 'original_transaction_id,product_id,environment,expires_at,revoked_at,taken_down_at,site_slug,published_at';
const enc = encodeURIComponent;

/** Live lookup. Throws on a lookup error: the caller decides whether to fail closed (checkout) or open (/me). */
export async function appStoreStateOf(userId: string, mode: 'live' | 'test', now = Date.now(), rest: typeof sbRest = sbRest): Promise<AppStoreState> {
  const shop: { ios_otid: string | null } | null = ((await rest(`ab_shops?owner_id=eq.${enc(userId)}&select=ios_otid&limit=1`)) ?? [])[0] ?? null;
  const shopPurchase: IosPurchaseRow | null = shop?.ios_otid
    ? ((await rest(`ios_purchases?original_transaction_id=eq.${enc(shop.ios_otid)}&select=${COLS}&limit=1`)) ?? [])[0] ?? null
    : null;
  const own: IosPurchaseRow[] = (await rest(`ios_purchases?user_id=eq.${enc(userId)}&select=${COLS}&limit=20`)) ?? [];
  return appStoreStateFrom(shop, shopPurchase, own, mode, now);
}
