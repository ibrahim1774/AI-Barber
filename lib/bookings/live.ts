// Production wiring for the booking API handlers. Service-role Supabase only server-side.
import { liveGetUser } from './auth.js';
import { liveNotify, livePayments } from './deps.js';
import type { OwnerDeps, PurchaseVerifier } from './ownerFlow.js';
import { shopBookingLimiter } from './rateLimit.js';
import { serviceClient, supabaseBookingRepo } from './repo.js';

export const BOOKING_BASE_URL = process.env.BOOKING_BASE_URL || 'https://www.aibarber.org';

/** lib/ios verifier (Apple) + ios_purchases upsert so the gate can find the row. */
function livePurchases(): PurchaseVerifier {
  return {
    async verify(transactionId) {
      const [{ defaultVerifier }, { supabasePurchases }] = await Promise.all([
        import('../ios/appleVerify.js'),
        import('../ios/purchases.js'),
      ]);
      // Captured before asking Apple, so a revocation newer than this answer is never cleared.
      const checkedAt = Date.now();
      const tx = await defaultVerifier()(transactionId);
      await supabasePurchases().upsertVerified(tx, { checkedAt });
      return { originalTransactionId: tx.originalTransactionId };
    },
    async setUser(otid, userId) {
      const { supabasePurchases } = await import('../ios/purchases.js');
      await supabasePurchases().setUser(otid, userId);
    },
  };
}

export function liveDeps(): OwnerDeps {
  const client = serviceClient();
  return {
    repo: supabaseBookingRepo(client),
    payments: livePayments,
    notify: liveNotify,
    now: Date.now,
    baseUrl: BOOKING_BASE_URL,
    limits: shopBookingLimiter(),
    getUser: liveGetUser(client),
    purchases: livePurchases(),
  };
}
