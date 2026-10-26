import { call, OwnerApiError } from '@/lib/setup/ownerApi';

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
  /**
   * Whose Apple purchase this is, from the server: 'self' (this account owns it), 'other' (another account on the same
   * Apple ID does), or null (no purchase of this account's own, or an old server). Bookings and Store unlock only for 'self'.
   */
  purchaseAccount: 'self' | 'other' | null;
  /** The server's masked email of the other account ("a***@gmail.com"), when it says one. */
  purchaseHint: string | null;
  /** What the deployed server supports: `memberProfile` is true once migration 015 is live (title / booking_url columns, POST /api/shop/members). */
  capabilities: { memberProfile: boolean };
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The server's answer as a Plan, or null when it isn't one (no body, a page that isn't JSON, no
 * `entitlements` object). Fields are coerced: only `true` counts as true, odd values become null.
 */
export function normalizePlan(raw: unknown): Plan | null {
  if (!isObject(raw) || !isObject(raw.entitlements)) return null;
  const e = raw.entitlements;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const takenDownAt = str(raw.takenDownAt);
  const revoked = raw.revoked === true;
  // Fail closed: a refunded / revoked purchase, or a site the server took down while the plan is not active,
  // grants nothing even if the entitlement flags still say true.
  const lapsed = revoked || (takenDownAt != null && raw.active !== true);
  return {
    linked: raw.linked === true,
    tier: raw.tier === 'website' || raw.tier === 'bookings' || raw.tier === 'store' ? raw.tier : null,
    entitlements: lapsed
      ? { hosting: false, bookings: false, store: false }
      : { hosting: e.hosting === true, bookings: e.bookings === true, store: e.store === true },
    active: raw.active === true,
    expiresAt: str(raw.expiresAt),
    takenDownAt,
    revoked,
    purchaseAccount: raw.purchaseAccount === 'self' || raw.purchaseAccount === 'other' ? raw.purchaseAccount : null,
    purchaseHint: str(raw.purchaseHint) ?? str(raw.ownerHint) ?? str(raw.hint),
    capabilities: { memberProfile: isObject(raw.capabilities) && raw.capabilities.memberProfile === true },
  };
}

/** A malformed answer is an error (retryable, "unknown"), never a plan the tabs could crash on. */
async function planCall(answer: Promise<unknown>): Promise<Plan> {
  const plan = normalizePlan(await answer);
  if (!plan) throw new OwnerApiError(200, 'bad-response', "Couldn't read your plan. Try again.");
  return plan;
}

/** A signed-in account with no shop yet: nothing is granted, and it is not an error. */
export const UNLINKED_PLAN: Plan = {
  linked: false, tier: null, entitlements: { hosting: false, bookings: false, store: false },
  active: false, expiresAt: null, takenDownAt: null, revoked: false, purchaseAccount: null, purchaseHint: null, capabilities: { memberProfile: false },
};

export async function getPlan(): Promise<Plan> {
  try {
    return await planCall(call<unknown>('GET', '/api/shop/plan'));
  } catch (e) {
    // Only the server's 404 no-shop: a network or 5xx failure stays an error (retry card).
    if (e instanceof OwnerApiError && e.status === 404 && e.code === 'no-shop') return { ...UNLINKED_PLAN };
    throw e;
  }
}

/** Right after an upgrade purchase: the server verifies it with Apple and returns the plan. */
export const refreshPlan = (transactionId: string | null): Promise<Plan> =>
  planCall(call<unknown>('POST', '/api/shop/plan', { transactionId }));

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

/**
 * After a transfer (moved or already yours): re-read the plan and publish it to the tabs. POST first (it verifies with
 * Apple); if that fails for any reason (an older server answers 404 no-shop to an account with no shop), GET, which
 * answers for a no-shop account too. Throws only when both fail.
 */
export async function refreshPlanAfterTransfer(transactionId: string | null | undefined): Promise<Plan> {
  let plan: Plan;
  try {
    if (!transactionId) throw new Error('no transaction');
    plan = await refreshPlan(transactionId);
  } catch {
    plan = await getPlan();
  }
  setSharedPlan(plan);
  return plan;
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
export function hostingReadOnlyOpen(plan: (Pick<Plan, 'entitlements' | 'expiresAt'> & { linked?: boolean }) | null, now: number = Date.now()): boolean {
  if (!plan) return true;
  if (plan.entitlements.hosting) return false;
  if (plan.linked === false && !plan.expiresAt) return false; // never subscribed: nothing to view read-only, show the upgrade card
  if (!plan.expiresAt) return true;
  const ended = Date.parse(plan.expiresAt);
  if (Number.isNaN(ended)) return true;
  return now - ended < READ_ONLY_DAYS * 24 * 60 * 60 * 1000;
}

// The last plan the server reported, shared so a refresh after an upgrade reaches the tabs without Retry.
let shared: Plan | null = null;
// Bumped when the account changes: a plan request started before that must not land afterwards (it is the old account's).
let planEpoch = 0;
export const getPlanEpoch = (): number => planEpoch;
/** Sign-out / account switch: forget the plan, and drop any plan still being fetched for the old account. */
export function resetSharedPlan(): void {
  planEpoch++;
  setSharedPlan(null);
}
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
