// The Stripe API version every custom-domain call pins (Stripe-Version header), so response
// shapes never change under us with the account's default version. Parsers still accept the
// newer (basil, 2025-03-31+) shapes too.
export const STRIPE_API_VERSION = '2024-06-20';
