// Web only: how the plan screen words the web-app billing server's answers (POST /api/web-app/checkout, GET /api/web-app/me).
// Pure, so every mapping is unit-tested. The phone app never imports this.
export const SUPPORT_EMAIL = 'support@davoxa.com';

export const PROCESSING_MESSAGE = 'Your payment is still processing. Give it a minute, then refresh.';
export const APP_STORE_ACTIVE_MESSAGE =
  'You already have an active subscription through the App Store. Manage it on your iPhone (Settings > Apple ID > Subscriptions); no need to pay again here.';
export const APP_STORE_LAPSED_MESSAGE = `This account is linked to an App Store purchase that has ended. Contact ${SUPPORT_EMAIL} to move to the web plan.`;
export const ACCOUNT_CHECK_MESSAGE = "Couldn't check your account right now. Try again in a moment.";
export const CHECKOUT_RETRY_MESSAGE = "We couldn't open checkout. Check your connection and try again.";
export const APP_STORE_PUBLISH_MESSAGE = `This account has an App Store subscription. Publish from the iPhone app, or contact ${SUPPORT_EMAIL}.`;

export type CheckoutFailure =
  | { kind: 'portal' }
  | { kind: 'processing'; message: string }
  | { kind: 'app-store'; message: string }
  | { kind: 'error'; message: string };

/** What to do with a checkout answer that is not a 200 with a url. */
export function checkoutFailure(status: number, code?: string): CheckoutFailure {
  if (status === 409) {
    if (code === 'already_subscribed') return { kind: 'portal' };
    if (code === 'payment_processing' || code === 'checkout_in_progress') return { kind: 'processing', message: PROCESSING_MESSAGE };
    if (code === 'ios_subscription_active') return { kind: 'app-store', message: APP_STORE_ACTIVE_MESSAGE };
    if (code === 'ios_linked_lapsed') return { kind: 'app-store', message: APP_STORE_LAPSED_MESSAGE };
    return { kind: 'error', message: CHECKOUT_RETRY_MESSAGE }; // an unknown 409 never opens the portal
  }
  if (status === 503) return { kind: 'error', message: ACCOUNT_CHECK_MESSAGE };
  return { kind: 'error', message: CHECKOUT_RETRY_MESSAGE };
}

/** The `appStore` field of /api/web-app/me -> the message that replaces the pay buttons, or null. */
export function appStoreNotice(appStore: unknown): string | null {
  if (appStore === 'active') return APP_STORE_ACTIVE_MESSAGE;
  if (appStore === 'linked') return APP_STORE_LAPSED_MESSAGE;
  return null;
}

/** Only a Stripe-hosted https page (Checkout or the billing portal) may be navigated to from a server answer. */
export function isStripeUrl(u: unknown): u is string {
  if (typeof u !== 'string') return false;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && (url.hostname === 'checkout.stripe.com' || url.hostname === 'billing.stripe.com');
  } catch { return false; }
}
