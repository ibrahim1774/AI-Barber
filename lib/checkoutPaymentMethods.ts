// New PrimeHub subscription checkouts (web-app plans, the old site's plans, custom domains) leave out
// Cash App Pay. This is a per-session exclusion on purpose: the account's payment method settings and
// invoice settings are untouched, so existing subscriptions that pay with Cash App Pay keep renewing
// exactly as before. Barber booking/store checkouts are card-only already (lib/bookings/payments.ts).
export const EXCLUDED_NEW_CHECKOUT_METHODS = ['cashapp'] as const;

/** Form params that exclude the methods above from a Checkout Session. */
export function excludedMethodParams(): Record<string, string> {
  return Object.fromEntries(EXCLUDED_NEW_CHECKOUT_METHODS.map((m, i) => [`excluded_payment_method_types[${i}]`, m]));
}
