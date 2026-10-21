// Production wiring for the booking API handlers. Service-role Supabase only server-side.
import { liveGetUser } from './auth.js';
import { liveNotify, livePayments } from './deps.js';
import type { OwnerDeps, PurchaseVerifier } from './ownerFlow.js';
import { shopBookingLimiter } from './rateLimit.js';
import { serviceClient, supabaseBookingRepo } from './repo.js';
import type { VerifiedTx } from '../ios/appleVerify.js';
import type { PurchasesRepo } from '../ios/purchases.js';

export const BOOKING_BASE_URL = process.env.BOOKING_BASE_URL || 'https://www.aibarber.org';

/** What a purchase verify needs: the Apple verifier and the ios_purchases repo. */
export interface PurchaseVerifierParts {
  verify(transactionId: string): Promise<VerifiedTx>;
  repo: Pick<PurchasesRepo, 'upsertVerified' | 'setUser'>;
}

/**
 * Apple verify + ios_purchases upsert, so the gates can find the row. Any of the six products
 * (lib/ios/tiers.ts) verifies, and the upsert records its (latest) product, so a Bookings or
 * Store purchase made at publish grants its tier at once. `load` is lazy: the App Store library
 * is only pulled in by calls that verify.
 */
export function makePurchaseVerifier(load: () => Promise<PurchaseVerifierParts>, now: () => number = Date.now): PurchaseVerifier {
  return {
    async verify(transactionId) {
      const { verify, repo } = await load();
      // Captured before asking Apple, so a revocation newer than this answer is never cleared.
      const checkedAt = now();
      const tx = await verify(transactionId);
      await repo.upsertVerified(tx, { checkedAt });
      return { originalTransactionId: tx.originalTransactionId };
    },
    async setUser(otid, userId) {
      const { repo } = await load();
      await repo.setUser(otid, userId);
    },
  };
}

function livePurchases(): PurchaseVerifier {
  return makePurchaseVerifier(async () => {
    const [{ defaultVerifier }, { supabasePurchases }] = await Promise.all([
      import('../ios/appleVerify.js'),
      import('../ios/purchases.js'),
    ]);
    return { verify: (id) => defaultVerifier()(id), repo: supabasePurchases() };
  });
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
