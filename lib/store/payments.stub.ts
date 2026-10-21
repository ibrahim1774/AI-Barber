// STUB until S3b's lib/store/payments.ts lands. Same signatures as the contract; every call
// throws 'not-built'. At merge the controller points lib/store/deps.ts at ./payments.js
// (and refundKey.order) and deletes this file.
import type { PayShop, StripeOpts } from '../bookings/payments.js';

export type { PayShop, StripeOpts };

export interface PayOrder {
  id: string;
  shop_id: string;
  order_no: number;
  manage_token: string;
  customer_email: string;
  fulfilment: 'pickup' | 'shipping';
  shipping_cents: number;
  total_cents: number;
  stripe_payment_intent_id: string | null;
  amount_paid_cents: number;
  amount_refunded_cents: number;
}

export interface PayOrderItem {
  name: string;
  unit_price_cents: number;
  quantity: number;
  photo_url?: string | null;
}

export async function createOrderCheckout(
  _shop: PayShop,
  _order: PayOrder,
  _items: PayOrderItem[],
  _opts?: StripeOpts,
): Promise<{ url: string; sessionId: string }> {
  throw new Error('not-built');
}

export async function refundOrder(
  _shop: PayShop,
  _order: PayOrder,
  _amountCents: number,
  _opts: { idempotencyKey: string } & StripeOpts,
): Promise<{ refundedCents: number }> {
  throw new Error('not-built');
}

/** Becomes refundKey.order (lib/bookings/payments.ts) at merge. */
export const refundKeyOrder = (orderId: string, targetTotalCents: number) => `refund-order-${orderId}-${targetTotalCents}`;
