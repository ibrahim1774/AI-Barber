// Single injection point for what the store API needs from payments and notifications. Flows
// take payments/notify through their deps object, so tests inject fakes.
//
// createOrderCheckout / refundOrder are S3b's lib/store/payments.ts; notifyOrder is
// lib/store/notify.ts; the refund key is refundKey.order (lib/bookings/payments.ts).
import { expireCheckoutSession, refundKey, stripeRefundedTotal, type PayShop } from '../bookings/payments.js';
import { createOrderCheckout, refundOrder, type PayOrder, type PayOrderItem, type PayStoreShop } from './payments.js';
import { notifyOrder } from './notify.js';
import { closeCheckoutSession, type CheckoutCloseResult } from './checkout.js';
import type { StoreNotifyEvent } from './types.js';

export type { PayOrder, PayOrderItem, PayShop, PayStoreShop, CheckoutCloseResult };

export interface StorePayments {
  /** Stripe Checkout on the connected account; throws when it can't be created. Pass the full
   *  shop row: ships_within_days sets the shipping label and delivery estimate. */
  createOrderCheckout(shop: PayStoreShop, order: PayOrder, items: PayOrderItem[]): Promise<{ url: string; sessionId: string }>;
  /** Refund `amountCents` (clamped to what is refundable) under the given idempotency key. */
  refundOrder(shop: PayShop, order: PayOrder, amountCents: number, opts: { idempotencyKey: string }): Promise<{ refundedCents: number }>;
  /** Cents Stripe already refunded on this payment intent (refunds list). Asked before a retry under a new key suffix. Optional for older fakes. */
  refundedOnStripe?(shop: PayShop, paymentIntentId: string): Promise<number>;
  /** Never throws. */
  expireCheckoutSession(shop: PayShop, sessionId: string): Promise<boolean>;
  /** Expire, else read the session's status: 'expired' | 'complete' | 'unknown'. Never throws (lib/store/checkout.ts). */
  closeCheckoutSession(shop: PayShop, sessionId: string): Promise<CheckoutCloseResult>;
}

/** Never throws (the flows still wrap it). */
export type NotifyOrder = (event: StoreNotifyEvent) => Promise<void>;

/** refundKey.order(orderId, target, amount, refunded): one owner refund attempt; its retries send the same key. */
export const orderRefundKey = (orderId: string, targetTotalCents: number, amountCents: number, refundedCents: number): string =>
  refundKey.order(orderId, targetTotalCents, amountCents, refundedCents);

export const liveStorePayments: StorePayments = {
  refundedOnStripe: (shop, pi) => stripeRefundedTotal(shop, pi),
  createOrderCheckout: (shop, order, items) => createOrderCheckout(shop, order, items),
  refundOrder: (shop, order, amountCents, opts) => refundOrder(shop, order, amountCents, opts),
  expireCheckoutSession: (shop, sessionId) => expireCheckoutSession(shop, sessionId),
  closeCheckoutSession: (shop, sessionId) => closeCheckoutSession(shop, sessionId),
};

export const liveNotifyOrder: NotifyOrder = (event) => notifyOrder(event);
