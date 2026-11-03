// New PrimeHub subscription checkouts (web-app plans, the old site's plans, custom domains) use their own
// payment method configuration (env STRIPE_NEW_CHECKOUT_PMC; in live: "New signups (no Cash App Pay)",
// a copy of the account Default with Cash App Pay off). The account Default configuration and invoice
// settings are untouched, so existing subscriptions that pay with Cash App Pay keep renewing exactly as before.
// `payment_method_configuration` exists on our pinned API version (2024-06-20); `excluded_payment_method_types`
// does not (added 2025-09-30), so it is deliberately not used. Unset env = Stripe's default (no change).
// Barber booking/store checkouts are card-only already (lib/bookings/payments.ts).
export function newCheckoutMethodParams(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const pmc = (env.STRIPE_NEW_CHECKOUT_PMC || '').trim();
  return /^pmc_[A-Za-z0-9]+$/.test(pmc) ? { payment_method_configuration: pmc } : {};
}
