/** Checkout and refund metadata tag for store orders (metadata.app). The webhook routes on it, and
 *  live Checkout sessions carry it, so the value must never change. A leaf module: lib/bookings
 *  imports it without a static cycle through lib/store/payments.ts. */
export const STORE_APP = 'aibarber-store';
