import { manualMethods } from '../book/logic';
import { ApiError } from './api';
import { cartTotals } from './cart';
import type {
  Address, Cart, CreateOrderResponse, Fulfilment, ManualMethod, OrderBody, PayChoice, Product, ShopInfo,
} from './types';

export { formatMoney, manualLink, manualMethods, METHOD_LABEL, safeAccent, onAccent, telUrl, directionsUrl } from '../book/logic';

/** Mirrors lib/store/payments.ts: 0 or 1 → "Ships within 1 day", 2+ → "Ships within N days", unset → no line (null). */
export function shipsWithinLabel(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const days = Math.max(1, Math.floor(n));
  return days === 1 ? 'Ships within 1 day' : `Ships within ${days} days`;
}

/* ---------- routing ---------- */

export type ShopRoute =
  | { kind: 'shop'; slug: string }
  | { kind: 'order'; token: string }
  | { kind: 'none' };

export function parseShopRoute(pathname: string): ShopRoute {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'shop' || !parts[1]) return { kind: 'none' };
  if (parts[1] === 'manage') {
    return parts[2] ? { kind: 'order', token: decodeURIComponent(parts[2]) } : { kind: 'none' };
  }
  return { kind: 'shop', slug: decodeURIComponent(parts[1]) };
}

export function tokenFromStatusUrl(url: string): string {
  const m = /\/shop\/manage\/([^/?#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : '';
}

/** A fresh idempotency key for one checkout attempt: 32 chars, [a-f0-9]. */
export function newClientKey(): string {
  const c: Crypto | undefined = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
  let s = '';
  while (s.length < 32) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

/** Address lines for display. Accepts the stored snake_case shape and the form's camelCase one. */
export function formatAddress(a: Record<string, string | undefined> | null | undefined): string[] {
  if (!a) return [];
  const zip = a.postal_code ?? a.postalCode ?? '';
  const cityLine = [[a.city, a.state].filter(Boolean).join(', '), zip].filter(Boolean).join(' ');
  return [a.name, a.line1, a.line2, cityLine].filter((s): s is string => !!s && !!s.trim());
}

/* ---------- checkout ---------- */

/** Stripe's minimum card charge; the server refuses a card order below it. */
export const CARD_MIN_CENTS = 50;

export type AddressForm = { name: string; line1: string; line2: string; city: string; state: string; postalCode: string };
export const EMPTY_ADDRESS: AddressForm = { name: '', line1: '', line2: '', city: '', state: '', postalCode: '' };

export type CheckoutState = {
  slug: string;
  clientKey: string;
  shop: ShopInfo;
  products: Product[];
  cart: Cart;
  customer: { name: string; phone: string; email: string };
  note: string;
  fulfilment: Fulfilment;
  address: AddressForm;
  pay: PayChoice;
  method: ManualMethod | null;
};

export type PayRow = { pay: PayChoice; method?: ManualMethod };

/** Ways to pay for this fulfilment. Pay-at-pickup is for pickup only; card is dropped under the 50 cent minimum. */
export function payRows(shop: ShopInfo, fulfilment: Fulfilment, totalCents?: number): PayRow[] {
  const rows: PayRow[] = [];
  if (fulfilment === 'pickup' && shop.pay.inShop) rows.push({ pay: 'shop' });
  for (const m of manualMethods(shop.pay.manual)) rows.push({ pay: 'manual', method: m });
  if (shop.pay.card && (totalCents == null || totalCents >= CARD_MIN_CENTS)) rows.push({ pay: 'card' });
  return rows;
}

/** The pay choice and method to send, coerced to something valid for the fulfilment. */
function effectivePay(s: CheckoutState): PayRow {
  const rows = payRows(s.shop, s.fulfilment);
  if (s.pay === 'manual') {
    const methods = rows.filter((r) => r.pay === 'manual');
    const hit = methods.find((r) => r.method === s.method);
    if (hit) return hit;
    // The server accepts a lone handle without a named method; with several, the customer must choose.
    if (methods.length === 1) return methods[0];
    if (methods.length > 1) return { pay: 'manual' };
  } else {
    const hit = rows.find((r) => r.pay === s.pay);
    if (hit) return hit;
  }
  // Not offered for this fulfilment (e.g. pay-at-pickup on a shipping order): fall back to what is.
  return rows[0] ?? { pay: s.pay };
}

export function checkoutBody(s: CheckoutState): OrderBody {
  const totals = cartTotals(s.cart, s.products, s.fulfilment, s.shop.shipping.flatCents);
  const eff = effectivePay(s);
  const t = (v: string) => v.trim();
  const body: OrderBody = {
    slug: s.slug,
    clientKey: s.clientKey,
    items: s.cart.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
    customer: { name: t(s.customer.name), phone: t(s.customer.phone), email: t(s.customer.email) },
    fulfilment: s.fulfilment,
    pay: eff.pay,
    expectedTotalCents: totals.totalCents,
  };
  if (t(s.note)) body.note = t(s.note);
  if (eff.pay === 'manual' && eff.method) body.method = eff.method;
  // Card + shipping: Stripe Checkout collects the address, so none is sent.
  if (s.fulfilment === 'shipping' && eff.pay !== 'card') {
    const a: Address = { name: t(s.address.name), line1: t(s.address.line1), city: t(s.address.city), state: t(s.address.state).toUpperCase(), postalCode: t(s.address.postalCode) };
    if (t(s.address.line2)) a.line2 = t(s.address.line2);
    body.address = a;
  }
  return body;
}

/** A new attempt: same cart and details, new idempotency key. */
export function withNewAttempt(s: CheckoutState, makeKey: () => string = newClientKey): CheckoutState {
  return { ...s, clientKey: makeKey() };
}

/** First problem with the form in plain words, or null when it can be submitted. */
export function validateCheckout(s: CheckoutState): string | null {
  if (s.cart.lines.length === 0) return 'Your cart is empty.';
  if (s.cart.lines.some((l) => l.soldOut)) return 'Remove the sold out items to continue.';
  if (!s.customer.name.trim()) return 'Please enter your name.';
  if (s.customer.phone.replace(/\D/g, '').length < 10) return 'Please enter a valid phone number.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.customer.email.trim())) return 'Please enter a valid email.';
  const eff = effectivePay(s);
  if (!payRows(s.shop, s.fulfilment).length) return "This shop can't take orders online right now. Please call the shop.";
  if (eff.pay === 'manual' && !eff.method) return 'Please choose how you want to pay.';
  if (s.fulfilment === 'shipping' && eff.pay !== 'card') {
    const a = s.address;
    if (!a.name.trim() || !a.line1.trim() || !a.city.trim()) return 'Please enter your full shipping address.';
    if (!/^[A-Za-z]{2}$/.test(a.state.trim())) return 'Please choose your state.';
    if (!/^\d{5}(-\d{4})?$/.test(a.postalCode.trim())) return 'Please enter a valid ZIP code.';
  }
  return null;
}

const FIELD_WORDS: Record<string, string> = {
  pay: 'payment choice', method: 'payment method', items: 'cart', customer: 'name, phone and email', address: 'shipping address',
  fulfilment: 'pickup or shipping choice', note: 'note', slug: 'shop link', clientKey: 'order', expectedTotalCents: 'total',
};
/** Plain-words message for a 400 invalid { field }. */
export function invalidMessage(field: string | undefined): string {
  const w = field && FIELD_WORDS[field];
  return w ? `Please check your ${w}.` : 'Please check your details.';
}

export const RATE_LIMITED_FALLBACK = 'Too many orders right now. Please try again in a few minutes.';
export const EXPIRED_MESSAGE = 'Checkout timed out. Please try again.';
export const CHANGED_MESSAGE = 'Prices changed. Check your cart.';

export type PlaceResult =
  | { kind: 'ok'; res: CreateOrderResponse; state: CheckoutState }
  | { kind: 'cart-changed'; products: Product[]; totalCents: number | undefined }
  | { kind: 'sold-out'; productIds: string[] }
  | { kind: 'expired' }
  | { kind: 'paused' }
  | { kind: 'rate-limited'; message: string }
  | { kind: 'payment-unavailable'; message: string }
  | { kind: 'invalid'; field: string | undefined }
  | { kind: 'error'; message: string };

/**
 * Submits one checkout attempt. On `checkout-expired` it makes a new clientKey and resubmits once;
 * if that expires too, the caller shows EXPIRED_MESSAGE.
 */
export async function placeOrder(
  createOrder: (b: OrderBody) => Promise<CreateOrderResponse>,
  state: CheckoutState,
  makeKey: () => string = newClientKey,
): Promise<PlaceResult> {
  let cur = state;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await createOrder(checkoutBody(cur));
      return { kind: 'ok', res, state: cur };
    } catch (e) {
      if (!(e instanceof ApiError)) return { kind: 'error', message: 'Something went wrong. Please try again.' };
      if (e.status === 409 && e.code === 'checkout-expired') {
        if (attempt === 0) { cur = withNewAttempt(cur, makeKey); continue; }
        return { kind: 'expired' };
      }
      if (e.status === 409 && e.code === 'cart-changed') return { kind: 'cart-changed', products: e.products, totalCents: e.totalCents };
      if (e.status === 409 && e.code === 'sold-out') return { kind: 'sold-out', productIds: e.productIds };
      if (e.status === 423) return { kind: 'paused' };
      if (e.status === 429 || e.code === 'rate-limited') return { kind: 'rate-limited', message: e.serverMessage?.trim() || RATE_LIMITED_FALLBACK };
      if (e.status === 502 && e.code === 'payment-unavailable') {
        return { kind: 'payment-unavailable', message: "Card payments aren't available right now. Please choose another way to pay." };
      }
      if (e.status === 400) return { kind: 'invalid', field: e.field };
      if (e.status === 404) return { kind: 'error', message: "We couldn't find this shop." };
      return { kind: 'error', message: 'Something went wrong. Please try again.' };
    }
  }
  return { kind: 'expired' };
}

/* ---------- order status ---------- */

export const STATUS_LABEL: Record<string, string> = {
  new: 'Order placed', paid: 'Paid', ready: 'Ready for pickup', shipped: 'Shipped', done: 'Completed', cancelled: 'Cancelled',
};

export function paymentLine(o: { paymentStatus: string; paymentMethod: string | null; amountPaidCents: number; amountRefundedCents: number }): string {
  if (o.amountRefundedCents > 0 && o.amountRefundedCents >= o.amountPaidCents) return 'Refunded';
  if (o.amountRefundedCents > 0) return 'Partly refunded';
  if (o.paymentStatus === 'paid') return 'Paid';
  if (o.paymentMethod === 'shop') return 'Pay at pickup';
  if (o.paymentStatus === 'awaiting') return 'Awaiting payment';
  return 'Unpaid';
}

export function sentErrorMessage(e: { status: number; code: string } | null): string {
  if (e && e.status === 409 && e.code === 'not-awaiting-payment') return "This order doesn't need a payment sent.";
  return "Couldn't record that. Try again.";
}
