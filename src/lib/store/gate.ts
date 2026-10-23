import { useTierAccess, useUpgrade, type TierAccess } from '@/lib/tierAccess';

/**
 * The Store tier gate. `active`: the plan covers the store. `inactive`: it
 * doesn't (Website or Bookings plan). `loading` / `error`: not decidable yet.
 * Order actions are never gated by this: orders already placed stay
 * fulfillable and refundable after a downgrade.
 */
export type StoreAccess = {
  status: 'active' | 'inactive' | 'loading' | 'error';
  /** Hosting lapsed over 30 days ago: only the upgrade card shows. */
  expired: boolean;
  /** Hosting is on (so a missing store entitlement is a plan choice, not a lapse). */
  hosting: boolean;
  retry(): void;
};

function statusOf(t: TierAccess): StoreAccess['status'] {
  return t.status === 'ready' ? (t.entitled ? 'active' : 'inactive') : t.status;
}

export function useStoreAccess(): StoreAccess {
  const t = useTierAccess('store');
  return { status: statusOf(t), expired: t.expired, hosting: t.hosting, retry: t.retry };
}

/** Presents the `store_upgrade` paywall. */
export function useOpenStoreUpgrade(): { open(): void; busy: boolean } {
  const { run, busy } = useUpgrade('store_upgrade');
  return { open: () => void run(), busy };
}
