// Placeholder for S2's lib/bookings/payments.ts (Stripe Connect), so the booking API compiles
// on its own branch. Same exported names and shapes as S2's file. It never fakes money
// movement: checkout and refund throw (a card booking fails closed and its hold is dropped;
// a refund failure is logged), expire reports false.
// Swap the import in ./deps.ts to './payments.js' once S2's branch is merged.

export interface PayShop {
  id: string;
  slug?: string | null;
  name?: string | null;
  currency?: string | null;
  stripe_account_id: string | null;
  platform_fee_bps: number;
}

export interface PayAppointment {
  id: string;
  shop_id?: string;
  service_name: string;
  price_cents: number | null;
  manage_token: string;
  customer_email?: string | null;
  start_at?: string;
  stripe_payment_intent_id?: string | null;
  amount_paid_cents?: number | null;
  amount_refunded_cents?: number | null;
}

export async function createCardCheckout(
  _shop: PayShop,
  _appt: PayAppointment,
  _amountCents: number,
): Promise<{ url: string; sessionId: string }> {
  throw new Error('payments not wired: lib/bookings/payments.ts is not merged yet');
}

export async function refundAppointment(
  _shop: PayShop,
  _appt: PayAppointment,
  _amountCents: number,
): Promise<{ refundedCents: number }> {
  throw new Error('payments not wired: lib/bookings/payments.ts is not merged yet');
}

/** Never throws; true when Stripe expired the session. */
export async function expireCheckoutSession(_shop: PayShop, _sessionId: string): Promise<boolean> {
  return false;
}
