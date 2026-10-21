// Placeholder for S2's lib/bookings/notify.ts (push + email), so the booking API compiles on
// its own branch. Logs and returns; like the real notify() it never throws.
// Swap the import in ./deps.ts to './notify.js' once S2's branch is merged.
import type { AppointmentRow, ShopRow } from './repo.js';

export type NotifyEvent =
  | { kind: 'booking_created'; shop: ShopRow; appt: AppointmentRow; memberName: string }
  | { kind: 'booking_cancelled'; by: 'customer' | 'shop'; shop: ShopRow; appt: AppointmentRow; memberName: string; refundedCents: number }
  | { kind: 'booking_rescheduled'; shop: ShopRow; appt: AppointmentRow; memberName: string; previousStart: string; by: 'customer' | 'shop' }
  | { kind: 'customer_says_paid'; shop: ShopRow; appt: AppointmentRow; method: 'cashapp' | 'venmo' | 'zelle' | 'paypal'; amountCents: number };

export async function notify(event: NotifyEvent): Promise<void> {
  console.log('[bookings/notify stub]', event.kind, event.appt.id);
}
