// Placeholder for S2's lib/bookings/notify.ts (push + email), so the booking API compiles on
// its own branch. Same NotifyEvent shape as S2's file (id-based: notify loads the rest).
// Logs and returns; like the real notify() it never throws.
// Swap the import in ./deps.ts to './notify.js' once S2's branch is merged.

export type ManualMethod = 'cashapp' | 'venmo' | 'zelle' | 'paypal';

export type NotifyEvent =
  | { kind: 'booking_created'; appointmentId: string }
  | { kind: 'booking_cancelled'; appointmentId: string; by: 'customer' | 'shop'; refundedCents?: number }
  | { kind: 'booking_rescheduled'; appointmentId: string; by?: 'customer' | 'shop' }
  | { kind: 'customer_says_paid'; appointmentId: string; method: ManualMethod; amountCents?: number }
  | { kind: 'reminder'; appointmentId: string };

export async function notify(event: NotifyEvent): Promise<void> {
  console.log('[bookings/notify stub]', event.kind, event.appointmentId);
}
