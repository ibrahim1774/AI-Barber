/**
 * Mocks for the e2e scenarios, wired in each test file with
 *   jest.mock('expo-superwall', () => require('./mocks').superwallMock());
 *   jest.mock('expo-sqlite/kv-store', () => require('./mocks').diskMock());
 *
 * - The "disk" lives on globalThis, so it survives jest.resetModules(): that is
 *   how a scenario kills the app and launches it again with the same storage.
 * - The Superwall mock is the shared test/mocks/superwall.ts plus the
 *   entitlements on the subscription status (the shared one always reports
 *   none), so SubscriptionSync feeds the real entitlements mirror; and the
 *   placement events go to the hook that registered (two usePaywall hooks are mounted).
 */
/* eslint-disable @typescript-eslint/no-require-imports */

type Disk = Map<string, string>;
const g = globalThis as unknown as { __e2eDisk?: Disk };

export function disk(): Disk {
  if (!g.__e2eDisk) g.__e2eDisk = new Map();
  return g.__e2eDisk;
}

/** A fresh install: nothing on the phone. */
export function wipeDisk(): void {
  disk().clear();
}

export function diskMock() {
  const Storage = {
    getItem: async (k: string): Promise<string | null> => disk().get(k) ?? null,
    setItem: async (k: string, v: string): Promise<void> => {
      disk().set(k, v);
    },
    removeItem: async (k: string): Promise<boolean> => disk().delete(k),
  };
  return { __esModule: true, default: Storage, Storage };
}

export function superwallMock() {
  const base = jest.requireActual('../../test/mocks/superwall');
  base.sw.ents = [] as string[];
  return {
    ...base,
    // Events go to the placement that is presenting (the shared mock keeps the last-rendered hook's callbacks).
    usePlacement(callbacks: Record<string, unknown> = {}) {
      return {
        registerPlacement: async ({ feature }: { placement: string; feature?: () => void }) => {
          base.sw.callbacks = callbacks;
          await base.sw.register();
          feature?.();
        },
      };
    },
    useUser() {
      const u = base.useUser();
      return {
        ...u,
        subscriptionStatus: { status: base.sw.status, entitlements: (base.sw.ents as string[]).map((id) => ({ id })) },
      };
    },
  };
}
