import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/shop/api';
import { cartTotals } from '../../src/shop/cart';
import {
  checkoutBody, invalidMessage, payRows, placeOrder, validateCheckout, withNewAttempt, type CheckoutState,
} from '../../src/shop/logic';
import type { Product, ShopInfo } from '../../src/shop/types';

const shop: ShopInfo = {
  slug: 'fresh-cuts', name: 'Fresh Cuts', address: '1 Main St', phone: '5125550100', accent: null,
  pickup: { enabled: true, note: 'Ask at the counter' },
  shipping: { enabled: true, flatCents: 599, shipsWithinDays: 3 },
  pay: { inShop: true, card: true, manual: { cashapp: '$fresh', venmo: '@fresh' } },
};
const products: Product[] = [
  { id: 'a', name: 'Pomade', priceCents: 1800, description: null, photos: [], soldOut: false },
  { id: 'b', name: 'Comb', priceCents: 450, description: null, photos: [], soldOut: false },
];
const address = { name: 'Sam Lee', line1: '1 Main St', line2: '', city: 'Austin', state: 'TX', postalCode: '78701' };
const base = (over: Partial<CheckoutState> = {}): CheckoutState => ({
  slug: 'fresh-cuts', clientKey: 'k'.repeat(32), shop, products,
  cart: { lines: [
    { productId: 'a', name: 'Pomade', priceCents: 1800, photo: null, quantity: 2 },
    { productId: 'b', name: 'Comb', priceCents: 450, photo: null, quantity: 1 },
  ] },
  customer: { name: ' Sam Lee ', phone: '512 555 0100', email: 'sam@x.test' }, note: '',
  fulfilment: 'pickup', address, pay: 'shop', method: null, ...over,
});

describe('checkoutBody', () => {
  it('sends no address for card + shipping', () => {
    const b = checkoutBody(base({ fulfilment: 'shipping', pay: 'card' }));
    expect(b.pay).toBe('card');
    expect('address' in b).toBe(false);
  });
  it('sends the address for manual + shipping, trimmed, with line2 only when set', () => {
    const b = checkoutBody(base({ fulfilment: 'shipping', pay: 'manual', method: 'cashapp' }));
    expect(b.address).toEqual({ name: 'Sam Lee', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701' });
    expect(b.method).toBe('cashapp');
    const b2 = checkoutBody(base({ fulfilment: 'shipping', pay: 'manual', method: 'cashapp', address: { ...address, line2: 'Apt 2' } }));
    expect(b2.address?.line2).toBe('Apt 2');
  });
  it('sends no address for pickup', () => {
    expect('address' in checkoutBody(base())).toBe(false);
  });
  it("sends pay 'shop' only for pickup", () => {
    expect(checkoutBody(base({ fulfilment: 'pickup', pay: 'shop' })).pay).toBe('shop');
    expect(checkoutBody(base({ fulfilment: 'shipping', pay: 'shop' })).pay).not.toBe('shop');
  });
  it('sends method only for manual', () => {
    expect('method' in checkoutBody(base({ pay: 'card', method: 'venmo' }))).toBe(false);
    expect(checkoutBody(base({ pay: 'manual', method: 'venmo' })).method).toBe('venmo');
  });
  it('expectedTotalCents equals cartTotals', () => {
    const s = base({ fulfilment: 'shipping', pay: 'card' });
    expect(checkoutBody(s).expectedTotalCents).toBe(cartTotals(s.cart, products, 'shipping', 599).totalCents);
    expect(checkoutBody(s).expectedTotalCents).toBe(1800 * 2 + 450 + 599);
    const p = base();
    expect(checkoutBody(p).expectedTotalCents).toBe(4050);
  });
  it('lists items and trims customer fields; omits an empty note', () => {
    const b = checkoutBody(base());
    expect(b.items).toEqual([{ productId: 'a', quantity: 2 }, { productId: 'b', quantity: 1 }]);
    expect(b.customer.name).toBe('Sam Lee');
    expect('note' in b).toBe(false);
    expect(checkoutBody(base({ note: ' leave at door ' })).note).toBe('leave at door');
  });
  it('the clientKey is stable across a retry and new after withNewAttempt', () => {
    const s = base();
    expect(checkoutBody(s).clientKey).toBe(checkoutBody(s).clientKey);
    const s2 = withNewAttempt(s);
    expect(s2.clientKey).not.toBe(s.clientKey);
    expect(s2.clientKey).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });
});

describe('payRows', () => {
  it('pickup offers shop, each manual handle, and card', () => {
    expect(payRows(shop, 'pickup').map((r) => `${r.pay}:${r.method ?? ''}`)).toEqual(['shop:', 'manual:cashapp', 'manual:venmo', 'card:']);
  });
  it('shipping hides pay-at-pickup', () => {
    expect(payRows(shop, 'shipping').map((r) => r.pay)).not.toContain('shop');
  });
  it('card is hidden under 50 cents', () => {
    expect(payRows(shop, 'pickup', 40).map((r) => r.pay)).not.toContain('card');
  });
});

describe('validateCheckout', () => {
  it('passes a complete pickup order', () => { expect(validateCheckout(base())).toBeNull(); });
  it('wants name, phone, email', () => {
    expect(validateCheckout(base({ customer: { name: '', phone: '5125550100', email: 'a@b.co' } }))).toMatch(/name/i);
    expect(validateCheckout(base({ customer: { name: 'A', phone: '12', email: 'a@b.co' } }))).toMatch(/phone/i);
    expect(validateCheckout(base({ customer: { name: 'A', phone: '5125550100', email: 'nope' } }))).toMatch(/email/i);
  });
  it('wants an address for non-card shipping, but not for card shipping', () => {
    expect(validateCheckout(base({ fulfilment: 'shipping', pay: 'manual', method: 'cashapp', address: { ...address, line1: '' } }))).toMatch(/address/i);
    expect(validateCheckout(base({ fulfilment: 'shipping', pay: 'manual', method: 'cashapp', address: { ...address, postalCode: '123' } }))).toMatch(/zip/i);
    expect(validateCheckout(base({ fulfilment: 'shipping', pay: 'card', address: { ...address, line1: '' } }))).toBeNull();
  });
  it('wants a method for manual', () => {
    expect(validateCheckout(base({ pay: 'manual', method: null }))).toMatch(/pay/i);
  });
  it('refuses an empty cart and sold-out lines', () => {
    expect(validateCheckout(base({ cart: { lines: [] } }))).toMatch(/cart/i);
    const s = base();
    s.cart.lines[0].soldOut = true;
    expect(validateCheckout(s)).toMatch(/sold out/i);
  });
});

const created = { order: { id: 'o1', number: 1001, subtotalCents: 4050, shippingCents: 0, totalCents: 4050, statusUrl: 'https://www.aibarber.org/shop/manage/tok' } };

describe('placeOrder', () => {
  it('returns ok with the response and the key used', async () => {
    const createOrder = vi.fn().mockResolvedValue(created);
    const r = await placeOrder(createOrder, base());
    expect(r).toMatchObject({ kind: 'ok', res: created });
    expect(createOrder).toHaveBeenCalledTimes(1);
  });
  it('checkout-expired: retries once with a new clientKey', async () => {
    const createOrder = vi.fn()
      .mockRejectedValueOnce(new ApiError(409, 'checkout-expired'))
      .mockResolvedValueOnce(created);
    const s = base();
    const r = await placeOrder(createOrder, s);
    expect(r.kind).toBe('ok');
    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(createOrder.mock.calls[1][0].clientKey).not.toBe(createOrder.mock.calls[0][0].clientKey);
    expect(r.kind === 'ok' && r.state.clientKey).toBe(createOrder.mock.calls[1][0].clientKey);
  });
  it('checkout-expired twice: gives up with a timed-out result', async () => {
    const createOrder = vi.fn().mockRejectedValue(new ApiError(409, 'checkout-expired'));
    const r = await placeOrder(createOrder, base());
    expect(r.kind).toBe('expired');
    expect(createOrder).toHaveBeenCalledTimes(2);
  });
  it('cart-changed carries fresh products and the new total', async () => {
    const fresh = [{ ...products[0], priceCents: 2000 }];
    const createOrder = vi.fn().mockRejectedValue(new ApiError(409, 'cart-changed', { error: 'cart-changed', products: fresh, totalCents: 4450 }));
    expect(await placeOrder(createOrder, base())).toEqual({ kind: 'cart-changed', products: fresh, totalCents: 4450 });
  });
  it('sold-out carries the product ids', async () => {
    const createOrder = vi.fn().mockRejectedValue(new ApiError(409, 'sold-out', { productIds: ['b'] }));
    expect(await placeOrder(createOrder, base())).toEqual({ kind: 'sold-out', productIds: ['b'] });
  });
  it('423 is paused; 429 carries a message; 502 payment-unavailable; 400 carries the field', async () => {
    const run = (e: ApiError) => placeOrder(vi.fn().mockRejectedValue(e), base());
    expect(await run(new ApiError(423, 'store-paused'))).toEqual({ kind: 'paused' });
    expect(await run(new ApiError(429, 'rate-limited'))).toMatchObject({ kind: 'rate-limited' });
    expect(await run(new ApiError(429, 'rate-limited', { message: 'Slow down' }))).toEqual({ kind: 'rate-limited', message: 'Slow down' });
    expect(await run(new ApiError(502, 'payment-unavailable'))).toMatchObject({ kind: 'payment-unavailable' });
    expect(await run(new ApiError(400, 'invalid', { field: 'customer' }))).toEqual({ kind: 'invalid', field: 'customer' });
    expect(await run(new ApiError(0, 'network'))).toMatchObject({ kind: 'error' });
  });
});

describe('invalidMessage', () => {
  it('maps contract fields to words, never the raw name', () => {
    expect(invalidMessage('pay')).toBe('Please check your payment choice.');
    expect(invalidMessage('items')).toBe('Please check your cart.');
    expect(invalidMessage('customer')).toMatch(/name, phone/);
    expect(invalidMessage('address')).toMatch(/shipping address/);
    expect(invalidMessage('weird')).toBe('Please check your details.');
    expect(invalidMessage(undefined)).toBe('Please check your details.');
  });
});

describe('pay coercion', () => {
  it('under 50 cents hides card', () => {
    expect(payRows(shop, 'pickup', 49).map((r) => r.pay)).not.toContain('card');
    expect(payRows(shop, 'pickup', 50).map((r) => r.pay)).toContain('card');
  });
  it('several manual handles and no choice sends manual without a method', () => {
    const b = checkoutBody(base({ pay: 'manual', method: null }));
    expect(b.pay).toBe('manual');
    expect('method' in b).toBe(false);
  });
  it('a single manual handle is sent without being chosen', () => {
    const one = { ...shop, pay: { ...shop.pay, manual: { zelle: 'a@b.co' } } };
    expect(checkoutBody(base({ shop: one, pay: 'manual', method: null })).method).toBe('zelle');
  });
});
