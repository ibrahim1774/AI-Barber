// Single injection point for what the store API needs from payments and notifications. Flows
// take payments/notify through their deps object, so tests inject fakes.
//
// MERGE (controller): import createOrderCheckout / refundOrder from './payments.js' and
// notifyOrder from './notify.js', set orderRefundKey = refundKey.order, delete the *.stub.ts.
import { expireCheckoutSession } from '../bookings/payments.js';
import { createOrderCheckout, refundOrder, refundKeyOrder, type PayOrder, type PayOrderItem, type PayShop } from './payments.stub.js';
import { notifyOrder } from './notify.stub.js';
import { closeCheckoutSession, type CheckoutCloseResult } from './checkout.js';
import type { StoreNotifyEvent } from './types.js';

export type { PayOrder, PayOrderItem, PayShop, CheckoutCloseResult };

export interface StorePayments {
  /** Stripe Checkout on the connected account; throws when it can't be created. */
  createOrderCheckout(shop: PayShop, order: PayOrder, items: PayOrderItem[]): Promise<{ url: string; sessionId: string }>;
  /** Refund `amountCents` (clamped to what is refundable) under the given idempotency key. */
  refundOrder(shop: PayShop, order: PayOrder, amountCents: number, opts: { idempotencyKey: string }): Promise<{ refundedCents: number }>;
  /** Never throws. */
  expireCheckoutSession(shop: PayShop, sessionId: string): Promise<boolean>;
  /** Expire, else read the session's status: 'expired' | 'complete' | 'unknown'. Never throws (lib/store/checkout.ts). */
  closeCheckoutSession(shop: PayShop, sessionId: string): Promise<CheckoutCloseResult>;
}

/** Never throws (the flows still wrap it). */
export type NotifyOrder = (event: StoreNotifyEvent) => Promise<void>;

/** refundKey.order(orderId, targetTotalCents): every owner refund attempt and its retries. */
export const orderRefundKey: (orderId: string, targetTotalCents: number) => string = refundKeyOrder;

export const liveStorePayments: StorePayments = {
  createOrderCheckout: (shop, order, items) => createOrderCheckout(shop, order, items),
  refundOrder: (shop, order, amountCents, opts) => refundOrder(shop, order, amountCents, opts),
  expireCheckoutSession: (shop, sessionId) => expireCheckoutSession(shop, sessionId),
  closeCheckoutSession: (shop, sessionId) => closeCheckoutSession(shop, sessionId),
};

export const liveNotifyOrder: NotifyOrder = (event) => notifyOrder(event);
