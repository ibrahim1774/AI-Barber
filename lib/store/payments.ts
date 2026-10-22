import { platformFeeCents } from '../bookings/money.js';
import {
  stripeRequest, expireCheckoutSession, StripeApiError, CHECKOUT_HOLD_SEC, MIN_CHARGE_CENTS, SITE_ORIGIN,
  type PayShop, type StripeOpts,
} from '../bookings/payments.js';
import { STORE_APP } from './constants.js';

/**
 * Stripe for store orders: Checkout and refunds on the shop's connected account (Standard,
 * direct charges), raw fetch through the Phase 2 stripeRequest. The platform fee is
 * platformFeeCents(total incl. shipping, shop.platform_fee_bps).
 */

export { STORE_APP };

/** The shipping promise, shared by the Checkout shipping option and the confirmation email.
 *  0 or 1 → "Ships within 1 day", 2+ → "Ships within N days", unset → "Shipping". */
export function shipsWithinLabel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'Shipping';
  const days = Math.max(1, Math.floor(n));
  return days === 1 ? 'Ships within 1 day' : `Ships within ${days} days`;
}

/** "#1001", or the id's first 8 characters if the order has no number. */
export const orderNoLabel = (o: { id: string; order_no: number | null }) => `#${o.order_no ?? o.id.slice(0, 8)}`;

/** The order status page (the Checkout return URLs hang off it). */
export const orderManageUrl = (token: string) => `${SITE_ORIGIN}/shop/manage/${encodeURIComponent(token)}`;

// ---------------------------------------------------------------------------
// Types (structural subsets of the ab_orders / ab_order_items rows)
// ---------------------------------------------------------------------------

export interface PayOrder {
  id: string;
  shop_id: string;
  order_no: number | null;
  manage_token: string;
  customer_email: string | null;
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
  /** The product's cover photo; sent to Stripe only when it is https. */
  photo_url?: string | null;
}

/** The shop fields Checkout reads. ships_within_days only shapes the shipping option's label. */
export type PayStoreShop = PayShop & { ships_within_days?: number | null };

/** As stored in ab_orders.shipping_address. */
export interface OrderAddress {
  name: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

const isHttps = (u: unknown): u is string => typeof u === 'string' && u.length <= 2048 && /^https:\/\/\S+$/i.test(u);

/**
 * Hosted Checkout for a card order, on the connected account. Card only (Apple Pay rides on it).
 * Throws before calling Stripe when the shop has no connected account or the total is under the
 * 50¢ minimum. The Idempotency-Key is per order + total + minute (expires_at is anchored to the
 * same minute), so a network retry in that minute returns the same session.
 * After the call, a session whose amount_total differs from order.total_cents is expired and the
 * call throws: a total mismatch is a bug, never a charge.
 */
export async function createOrderCheckout(
  shop: PayStoreShop,
  order: PayOrder,
  items: PayOrderItem[],
  opts: StripeOpts = {},
): Promise<{ url: string; sessionId: string }> {
  if (!shop.stripe_account_id) throw new StripeApiError('shop has no connected Stripe account', 400, 'no-account');
  const total = Math.floor(Number(order.total_cents));
  if (!Number.isFinite(total) || total < MIN_CHARGE_CENTS) {
    throw new StripeApiError(`amount ${order.total_cents} is below the ${MIN_CHARGE_CENTS}¢ minimum`, 400, 'amount-too-small');
  }
  if (!items.length) throw new StripeApiError('order has no items', 400, 'no-items');

  const currency = (shop.currency || 'usd').toLowerCase();
  const fee = platformFeeCents(total, shop.platform_fee_bps);
  const now = (opts.now ?? Date.now)();
  const minuteSec = Math.floor(now / 60_000) * 60;
  const meta = { order_id: order.id, shop_id: shop.id, app: STORE_APP };
  const link = orderManageUrl(order.manage_token);

  const params: Record<string, string | number | undefined> = {
    mode: 'payment',
    success_url: `${link}?checkout=success`,
    cancel_url: `${link}?checkout=cancelled`,
    expires_at: minuteSec + CHECKOUT_HOLD_SEC,
    'payment_method_types[0]': 'card',
    client_reference_id: order.id,
    customer_email: order.customer_email || undefined,
    'payment_intent_data[application_fee_amount]': fee > 0 ? fee : undefined,
    'payment_intent_data[description]': `Order ${orderNoLabel(order)}${shop.name ? ` at ${shop.name}` : ''}`.slice(0, 250),
  };
  items.forEach((it, i) => {
    const li = `line_items[${i}]`;
    params[`${li}[price_data][currency]`] = currency;
    params[`${li}[price_data][unit_amount]`] = Math.floor(it.unit_price_cents);
    params[`${li}[price_data][product_data][name]`] = String(it.name).slice(0, 250);
    if (isHttps(it.photo_url)) params[`${li}[price_data][product_data][images][0]`] = it.photo_url;
    params[`${li}[quantity]`] = Math.floor(it.quantity);
  });
  if (order.fulfilment === 'shipping') {
    const rate = 'shipping_options[0][shipping_rate_data]';
    const days = shop.ships_within_days;
    params['shipping_address_collection[allowed_countries][0]'] = 'US';
    params[`${rate}[type]`] = 'fixed_amount';
    params[`${rate}[fixed_amount][amount]`] = Math.max(0, Math.floor(order.shipping_cents || 0));
    params[`${rate}[fixed_amount][currency]`] = currency;
    params[`${rate}[display_name]`] = shipsWithinLabel(days);
    if (days != null) {
      params[`${rate}[delivery_estimate][maximum][unit]`] = 'business_day';
      params[`${rate}[delivery_estimate][maximum][value]`] = days + 5;
    }
  }
  for (const [k, v] of Object.entries(meta)) {
    params[`metadata[${k}]`] = v;
    params[`payment_intent_data[metadata][${k}]`] = v;
  }

  const session = await stripeRequest('POST', '/checkout/sessions', params, {
    account: shop.stripe_account_id,
    idempotencyKey: `ab-order-checkout-${order.id}-${total}-${minuteSec}`,
    fetch: opts.fetch,
  });
  if (!session?.url || !session?.id) throw new StripeApiError('Checkout Session has no url', 502);
  if (Number(session.amount_total) !== total) {
    console.error('[store/payments] Checkout total mismatch, expiring the session:',
      JSON.stringify({ order: order.id, session: session.id, expected: total, got: session.amount_total ?? null }));
    await expireCheckoutSession(shop, session.id, { fetch: opts.fetch });
    throw new StripeApiError(`Checkout total ${session.amount_total} differs from the order total ${total}`, 502, 'amount-mismatch');
  }
  return { url: session.url, sessionId: session.id };
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

/**
 * Refund (part of) an order's card payment, refunding AI Barber's fee proportionally
 * (refund_application_fee=true). Clamped to amount_paid - amount_refunded on the row given.
 * Returns 0 without calling Stripe when there is nothing to refund. The idempotency key is
 * required: use refundKey.order / .pac / .duplicate.
 */
export async function refundOrder(
  shop: PayShop,
  order: PayOrder,
  amountCents: number,
  opts: { idempotencyKey: string } & StripeOpts,
): Promise<{ refundedCents: number }> {
  if (!opts?.idempotencyKey) throw new StripeApiError('refundOrder needs an idempotency key', 500, 'no-idempotency-key');
  const paid = Math.max(0, Math.floor(order.amount_paid_cents ?? 0));
  const already = Math.max(0, Math.floor(order.amount_refunded_cents ?? 0));
  const amount = Math.min(Math.floor(Number(amountCents) || 0), paid - already);
  if (amount <= 0 || !order.stripe_payment_intent_id) return { refundedCents: 0 };
  if (!shop.stripe_account_id) throw new StripeApiError('shop has no connected Stripe account', 400, 'no-account');

  const refund = await stripeRequest('POST', '/refunds', {
    payment_intent: order.stripe_payment_intent_id,
    amount,
    refund_application_fee: true,
    'metadata[order_id]': order.id,
    'metadata[app]': STORE_APP,
  }, { account: shop.stripe_account_id, idempotencyKey: opts.idempotencyKey, fetch: opts.fetch });
  if (refund?.status === 'failed' || refund?.status === 'canceled') {
    throw new StripeApiError(`refund ${refund?.id} ${refund?.status}`, 502, 'refund-failed');
  }
  return { refundedCents: Number(refund?.amount) || amount };
}

// ---------------------------------------------------------------------------
// Shipping address from a completed session
// ---------------------------------------------------------------------------

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/**
 * The address Stripe collected. Raw fetch sends no Stripe-Version, so the shape depends on the
 * account's API version: collected_information.shipping_details (newer), then shipping_details
 * (older), then customer_details. Null when none holds an address.
 */
export function orderShippingFromSession(session: any): OrderAddress | null {
  const candidates = [session?.collected_information?.shipping_details, session?.shipping_details, session?.customer_details];
  const src = candidates.find((c) => c && typeof c.address === 'object' && c.address);
  if (!src) return null;
  const a = src.address;
  return {
    name: str(src.name),
    line1: str(a.line1),
    line2: str(a.line2),
    city: str(a.city),
    state: str(a.state),
    postal_code: str(a.postal_code),
    country: str(a.country),
  };
}
