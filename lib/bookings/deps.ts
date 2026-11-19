// Single injection point for what the booking API needs from payments, notifications and
// calendar text. Flows take payments/notify through their deps object, so tests inject fakes.
import { createCardCheckout, expireCheckoutSession, refreshChargesEnabled, refundAppointment, refundKey, stripeRefundedTotal } from './payments.js';
import { closeCheckoutSession } from '../store/checkout.js';
import { notify, type NotifyEvent } from './notify.js';
import { appointmentsToIcs, type FeedAppointment } from './ics.js';
import type { AppointmentRow, ShopRow } from './repo.js';

export type { NotifyEvent, FeedAppointment };
export { appointmentsToIcs, refundKey };

export interface Payments {
  createCardCheckout(shop: ShopRow, appt: AppointmentRow, amountCents: number): Promise<{ url: string; sessionId: string }>;
  /** opts.idempotencyKey: a reason-scoped key from refundKey (the cancel path uses refundKey.cancel(id)). */
  refundAppointment(shop: ShopRow, appt: AppointmentRow, amountCents: number, opts?: { idempotencyKey?: string }): Promise<{ refundedCents: number }>;
  /**
   * One read-only GET of the connected account; stores charges_enabled when it changed (like the account.updated webhook).
   * Resolves true/false for charges_enabled, null when Stripe does not say (unreachable, access revoked: nothing is changed). Optional for older fakes.
   */
  refreshChargesEnabled?(shop: ShopRow): Promise<boolean | null>;
  /** Never throws. */
  expireCheckoutSession(shop: ShopRow, sessionId: string): Promise<boolean>;
  /**
   * Expire, else read the session's status: 'expired' | 'complete' | 'unknown' (lib/store/checkout.ts).
   * Never throws. The card-hold sweep asks this before cancelling (e2e I7). Optional for older fakes.
   */
  closeCheckoutSession?(shop: ShopRow, sessionId: string): Promise<'expired' | 'complete' | 'unknown'>;
  /** Cents Stripe already refunded on this payment intent (refunds list). Asked before a retry under a new key suffix. Optional for older fakes. */
  refundedOnStripe?(shop: ShopRow, paymentIntentId: string): Promise<number>;
}

export type Notify = (event: NotifyEvent) => Promise<void>;

export const livePayments: Payments = {
  createCardCheckout, refundAppointment, expireCheckoutSession, closeCheckoutSession, refreshChargesEnabled,
  refundedOnStripe: (shop, pi) => stripeRefundedTotal(shop, pi),
};
export const liveNotify: Notify = (event) => notify(event);
