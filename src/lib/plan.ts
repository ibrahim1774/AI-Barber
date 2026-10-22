import { call } from '@/lib/setup/ownerApi';

export type Tier = 'website' | 'bookings' | 'store';

/** GET/POST /api/shop/plan: the server's view of the owner's plan. */
export type Plan = {
  linked: boolean;
  tier: Tier | null;
  entitlements: { hosting: boolean; bookings: boolean; store: boolean };
  active: boolean;
  expiresAt: string | null;
  takenDownAt: string | null;
  revoked: boolean;
};

export const getPlan = (): Promise<Plan> => call<Plan>('GET', '/api/shop/plan');

/** Right after an upgrade purchase: the server verifies it with Apple and returns the plan. */
export const refreshPlan = (transactionId: string | null): Promise<Plan> =>
  call<Plan>('POST', '/api/shop/plan', { transactionId });

/**
 * Asks the server to re-read the plan for this transaction, which also relinks a shop stuck on an older,
 * lapsed purchase (the server only relinks to an active one). Quiet: never throws, never awaited by callers.
 */
export async function refreshPlanQuietly(transactionId: string | null | undefined): Promise<void> {
  if (!transactionId) return;
  try {
    setSharedPlan(await refreshPlan(transactionId));
  } catch {
    // the next load tries again
  }
}

export function planLabel(tier: Tier | null | undefined): string {
  switch (tier) {
    case 'website':
      return 'Website';
    case 'bookings':
      return 'Bookings';
    case 'store':
      return 'Store';
    default:
      return 'None';
  }
}

export const READ_ONLY_DAYS = 30;

/**
 * Bookings and Store stay readable for 30 days after the subscription ended
 * (then they show the upgrade card). True while hosting is inactive and the
 * lapse is under 30 days old; a lapse with no date is treated as recent.
 */
export function hostingReadOnlyOpen(plan: Pick<Plan, 'entitlements' | 'expiresAt'> | null, now: number = Date.now()): boolean {
  if (!plan) return true;
  if (plan.entitlements.hosting) return false;
  if (!plan.expiresAt) return true;
  const ended = Date.parse(plan.expiresAt);
  if (Number.isNaN(ended)) return true;
  return now - ended < READ_ONLY_DAYS * 24 * 60 * 60 * 1000;
}

// The last plan the server reported, shared so a refresh after an upgrade reaches the tabs without Retry.
let shared: Plan | null = null;
const planListeners = new Set<() => void>();
export const getSharedPlan = (): Plan | null => shared;
export function setSharedPlan(p: Plan | null): void {
  if (shared === p) return;
  shared = p;
  planListeners.forEach((l) => l());
}
export function subscribePlan(l: () => void): () => void {
  planListeners.add(l);
  return () => {
    planListeners.delete(l);
  };
}
