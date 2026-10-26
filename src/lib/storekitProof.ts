import { requireOptionalNativeModule } from 'expo';

/** Apple's signed JWS for the current subscription entitlement, plus its originalTransactionId. */
export type StorekitProof = { jws: string; originalTransactionId: string };

type Native = { getCurrentEntitlementJWS(): Promise<StorekitProof | null> };

/**
 * The signed proof the server asks for on a subscription move. Native module `storekit-proof` (iOS 15+, StoreKit 2).
 * Never throws: a missing module (jest, simulators without a rebuild, Android), no entitlement, or any native
 * failure all answer null, and the caller simply sends no proof.
 */
export async function getCurrentEntitlementProof(): Promise<StorekitProof | null> {
  try {
    const mod = requireOptionalNativeModule<Native>('StorekitProof');
    if (!mod || typeof mod.getCurrentEntitlementJWS !== 'function') return null;
    const r = await mod.getCurrentEntitlementJWS();
    if (r && typeof r.jws === 'string' && r.jws && typeof r.originalTransactionId === 'string' && r.originalTransactionId) return r;
    return null;
  } catch {
    return null;
  }
}
