/**
 * Jest stand-in for expo-superwall: no provider, no native SDK. `sw` lets a
 * test drive the placement (captured callbacks, a held registerPlacement) and
 * set the customer's subscriptions.
 */
type Callbacks = {
  onDismiss?: (info: any, result: any) => void;
  onSkip?: (reason: any) => void;
  onError?: (error: string) => void;
};

export const sw = {
  callbacks: {} as Callbacks,
  /** What registerPlacement awaits before running `feature` (the real hook does the same). */
  register: async () => {},
  subscriptions: [] as any[],
  reset() {
    sw.callbacks = {};
    sw.register = async () => {};
    sw.subscriptions = [];
  },
};

export function usePlacement(callbacks: Callbacks = {}) {
  sw.callbacks = callbacks;
  return {
    registerPlacement: async ({ feature }: { placement: string; feature?: () => void }) => {
      await sw.register();
      feature?.();
    },
  };
}
export function useSuperwallEvents() {}
const getCustomerInfo = async () => ({ userId: '', subscriptions: sw.subscriptions, nonSubscriptions: [], entitlements: [] });
export function useUser() {
  return { subscriptionStatus: { status: 'UNKNOWN' }, getCustomerInfo };
}
export function SuperwallProvider({ children }: { children: unknown }) {
  return children;
}

export function useSuperwall(selector?: (s: Record<string, unknown>) => unknown) {
  const state = { isConfigured: true, restorePurchases: async () => ({}) };
  return selector ? selector(state) : state;
}
