/** Jest stand-in for expo-superwall: no provider, no native SDK. */
export function usePlacement() {
  return { registerPlacement: async () => {} };
}
export function useSuperwallEvents() {}
export function useUser() {
  return {
    subscriptionStatus: { status: 'UNKNOWN' },
    getCustomerInfo: async () => ({ userId: '', subscriptions: [], nonSubscriptions: [], entitlements: [] }),
  };
}
export function SuperwallProvider({ children }: { children: unknown }) {
  return children;
}

export function useSuperwall(selector?: (s: Record<string, unknown>) => unknown) {
  const state = { isConfigured: true, restorePurchases: async () => ({}) };
  return selector ? selector(state) : state;
}
