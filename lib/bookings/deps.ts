// Single injection point for what the booking API needs from S2 (payments, notifications,
// calendar text). Flows take payments/notify through their deps object, so tests inject
// fakes and nothing else imports the stubs.
//
// MERGE NOTE: when S2's branch lands, change the three imports below to './payments.js',
// './notify.js' and './ics.js' and delete the *.stub.ts files. The stubs export the same
// names and shapes as S2's files.
import { createCardCheckout, expireCheckoutSession, refundAppointment, refundKey } from './payments.stub.js';
import { notify, type NotifyEvent } from './notify.stub.js';
import { appointmentsToIcs, type FeedAppointment } from './ics.stub.js';
import type { AppointmentRow, ShopRow } from './repo.js';

export type { NotifyEvent, FeedAppointment };
export { appointmentsToIcs, refundKey };

export interface Payments {
  createCardCheckout(shop: ShopRow, appt: AppointmentRow, amountCents: number): Promise<{ url: string; sessionId: string }>;
  /** opts.idempotencyKey: a reason-scoped key from refundKey (the cancel path uses refundKey.cancel(id)). */
  refundAppointment(shop: ShopRow, appt: AppointmentRow, amountCents: number, opts?: { idempotencyKey?: string }): Promise<{ refundedCents: number }>;
  /** Never throws. */
  expireCheckoutSession(shop: ShopRow, sessionId: string): Promise<boolean>;
}

export type Notify = (event: NotifyEvent) => Promise<void>;

export const livePayments: Payments = { createCardCheckout, refundAppointment, expireCheckoutSession };
export const liveNotify: Notify = notify;
