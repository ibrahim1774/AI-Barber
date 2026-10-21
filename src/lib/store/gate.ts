/**
 * The Store tier hook point. Phase 3 treats every shop as entitled; Phase 4
 * replaces `useStoreAccess` with the real check (Superwall placement
 * `store_upgrade`) and `openStoreUpgrade` with presenting that paywall. The
 * Store tab already renders its locked/upgrade state from `status`.
 */
export type StoreAccess = { status: 'active' | 'inactive' };

export function useStoreAccess(): StoreAccess {
  return { status: 'active' };
}

export function openStoreUpgrade(): void {
  // Phase 4: register the `store_upgrade` placement.
}
