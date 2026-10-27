// Row and event types for the store (Phase 3). Column names are the database's (005 + 009).
import type { ManualMethod, PaymentStatus, ShopRow } from '../bookings/repo.js';

export type { ManualMethod, PaymentStatus };

/** The ab_shops columns the store reads: the booking ShopRow plus the store columns (005, 009). */
export interface ShopStoreRow extends ShopRow {
  store_enabled: boolean;
  store_pickup: boolean;
  store_pickup_note: string | null;
  store_shipping: boolean;
  shipping_flat_cents: number | null;
  ships_within_days: number | null;
}

export interface ProductRow {
  id: string;
  shop_id: string;
  name: string;
  price_cents: number;
  description: string | null;
  /** In stored order; the first is the cover. */
  photos: string[];
  sold_out: boolean;
  active: boolean;
  sort: number;
  created_at?: string;
  updated_at?: string;
}

export type OrderStatus = 'new' | 'paid' | 'ready' | 'shipped' | 'done' | 'cancelled';
export type Fulfilment = 'pickup' | 'shipping';
export type OrderPaymentMethod = 'shop' | ManualMethod | 'card';

/** { name, line1, line2, city, state, postal_code, country } once known; {} for a card hold on shipping. */
export type ShippingAddress = Record<string, unknown>;

/** Every ab_orders column (005 + 009). */
export interface OrderRow {
  id: string;
  shop_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  note: string | null;
  fulfilment: Fulfilment;
  shipping_address: ShippingAddress | null;
  shipping_cents: number;
  subtotal_cents: number;
  total_cents: number;
  currency: string;
  status: OrderStatus;
  tracking_number: string | null;
  tracking_url: string | null;
  payment_status: PaymentStatus;
  payment_method: OrderPaymentMethod | null;
  amount_paid_cents: number;
  amount_refunded_cents: number;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  manage_token: string;
  created_at: string;
  updated_at: string;
  // 009
  order_no: number;
  client_key: string | null;
  customer_says_paid_at: string | null;
  paid_at: string | null;
  ready_at: string | null;
  shipped_at: string | null;
  done_at: string | null;
  cancelled_at: string | null;
  cancelled_by: 'customer' | 'shop' | null;
  refund_due_cents: number;
  refund_requested_at: string | null;
  refund_stuck_at: string | null;
  /** Generated: refund_due_cents > amount_refunded_cents and refund_stuck_at is null. */
  refund_pending: boolean;
  checkout_url: string | null;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string | null;
  name: string;
  unit_price_cents: number;
  quantity: number;
  created_at?: string;
}

export type StoreNotifyEvent =
  | { kind: 'order_created'; orderId: string }   // card + awaiting: no-op (webhook sends it on payment)
  | { kind: 'order_ready'; orderId: string }
  | { kind: 'order_shipped'; orderId: string }
  | { kind: 'order_cancelled'; orderId: string; refundedCents?: number; /** The business closed its account (delete-account). */ closed?: boolean; /** Cents the business still owes the customer and could not refund (closure): the email says to contact the shop. */ owedCents?: number }
  | { kind: 'order_says_paid'; orderId: string; method: 'cashapp' | 'venmo' | 'zelle' | 'paypal' };
