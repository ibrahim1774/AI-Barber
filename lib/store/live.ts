// Production wiring for the store API handlers. Service-role Supabase only server-side.
import { liveGetUser } from '../bookings/auth.js';
import { BOOKING_BASE_URL } from '../bookings/live.js';
import { SHOP_WINDOW_MS, supabaseRateStore, withFallback, type RateLimitStore } from '../bookings/rateLimit.js';
import { serviceClient } from '../bookings/repo.js';
import type { StoreLimits, StoreOwnerDeps } from './core.js';
import { liveNotifyOrder, liveStorePayments } from './deps.js';
import { supabaseStoreRepo } from './repo.js';

/** Order creates per shop per hour, across all IPs (ab_rate_hit key shop-order:{shopId}). */
export const SHOP_ORDER_LIMIT = 30;

/** Per-shop order cap. Shared across instances (Supabase), in-memory fallback: fails open, never throws. */
export function shopOrderLimiter(
  store: RateLimitStore = supabaseRateStore(() => serviceClient()),
  now: () => number = Date.now,
): StoreLimits {
  const safe = withFallback(store);
  return { shopOrder: async (shopId) => safe.hit(`shop-order:${shopId}`, SHOP_ORDER_LIMIT, SHOP_WINDOW_MS, now()) };
}

/** One per instance, so the in-memory fallback keeps counting across requests. The client is created on first use. */
const sharedShopOrderLimiter = shopOrderLimiter();

export function liveStoreDeps(): StoreOwnerDeps {
  const client = serviceClient();
  return {
    repo: supabaseStoreRepo(client),
    payments: liveStorePayments,
    notify: liveNotifyOrder,
    now: Date.now,
    baseUrl: BOOKING_BASE_URL,
    limits: sharedShopOrderLimiter,
    getUser: liveGetUser(client),
  };
}
