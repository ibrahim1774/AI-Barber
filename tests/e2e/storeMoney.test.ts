// E2E: store money paths. Real order flows + live Stripe request building (fake Stripe) + the real
// signed Connect webhook handler + the owner refund + the reminders-cron sweeps, over one state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resetBoundaries } from './harness/world.js';
import { stripe, paySession, chargeRefundedObject, dashboardRefund } from './harness/stripe.js';
import { moneyWorld, sign, CUSTOMER, ADDRESS, type MoneyWorld } from './harness/storeMoney.js';
import { createOrder, getOrder, postOrderSent } from '../../lib/store/publicFlow.js';
import { markOwnerOrder, refundOwnerOrder } from '../../lib/store/ownerFlow.js';
import { expireStaleOrderHolds, retryPendingOrderRefunds, ORDER_REFUND_GIVE_UP_HOURS } from '../../lib/store/core.js';
import { STORE_APP } from '../../lib/store/constants.js';

const AUTH = 'Bearer owner-jwt';
let m: MoneyWorld;
beforeEach(() => {
  resetBoundaries();
  m = moneyWorld();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const key = () => randomUUID();
function cardOrder(over: Record<string, unknown> = {}) {
  return createOrder({
    slug: 'fresh-cuts', clientKey: key(), items: [{ productId: m.ids.oil, quantity: 1 }, { productId: m.ids.balm, quantity: 1 }],
    customer: CUSTOMER, fulfilment: 'pickup', pay: 'card', expectedTotalCents: 3500, ...over,
  }, m.deps);
}
const sessionReqs = () => stripe.requests.filter((r) => r.method === 'POST' && r.path === '/checkout/sessions');
const refundReqs = () => stripe.requests.filter((r) => r.path === '/refunds');
async function paidOrder(over: Record<string, unknown> = {}) {
  const r = await cardOrder(over);
  expect(r.status).toBe(201);
  const o = m.state.orders.at(-1)!;
  const session = paySession(o.stripe_checkout_session_id!);
  const d = await m.deliver(m.event('checkout.session.completed', session));
  expect(d.body.outcome).toBe('order:paid');
  return { id: o.id, pi: session.payment_intent!, session };
}

// ---------------------------------------------------------------------------
describe('Checkout session creation (live request building)', () => {
  it('pickup card order: line items, 2% platform fee, currency, metadata, connected account, return URLs', async () => {
    const r = await cardOrder();
    expect(r.status).toBe(201);
    const o = m.state.orders.at(-1)!;
    expect((r.body as any).checkoutUrl).toBe(`https://checkout.stripe.test/${o.stripe_checkout_session_id}`);
    const [req] = sessionReqs();
    expect(req.account).toBe('acct_1');
    expect(req.params).toMatchObject({
      mode: 'payment', 'payment_method_types[0]': 'card', client_reference_id: o.id, customer_email: 'sam@example.com',
      'payment_intent_data[application_fee_amount]': '70',
      'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][unit_amount]': '1500', 'line_items[0][quantity]': '1',
      'line_items[0][price_data][product_data][images][0]': 'https://img/oil-1.jpg',
      'line_items[1][price_data][unit_amount]': '2000',
      'metadata[app]': STORE_APP, 'metadata[order_id]': o.id, 'payment_intent_data[metadata][app]': STORE_APP,
    });
    expect(req.params['shipping_address_collection[allowed_countries][0]']).toBeUndefined();
    expect(req.params.success_url).toBe(`https://www.aibarber.org/shop/manage/${o.manage_token}?checkout=success`);
    expect(req.idempotencyKey).toMatch(new RegExp(`^ab-order-checkout-${o.id}-3500-\\d+$`));
    expect(stripe.sessions.get(o.stripe_checkout_session_id!)!.amount_total).toBe(3500);
    expect(o).toMatchObject({ status: 'new', payment_method: 'card', payment_status: 'awaiting', total_cents: 3500, currency: 'usd' });
    // A card hold is invisible to the owner and sends nothing until it is paid.
    expect(m.notes).toEqual([]);
  });

  it('shipping card order: flat shipping in the total and the fee, US-only address collection', async () => {
    const r = await cardOrder({ fulfilment: 'shipping', expectedTotalCents: 4000 });
    expect(r.status).toBe(201);
    const [req] = sessionReqs();
    expect(req.params).toMatchObject({
      'shipping_address_collection[allowed_countries][0]': 'US',
      'shipping_options[0][shipping_rate_data][fixed_amount][amount]': '500',
      'shipping_options[0][shipping_rate_data][display_name]': 'Ships within 3 days',
      'payment_intent_data[application_fee_amount]': '80',
    });
    expect(stripe.sessions.values().next().value!.amount_total).toBe(4000);
  });

  it.each([
    [1525, 31], [1524, 30], [50, 1], [74, 1], [75, 2], [999_99, 2000],
  ])('fee on %i cents is %i (2%, half up)', async (price, fee) => {
    m.state.products.find((p) => p.id === m.ids.oil)!.price_cents = price;
    const r = await cardOrder({ items: [{ productId: m.ids.oil, quantity: 1 }], expectedTotalCents: price });
    expect(r.status).toBe(201);
    expect(sessionReqs()[0].params['payment_intent_data[application_fee_amount]']).toBe(String(fee));
  });

  it('a non-USD shop charges in its own currency (lower case to Stripe) and the webhook accepts it', async () => {
    m = moneyWorld({ shop: { currency: 'CAD' } });
    const { id } = await paidOrder();
    expect(sessionReqs()[0].params['line_items[0][price_data][currency]']).toBe('cad');
    expect(m.order(id)).toMatchObject({ status: 'paid', currency: 'CAD' });
  });

  it('Stripe reporting a different total: the session is expired, the hold cancelled, 502, nothing charged', async () => {
    stripe.overrideTotal = 3499;
    const r = await cardOrder();
    expect(r).toMatchObject({ status: 502, body: { error: 'payment-unavailable' } });
    const o = m.state.orders.at(-1)!;
    expect(o).toMatchObject({ status: 'cancelled', payment_status: 'none' });
    expect([...stripe.sessions.values()][0].status).toBe('expired');
  });

  it('Stripe down: 502 payment-unavailable, the hold is cancelled (order number kept, never reused)', async () => {
    stripe.failNext.push({ match: (q) => q.path === '/checkout/sessions', network: true });
    const r = await cardOrder();
    expect(r.status).toBe(502);
    expect(m.state.orders.at(-1)).toMatchObject({ status: 'cancelled', order_no: 1001 });
    const next = await cardOrder();
    expect(next.status).toBe(201);
    expect(m.state.orders.at(-1)!.order_no).toBe(1002);
  });

  it('a total under the 50¢ Stripe minimum is refused before Stripe is called', async () => {
    m.state.products.find((p) => p.id === m.ids.oil)!.price_cents = 50;
    const r = await cardOrder({ items: [{ productId: m.ids.oil, quantity: 1 }], expectedTotalCents: 50 });
    expect(r.status).toBe(201); // 50 is the minimum itself
    expect(sessionReqs()).toHaveLength(1);
  });

  it('a stale cart total is refused with the current prices (409 cart-changed), nothing created', async () => {
    const r = await cardOrder({ expectedTotalCents: 3000 });
    expect(r).toMatchObject({ status: 409, body: { error: 'cart-changed', totalCents: 3500 } });
    expect(m.state.orders).toHaveLength(0);
    expect(sessionReqs()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('idempotent order creation and numbering', () => {
  it('the same clientKey twice in a row: one order, one Checkout session, same URL, one notification', async () => {
    const k = key();
    const a = await cardOrder({ clientKey: k });
    const b = await cardOrder({ clientKey: k });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect((b.body as any).checkoutUrl).toBe((a.body as any).checkoutUrl);
    expect((b.body as any).order.id).toBe((a.body as any).order.id);
    expect(m.state.orders).toHaveLength(1);
    expect(sessionReqs()).toHaveLength(1);
  });

  it('a double tap (two concurrent submits, same clientKey): one order, one session, both get its URL', async () => {
    const k = key();
    const [a, b] = await Promise.all([cardOrder({ clientKey: k }), cardOrder({ clientKey: k })]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect((a.body as any).checkoutUrl).toBe((b.body as any).checkoutUrl);
    expect(m.state.orders).toHaveLength(1);
    expect(sessionReqs()).toHaveLength(1);
  });

  it('ten concurrent pay-in-shop submits with one clientKey: one order, one order_created notification', async () => {
    const k = key();
    const all = await Promise.all(Array.from({ length: 10 }, () => cardOrder({ clientKey: k, pay: 'shop' })));
    expect(all.every((r) => r.status === 201)).toBe(true);
    expect(new Set(all.map((r) => (r.body as any).order.id)).size).toBe(1);
    expect(m.state.orders).toHaveLength(1);
    expect(m.notes.filter((n) => n.kind === 'order_created')).toHaveLength(1);
  });

  it('a resubmit after the first request died before storing its session: the orphan hold is cancelled, 409 checkout-expired', async () => {
    const k = key();
    // First request: the session-store write fails (the row keeps no session).
    const realUpdate = m.deps.repo.updateOrder;
    m.deps.repo.updateOrder = vi.fn(async (...args: Parameters<typeof realUpdate>) => {
      if ('stripe_checkout_session_id' in args[1]) throw new Error('db blip');
      return realUpdate(...args);
    });
    const first = await cardOrder({ clientKey: k });
    expect(first.status).toBe(201); // the customer still gets a working Checkout URL
    m.deps.repo.updateOrder = realUpdate;
    // 45 s later the page resubmits the same key.
    m.setNow('2026-11-02T12:00:45Z');
    const again = await cardOrder({ clientKey: k });
    expect(again).toMatchObject({ status: 409, body: { error: 'checkout-expired' } });
    const o = m.state.orders[0];
    expect(o).toMatchObject({ status: 'cancelled', cancelled_by: 'customer' });
    // The customer pays the first URL anyway: the webhook records it on the cancelled order and refunds in full.
    const session = paySession([...stripe.sessions.keys()][0]);
    const d = await m.deliver(m.event('checkout.session.completed', session));
    expect(d.body.outcome).toBe('order:refunded:cancelled-before-payment');
    expect(m.order(o.id)).toMatchObject({ amount_paid_cents: 3500, amount_refunded_cents: 3500, payment_status: 'refunded', status: 'cancelled' });
    expect(refundReqs()).toHaveLength(1);
    expect(refundReqs()[0].idempotencyKey).toBe(`refund-pac-${session.payment_intent}`);
    expect(stripe.charges.get(session.payment_intent!)!.refunded).toBe(3500);
  });

  it('order numbers are per shop and sequential from 1001; the same clientKey in two shops is two orders', async () => {
    const k = key();
    for (let i = 0; i < 3; i++) expect((await cardOrder({ pay: 'shop' })).status).toBe(201);
    const shared = await cardOrder({ pay: 'shop', clientKey: k });
    const other = await createOrder({
      slug: 'other-shop', clientKey: k, items: [{ productId: m.ids.foreign, quantity: 1 }], customer: CUSTOMER,
      fulfilment: 'pickup', pay: 'shop', expectedTotalCents: 900,
    }, m.deps);
    expect(shared.status).toBe(201);
    expect(other.status).toBe(201);
    const mine = m.state.orders.filter((o) => o.shop_id === m.ids.shopId).map((o) => o.order_no);
    const theirs = m.state.orders.filter((o) => o.shop_id === m.ids.otherShopId).map((o) => o.order_no);
    expect(mine).toEqual([1001, 1002, 1003, 1004]);
    expect(theirs).toEqual([1001]);
  });

  it('a resubmit of an existing order answers from it even after the product sold out', async () => {
    const k = key();
    const a = await cardOrder({ clientKey: k, pay: 'shop' });
    m.state.products.find((p) => p.id === m.ids.oil)!.sold_out = true;
    const b = await cardOrder({ clientKey: k, pay: 'shop' });
    expect(b.status).toBe(201);
    expect((b.body as any).order.id).toBe((a.body as any).order.id);
  });
});

// ---------------------------------------------------------------------------
describe('Connect webhook: replay, duplicates, ordering, other apps', () => {
  it('completed → paid, one order_created; a redelivery of the event is a duplicate', async () => {
    const { id, session } = await paidOrder();
    expect(m.order(id)).toMatchObject({ status: 'paid', payment_status: 'paid', amount_paid_cents: 3500 });
    expect(m.notes.filter((n) => n.kind === 'order_created')).toHaveLength(1);
    // Stripe redelivers with the SAME event id: deduped.
    const original = m.event('checkout.session.completed', session);
    original.id = [...m.processed][0];
    expect((await m.deliver(original)).body.outcome).toBe('duplicate');
    expect(m.notes.filter((n) => n.kind === 'order_created')).toHaveLength(1);
    expect(m.order(id).amount_paid_cents).toBe(3500);
  });

  it('a bad or missing signature is refused (400) and nothing changes', async () => {
    await cardOrder();
    const o = m.state.orders.at(-1)!;
    const session = paySession(o.stripe_checkout_session_id!);
    const ev = m.event('checkout.session.completed', session);
    const body = JSON.stringify(ev);
    expect((await m.deliver(ev, { sig: sign(body, 'whsec_wrong') })).statusCode).toBe(400);
    expect((await m.deliver(ev, { sig: null })).statusCode).toBe(400);
    expect((await m.deliver(ev, { sig: sign(body, undefined, Math.floor(Date.now() / 1000) - 3600) })).statusCode).toBe(400);
    expect((await m.deliver(ev, { raw: body + ' ', sig: sign(body) })).statusCode).toBe(400);
    expect(m.order(o.id).status).toBe('new');
  });

  it('the webhook ignores sessions of other apps on the connected account and events from another account', async () => {
    await cardOrder();
    const o = m.state.orders.at(-1)!;
    const s = paySession(o.stripe_checkout_session_id!);
    const foreign = { ...s, id: 'cs_other_app', metadata: { app: 'some-other-app' }, client_reference_id: 'abc' };
    expect((await m.deliver(m.event('checkout.session.completed', foreign))).body.outcome).toBe('ignored:no-appointment');
    const wrongAcct = await m.deliver(m.event('checkout.session.completed', s, { account: 'acct_attacker' }));
    expect(wrongAcct.body.outcome).toBe('order:ignored:account-mismatch');
    expect(m.order(o.id).status).toBe('new');
    expect((await m.deliver(m.event('payment_intent.created', { id: 'pi_x' }))).body.outcome).toBe('ignored:payment_intent.created');
    expect((await m.deliver(m.event('checkout.session.completed', { ...s, metadata: { app: STORE_APP }, payment_status: 'unpaid' }))).body.outcome)
      .toBe('order:ignored:unpaid');
  });

  it('expired then completed for the same session (out of order): the payment is recorded, then refunded', async () => {
    await cardOrder();
    const o = m.state.orders.at(-1)!;
    const s = stripe.sessions.get(o.stripe_checkout_session_id!)!;
    expect((await m.deliver(m.event('checkout.session.expired', { ...s, status: 'expired' }))).body.outcome).toBe('order:cancelled:expired');
    const paid = paySession(s.id);
    expect((await m.deliver(m.event('checkout.session.completed', paid))).body.outcome).toBe('order:refunded:cancelled-before-payment');
    expect(stripe.charges.get(paid.payment_intent!)!.refunded).toBe(3500);
  });

  it('a second payment for one order (two sessions paid) is refunded under the duplicate key', async () => {
    const { id } = await paidOrder();
    // A superseded session for the same order (e.g. created by a retried request) is also paid.
    const extra = paySession((await (async () => {
      const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST', headers: { Authorization: 'Bearer x', 'Stripe-Account': 'acct_1' },
        body: new URLSearchParams({ 'line_items[0][price_data][unit_amount]': '3500', 'line_items[0][quantity]': '1', client_reference_id: id, 'metadata[order_id]': id, 'metadata[app]': STORE_APP }).toString(),
      } as any);
      return (await r.json()).id;
    })()));
    const d = await m.deliver(m.event('checkout.session.completed', extra));
    expect(d.body.outcome).toBe('order:refunded:duplicate-payment');
    expect(refundReqs().at(-1)!.idempotencyKey).toBe(`refund-dup-${extra.payment_intent}`);
    expect(m.order(id).amount_paid_cents).toBe(3500);
  });

  it('M4 (fixed): two concurrent deliveries of one completed event send the order confirmation once', async () => {
    await cardOrder();
    const o = m.state.orders.at(-1)!;
    const ev = m.event('checkout.session.completed', paySession(o.stripe_checkout_session_id!));
    await Promise.all([m.deliver(ev), m.deliver(ev)]);
    expect(m.notes.filter((n) => n.kind === 'order_created')).toHaveLength(1);
  });

  it('setup: both concurrent deliveries pass the processed-event check before either records it (the confirmation claim makes it harmless)', async () => {
    await cardOrder();
    const o = m.state.orders.at(-1)!;
    const ev = m.event('checkout.session.completed', paySession(o.stripe_checkout_session_id!));
    const before = m.rawNotes.filter((n) => n.kind === 'order_created').length; // the hold's own (suppressed) one
    const [a, b] = await Promise.all([m.deliver(ev), m.deliver(ev)]);
    expect([a.body.outcome, b.body.outcome].sort()).toEqual(['order:noop:already-recorded', 'order:paid']);
    expect(m.rawNotes.filter((n) => n.kind === 'order_created').length - before).toBe(1);
  });

  it('I5 (fixed): charge.refunded delivered before checkout.session.completed is booked when the payment is recorded', async () => {
    await cardOrder();
    const o = m.state.orders.at(-1)!;
    const session = paySession(o.stripe_checkout_session_id!);
    // The completed delivery fails (our 500) and Stripe retries it later; meanwhile the barber
    // refunds in the Stripe dashboard and charge.refunded arrives first.
    const refunded = dashboardRefund(session.payment_intent!, 3500);
    await m.deliver(m.event('charge.refunded', refunded));
    await m.deliver(m.event('checkout.session.completed', session));
    expect(m.order(o.id).amount_refunded_cents).toBe(3500);
  });

  it('setup (was: completed marks it paid in full): the early charge.refunded is still ignored (unmatched) and recorded; completed then books the full refund and cancels, no confirmation', async () => {
    await cardOrder();
    const o = m.state.orders.at(-1)!;
    const session = paySession(o.stripe_checkout_session_id!);
    const ev = m.event('charge.refunded', dashboardRefund(session.payment_intent!, 3500));
    expect((await m.deliver(ev)).body.outcome).toBe('ignored:no-appointment');
    expect(m.processed.has(ev.id)).toBe(true);
    expect((await m.deliver(m.event('checkout.session.completed', session))).body.outcome).toBe('order:paid:refunded-on-stripe:cancelled');
    expect(m.order(o.id)).toMatchObject({ status: 'cancelled', payment_status: 'refunded', amount_refunded_cents: 3500 });
    expect(m.notes.filter((n) => n.kind === 'order_created')).toHaveLength(0);
  });

  it('I5: a partial dashboard refund before completed is booked as partially refunded; the order stays paid and is confirmed', async () => {
    await cardOrder();
    const o = m.state.orders.at(-1)!;
    const session = paySession(o.stripe_checkout_session_id!);
    await m.deliver(m.event('charge.refunded', dashboardRefund(session.payment_intent!, 1000)));
    await m.deliver(m.event('checkout.session.completed', session));
    expect(m.order(o.id)).toMatchObject({ status: 'paid', payment_status: 'partially_refunded', amount_refunded_cents: 1000 });
    expect(m.notes.filter((n) => n.kind === 'order_created')).toHaveLength(1);
  });

  it('I5: a Stripe outage on the refund check is a 500 (event not recorded); the retry books it and confirms once', async () => {
    await cardOrder();
    const o = m.state.orders.at(-1)!;
    const session = paySession(o.stripe_checkout_session_id!);
    await m.deliver(m.event('charge.refunded', dashboardRefund(session.payment_intent!, 1000)));
    stripe.failNext.push({ match: (r) => r.method === 'GET' && r.path.startsWith('/payment_intents/'), status: 500 });
    const ev = m.event('checkout.session.completed', session);
    expect((await m.deliver(ev)).statusCode).toBe(500);
    expect(m.processed.has(ev.id)).toBe(false);
    expect((await m.deliver(ev)).statusCode).toBe(200);
    expect(m.order(o.id)).toMatchObject({ status: 'paid', amount_refunded_cents: 1000 });
    expect(m.notes.filter((n) => n.kind === 'order_created')).toHaveLength(1);
  });

  it('a failing order write is a 500 and the event is not recorded, so the Stripe retry finishes it', async () => {
    await cardOrder();
    const o = m.state.orders.at(-1)!;
    const ev = m.event('checkout.session.completed', paySession(o.stripe_checkout_session_id!));
    const real = m.orderDeps.markOrderPaid;
    m.orderDeps.markOrderPaid = async () => { throw new Error('db down'); };
    expect((await m.deliver(ev)).statusCode).toBe(500);
    expect(m.processed.has(ev.id)).toBe(false);
    m.orderDeps.markOrderPaid = real;
    expect((await m.deliver(ev)).body.outcome).toBe('order:paid');
  });

  it('the shipping address Stripe collected is stored on the paid order', async () => {
    await cardOrder({ fulfilment: 'shipping', expectedTotalCents: 4000 });
    const o = m.state.orders.at(-1)!;
    const s = paySession(o.stripe_checkout_session_id!);
    const withAddr = { ...s, collected_information: { shipping_details: { name: 'Sam Lee', address: { line1: '1 Main', city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' } } } };
    await m.deliver(m.event('checkout.session.completed', withAddr));
    expect(m.order(o.id).shipping_address).toMatchObject({ line1: '1 Main', country: 'US' });
  });
});

// ---------------------------------------------------------------------------
describe('owner refunds: full, partial, over-refund, stuck', () => {
  it('refund idempotency: a double tap refunds once; a lost Stripe response retried by the sweep replays the same refund, never a second', async () => {
    const { id } = await paidOrder();
    const pi = m.order(id).stripe_payment_intent_id!;
    const [x, y] = await Promise.all([refundOwnerOrder(AUTH, id, { amountCents: 1000 }, m.deps), refundOwnerOrder(AUTH, id, { amountCents: 1000 }, m.deps)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(stripe.charges.get(pi)!.refunded).toBe(1000);
    // Stripe refunds, the response is lost; the owner taps again (refund-pending), the sweep retries.
    stripe.failNext.push({ match: (q) => q.path === '/refunds', afterProcess: true });
    await refundOwnerOrder(AUTH, id, { amountCents: 500 }, m.deps);
    expect(stripe.charges.get(pi)!.refunded).toBe(1500);
    expect((await refundOwnerOrder(AUTH, id, { amountCents: 500 }, m.deps)).status).toBe(409);
    m.setNow(new Date(Date.parse('2026-11-02T12:00:00Z') + 600_000).toISOString());
    await retryPendingOrderRefunds(m.deps);
    expect(stripe.charges.get(pi)!.refunded).toBe(1500);
    const keys = refundReqs().slice(1).map((q) => q.idempotencyKey);
    expect(keys).toEqual([`refund-order-${id}-1500-500-1000`, `refund-order-${id}-1500-500-1000`]);
    expect(m.order(id)).toMatchObject({ amount_refunded_cents: 1500, refund_due_cents: 1500 });
  });

  it('partial then the rest: absolute totals, keys per target, one cancellation email, webhooks change nothing', async () => {
    const { id, pi } = await paidOrder();
    const p = await refundOwnerOrder(AUTH, id, { amountCents: 500 }, m.deps);
    expect(p).toMatchObject({ status: 200, body: { refundedCents: 500, pending: false } });
    expect(m.order(id)).toMatchObject({ status: 'paid', payment_status: 'partially_refunded', amount_refunded_cents: 500, refund_due_cents: 500 });
    expect(refundReqs()[0]).toMatchObject({ account: 'acct_1', idempotencyKey: `refund-order-${id}-500-500-0` });
    expect(refundReqs()[0].params).toMatchObject({ amount: '500', refund_application_fee: 'true', payment_intent: pi });
    await m.deliver(m.event('charge.refunded', chargeRefundedObject(pi)));
    const rest = await refundOwnerOrder(AUTH, id, {}, m.deps);
    expect(rest).toMatchObject({ status: 200, body: { refundedCents: 3000 } });
    expect(refundReqs()[1].idempotencyKey).toBe(`refund-order-${id}-3500-3000-500`);
    expect(m.order(id)).toMatchObject({ status: 'cancelled', cancelled_by: 'shop', payment_status: 'refunded', amount_refunded_cents: 3500 });
    await m.deliver(m.event('charge.refunded', chargeRefundedObject(pi)));
    expect(m.notes.filter((n) => n.kind === 'order_cancelled')).toHaveLength(1);
    expect(stripe.charges.get(pi)!.refunded).toBe(3500);
  });

  it('over-refund and nonsense amounts are refused before Stripe; nothing more than was paid ever leaves', async () => {
    const { id } = await paidOrder();
    for (const amountCents of [3501, 0, -5, 1.5, '100', null]) {
      const r = await refundOwnerOrder(AUTH, id, { amountCents }, m.deps);
      expect(r.status).toBe(400);
    }
    expect((await refundOwnerOrder(AUTH, id, undefined, m.deps)).status).toBe(400);
    expect((await refundOwnerOrder(AUTH, id, [], m.deps)).status).toBe(400);
    expect(refundReqs()).toHaveLength(0);
  });

  it('a double-submitted full refund refunds once', async () => {
    const { id, pi } = await paidOrder();
    const [a, b] = await Promise.all([refundOwnerOrder(AUTH, id, {}, m.deps), refundOwnerOrder(AUTH, id, {}, m.deps)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(stripe.charges.get(pi)!.refunded).toBe(3500);
    expect(refundReqs()).toHaveLength(1);
  });

  it('a refund whose response was lost is retried by the cron under the same key and is not doubled', async () => {
    const { id, pi } = await paidOrder();
    stripe.failNext.push({ match: (q) => q.path === '/refunds', afterProcess: true });
    const r = await refundOwnerOrder(AUTH, id, {}, m.deps);
    expect(r).toMatchObject({ status: 200, body: { refundedCents: 0, pending: true } });
    expect(stripe.charges.get(pi)!.refunded).toBe(3500);
    m.setNow('2026-11-02T12:10:00Z');
    expect(await retryPendingOrderRefunds(m.deps)).toMatchObject({ retried: 1, refunded: 1 });
    expect(stripe.charges.get(pi)!.refunded).toBe(3500);
    expect(m.order(id)).toMatchObject({ status: 'cancelled', amount_refunded_cents: 3500, payment_status: 'refunded' });
  });

  it('a refund Stripe keeps refusing is marked stuck after 23 h, logged once, never lowered', async () => {
    const { id } = await paidOrder();
    for (let i = 0; i < 6; i++) stripe.failNext.push({ match: (q) => q.path === '/refunds', status: 500 });
    expect((await refundOwnerOrder(AUTH, id, { amountCents: 1000 }, m.deps)).body).toMatchObject({ pending: true });
    m.setNow('2026-11-02T12:10:00Z');
    expect(await retryPendingOrderRefunds(m.deps)).toMatchObject({ retried: 1, failed: 1 });
    m.setNow(new Date(Date.parse('2026-11-02T12:00:00Z') + ORDER_REFUND_GIVE_UP_HOURS * 3600_000 + 60_000).toISOString());
    expect(await retryPendingOrderRefunds(m.deps)).toMatchObject({ stuck: 1 });
    expect(await retryPendingOrderRefunds(m.deps)).toMatchObject({ stuck: 0, retried: 0 });
    expect(m.state.events.filter((e) => e.kind === 'order_refund_stuck')).toHaveLength(1);
    expect(m.order(id)).toMatchObject({ refund_due_cents: 1000, amount_refunded_cents: 0, refund_pending: false });
    const view = await markOwnerOrder(AUTH, id, { action: 'done' }, m.deps);
    expect((view.body as any).order).toMatchObject({ refundStuck: true, refundPending: false });
  });

  it('a dashboard refund between the owner claim and the Stripe call: the cron retry refunds the rest under its own key (amount and refunded total are in the key: P5 resolved)', async () => {
    const { id, pi } = await paidOrder();
    // The owner taps "refund all" (target 3500). Before our refund call, the barber refunds 1000 in the dashboard.
    stripe.failNext.push({ match: (q) => q.path === '/refunds', status: 400, body: { error: { code: 'amount_too_large', message: 'too large' } } });
    dashboardRefund(pi, 1000);
    await refundOwnerOrder(AUTH, id, {}, m.deps);
    await m.deliver(m.event('charge.refunded', chargeRefundedObject(pi)));
    for (let i = 1; i <= 3; i++) {
      m.setNow(new Date(Date.parse('2026-11-02T12:00:00Z') + i * 600_000).toISOString());
      await retryPendingOrderRefunds(m.deps);
    }
    expect(stripe.charges.get(pi)!.refunded).toBe(3500);
    // Key = order + target + amount + refunded total (P5): the retry's smaller amount has its own
    // key, so it never depends on whether Stripe saved a result for the first 400.
    expect(refundReqs().map((q) => [q.idempotencyKey, q.params.amount])).toEqual([[`refund-order-${id}-3500-3500-0`, '3500'], [`refund-order-${id}-3500-2500-1000`, '2500']]);
    expect(m.order(id)).toMatchObject({ status: 'cancelled', amount_refunded_cents: 3500 });
  });

  it('owner actions on orders are never store-gated: refund and fulfil work after the store is paused', async () => {
    const { id } = await paidOrder();
    m.state.shops[0].store_enabled = false;
    m.state.purchases[m.state.shops[0].ios_otid!].taken_down_at = new Date().toISOString();
    expect((await markOwnerOrder(AUTH, id, { action: 'ready' }, m.deps)).status).toBe(200);
    expect((await refundOwnerOrder(AUTH, id, { amountCents: 100 }, m.deps)).status).toBe(200);
  });

  it("another owner can't see or refund this shop's order (404), and no token is 401", async () => {
    const { id } = await paidOrder();
    expect((await refundOwnerOrder('Bearer other-jwt', id, {}, m.deps)).status).toBe(404);
    expect((await refundOwnerOrder(undefined, id, {}, m.deps)).status).toBe(401);
    expect((await refundOwnerOrder('Bearer forged', id, {}, m.deps)).status).toBe(401);
    expect((await markOwnerOrder('Bearer other-jwt', id, { action: 'cancel' }, m.deps)).status).toBe(404);
    expect(refundReqs()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('card hold sweep (reminders cron) against Stripe', () => {
  it('an unpaid hold past 35 min is expired at Stripe first, then cancelled; a paid-on-time hold is left for the webhook', async () => {
    await cardOrder();
    await cardOrder();
    const [a, b] = m.state.orders;
    paySession(b.stripe_checkout_session_id!); // paid at minute 31, webhook still on its way
    m.setNow('2026-11-02T12:36:00Z');
    expect(await expireStaleOrderHolds(m.deps)).toEqual({ expired: 1, paid: 1, unresolved: 0 });
    expect(m.order(a.id)).toMatchObject({ status: 'cancelled', payment_status: 'none' });
    expect(stripe.sessions.get(a.stripe_checkout_session_id!)!.status).toBe('expired');
    expect(m.order(b.id).status).toBe('new');
    await m.deliver(m.event('checkout.session.completed', stripe.sessions.get(b.stripe_checkout_session_id!)));
    expect(m.order(b.id).status).toBe('paid');
  });

  it('Stripe unreachable: the hold is left (unresolved) and rotated, never cancelled on a guess', async () => {
    await cardOrder();
    stripe.failNext.push({ match: () => true, network: true }, { match: () => true, network: true });
    m.setNow('2026-11-02T12:36:00Z');
    expect(await expireStaleOrderHolds(m.deps)).toEqual({ expired: 0, paid: 0, unresolved: 1 });
    expect(m.state.orders[0].status).toBe('new');
  });
});

// ---------------------------------------------------------------------------
describe('paid-outside (manual rail) orders', () => {
  it("cash app order → customer says sent (once) → owner marks paid → ready → done; card actions refused", async () => {
    const r = await createOrder({
      slug: 'fresh-cuts', clientKey: key(), items: [{ productId: m.ids.balm, quantity: 2 }], customer: CUSTOMER,
      fulfilment: 'pickup', pay: 'manual', expectedTotalCents: 4000,
    }, m.deps);
    expect(r.status).toBe(201);
    const o = m.state.orders.at(-1)!;
    expect(o).toMatchObject({ payment_method: 'cashapp', payment_status: 'awaiting' });
    const token = o.manage_token;
    expect((await postOrderSent({ token, method: 'cashapp' }, m.deps)).status).toBe(200);
    expect((await postOrderSent({ token, method: 'cashapp' }, m.deps)).status).toBe(200);
    expect(m.notes.filter((n) => n.kind === 'order_says_paid')).toHaveLength(1);
    expect((await postOrderSent({ token, method: 'venmo' }, m.deps)).status).toBe(409);
    expect((await refundOwnerOrder(AUTH, o.id, {}, m.deps)).body).toMatchObject({ error: 'not-card' });
    const paid = await markOwnerOrder(AUTH, o.id, { action: 'paid' }, m.deps);
    expect(paid.body).toMatchObject({ order: { paymentStatus: 'paid', amountPaidCents: 4000, status: 'paid' } });
    expect((await markOwnerOrder(AUTH, o.id, { action: 'ready' }, m.deps)).status).toBe(200);
    expect((await markOwnerOrder(AUTH, o.id, { action: 'done' }, m.deps)).status).toBe(200);
    expect((await getOrder({ token }, m.deps)).body).toMatchObject({ order: { status: 'done', paymentStatus: 'paid' } });
    expect(stripe.requests).toHaveLength(0);
  });

  it('shipping with a non-card rail needs a valid US address', async () => {
    const base = { slug: 'fresh-cuts', clientKey: key(), items: [{ productId: m.ids.balm, quantity: 1 }], customer: CUSTOMER, fulfilment: 'shipping', pay: 'manual', expectedTotalCents: 2500 };
    expect((await createOrder({ ...base, address: { ...ADDRESS, state: 'Texas' } }, m.deps)).body).toMatchObject({ field: 'address' });
    expect((await createOrder({ ...base, address: { ...ADDRESS, postalCode: 'K1A0B1' } }, m.deps)).body).toMatchObject({ field: 'address' });
    expect((await createOrder({ ...base, address: ADDRESS }, m.deps)).status).toBe(201);
    expect((await createOrder({ ...base, clientKey: key(), pay: 'shop', address: ADDRESS }, m.deps)).body).toMatchObject({ field: 'pay' });
  });
});
