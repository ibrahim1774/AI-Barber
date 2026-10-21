// Single injection point for the side effects the booking API needs from S2
// (payments + notifications). Flows take these through their deps object, so tests inject
// fakes and nothing else imports the stubs.
//
// MERGE NOTE: when S2's lib/bookings/payments.ts and notify.ts land, change the two imports
// below to './payments.js' and './notify.js' and delete the *.stub.ts files.
import { createCardCheckout, refundAppointment } from './payments.stub.js';
import { notify, type NotifyEvent } from './notify.stub.js';
import type { AppointmentRow, ShopRow } from './repo.js';

export type { NotifyEvent };

export interface Payments {
  createCardCheckout(shop: ShopRow, appt: AppointmentRow, amountCents: number): Promise<{ url: string; sessionId: string }>;
  refundAppointment(shop: ShopRow, appt: AppointmentRow, amountCents: number): Promise<{ refundedCents: number }>;
}

export type Notify = (event: NotifyEvent) => Promise<void>;

export const livePayments: Payments = { createCardCheckout, refundAppointment };
export const liveNotify: Notify = notify;
