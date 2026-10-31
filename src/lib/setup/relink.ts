import { Platform } from 'react-native';
import { currentUserId } from '@/lib/auth';
import { findTransactionId } from '@/lib/publish';
import { buildSetupBody, shopSetup } from '@/lib/setup/ownerApi';
import { loadMyShop } from '@/lib/shop';
import { loadSite } from '@/lib/siteStore';
import { registerPushToken } from '@/lib/bookings/push';

/**
 * A shop made before the subscription was linked stays paused on the public page. The
 * server's /api/shop/setup is convergent for an existing shop, so asking again with the
 * App Store transaction ties the purchase to it. Services are sent empty on purpose:
 * this only links the purchase and must never bring back services the owner deleted.
 */
let running: Promise<boolean> | null = null;

export type RelinkOptions = {
  /** getCustomerInfo().subscriptions → pickLatestTransactionId */
  latestTransactionId: () => Promise<string | null>;
  /** A transaction id the caller already has (a fresh publish or restore). */
  transactionId?: string | null;
};

/** True when the shop was just linked. Never throws; says nothing on failure (the next load tries again). */
export function relinkShopPurchase(opts: RelinkOptions): Promise<boolean> {
  // Web: the server finds the plan from the account (no Apple purchase to link).
  if (Platform.OS === 'web') return Promise.resolve(false);
  if (running) return running;
  running = run(opts)
    .catch(() => false)
    .finally(() => {
      running = null;
    });
  return running;
}

async function run(opts: RelinkOptions): Promise<boolean> {
  const shop = await loadMyShop();
  if (!shop || shop.purchaseLinked) return false;
  const site = await loadSite();
  if (!site) return false;
  const transactionId =
    opts.transactionId || (await findTransactionId(opts.latestTransactionId)) || site.transactionId;
  if (!transactionId) return false;
  await shopSetup({ ...buildSetupBody(site), services: [], transactionId });
  return true;
}

/** Once the shop exists: register this phone for booking pushes. Idempotent and never throws. */
export async function registerPushForShop(): Promise<void> {
  try {
    const uid = currentUserId();
    if (uid) await registerPushToken(uid);
  } catch {
    // registerPushToken already logs; nothing to tell the user
  }
}
