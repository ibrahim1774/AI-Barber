import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createOrder, getOrder, getStoreShop, postOrderSent } from '../../lib/store/publicFlow.js';
import { storeWorld, type StoreWorld } from './fakeRepo.js';

const ADDRESS = { name: 'Sam Lee', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701' };

function body(w: StoreWorld, over: Record<string, unknown> = {}) {
  return {
    slug: 'fresh-cuts',
    clientKey: randomUUID(),
    items: [{ productId: w.ids.oil, quantity: 2 }],
    customer: { name: 'Sam Lee', phone: '(555) 123-4567', email: 'sam@example.com' },
    fulfilment: 'pickup',
    pay: 'manual',
    expectedTotalCents: 3000,
    ...over,
  };
}

const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

describe('getStoreShop', () => {
  it('lists active products only, sold out included and flagged, in sort order', async () => {
    const w = storeWorld();
    const r = await getStoreShop({ slug: 'fresh-cuts' }, w.deps);
    expect(r.status).toBe(200);
    const b = r.body as any;
    expect(b.paused).toBe(false);
    expect(b.shop).toEqual({
      slug: 'fresh-cuts', name: 'Fresh Cuts', address: '1 Main St', phone: '555-0100', accent: '#112233',
      pickup: { enabled: true, note: 'Ring the bell' },
      shipping: { enabled: true, flatCents: 500, shipsWithinDays: 3 },
      pay: { inShop: true, card: true, manual: { cashapp: '$freshcuts' } },
    });
    expect(b.products.map((p: any) => p.name)).toEqual(['Beard oil', 'Balm', 'Pomade']);
    expect(b.products[0]).toEqual({
      id: w.ids.oil, name: 'Beard oil', priceCents: 1500, description: null,
      photos: ['https://img/oil-1.jpg', 'https://img/oil-2.jpg'], soldOut: false,
    });
    expect(b.products[2].soldOut).toBe(true);
  });

  it('sort order wins over insertion order', async () => {
    const w = storeWorld();
    w.state.products.find((p) => p.id === w.ids.oil)!.sort = 9;
    const b = (await getStoreShop({ slug: 'fresh-cuts' }, w.deps)).body as any;
    expect(b.products.map((p: any) => p.name)).toEqual(['Balm', 'Pomade', 'Beard oil']);
  });

  it('shipping.enabled is false when the flat rate is null', async () => {
    const w = storeWorld({ shop: { shipping_flat_cents: null } });
    const b = (await getStoreShop({ slug: 'fresh-cuts' }, w.deps)).body as any;
    expect(b.shop.shipping).toEqual({ enabled: false, flatCents: 0, shipsWithinDays: 3 });
  });

  it('paused shape when the gate is closed', async () => {
    const w = storeWorld({ shop: { store_enabled: false } });
    expect(await getStoreShop({ slug: 'fresh-cuts' }, w.deps)).toEqual({ status: 200, body: { paused: true, shop: { name: 'Fresh Cuts' } } });
  });

  it('404 for an unknown or malformed slug', async () => {
    const w = storeWorld();
    expect((await getStoreShop({ slug: 'nope' }, w.deps)).status).toBe(404);
    expect((await getStoreShop({ slug: 'Bad Slug' }, w.deps))).toEqual({ status: 404, body: { error: 'not-found' } });
    expect((await getStoreShop({}, w.deps)).status).toBe(404);
  });
});

describe('createOrder: validation', () => {
  const cases: [string, (w: StoreWorld) => Record<string, unknown>, string][] = [
    ['slug', (w) => body(w, { slug: 'Bad Slug' }), 'slug'],
    ['clientKey missing', (w) => body(w, { clientKey: undefined }), 'clientKey'],
    ['clientKey too short', (w) => body(w, { clientKey: 'abc' }), 'clientKey'],
    ['clientKey bad chars', (w) => body(w, { clientKey: 'a b c d e f g h i j k l' }), 'clientKey'],
    ['items empty', (w) => body(w, { items: [] }), 'items'],
    ['items qty 11', (w) => body(w, { items: [{ productId: w.ids.oil, quantity: 11 }] }), 'items'],
    ['customer missing', (w) => body(w, { customer: undefined }), 'customer'],
    ['customer name', (w) => body(w, { customer: { name: ' ', phone: '5551234567', email: 'a@b.co' } }), 'customer.name'],
    ['customer phone', (w) => body(w, { customer: { name: 'Sam', phone: '12', email: 'a@b.co' } }), 'customer.phone'],
    ['customer email', (w) => body(w, { customer: { name: 'Sam', phone: '5551234567', email: 'nope' } }), 'customer.email'],
    ['note too long', (w) => body(w, { note: 'x'.repeat(501) }), 'note'],
    ['fulfilment unknown', (w) => body(w, { fulfilment: 'drone' }), 'fulfilment'],
    ['pay unknown', (w) => body(w, { pay: 'cash' }), 'pay'],
    ['method on a non-manual pay', (w) => body(w, { pay: 'shop', method: 'cashapp' }), 'method'],
    ['method unknown', (w) => body(w, { method: 'bitcoin' }), 'method'],
    ['expectedTotalCents missing', (w) => body(w, { expectedTotalCents: undefined }), 'expectedTotalCents'],
    ['expectedTotalCents not an integer', (w) => body(w, { expectedTotalCents: 30.5 }), 'expectedTotalCents'],
    ['pay shop with shipping', (w) => body(w, { pay: 'shop', fulfilment: 'shipping', address: ADDRESS, expectedTotalCents: 3500 }), 'pay'],
    ['address missing for shipping + manual', (w) => body(w, { fulfilment: 'shipping', expectedTotalCents: 3500 }), 'address'],
    ['address invalid for shipping + manual', (w) => body(w, { fulfilment: 'shipping', address: { ...ADDRESS, state: 'TEX' }, expectedTotalCents: 3500 }), 'address'],
    ['method not offered by the shop', (w) => body(w, { method: 'venmo' }), 'method'],
  ];
  for (const [name, mk, field] of cases) {
    it(`400 invalid ${field}: ${name}`, async () => {
      const w = storeWorld();
      expect(await createOrder(mk(w), w.deps)).toEqual({ status: 400, body: { error: 'invalid', field } });
      expect(w.state.orders).toHaveLength(0);
    });
  }

  it('400 invalid body for a non-object', async () => {
    const w = storeWorld();
    expect(await createOrder(undefined, w.deps)).toEqual({ status: 400, body: { error: 'invalid', field: 'body' } });
  });

  it('400 fulfilment when the shop has it off (shipping without a flat rate, pickup off)', async () => {
    let w = storeWorld({ shop: { shipping_flat_cents: null } });
    expect(await createOrder(body(w, { fulfilment: 'shipping', address: ADDRESS, expectedTotalCents: 3000 }), w.deps))
      .toEqual({ status: 400, body: { error: 'invalid', field: 'fulfilment' } });
    w = storeWorld({ shop: { store_shipping: false } });
    expect((await createOrder(body(w, { fulfilment: 'shipping', address: ADDRESS, expectedTotalCents: 3500 }), w.deps)).body)
      .toEqual({ error: 'invalid', field: 'fulfilment' });
    w = storeWorld({ shop: { store_pickup: false } });
    expect((await createOrder(body(w), w.deps)).body).toEqual({ error: 'invalid', field: 'fulfilment' });
  });

  it('400 pay when the rail is not offered', async () => {
    let w = storeWorld({ shop: { manual_handles: {} } });
    expect((await createOrder(body(w), w.deps)).body).toEqual({ error: 'invalid', field: 'pay' });
    w = storeWorld({ shop: { stripe_charges_enabled: false } });
    expect((await createOrder(body(w, { pay: 'card' }), w.deps)).body).toEqual({ error: 'invalid', field: 'pay' });
    w = storeWorld({ shop: { pay_in_shop: false } });
    expect((await createOrder(body(w, { pay: 'shop' }), w.deps)).body).toEqual({ error: 'invalid', field: 'pay' });
  });

  it('card: a 50 cent cart is accepted (Stripe minimum); a lower total is refused by the 50 cent product floor', async () => {
    const w = storeWorld();
    w.state.products.find((p) => p.id === w.ids.balm)!.price_cents = 50;
    const ok = await createOrder(body(w, { pay: 'card', items: [{ productId: w.ids.balm, quantity: 1 }], expectedTotalCents: 50 }), w.deps);
    expect(ok.status).toBe(201);
    w.state.products.find((p) => p.id === w.ids.balm)!.price_cents = 49;
    expect(await createOrder(body(w, { pay: 'card', items: [{ productId: w.ids.balm, quantity: 1 }], expectedTotalCents: 49 }), w.deps))
      .toEqual({ status: 400, body: { error: 'invalid', field: 'items' } });
  });

  it('400 items for an inactive, foreign or under-50-cent product', async () => {
    const w = storeWorld();
    for (const id of [w.ids.comb, w.ids.foreign]) {
      expect((await createOrder(body(w, { items: [{ productId: id, quantity: 1 }] }), w.deps)).body).toEqual({ error: 'invalid', field: 'items' });
    }
    w.state.products.find((p) => p.id === w.ids.balm)!.price_cents = 49; // a legacy row from before 009's check
    expect((await createOrder(body(w, { items: [{ productId: w.ids.balm, quantity: 2 }], expectedTotalCents: 98 }), w.deps)).body)
      .toEqual({ error: 'invalid', field: 'items' });
    expect(w.state.orders).toHaveLength(0);
  });
});

describe('createOrder: cart and gate', () => {
  it('409 sold-out with productIds', async () => {
    const w = storeWorld();
    const r = await createOrder(body(w, { items: [{ productId: w.ids.oil, quantity: 1 }, { productId: w.ids.pomade, quantity: 1 }], expectedTotalCents: 2500 }), w.deps);
    expect(r).toEqual({ status: 409, body: { error: 'sold-out', productIds: [w.ids.pomade] } });
  });

  it('409 cart-changed with the cart products and the server total when expectedTotalCents is off by 1', async () => {
    const w = storeWorld();
    const r = await createOrder(body(w, { expectedTotalCents: 2999 }), w.deps);
    expect(r.status).toBe(409);
    expect(r.body).toEqual({
      error: 'cart-changed',
      totalCents: 3000,
      products: [{ id: w.ids.oil, name: 'Beard oil', priceCents: 1500, description: null, photos: ['https://img/oil-1.jpg', 'https://img/oil-2.jpg'], soldOut: false }],
    });
    expect(w.state.orders).toHaveLength(0);
  });

  it('cart-changed counts shipping in the total', async () => {
    const w = storeWorld();
    const r = await createOrder(body(w, { fulfilment: 'shipping', address: ADDRESS, expectedTotalCents: 3000 }), w.deps);
    expect(r.body).toMatchObject({ error: 'cart-changed', totalCents: 3500 });
  });

  it('423 store-paused from the gate, 404 for an unknown shop', async () => {
    const w = storeWorld();
    w.state.purchases[w.shop().ios_otid!].taken_down_at = '2026-10-01T00:00:00Z';
    expect(await createOrder(body(w), w.deps)).toEqual({ status: 423, body: { error: 'store-paused' } });
    expect((await createOrder(body(w, { slug: 'nope' }), w.deps)).status).toBe(404);
  });

  it('429 when the shop limiter says no, checked only after validation, with Retry-After 300', async () => {
    const w = storeWorld();
    w.limits.shopOrder.mockResolvedValue(false);
    expect((await createOrder(body(w, { customer: { name: 'Sam', phone: '1', email: 'a@b.co' } }), w.deps)).status).toBe(400);
    expect((await createOrder(body(w, { expectedTotalCents: 1 }), w.deps)).status).toBe(409);
    expect(w.limits.shopOrder).not.toHaveBeenCalled();
    const r = await createOrder(body(w), w.deps);
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: 'rate-limited' });
    expect(r.headers).toEqual({ 'Retry-After': '300' });
    expect(w.limits.shopOrder).toHaveBeenCalledWith(w.ids.shopId);
    expect(w.state.orders).toHaveLength(0);
  });
});

describe('createOrder: rails', () => {
  it('manual: 201, new/awaiting, method fixed, notified once, numbers 1001 then 1002', async () => {
    const w = storeWorld();
    const r1 = await createOrder(body(w, { note: 'Gift wrap please' }), w.deps);
    expect(r1.status).toBe(201);
    const o1 = w.state.orders[0];
    expect(o1).toMatchObject({
      status: 'new', payment_status: 'awaiting', payment_method: 'cashapp', order_no: 1001, fulfilment: 'pickup',
      shipping_address: null, subtotal_cents: 3000, shipping_cents: 0, total_cents: 3000, currency: 'usd',
      customer_name: 'Sam Lee', customer_phone: '(555) 123-4567', customer_email: 'sam@example.com', note: 'Gift wrap please',
    });
    expect(r1.body).toEqual({
      order: { id: o1.id, number: 1001, subtotalCents: 3000, shippingCents: 0, totalCents: 3000, statusUrl: `https://www.aibarber.org/shop/manage/${o1.manage_token}` },
    });
    expect(w.notified).toEqual([{ kind: 'order_created', orderId: o1.id }]);
    const r2 = await createOrder(body(w), w.deps);
    expect((r2.body as any).order.number).toBe(1002);
    expect(w.notified).toHaveLength(2);
    expect(w.payments.createOrderCheckout).not.toHaveBeenCalled();
  });

  it('manual with several handles and none named: method null', async () => {
    const w = storeWorld({ shop: { manual_handles: { cashapp: '$a', venmo: '@b' } } });
    await createOrder(body(w), w.deps);
    expect(w.state.orders[0].payment_method).toBeNull();
    await createOrder(body(w, { method: 'venmo' }), w.deps);
    expect(w.state.orders[1].payment_method).toBe('venmo');
  });

  it('manual + shipping stores the US address and the flat rate', async () => {
    const w = storeWorld();
    const r = await createOrder(body(w, { fulfilment: 'shipping', address: { ...ADDRESS, state: 'tx' }, expectedTotalCents: 3500 }), w.deps);
    expect(r.status).toBe(201);
    expect(w.state.orders[0]).toMatchObject({
      fulfilment: 'shipping', shipping_cents: 500, total_cents: 3500,
      shipping_address: { name: 'Sam Lee', line1: '1 Main St', line2: null, city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' },
    });
  });

  it('pickup + shop: 201, payment_status none, method shop', async () => {
    const w = storeWorld();
    const r = await createOrder(body(w, { pay: 'shop' }), w.deps);
    expect(r.status).toBe(201);
    expect(w.state.orders[0]).toMatchObject({ payment_status: 'none', payment_method: 'shop', status: 'new' });
    expect(w.notified).toHaveLength(1);
  });

  it('card + shipping: inserted with shipping_address {}, checkout gets snapshot items and the total, session + url stored in one update', async () => {
    const w = storeWorld();
    const upd = vi.spyOn(w.deps.repo, 'updateOrder');
    const r = await createOrder(body(w, {
      pay: 'card', fulfilment: 'shipping', address: ADDRESS,
      items: [{ productId: w.ids.oil, quantity: 1 }, { productId: w.ids.balm, quantity: 2 }], expectedTotalCents: 6000,
    }), w.deps);
    expect(r.status).toBe(201);
    const o = w.state.orders[0];
    expect(o).toMatchObject({
      status: 'new', payment_status: 'awaiting', payment_method: 'card', shipping_address: {},
      subtotal_cents: 5500, shipping_cents: 500, total_cents: 6000,
      stripe_checkout_session_id: `cs_${o.id}`, checkout_url: `https://checkout.stripe.test/${o.id}`,
    });
    expect(upd).toHaveBeenCalledTimes(1);
    expect(upd.mock.calls[0][1]).toEqual({ stripe_checkout_session_id: `cs_${o.id}`, checkout_url: `https://checkout.stripe.test/${o.id}` });
    const [shopArg, orderArg, itemsArg] = w.payments.createOrderCheckout.mock.calls[0];
    expect(shopArg).toMatchObject({ id: w.ids.shopId, stripe_account_id: 'acct_1' });
    expect(orderArg).toMatchObject({ id: o.id, order_no: 1001, total_cents: 6000, shipping_cents: 500, manage_token: o.manage_token });
    expect(itemsArg).toEqual([
      { name: 'Beard oil', unit_price_cents: 1500, quantity: 1, photo_url: 'https://img/oil-1.jpg' },
      { name: 'Balm', unit_price_cents: 2000, quantity: 2, photo_url: null },
    ]);
    expect(r.body).toMatchObject({ checkoutUrl: `https://checkout.stripe.test/${o.id}`, order: { number: 1001, totalCents: 6000 } });
    expect(w.notified).toEqual([{ kind: 'order_created', orderId: o.id }]);
  });

  it('card + pickup ignores any address and stores null', async () => {
    const w = storeWorld();
    await createOrder(body(w, { pay: 'card', address: ADDRESS }), w.deps);
    expect(w.state.orders[0].shipping_address).toBeNull();
  });

  it('card Checkout throws: 502 payment-unavailable, the order is cancelled (customer), not deleted', async () => {
    const w = storeWorld();
    const e = quiet();
    w.payments.createOrderCheckout.mockRejectedValueOnce(new Error('stripe down'));
    const r = await createOrder(body(w, { pay: 'card' }), w.deps);
    e.mockRestore();
    expect(r).toEqual({ status: 502, body: { error: 'payment-unavailable' } });
    expect(w.state.orders).toHaveLength(1);
    expect(w.state.orders[0]).toMatchObject({
      status: 'cancelled', cancelled_by: 'customer', cancelled_at: '2026-11-02T12:00:00.000Z', payment_status: 'none', order_no: 1001,
    });
    expect(w.notified).toEqual([]);
    // the number is not reused
    expect(((await createOrder(body(w), w.deps)).body as any).order.number).toBe(1002);
  });

  it('snapshots: a later product price edit does not change the stored items', async () => {
    const w = storeWorld();
    await createOrder(body(w), w.deps);
    w.state.products.find((p) => p.id === w.ids.oil)!.price_cents = 9900;
    w.state.products.find((p) => p.id === w.ids.oil)!.name = 'Renamed';
    expect(w.state.items).toEqual([expect.objectContaining({ product_id: w.ids.oil, name: 'Beard oil', unit_price_cents: 1500, quantity: 2 })]);
  });

  it('a notify failure never fails the request', async () => {
    const w = storeWorld();
    (w.deps.notify as any).mockRejectedValueOnce(new Error('smtp'));
    const e = quiet();
    expect((await createOrder(body(w), w.deps)).status).toBe(201);
    e.mockRestore();
  });
});

describe('createOrder: repeated clientKey', () => {
  it('manual: the same order id and number come back; no second order, no second push, not rate-counted', async () => {
    const w = storeWorld();
    const b = body(w);
    const r1 = await createOrder(b, w.deps);
    const r2 = await createOrder(b, w.deps);
    expect(r2).toEqual(r1);
    expect(w.state.orders).toHaveLength(1);
    expect(w.notified).toHaveLength(1);
    expect(w.limits.shopOrder).toHaveBeenCalledTimes(1);
  });

  it('a retry still returns the stored order after the product sold out', async () => {
    const w = storeWorld();
    const b = body(w);
    const r1 = await createOrder(b, w.deps);
    w.state.products.find((p) => p.id === w.ids.oil)!.sold_out = true;
    expect(await createOrder(b, w.deps)).toEqual(r1);
  });

  it('card live hold: the stored checkoutUrl comes back, createOrderCheckout is not called again', async () => {
    const w = storeWorld();
    const b = body(w, { pay: 'card' });
    const r1 = await createOrder(b, w.deps);
    const r2 = await createOrder(b, w.deps);
    expect(r2).toEqual(r1);
    expect((r2.body as any).checkoutUrl).toBe(`https://checkout.stripe.test/${w.state.orders[0].id}`);
    expect(w.payments.createOrderCheckout).toHaveBeenCalledTimes(1);
    expect(w.notified).toHaveLength(1);
  });

  it('card live hold with no stored session: the hold is cancelled and 409 checkout-expired', async () => {
    const w = storeWorld();
    const b = body(w, { pay: 'card' });
    await createOrder(b, w.deps);
    Object.assign(w.state.orders[0], { stripe_checkout_session_id: null, checkout_url: null }); // died between create and store
    w.setNow('2026-11-02T12:00:31Z'); // older than the in-flight budget (30 s)
    const r = await createOrder(b, w.deps);
    expect(r).toEqual({ status: 409, body: { error: 'checkout-expired' } });
    expect(w.state.orders[0]).toMatchObject({ status: 'cancelled', cancelled_by: 'customer', payment_status: 'none' });
    expect(w.payments.createOrderCheckout).toHaveBeenCalledTimes(1);
    expect(w.deps.sleep).not.toHaveBeenCalled();
  });

  it('an older no-session hold whose session is stored just before the cancel: the cancel misses, the resubmit gets that URL', async () => {
    const w = storeWorld();
    const b = body(w, { pay: 'card' });
    await createOrder(b, w.deps);
    const o = w.state.orders[0];
    Object.assign(o, { stripe_checkout_session_id: null, checkout_url: null }); // the first request is slow to store
    w.setNow('2026-11-02T12:00:31Z'); // older than the in-flight budget (30 s)
    const realUpdate = w.deps.repo.updateOrder;
    w.deps.repo.updateOrder = vi.fn(async (id, patch, guard) => {
      if ((patch as any).status === 'cancelled') {
        // The first request's guarded store lands between the resubmit's read and its cancel.
        Object.assign(o, { stripe_checkout_session_id: 'cs_slow', checkout_url: 'https://checkout.stripe.test/slow' });
      }
      return realUpdate(id, patch, guard);
    });
    const r = await createOrder(b, w.deps);
    expect(r.status).toBe(201);
    expect((r.body as any).checkoutUrl).toBe('https://checkout.stripe.test/slow');
    expect(w.state.orders[0]).toMatchObject({ status: 'new', payment_status: 'awaiting', stripe_checkout_session_id: 'cs_slow' });
    expect(w.state.orders.filter((x) => x.status === 'cancelled' && x.checkout_url)).toEqual([]);
    expect(w.payments.createOrderCheckout).toHaveBeenCalledTimes(1);
  });

  describe('in-flight double submit (the first request is still in Stripe)', () => {
    function deferredCheckout(w: StoreWorld) {
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      w.payments.createOrderCheckout.mockImplementationOnce(async (_s: any, o: { id: string }) => {
        await gate;
        return { url: `https://checkout.stripe.test/${o.id}`, sessionId: `cs_${o.id}` };
      });
      return { release };
    }
    const until = async (cond: () => boolean) => { for (let i = 0; i < 50 && !cond(); i++) await new Promise((r) => setImmediate(r)); };
    const invariant = (w: StoreWorld) => {
      // no order is both cancelled and holding a checkout URL
      expect(w.state.orders.filter((o) => o.status === 'cancelled' && o.checkout_url)).toEqual([]);
    };

    it('the resubmit waits for the session and returns the same URL; nothing is cancelled', async () => {
      const w = storeWorld();
      const b = body(w, { pay: 'card' });
      const { release } = deferredCheckout(w);
      const pA = createOrder(b, w.deps);
      await until(() => w.payments.createOrderCheckout.mock.calls.length === 1);
      let aDone: Promise<unknown> | null = null;
      (w.deps.sleep as any).mockImplementation(async () => { if (!aDone) { release(); aDone = pA; } await aDone; });
      const rB = await createOrder(b, w.deps);
      const rA = await pA;
      const o = w.state.orders[0];
      expect(rA.status).toBe(201);
      expect(rB).toEqual(rA);
      expect((rA.body as any).checkoutUrl).toBe(`https://checkout.stripe.test/${o.id}`);
      expect(o).toMatchObject({ status: 'new', payment_status: 'awaiting', checkout_url: `https://checkout.stripe.test/${o.id}` });
      expect(w.state.orders).toHaveLength(1);
      expect(w.payments.createOrderCheckout).toHaveBeenCalledTimes(1);
      expect(w.notified).toHaveLength(1);
      invariant(w);
    });

    it('if the session does not appear in time: 409 without cancelling; exactly one response carries a URL, for a live hold', async () => {
      const w = storeWorld();
      const b = body(w, { pay: 'card' });
      const { release } = deferredCheckout(w);
      const pA = createOrder(b, w.deps);
      await until(() => w.payments.createOrderCheckout.mock.calls.length === 1);
      const rB = await createOrder(b, w.deps); // A still in Stripe through all 4 polls
      expect(rB).toEqual({ status: 409, body: { error: 'checkout-expired' } });
      expect(w.deps.sleep).toHaveBeenCalledTimes(4);
      expect(w.state.orders[0]).toMatchObject({ status: 'new', payment_status: 'awaiting' });
      release();
      const rA = await pA;
      const withUrl = [rA, rB].filter((r) => (r.body as any).checkoutUrl);
      expect(withUrl).toHaveLength(1);
      const o = w.state.orders[0];
      expect((withUrl[0].body as any).checkoutUrl).toBe(o.checkout_url);
      expect(o).toMatchObject({ status: 'new', payment_status: 'awaiting', amount_paid_cents: 0 });
      invariant(w);
    });

    it('a hold cancelled while its first request is in Stripe never gets a URL: the new session is expired and 409', async () => {
      const w = storeWorld();
      const b = body(w, { pay: 'card' });
      const { release } = deferredCheckout(w);
      const pA = createOrder(b, w.deps);
      await until(() => w.payments.createOrderCheckout.mock.calls.length === 1);
      const id = w.state.orders[0].id;
      Object.assign(w.order(id), { status: 'cancelled', cancelled_by: 'customer', payment_status: 'none' }); // e.g. judged dead
      release();
      const rA = await pA;
      expect(rA).toEqual({ status: 409, body: { error: 'checkout-expired' } });
      expect(w.order(id)).toMatchObject({ status: 'cancelled', checkout_url: null, stripe_checkout_session_id: null });
      expect(w.payments.expireCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ id: w.ids.shopId }), `cs_${id}`);
      expect(w.notified).toEqual([]);
      invariant(w);
    });
  });

  it('card paid: 201 with no checkoutUrl', async () => {
    const w = storeWorld();
    const b = body(w, { pay: 'card' });
    await createOrder(b, w.deps);
    Object.assign(w.state.orders[0], { status: 'paid', payment_status: 'paid', amount_paid_cents: 3000, stripe_payment_intent_id: 'pi_1' });
    const r = await createOrder(b, w.deps);
    expect(r.status).toBe(201);
    expect(r.body).not.toHaveProperty('checkoutUrl');
    expect((r.body as any).order.number).toBe(1001);
  });

  it('card cancelled: 409 checkout-expired', async () => {
    const w = storeWorld();
    const b = body(w, { pay: 'card' });
    await createOrder(b, w.deps);
    Object.assign(w.state.orders[0], { status: 'cancelled', cancelled_by: 'customer', payment_status: 'none' });
    expect(await createOrder(b, w.deps)).toEqual({ status: 409, body: { error: 'checkout-expired' } });
  });

  describe('the race branch (the RPC itself reports existing: true)', () => {
    async function race(w: StoreWorld, b: Record<string, unknown>, mutate: () => void) {
      await createOrder(b, w.deps);
      mutate();
      // A concurrent first submit: the pre-check misses, the RPC finds the winner.
      w.deps.repo.orderByClientKey = async () => null;
      w.payments.createOrderCheckout.mockClear();
      (w.deps.notify as any).mockClear();
      w.notified.length = 0;
      return createOrder(b, w.deps);
    }

    it('live hold with a URL: that URL, no second checkout, no notify', async () => {
      const w = storeWorld();
      const r = await race(w, body(w, { pay: 'card' }), () => {});
      expect(r.status).toBe(201);
      expect((r.body as any).checkoutUrl).toBe(w.state.orders[0].checkout_url);
      expect(w.payments.createOrderCheckout).not.toHaveBeenCalled();
      expect(w.notified).toEqual([]);
      expect(w.state.orders).toHaveLength(1);
    });

    it('live hold without a session: cancelled + 409', async () => {
      const w = storeWorld();
      const r = await race(w, body(w, { pay: 'card' }), () => {
        Object.assign(w.state.orders[0], { stripe_checkout_session_id: null, checkout_url: null });
        w.setNow('2026-11-02T12:01:00Z');
      });
      expect(r).toEqual({ status: 409, body: { error: 'checkout-expired' } });
      expect(w.state.orders[0].status).toBe('cancelled');
    });

    it('paid: 201 without checkoutUrl; cancelled: 409; manual: 201 with no second notify', async () => {
      let w = storeWorld();
      let r = await race(w, body(w, { pay: 'card' }), () => Object.assign(w.state.orders[0], { status: 'paid', payment_status: 'paid', amount_paid_cents: 3000 }));
      expect(r.status).toBe(201);
      expect(r.body).not.toHaveProperty('checkoutUrl');
      w = storeWorld();
      r = await race(w, body(w, { pay: 'card' }), () => Object.assign(w.state.orders[0], { status: 'cancelled', cancelled_by: 'customer', payment_status: 'none' }));
      expect(r).toEqual({ status: 409, body: { error: 'checkout-expired' } });
      w = storeWorld();
      r = await race(w, body(w), () => {});
      expect(r.status).toBe(201);
      expect(w.notified).toEqual([]);
      expect(w.state.orders).toHaveLength(1);
    });
  });
});

describe('getOrder', () => {
  async function placed(w: StoreWorld, over: Record<string, unknown> = {}) {
    const r = await createOrder(body(w, over), w.deps);
    expect(r.status).toBe(201);
    return w.state.orders.at(-1)!;
  }

  it('returns the order, items, shop and canSayPaid', async () => {
    const w = storeWorld();
    const o = await placed(w);
    const r = await getOrder({ token: o.manage_token }, w.deps);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      order: {
        id: o.id, number: 1001, status: 'new', fulfilment: 'pickup', createdAt: '2026-11-02T12:00:00.000Z',
        items: [{ name: 'Beard oil', unitPriceCents: 1500, quantity: 2 }],
        subtotalCents: 3000, shippingCents: 0, totalCents: 3000,
        paymentStatus: 'awaiting', paymentMethod: 'cashapp', amountPaidCents: 0, amountRefundedCents: 0,
        trackingNumber: null, trackingUrl: null, shippingAddress: null, customerSaysPaid: false,
      },
      shop: {
        name: 'Fresh Cuts', slug: 'fresh-cuts', address: '1 Main St', phone: '555-0100', accent: '#112233',
        pickupNote: 'Ring the bell', shipsWithinDays: 3, manual: { cashapp: '$freshcuts' },
      },
      canSayPaid: true,
      shopOpen: true,
    });
  });

  it('404 for an unknown or malformed token', async () => {
    const w = storeWorld();
    expect(await getOrder({ token: 'x'.repeat(64) }, w.deps)).toEqual({ status: 404, body: { error: 'not-found' } });
    expect((await getOrder({ token: 'short' }, w.deps)).status).toBe(404);
  });

  it('works while the store is paused', async () => {
    const w = storeWorld();
    const o = await placed(w);
    w.state.shops[0].store_enabled = false;
    expect((await getOrder({ token: o.manage_token }, w.deps)).status).toBe(200);
  });

  it('shippingAddress is null for {} (card hold on shipping) and the object once known', async () => {
    const w = storeWorld();
    const o = await placed(w, { pay: 'card', fulfilment: 'shipping', expectedTotalCents: 3500 });
    expect(((await getOrder({ token: o.manage_token }, w.deps)).body as any).order.shippingAddress).toBeNull();
    w.order(o.id).shipping_address = { name: 'S', line1: '1', city: 'A', state: 'TX', postal_code: '78701', country: 'US' };
    expect(((await getOrder({ token: o.manage_token }, w.deps)).body as any).order.shippingAddress).toMatchObject({ postal_code: '78701' });
  });

  it('canSayPaid follows the rule', async () => {
    const w = storeWorld();
    const o = await placed(w);
    const can = async () => ((await getOrder({ token: o.manage_token }, w.deps)).body as any).canSayPaid;
    expect(await can()).toBe(true);
    w.order(o.id).customer_says_paid_at = '2026-11-02T12:01:00Z';
    expect(await can()).toBe(false);
    w.order(o.id).customer_says_paid_at = null;
    w.order(o.id).payment_status = 'paid';
    expect(await can()).toBe(false);
    w.order(o.id).payment_status = 'awaiting';
    Object.assign(w.order(o.id), { status: 'cancelled', cancelled_by: 'shop' });
    expect(await can()).toBe(false);
    Object.assign(w.order(o.id), { status: 'ready', cancelled_by: null, payment_method: null });
    expect(await can()).toBe(false); // no method fixed
    const card = await placed(w, { pay: 'card' });
    expect(((await getOrder({ token: card.manage_token }, w.deps)).body as any).canSayPaid).toBe(false);
    const shop = await placed(w, { pay: 'shop' });
    expect(((await getOrder({ token: shop.manage_token }, w.deps)).body as any).canSayPaid).toBe(false);
  });
});

describe('postOrderSent', () => {
  async function manual(w: StoreWorld, over: Record<string, unknown> = {}) {
    await createOrder(body(w, over), w.deps);
    w.notified.length = 0;
    return w.state.orders.at(-1)!;
  }

  it("sets customer_says_paid_at once and pushes once; a repeat is 200 with no second push", async () => {
    const w = storeWorld();
    const o = await manual(w);
    expect(await postOrderSent({ token: o.manage_token, method: 'cashapp' }, w.deps)).toEqual({ status: 200, body: {} });
    expect(w.order(o.id).customer_says_paid_at).toBe('2026-11-02T12:00:00.000Z');
    expect(w.notified).toEqual([{ kind: 'order_says_paid', orderId: o.id, method: 'cashapp' }]);
    w.setNow('2026-11-02T12:05:00Z');
    expect(await postOrderSent({ token: o.manage_token, method: 'cashapp' }, w.deps)).toEqual({ status: 200, body: {} });
    expect(w.order(o.id).customer_says_paid_at).toBe('2026-11-02T12:00:00.000Z');
    expect(w.notified).toHaveLength(1);
  });

  it('409 not-awaiting-payment for a card order, a wrong method, a paid or a cancelled order', async () => {
    const w = storeWorld({ shop: { manual_handles: { cashapp: '$a', venmo: '@b' } } });
    const nope = { status: 409, body: { error: 'not-awaiting-payment' } };
    const card = await manual(w, { pay: 'card' });
    expect(await postOrderSent({ token: card.manage_token, method: 'cashapp' }, w.deps)).toEqual(nope);
    const m = await manual(w, { method: 'cashapp' });
    expect(await postOrderSent({ token: m.manage_token, method: 'venmo' }, w.deps)).toEqual(nope);
    const unfixed = await manual(w); // several handles, none named: method null
    expect(await postOrderSent({ token: unfixed.manage_token, method: 'cashapp' }, w.deps)).toEqual(nope);
    w.order(m.id).payment_status = 'paid';
    expect(await postOrderSent({ token: m.manage_token, method: 'cashapp' }, w.deps)).toEqual(nope);
    const c = await manual(w, { method: 'cashapp' });
    Object.assign(w.order(c.id), { status: 'cancelled', cancelled_by: 'shop' });
    expect(await postOrderSent({ token: c.manage_token, method: 'cashapp' }, w.deps)).toEqual(nope);
    const s = await manual(w, { pay: 'shop' });
    expect(await postOrderSent({ token: s.manage_token, method: 'cashapp' }, w.deps)).toEqual(nope);
    expect(w.notified).toEqual([]);
  });

  it('423 while paused, 404 for an unknown token, 400 for an unknown method', async () => {
    const w = storeWorld();
    const o = await manual(w);
    expect(await postOrderSent({ token: o.manage_token, method: 'bitcoin' }, w.deps)).toEqual({ status: 400, body: { error: 'invalid', field: 'method' } });
    expect((await postOrderSent({ token: 'y'.repeat(64), method: 'cashapp' }, w.deps)).status).toBe(404);
    w.state.shops[0].store_enabled = false;
    expect(await postOrderSent({ token: o.manage_token, method: 'cashapp' }, w.deps)).toEqual({ status: 423, body: { error: 'store-paused' } });
    expect(w.order(o.id).customer_says_paid_at).toBeNull();
  });

  it('a concurrent "sent" that already landed: 200, no second push (compare-and-set on customer_says_paid_at)', async () => {
    const w = storeWorld();
    const o = await manual(w);
    const orig = w.deps.repo.orderByToken;
    w.deps.repo.orderByToken = async (t) => {
      const r = await orig(t);
      w.order(o.id).customer_says_paid_at = '2026-11-02T11:59:00Z'; // the other request wins after our read
      return r;
    };
    expect(await postOrderSent({ token: o.manage_token, method: 'cashapp' }, w.deps)).toEqual({ status: 200, body: {} });
    expect(w.notified).toEqual([]);
  });
});
