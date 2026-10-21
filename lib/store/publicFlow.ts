// Public store API flows (no auth): /api/store/{shop,orders,order,sent}. Pure over injected deps
// (repo, payments, notify, clock, limits), so they are testable without Supabase or Stripe.
// Handlers in api/store/* only parse the request and send the result.
import {
  cardEnabled,
  err,
  inShopAllowed,
  invalid,
  isObj,
  isSlugParam,
  isToken,
  manualHandles,
  normalizePhone,
  notFound,
  ok,
  text,
  validEmail,
  type FlowResult,
} from '../bookings/core.js';
import { MANUAL_METHODS, type ManualMethod, type PaymentStatus } from '../bookings/repo.js';
import {
  LIVE_HOLD,
  MIN_PRICE_CENTS,
  expiredHoldPatch,
  isUnpaidCardHold,
  parseCart,
  parseUsAddress,
  pickupEnabled,
  priceCart,
  publicOrderView,
  publicProductView,
  safeNotify,
  shippingEnabled,
  statusUrl,
  storeOpen,
  type StoreDeps,
} from './core.js';
import type { NewOrder } from './repo.js';
import type { Fulfilment, OrderRow, OrderStatus, ShopStoreRow } from './types.js';

type Params = Record<string, unknown>;
type Pay = 'shop' | 'manual' | 'card';

/** The page's per-attempt key (a uuid); the same pattern as 009's ab_orders_client_key_fmt check. */
const CLIENT_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

export const storePaused = () => err(423, 'store-paused');
const checkoutExpired = () => err(409, 'checkout-expired');

// ---------------------------------------------------------------------------
// GET /api/store/shop?slug=
// ---------------------------------------------------------------------------
export async function getStoreShop(params: Params, deps: StoreDeps): Promise<FlowResult> {
  if (!isSlugParam(params.slug)) return notFound();
  const shop = await deps.repo.shopBySlug(params.slug);
  if (!shop) return notFound();
  if (!(await storeOpen(deps.repo, shop))) return ok({ paused: true, shop: { name: shop.name } });
  const products = (await deps.repo.products(shop.id)).filter((p) => p.active && p.shop_id === shop.id);
  return ok({
    paused: false,
    shop: {
      slug: shop.slug,
      name: shop.name,
      address: shop.address ?? null,
      phone: shop.phone ?? null,
      accent: shop.accent ?? null,
      pickup: { enabled: pickupEnabled(shop), note: shop.store_pickup_note ?? null },
      shipping: { enabled: shippingEnabled(shop), flatCents: shop.shipping_flat_cents ?? 0, shipsWithinDays: shop.ships_within_days ?? null },
      pay: { inShop: inShopAllowed(shop), card: cardEnabled(shop), manual: manualHandles(shop) },
    },
    products: products.map(publicProductView),
  });
}

// ---------------------------------------------------------------------------
// POST /api/store/orders
// ---------------------------------------------------------------------------
const created = (deps: StoreDeps, o: OrderRow, checkoutUrl?: string | null): FlowResult =>
  ok(
    {
      order: {
        id: o.id,
        number: o.order_no,
        subtotalCents: o.subtotal_cents,
        shippingCents: o.shipping_cents,
        totalCents: o.total_cents,
        statusUrl: statusUrl(deps.baseUrl, o.manage_token),
      },
      ...(checkoutUrl ? { checkoutUrl } : {}),
    },
    201,
  );

const shopRateLimited = (): FlowResult => ({
  ...err(429, 'rate-limited', { message: 'This shop is getting a lot of orders right now. Please try again in a few minutes.' }),
  headers: { 'Retry-After': '300' },
});

/**
 * The answer for a repeated clientKey (contract "Duplicate submits"): never a second Checkout
 * Session and never a second notify.
 */
async function repeatResponse(deps: StoreDeps, shop: ShopStoreRow, order: OrderRow): Promise<FlowResult> {
  let o = order;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (o.payment_method !== 'card') return created(deps, o);
    if (o.status === 'cancelled') return checkoutExpired();
    if (!(o.status === 'new' && isUnpaidCardHold(o))) return created(deps, o); // paid (or later)
    if (o.checkout_url) return created(deps, o, o.checkout_url);
    // A live hold with no session stored: the first request died between create and store.
    // Cancel it; the page makes a new clientKey. A payment on an orphaned session is refunded
    // by the webhook's paid-after-cancel path.
    const upd = await deps.repo.updateOrder(o.id, expiredHoldPatch(deps.now()), LIVE_HOLD);
    if (upd.ok) {
      if (upd.row.stripe_checkout_session_id) {
        try {
          await deps.payments.expireCheckoutSession(shop, upd.row.stripe_checkout_session_id);
        } catch (e: any) {
          console.error(`[store] expiring checkout for order ${o.id} failed:`, e?.message || e);
        }
      }
      return checkoutExpired();
    }
    const cur = await deps.repo.orderById(o.id);
    if (!cur) return checkoutExpired();
    o = cur; // a payment (or the session) landed meanwhile: decide again on the fresh row
  }
  return checkoutExpired();
}

export async function createOrder(body: unknown, deps: StoreDeps): Promise<FlowResult> {
  // Shape (no reads).
  if (!isObj(body)) return invalid('body');
  const { slug, clientKey, items, customer, note, fulfilment, pay, method, expectedTotalCents, address } = body;
  if (!isSlugParam(slug)) return invalid('slug');
  if (typeof clientKey !== 'string' || !CLIENT_KEY_RE.test(clientKey)) return invalid('clientKey');
  const lines = parseCart(items);
  if (!lines) return invalid('items');
  if (!isObj(customer)) return invalid('customer');
  const name = text(customer.name, 100);
  if (!name) return invalid('customer.name');
  if (!normalizePhone(customer.phone)) return invalid('customer.phone');
  const phone = (customer.phone as string).trim();
  const email = validEmail(customer.email);
  if (!email) return invalid('customer.email');
  const noteText = text(note, 500, true);
  if (noteText === undefined) return invalid('note');
  if (fulfilment !== 'pickup' && fulfilment !== 'shipping') return invalid('fulfilment');
  if (pay !== 'shop' && pay !== 'manual' && pay !== 'card') return invalid('pay');
  if (method != null && (pay !== 'manual' || !MANUAL_METHODS.includes(method as ManualMethod))) return invalid('method');
  if (typeof expectedTotalCents !== 'number' || !Number.isInteger(expectedTotalCents) || expectedTotalCents < 0) {
    return invalid('expectedTotalCents');
  }
  if (pay === 'shop' && fulfilment === 'shipping') return invalid('pay'); // in-shop pay is pickup only
  // Card + shipping: Stripe Checkout collects the address and the webhook stores it.
  let shippingAddress: Record<string, unknown> | null = null;
  if (fulfilment === 'shipping') {
    if (pay === 'card') shippingAddress = {};
    else {
      shippingAddress = parseUsAddress(address);
      if (!shippingAddress) return invalid('address');
    }
  }

  // Shop and gate.
  const shop = await deps.repo.shopBySlug(slug);
  if (!shop) return notFound();
  if (!(await storeOpen(deps.repo, shop))) return storePaused();
  if (fulfilment === 'pickup' ? !pickupEnabled(shop) : !shippingEnabled(shop)) return invalid('fulfilment');
  if (pay === 'shop' && !inShopAllowed(shop)) return invalid('pay');
  if (pay === 'manual' && Object.keys(manualHandles(shop)).length === 0) return invalid('pay');
  if (pay === 'card' && !cardEnabled(shop)) return invalid('pay');
  // The manual rail is fixed at order time: the one named, else the shop's only handle. With
  // several handles and none named it stays null, and "I've sent it" is refused for the order.
  let manualMethod: ManualMethod | null = null;
  if (pay === 'manual') {
    const offered = Object.keys(manualHandles(shop)) as ManualMethod[];
    if (method != null && !offered.includes(method as ManualMethod)) return invalid('method');
    manualMethod = (method as ManualMethod | undefined) ?? (offered.length === 1 ? offered[0] : null);
  }

  // A resubmit of an order that was already created answers from the stored order (before the
  // cart checks, so a retry after a product sold out still gets its order; not rate-counted).
  const prior = await deps.repo.orderByClientKey(shop.id, clientKey);
  if (prior) return repeatResponse(deps, shop, prior);

  // Cart (server is authoritative).
  const products = await deps.repo.productsByIds(shop.id, lines.map((l) => l.productId));
  const priced = priceCart(shop, products, lines, fulfilment as Fulfilment);
  if ('invalid' in priced) return invalid('items');
  if ('soldOut' in priced) return err(409, 'sold-out', { productIds: priced.soldOut });
  if (priced.total !== expectedTotalCents) {
    const byId = new Map(products.map((p) => [p.id, p]));
    return err(409, 'cart-changed', {
      products: priced.lines.map((l) => publicProductView(byId.get(l.product_id)!)),
      totalCents: priced.total,
    });
  }
  if (pay === 'card' && priced.total < MIN_PRICE_CENTS) return invalid('pay');

  // Per-shop cap across all IPs, counted only for requests about to insert.
  if (deps.limits && !(await deps.limits.shopOrder(shop.id))) return shopRateLimited();

  const row: NewOrder = {
    shop_id: shop.id,
    customer_name: name,
    customer_phone: phone,
    customer_email: email,
    note: noteText,
    fulfilment: fulfilment as Fulfilment,
    shipping_address: shippingAddress,
    shipping_cents: priced.shipping,
    subtotal_cents: priced.subtotal,
    total_cents: priced.total,
    currency: shop.currency || 'usd',
    status: 'new',
    payment_status: (pay as Pay) === 'shop' ? 'none' : 'awaiting',
    payment_method: pay === 'shop' ? 'shop' : pay === 'card' ? 'card' : manualMethod,
    client_key: clientKey,
  };
  const ins = await deps.repo.createOrder(
    row,
    priced.lines.map(({ product_id, name: n, unit_price_cents, quantity }) => ({ product_id, name: n, unit_price_cents, quantity })),
  );
  if (ins.existing) return repeatResponse(deps, shop, ins.order); // a concurrent first submit won
  let order = ins.order;

  let checkoutUrl: string | undefined;
  if (pay === 'card') {
    try {
      const co = await deps.payments.createOrderCheckout(
        shop,
        order,
        priced.lines.map(({ name: n, unit_price_cents, quantity, photo_url }) => ({ name: n, unit_price_cents, quantity, photo_url })),
      );
      checkoutUrl = co.url;
      try {
        // One update, so a retried submit always finds the session and its URL together.
        const upd = await deps.repo.updateOrder(order.id, { stripe_checkout_session_id: co.sessionId, checkout_url: co.url });
        if (upd.ok) order = upd.row;
      } catch (e: any) {
        console.error(`[store] storing checkout session for order ${order.id} failed:`, e?.message || e);
      }
    } catch (e: any) {
      // No Checkout = no hold. Cancel it (never delete: the order number must not be reused).
      console.error(`[store] createOrderCheckout failed for order ${order.id}:`, e?.message || e);
      try {
        await deps.repo.updateOrder(order.id, expiredHoldPatch(deps.now()), LIVE_HOLD);
      } catch (e2: any) {
        console.error(`[store] cancelling failed card hold ${order.id} failed:`, e2?.message || e2);
      }
      return err(502, 'payment-unavailable');
    }
  }

  // For an awaiting card hold S3b's notifyOrder is a no-op; the webhook confirms on payment.
  await safeNotify(deps, { kind: 'order_created', orderId: order.id });
  return created(deps, order, checkoutUrl);
}

// ---------------------------------------------------------------------------
// GET /api/store/order?token=  (never gated)
// ---------------------------------------------------------------------------
async function byToken(deps: StoreDeps, token: unknown): Promise<{ order: OrderRow; shop: ShopStoreRow } | null> {
  if (!isToken(token)) return null;
  const order = await deps.repo.orderByToken(token);
  if (!order) return null;
  const shop = await deps.repo.shopById(order.shop_id);
  return shop ? { order, shop } : null;
}

export async function getOrder(params: Params, deps: StoreDeps): Promise<FlowResult> {
  const c = await byToken(deps, params.token);
  if (!c) return notFound();
  const items = await deps.repo.orderItems(c.order.id);
  return ok(publicOrderView(c.order, items, c.shop, manualHandles(c.shop) as Record<string, string>));
}

// ---------------------------------------------------------------------------
// POST /api/store/sent  { token, method }
// ---------------------------------------------------------------------------
const SENT_PAYMENT_STATUSES: PaymentStatus[] = ['none', 'awaiting'];
const NOT_CANCELLED: OrderStatus[] = ['new', 'paid', 'ready', 'shipped', 'done'];

const awaitingManual = (o: OrderRow, method: ManualMethod) =>
  o.payment_method === method && SENT_PAYMENT_STATUSES.includes(o.payment_status) && o.status !== 'cancelled';

export async function postOrderSent(body: unknown, deps: StoreDeps): Promise<FlowResult> {
  if (!isObj(body)) return invalid('body');
  const method = body.method as ManualMethod;
  if (!MANUAL_METHODS.includes(method)) return invalid('method');
  const c = await byToken(deps, body.token);
  if (!c) return notFound();
  const { order, shop } = c;
  if (!(await storeOpen(deps.repo, shop))) return storePaused();
  // Only the manual rail fixed at order time, still unpaid and not cancelled. payment_method is
  // never rewritten here.
  if (!awaitingManual(order, method)) return err(409, 'not-awaiting-payment');
  if (order.customer_says_paid_at) return ok({}); // already told the barber; don't push again

  const upd = await deps.repo.updateOrder(
    order.id,
    { customer_says_paid_at: new Date(deps.now()).toISOString() },
    { paymentMethod: method, paymentStatusIn: SENT_PAYMENT_STATUSES, statusIn: NOT_CANCELLED, saysPaidNull: true },
  );
  if (upd.ok === false) {
    const cur = await deps.repo.orderById(order.id);
    return cur && awaitingManual(cur, method) && cur.customer_says_paid_at ? ok({}) : err(409, 'not-awaiting-payment');
  }
  await safeNotify(deps, { kind: 'order_says_paid', orderId: upd.row.id, method });
  return ok({});
}
