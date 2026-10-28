import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/lib/auth';
import { useAccountPlan, useSuperwallEntitlements } from '@/lib/entitlements';
import { getPlan, getPlanEpoch, setSharedPlan, type Plan } from '@/lib/plan';
import { useSubscriptionStatus, type SubscriptionStatus } from '@/lib/subscriptionStatus';

/**
 * Whether the account's OWN subscription failed to renew. There are no banners and no grace period in the app: every sign
 * of a failed payment blocks until the owner renews.
 * - 'none': nothing to say (active, loading, offline, a server error, signed out, never purchased, another account's
 *   purchase, a draft that was never published). This is the default for every uncertain answer.
 * - 'failed': the subscription expired, its renewal payment failed or it was cancelled, and the server has not taken the
 *   website down yet. Blocks editing and the tabs.
 * - 'offline': the server took the website down. Blocks the same way, new wording.
 * - 'revoked': refunded or revoked by Apple. Blocks the same way, with its own wording.
 */
export type PaymentLock = 'none' | 'failed' | 'offline' | 'revoked';
export type BlockKind = Exclude<PaymentLock, 'none'>;

/**
 * When the server still counts the purchase as active but its expiry is already past, a missed renewal notification could
 * look the same as a failed payment: wait this long (and re-read the plan once) before blocking on that inference.
 */
export const LATE_RENEWAL_SLACK_MS = 60 * 60 * 1000;

export const PAYMENT_FAILED_TITLE = 'Payment failed';
export const PAYMENT_FAILED_BODY = 'Please renew your payment to get access back. Your subscription could not be renewed.';
export const PAYMENT_OFFLINE_TITLE = 'Your website is offline';
export const PAYMENT_OFFLINE_BODY = 'Your payment failed or your subscription ended. Renew to put your website back online.';
export const PAYMENT_REVOKED_TITLE = 'Subscription ended';
export const PAYMENT_REVOKED_BODY = 'Your subscription was refunded or cancelled by Apple. Renew it to keep editing your site.';
export const UPDATE_PAYMENT_BUTTON = 'Update payment method';
export const CHECK_AGAIN_BUTTON = "I've renewed: check again";

/** Title and body of a block. */
export function paymentCopy(kind: BlockKind): { title: string; body: string } {
  if (kind === 'revoked') return { title: PAYMENT_REVOKED_TITLE, body: PAYMENT_REVOKED_BODY };
  if (kind === 'offline') return { title: PAYMENT_OFFLINE_TITLE, body: PAYMENT_OFFLINE_BODY };
  return { title: PAYMENT_FAILED_TITLE, body: PAYMENT_FAILED_BODY };
}

export const SETTINGS_OFFLINE_STATUS = 'Offline · Renew to get access back';

const ms = (iso: string | null) => {
  const t = Date.parse(iso ?? '');
  return Number.isNaN(t) ? null : t;
};

/** Failed until the server takes the website down, then offline. */
function phaseOf(plan: Plan): 'failed' | 'offline' {
  return plan.takenDownAt != null ? 'offline' : 'failed';
}

/**
 * True when the block would rest on an inference: the server still says active but the expiry passed. Such a lock only
 * shows after the plan was re-read once and still said so.
 */
export function isInferredLapse(plan: Plan | null, now: number = Date.now()): boolean {
  if (!plan || plan.purchaseAccount !== 'self' || plan.revoked || !plan.active || plan.takenDownAt != null) return false;
  const exp = ms(plan.expiresAt);
  return exp != null && now - exp > LATE_RENEWAL_SLACK_MS;
}

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
      return deviceActive ? 'none' : phaseOf(plan);
    }
    if (isInferredLapse(plan, now)) return deviceActive ? 'none' : phaseOf(plan);
    if (plan.active) return 'none'; // the server says paid: a stale per-site 'lapsed' does not outrank it
  }
  // Another account's purchase (the Move card), no purchase, or no plan yet: only the per-site confirmation counts.
  if (status === 'lapsed' && plan?.purchaseAccount !== 'other' && !deviceActive) return 'failed';
  return 'none';
}

/**
 * The lock for the local site, from the shared plan and the per-site status. A block that rests only on "active but past its
 * expiry" waits for one re-read of the plan (a missed renewal notice must not lock a paying user); if the re-read cannot be
 * made (offline) nothing is blocked.
 */
export function usePaymentLock(site: { deployedUrl?: string | null } | null | undefined): PaymentLock {
  const plan = useAccountPlan();
  const status = useSubscriptionStatus();
  const sw = useSuperwallEntitlements();
  const deviceActive = sw.known && sw.hosting;
  const now = Date.now();
  const lock = paymentLockOf(plan, site, status, now, deviceActive);
  const inferred = lock !== 'none' && isInferredLapse(plan, now);
  const [rereadFor, setRereadFor] = useState<string | null | undefined>(undefined);
  const attempted = useRef<string | null | undefined>(undefined);
  const { session } = useSession();
  const uid = session?.user?.id ?? null;
  const expiresAt = plan?.expiresAt ?? null;
  useEffect(() => {
    // A cached plan can be old (the app stayed open across a renewal): look once before blocking on it.
    const staleFailure = deviceActive && !!site?.deployedUrl && !!plan && !plan.active && plan.purchaseAccount === 'self';
    if (!(inferred || staleFailure) || attempted.current === expiresAt || !uid) return;
    attempted.current = expiresAt;
    const epoch = getPlanEpoch();
    getPlan()
      .then((p) => {
        if (epoch !== getPlanEpoch()) return;
        setSharedPlan(p);
        setRereadFor(p.expiresAt);
      })
      .catch(() => {
        attempted.current = undefined; // could not look: stay unblocked, try again on the next change
      });
  }, [inferred, uid, deviceActive, plan, expiresAt, site?.deployedUrl]);
  if (inferred && rereadFor !== expiresAt) return 'none';
  return lock;
}

export const isBlocking = (lock: PaymentLock): boolean => lock !== 'none';
