/** Jest stand-in for expo-superwall: no provider, no native SDK. */
export function usePlacement() {
  return { registerPlacement: async () => {} };
}
export function useSuperwallEvents() {}
export function useUser() {
  return { subscriptionStatus: { status: 'UNKNOWN' } };
}
export function SuperwallProvider({ children }: { children: unknown }) {
  return children;
}

export function useSuperwall() {
  return { restorePurchases: async () => ({}) };
}
