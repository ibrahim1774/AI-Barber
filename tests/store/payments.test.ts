import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createOrderCheckout, refundOrder, orderShippingFromSession, orderManageUrl, shipsWithinLabel,
  type PayOrder, type PayOrderItem,
} from '../../lib/store/payments.js';
import { CHECKOUT_HOLD_SEC, refundKey, StripeApiError } from '../../lib/bookings/payments.js';

const shop = { id: 'shop-1', slug: 'fade-factory', name: 'Fade Factory', currency: 'usd', stripe_account_id: 'acct_123', platform_fee_bps: 200, ships_within_days: null as number | null };
const order: PayOrder = {
  id: 'ord-1', shop_id: 'shop-1', order_no: 1001, manage_token: 'tok_order', customer_email: 'sam@example.com',
  fulfilment: 'pickup', shipping_cents: 0, total_cents: 4500,
  stripe_payment_intent_id: null, amount_paid_cents: 0, amount_refunded_cents: 0,
};
const items: PayOrderItem[] = [
  { name: 'Beard oil', unit_price_cents: 1500, quantity: 2, photo_url: 'https://cdn.example.com/oil.jpg' },
  { name: 'Comb', unit_price_cents: 1500, quantity: 1, photo_url: 'http://insecure.example.com/comb.jpg' },
];
const NOW = Date.UTC(2026, 9, 21, 12, 7, 42);
const MINUTE = Math.floor(NOW / 60_000) * 60;

type Call = { url: string; init: any; params: URLSearchParams };
function fakeFetch(...responses: Array<{ status?: number; body: any }>) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: string, init: any) => {
    calls.push({ url, init, params: new URLSearchParams(init.body ?? url.split('?')[1] ?? '') });
    const r = responses.shift() ?? { body: {} };
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body };
  });
  return { f, calls };
}
const session = (amount_total: number) => ({ body: { id: 'cs_o1', url: 'https://checkout.stripe.com/c/cs_o1', amount_total } });

const saved = { ...process.env };
beforeEach(() => {
  process.env.STRIPE_CONNECT_SECRET_KEY = 'sk_test_connect';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { process.env = { ...saved }; vi.restoreAllMocks(); });

describe('createOrderCheckout', () => {
  it('pickup order: line items, cover image only when https, no shipping, fee, metadata on session + PI, account, key, URLs', async () => {
    const { f, calls } = fakeFetch(session(4500));
    const r = await createOrderCheckout(shop, order, items, { fetch: f, now: () => NOW });
    expect(r).toEqual({ url: 'https://checkout.stripe.com/c/cs_o1', sessionId: 'cs_o1' });
    expect(calls).toHaveLength(1);
    const { url, init, params: p } = calls[0];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(init.method).toBe('POST');
    expect(init.headers['Stripe-Account']).toBe('acct_123');
    expect(init.headers.Authorization).toBe('Bearer sk_test_connect');
    expect(init.headers['Idempotency-Key']).toBe(`ab-order-checkout-ord-1-4500-${MINUTE}`);

    expect(p.get('mode')).toBe('payment');
    expect(p.get('expires_at')).toBe(String(MINUTE + CHECKOUT_HOLD_SEC));
    expect(p.get('payment_method_types[0]')).toBe('card');
    expect(p.get('client_reference_id')).toBe('ord-1');
    expect(p.get('customer_email')).toBe('sam@example.com');
    expect(p.get('success_url')).toBe('https://www.aibarber.org/shop/manage/tok_order?checkout=success');
    expect(p.get('cancel_url')).toBe('https://www.aibarber.org/shop/manage/tok_order?checkout=cancelled');

    // one line item per order item
    expect(p.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(p.get('line_items[0][price_data][unit_amount]')).toBe('1500');
    expect(p.get('line_items[0][price_data][product_data][name]')).toBe('Beard oil');
    expect(p.get('line_items[0][price_data][product_data][images][0]')).toBe('https://cdn.example.com/oil.jpg');
    expect(p.get('line_items[0][quantity]')).toBe('2');
    expect(p.get('line_items[1][price_data][product_data][name]')).toBe('Comb');
    expect(p.has('line_items[1][price_data][product_data][images][0]')).toBe(false); // http: dropped
    expect(p.get('line_items[1][quantity]')).toBe('1');
    expect(p.has('line_items[2][quantity]')).toBe(false);

    // no shipping params on a pickup order
    expect([...p.keys()].some((k) => k.startsWith('shipping_'))).toBe(false);

    expect(p.get('payment_intent_data[application_fee_amount]')).toBe('90'); // 2% of 4500
    expect(p.get('payment_intent_data[description]')).toBe('Order #1001 at Fade Factory');
    for (const prefix of ['metadata', 'payment_intent_data[metadata]']) {
      expect(p.get(`${prefix}[app]`)).toBe('aibarber-store');
      expect(p.get(`${prefix}[order_id]`)).toBe('ord-1');
      expect(p.get(`${prefix}[shop_id]`)).toBe('shop-1');
    }
  });

  it('omits the application fee when it rounds to 0, and truncates long product names to 250', async () => {
    const { f, calls } = fakeFetch(session(4500));
    await createOrderCheckout({ ...shop, platform_fee_bps: 0 }, order, [{ name: 'x'.repeat(400), unit_price_cents: 4500, quantity: 1 }], { fetch: f, now: () => NOW });
    expect(calls[0].params.has('payment_intent_data[application_fee_amount]')).toBe(false);
    expect(calls[0].params.get('line_items[0][price_data][product_data][name]')).toHaveLength(250);
    expect(calls[0].params.has('line_items[0][price_data][product_data][images][0]')).toBe(false);
  });

  it('shipping order: US-only address collection, fixed_amount = shipping_cents, fee on subtotal + shipping', async () => {
    const shipOrder = { ...order, fulfilment: 'shipping' as const, shipping_cents: 800, total_cents: 5300 };
    const { f, calls } = fakeFetch(session(5300));
    await createOrderCheckout({ ...shop, ships_within_days: 3 }, shipOrder, items.slice(0, 1).map((i) => ({ ...i, quantity: 3 })), { fetch: f, now: () => NOW });
    const p = calls[0].params;
    expect(p.get('shipping_address_collection[allowed_countries][0]')).toBe('US');
    expect(p.has('shipping_address_collection[allowed_countries][1]')).toBe(false);
    expect(p.get('shipping_options[0][shipping_rate_data][type]')).toBe('fixed_amount');
    expect(p.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]')).toBe('800');
    expect(p.get('shipping_options[0][shipping_rate_data][fixed_amount][currency]')).toBe('usd');
    expect(p.get('shipping_options[0][shipping_rate_data][display_name]')).toBe('Ships within 3 days');
    expect(p.get('shipping_options[0][shipping_rate_data][delivery_estimate][maximum][unit]')).toBe('business_day');
    expect(p.get('shipping_options[0][shipping_rate_data][delivery_estimate][maximum][value]')).toBe('8');
    expect(p.get('payment_intent_data[application_fee_amount]')).toBe('106'); // 2% of 5300
    expect(calls[0].init.headers['Idempotency-Key']).toBe(`ab-order-checkout-ord-1-5300-${MINUTE}`);
  });

  it('shipping order without ships_within_days: "Shipping" and no delivery estimate', async () => {
    const shipOrder = { ...order, fulfilment: 'shipping' as const, shipping_cents: 0, total_cents: 4500 };
    const { f, calls } = fakeFetch(session(4500));
    await createOrderCheckout(shop, shipOrder, items, { fetch: f, now: () => NOW });
    const p = calls[0].params;
    expect(p.get('shipping_options[0][shipping_rate_data][display_name]')).toBe('Shipping');
    expect(p.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]')).toBe('0');
    expect([...p.keys()].some((k) => k.includes('delivery_estimate'))).toBe(false);
  });

  it('shipping order with ships_within_days 1: singular "Ships within 1 day"', async () => {
    const shipOrder = { ...order, fulfilment: 'shipping' as const, shipping_cents: 0, total_cents: 4500 };
    const { f, calls } = fakeFetch(session(4500));
    await createOrderCheckout({ ...shop, ships_within_days: 1 }, shipOrder, items, { fetch: f, now: () => NOW });
    expect(calls[0].params.get('shipping_options[0][shipping_rate_data][display_name]')).toBe('Ships within 1 day');
    expect(calls[0].params.get('shipping_options[0][shipping_rate_data][delivery_estimate][maximum][value]')).toBe('6');
  });

  it('exactly 50¢ is accepted, with a 1¢ fee', async () => {
    const { f, calls } = fakeFetch(session(50));
    await createOrderCheckout(shop, { ...order, total_cents: 50 }, [{ name: 'Gum', unit_price_cents: 50, quantity: 1 }], { fetch: f, now: () => NOW });
    expect(calls).toHaveLength(1);
    expect(calls[0].params.get('payment_intent_data[application_fee_amount]')).toBe('1');
  });

  it('a null order_no falls back to the first 8 characters of the id in the description', async () => {
    const { f, calls } = fakeFetch(session(4500));
    await createOrderCheckout(shop, { ...order, id: 'abcdef12-3456', order_no: null }, items, { fetch: f, now: () => NOW });
    expect(calls[0].params.get('payment_intent_data[description]')).toBe('Order #abcdef12 at Fade Factory');
  });

  it('amount_total mismatch: expires the session and throws (never a charge for the wrong total)', async () => {
    const { f, calls } = fakeFetch(session(4400), { body: { id: 'cs_o1', status: 'expired' } });
    await expect(createOrderCheckout(shop, order, items, { fetch: f, now: () => NOW })).rejects.toThrow(StripeApiError);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe('https://api.stripe.com/v1/checkout/sessions/cs_o1/expire');
    expect(calls[1].init.headers['Stripe-Account']).toBe('acct_123');
  });

  it('throws before any fetch under the 50¢ minimum or without a connected account', async () => {
    const { f } = fakeFetch(session(49));
    await expect(createOrderCheckout(shop, { ...order, total_cents: 49 }, [{ name: 'Gum', unit_price_cents: 49, quantity: 1 }], { fetch: f })).rejects.toThrow(/minimum/);
    await expect(createOrderCheckout({ ...shop, stripe_account_id: null }, order, items, { fetch: f })).rejects.toThrow(/connected/);
    expect(f).not.toHaveBeenCalled();
  });

  it('a Stripe error propagates', async () => {
    const { f } = fakeFetch({ status: 400, body: { error: { message: 'bad', code: 'parameter_invalid' } } });
    await expect(createOrderCheckout(shop, order, items, { fetch: f, now: () => NOW })).rejects.toMatchObject({ status: 400, code: 'parameter_invalid' });
  });
});

describe('refundOrder', () => {
  const paid = { ...order, stripe_payment_intent_id: 'pi_o1', amount_paid_cents: 4500, amount_refunded_cents: 1000 };

  it('clamps to what is refundable, passes the given key, refunds the application fee, tags the order', async () => {
    const { f, calls } = fakeFetch({ body: { id: 're_1', amount: 3500, status: 'succeeded' } });
    const r = await refundOrder(shop, paid, 9999, { fetch: f, idempotencyKey: refundKey.order('ord-1', 4500) });
    expect(r).toEqual({ refundedCents: 3500 });
    const { url, init, params: p } = calls[0];
    expect(url).toBe('https://api.stripe.com/v1/refunds');
    expect(init.headers['Stripe-Account']).toBe('acct_123');
    expect(init.headers['Idempotency-Key']).toBe('refund-order-ord-1-4500');
    expect(p.get('payment_intent')).toBe('pi_o1');
    expect(p.get('amount')).toBe('3500');
    expect(p.get('refund_application_fee')).toBe('true');
    expect(p.get('metadata[order_id]')).toBe('ord-1');
    expect(p.get('metadata[app]')).toBe('aibarber-store');
  });

  it('returns 0 without calling Stripe when nothing is refundable (incl. a row with nothing paid)', async () => {
    const { f } = fakeFetch();
    expect(await refundOrder(shop, { ...paid, amount_refunded_cents: 4500 }, 100, { fetch: f, idempotencyKey: 'k' })).toEqual({ refundedCents: 0 });
    expect(await refundOrder(shop, { ...paid, amount_paid_cents: 0, amount_refunded_cents: 0 }, 100, { fetch: f, idempotencyKey: 'k' })).toEqual({ refundedCents: 0 });
    expect(await refundOrder(shop, { ...paid, stripe_payment_intent_id: null }, 100, { fetch: f, idempotencyKey: 'k' })).toEqual({ refundedCents: 0 });
    expect(await refundOrder(shop, paid, 0, { fetch: f, idempotencyKey: 'k' })).toEqual({ refundedCents: 0 });
    expect(f).not.toHaveBeenCalled();
  });

  it('a failed or canceled refund throws; a missing key throws before fetch', async () => {
    const { f } = fakeFetch({ body: { id: 're_x', amount: 100, status: 'failed' } });
    await expect(refundOrder(shop, paid, 100, { fetch: f, idempotencyKey: 'k' })).rejects.toThrow(/failed/);
    const g = fakeFetch();
    await expect(refundOrder(shop, paid, 100, { fetch: g.f } as any)).rejects.toThrow(/idempotency/i);
    expect(g.f).not.toHaveBeenCalled();
  });

  it('refundKey.order is per order and target total', () => {
    expect(refundKey.order('ord-1', 2500)).toBe('refund-order-ord-1-2500');
  });
});

describe('shipsWithinLabel', () => {
  it('0 or 1 → "Ships within 1 day"; 2+ → "N days"; null → "Shipping"', () => {
    expect(shipsWithinLabel(0)).toBe('Ships within 1 day');
    expect(shipsWithinLabel(1)).toBe('Ships within 1 day');
    expect(shipsWithinLabel(2)).toBe('Ships within 2 days');
    expect(shipsWithinLabel(null)).toBe('Shipping');
    expect(shipsWithinLabel(undefined)).toBe('Shipping');
  });
});

describe('orderShippingFromSession', () => {
  const addr = { line1: '1 Main St', line2: 'Apt 2', city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' };
  const want = { name: 'Sam Lee', line1: '1 Main St', line2: 'Apt 2', city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' };

  it('reads collected_information.shipping_details (newer API versions) first', () => {
    expect(orderShippingFromSession({
      collected_information: { shipping_details: { name: 'Sam Lee', address: addr } },
      shipping_details: { name: 'Old', address: { ...addr, city: 'Old' } },
      customer_details: { name: 'Cust', address: { ...addr, city: 'Cust' } },
    })).toEqual(want);
  });

  it('then shipping_details (older API versions)', () => {
    expect(orderShippingFromSession({ shipping_details: { name: 'Sam Lee', address: addr }, customer_details: { name: 'C', address: { ...addr, city: 'X' } } })).toEqual(want);
  });

  it('then customer_details.address and name; missing parts are null', () => {
    expect(orderShippingFromSession({ customer_details: { name: 'Sam Lee', address: { ...addr, line2: undefined } } })).toEqual({ ...want, line2: null });
  });

  it('null when the session has no address at all', () => {
    expect(orderShippingFromSession({})).toBeNull();
    expect(orderShippingFromSession({ customer_details: { name: 'x', address: null } })).toBeNull();
  });

  it('orderManageUrl is the /shop/manage status page', () => {
    expect(orderManageUrl('tok_order')).toBe('https://www.aibarber.org/shop/manage/tok_order');
  });
});
