// Placeholder for S2's lib/bookings/payments.ts (Stripe Connect), so the booking API compiles
// on its own branch. It never fakes money movement: every call throws, so a card booking
// fails closed (the hold is dropped) and a refund failure is logged, never "succeeds".
// Swap the import in ./deps.ts to './payments.js' once S2's branch is merged.
import type { AppointmentRow, ShopRow } from './repo.js';

export async function createCardCheckout(
  _shop: ShopRow,
  _appt: AppointmentRow,
  _amountCents: number,
): Promise<{ url: string; sessionId: string }> {
  throw new Error('payments not wired: lib/bookings/payments.ts is not merged yet');
}

export async function refundAppointment(
  _shop: ShopRow,
  _appt: AppointmentRow,
  _amountCents: number,
): Promise<{ refundedCents: number }> {
  throw new Error('payments not wired: lib/bookings/payments.ts is not merged yet');
}
