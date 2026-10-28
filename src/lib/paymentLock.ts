import { useEffect, useRef } from 'react';
import { useSession } from '@/lib/auth';
import { useAccountPlan, useSuperwallEntitlements } from '@/lib/entitlements';
import { getPlan, getPlanEpoch, setSharedPlan, type Plan } from '@/lib/plan';
import { useSubscriptionStatus, type SubscriptionStatus } from '@/lib/subscriptionStatus';

/**
 * Whether the account's OWN subscription failed to renew.
 * - 'none': nothing to say (active, loading, offline, a server error, signed out, never purchased, another account's
 *   purchase, a draft that was never published). This is the default for every uncertain answer.
 * - 'retry': Apple's billing grace / billing retry. The server still counts the purchase as active (it only takes the
 *   site down once Apple says the retry is over), but its expiry date has passed: the payment failed and Apple is
 *   still trying. Non-blocking banner.
 * - 'failed': the subscription ended without renewing (the server took the site down, or its expiry passed and it is no
 *   longer active, or this site's subscription was confirmed ended). Blocks editing and the tabs.
 * - 'revoked': refunded or revoked by Apple. Blocks the same way, with its own wording.
 */
export type PaymentLock = 'none' | 'retry' | 'failed' | 'revoked';

/** The server takes a site down about an hour after the subscription ends; the same slack avoids flagging a late renewal notice. */
export const RETRY_AFTER_MS = 60 * 60 * 1000;

export const PAYMENT_FAILED_TITLE = 'Payment failed';
export const PAYMENT_FAILED_BODY = 'Please renew your payment to keep editing your site. Your subscription could not be renewed.';
export const PAYMENT_REVOKED_TITLE = 'Subscription ended';
export const PAYMENT_REVOKED_BODY = 'Your subscription was refunded or cancelled by Apple. Renew it to keep editing your site.';
export const PAYMENT_BANNER = 'Payment failed. Update your payment method to keep your site.';
export const UPDATE_PAYMENT_BUTTON = 'Update payment method';
export const CHECK_AGAIN_BUTTON = "I've renewed: check again";

const ms = (iso: string | null) => {
  const t = Date.parse(iso ?? '');
  return Number.isNaN(t) ? null : t;
};

/**
 * Pure. `plan` is the server's plan for the signed-in account (null when not loaded / not this account's); `status`
 * is the per-site check against /api/ios/site. Only a published site can be locked (a never-published draft has the
 * publish flows instead). Anything but a clear sign that THIS account's own subscription ended is 'none'.
 */
export function paymentLockOf(
  plan: Plan | null,
  site: { deployedUrl?: string | null } | null | undefined,
  status: SubscriptionStatus,
  now: number = Date.now(),
  /** This iPhone's Superwall says the plan is paid right now (a renewal the cached server plan has not seen yet). */
  deviceActive = false,
): PaymentLock {
  if (!site?.deployedUrl) return 'none';
  if (plan && plan.purchaseAccount === 'self') {
    const exp = ms(plan.expiresAt);
    // The device just saw a paid plan: never block on an older server answer (it is re-read; the server gates stay).
    if (plan.revoked) return deviceActive ? 'none' : 'revoked';
    if (!plan.active && !plan.entitlements.hosting && (plan.takenDownAt != null || (exp != null && exp <= now))) {
      return deviceActive ? 'none' : 'failed';
    }
    if (plan.active && plan.takenDownAt == null && exp != null && now - exp > RETRY_AFTER_MS) return 'retry';
    if (plan.active) return 'none'; // the server says paid: a stale per-site 'lapsed' does not outrank it
  }
  // Another account's purchase (the Move card), no purchase, or no plan yet: only the per-site confirmation counts.
  if (status === 'lapsed' && plan?.purchaseAccount !== 'other' && !deviceActive) return 'failed';
  return 'none';
}

/** The lock for the local site, from the shared plan and the per-site status. Re-reads the plan once to confirm a 'retry'. */
export function usePaymentLock(site: { deployedUrl?: string | null } | null | undefined): PaymentLock {
  const plan = useAccountPlan();
  const status = useSubscriptionStatus();
  const sw = useSuperwallEntitlements();
  const deviceActive = sw.known && sw.hosting;
  const lock = paymentLockOf(plan, site, status, Date.now(), deviceActive);
  const confirmed = useRef(false);
  const { session } = useSession();
  const uid = session?.user?.id ?? null;
  useEffect(() => {
    // A cached plan can be old (the app stayed open across a renewal): look once before showing the banner on it.
    const staleFailure = deviceActive && !!site?.deployedUrl && !!plan && !plan.active && plan.purchaseAccount === 'self';
    if (!(lock === 'retry' || staleFailure) || confirmed.current || !uid) return;
    confirmed.current = true;
    const epoch = getPlanEpoch();
    getPlan().then((p) => epoch === getPlanEpoch() && setSharedPlan(p)).catch(() => {});
  }, [lock, uid, deviceActive, plan, site?.deployedUrl]);
  return lock;
}

export const isBlocking = (lock: PaymentLock): boolean => lock === 'failed' || lock === 'revoked';
