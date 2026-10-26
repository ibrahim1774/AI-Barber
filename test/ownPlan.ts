/**
 * A plan whose Apple purchase is the signed-in account's own (`purchaseAccount: 'self'`), active, every tier granted.
 * Bookings / Store unlock only with this AND Superwall's word, so a test that expects "unlocked" sets both.
 */
import type { Plan } from '@/lib/plan';

export const OWN_PLAN: Plan = {
  linked: true, tier: 'store', entitlements: { hosting: true, bookings: true, store: true }, active: true,
  expiresAt: null, takenDownAt: null, revoked: false, purchaseAccount: 'self', purchaseHint: null, capabilities: { memberProfile: false },
};
