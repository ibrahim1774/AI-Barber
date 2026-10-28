/**
 * A plan whose Apple purchase is the signed-in account's own (`purchaseAccount: 'self'`), active, every tier granted.
 * The server's own, active plan grants its tiers by itself (Superwall's word is added on top), so a test that expects
 * "unlocked" needs only this.
 */
import type { Plan } from '@/lib/plan';

export const OWN_PLAN: Plan = {
  linked: true, tier: 'store', entitlements: { hosting: true, bookings: true, store: true }, active: true,
  expiresAt: null, takenDownAt: null, revoked: false, purchaseAccount: 'self', purchaseHint: null, capabilities: { memberProfile: false },
};

/**
 * Ownership only: the account owns the purchase, but the server grants no tier beyond what Superwall reports. Only for
 * tests of the Superwall mirror itself (what each Superwall status alone turns into).
 */
export const OWNERSHIP_ONLY_PLAN: Plan = { ...OWN_PLAN, tier: null, entitlements: { hosting: false, bookings: false, store: false } };
