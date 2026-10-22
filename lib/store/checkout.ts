// Closing an order's Checkout Session before its hold is cancelled (the hold sweep). The sweep
// must never cancel an order whose customer paid on time while the completed webhook is still
// on its way, so it asks Stripe first and cancels only a session that is (now) expired.
import { stripeRequest, type FetchLike, type PayShop } from '../bookings/payments.js';

/**
 * - 'expired':  the session can no longer be paid (expired now, or already); cancel the hold.
 * - 'complete': the customer paid; leave the order to the checkout.session.completed webhook.
 * - 'unknown':  Stripe could not be asked or the session is still open; leave it, retry next sweep.
 */
export type CheckoutCloseResult = 'expired' | 'complete' | 'unknown';

const statusOf = (s: any): CheckoutCloseResult =>
  s?.status === 'expired' ? 'expired' : s?.status === 'complete' ? 'complete' : 'unknown';

/** Expire the session; if Stripe refuses (already complete or expired), read its status. Never throws. */
export async function closeCheckoutSession(
  shop: PayShop,
  sessionId: string,
  opts: { fetch?: FetchLike } = {},
): Promise<CheckoutCloseResult> {
  if (!shop.stripe_account_id || !sessionId) return 'unknown';
  const path = `/checkout/sessions/${encodeURIComponent(sessionId)}`;
  try {
    return statusOf(await stripeRequest('POST', `${path}/expire`, {}, { account: shop.stripe_account_id, fetch: opts.fetch }));
  } catch (e: any) {
    try {
      return statusOf(await stripeRequest('GET', path, {}, { account: shop.stripe_account_id, fetch: opts.fetch }));
    } catch (e2: any) {
      console.error(`[store] checkout session ${sessionId}: expire failed (${e?.message || e}) and status read failed:`, e2?.message || e2);
      return 'unknown';
    }
  }
}
