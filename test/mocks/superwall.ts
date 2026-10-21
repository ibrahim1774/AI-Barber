/**
 * Jest stand-in for expo-superwall: no provider, no native SDK. `sw` lets a
 * test drive the placement (captured callbacks, a held registerPlacement) and
 * set the customer's subscriptions.
 */
type Callbacks = {
  onPresent?: (info: any) => void;
  onDismiss?: (info: any, result: any) => void;
  onSkip?: (reason: any) => void;
  onError?: (error: string) => void;
};

export const sw = {
  callbacks: {} as Callbacks,
  /** What registerPlacement awaits before running `feature` (the real hook does the same). */
  register: async () => {},
  subscriptions: [] as any[],
  /** Replace to make getCustomerInfo hang or fail (native waits for config with no timeout). */
  customerInfo: null as null | (() => Promise<any>),
  /** What useSuperwall().restorePurchases resolves (or throws). */
  restore: async (): Promise<any> => ({ result: 'restored' }),
  /** Every setIntegrationAttributes call, in order. */
  integrationAttributes: [] as Record<string, string>[],
  /** useSuperwall().isConfigured (read at render). */
  configured: true,
  /** useSuperwall().configurationError (read at render). */
  configError: null as string | null,
  /** The callbacks the last useSuperwallEvents() call registered (SubscriptionSync's). */
  events: {} as Record<string, ((...args: any[]) => void) | undefined>,
  reset() {
    sw.events = {};
    sw.integrationAttributes = [];
    sw.configured = true;
    sw.configError = null;
    sw.callbacks = {};
    sw.register = async () => {};
    sw.subscriptions = [];
    sw.customerInfo = null;
    sw.restore = async () => ({ result: 'restored' });
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
export function useSuperwallEvents(callbacks: Record<string, ((...args: any[]) => void) | undefined> = {}) {
  sw.events = callbacks;
}
const getCustomerInfo = async () =>
  sw.customerInfo ? sw.customerInfo() : { userId: '', subscriptions: sw.subscriptions, nonSubscriptions: [], entitlements: [] };
const setIntegrationAttributes = async (attributes: Record<string, string>) => {
  sw.integrationAttributes.push(attributes);
};
export function useUser() {
  return { subscriptionStatus: { status: 'UNKNOWN' }, getCustomerInfo, setIntegrationAttributes };
}
export function SuperwallProvider({ children }: { children: unknown }) {
  return children;
}

export function useSuperwall(selector?: (s: Record<string, unknown>) => unknown) {
  const state = { isConfigured: sw.configured, configurationError: sw.configError, restorePurchases: () => sw.restore() };
  return selector ? selector(state) : state;
}
