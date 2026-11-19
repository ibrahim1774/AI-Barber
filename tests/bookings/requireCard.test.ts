import { describe, it, expect } from 'vitest';
import { createAppointment, getShop, getManage } from '../../lib/bookings/publicFlow.js';
import { cardRequired, STRIPE_MIN_CENTS } from '../../lib/bookings/core.js';
import { makeShop, makeService, world } from './fakeRepo.js';

const T10 = '2026-11-03T15:00:00.000Z';
const customer = { name: 'Sam Lee', phone: '(555) 123-4567', email: 'sam@example.com' };
const live = { stripe_account_id: 'acct_1', stripe_charges_enabled: true, manual_handles: { cashapp: '$fresh' } };

function mk(shop: Record<string, unknown> = {}, svc: Record<string, unknown> = { deposit_type: 'percent', deposit_value: 50 }) {
  const w = world({ shop: { ...live, require_card: true, ...shop } as any });
  Object.assign(w.state.services[0], svc);
  return w;
}
const book = (w: ReturnType<typeof world>, over: Record<string, unknown> = {}) =>
  createAppointment({ slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: 'any', start: T10, customer, pay: 'shop', ...over }, w.deps);
const cardOnlyOf = async (w: ReturnType<typeof world>) => ((await getShop({ slug: 'fresh-cuts' }, w.deps)).body as any).services[0].cardOnly;

describe('cardRequired', () => {
  const shop = makeShop({ id: 's', ...live, require_card: true });
  const svc = makeService({ id: 'x', shop_id: 's' });
  it('needs the flag, live card and a charge of at least the Stripe minimum', () => {
    expect(STRIPE_MIN_CENTS).toBe(50);
    expect(cardRequired(shop, svc, 3000)).toBe(true);
    expect(cardRequired({ ...shop, require_card: false }, svc, 3000)).toBe(false);
    expect(cardRequired({ ...shop, require_card: undefined }, svc, 3000)).toBe(false);
    expect(cardRequired({ ...shop, stripe_charges_enabled: false }, svc, 3000)).toBe(false);
    expect(cardRequired({ ...shop, stripe_account_id: null }, svc, 3000)).toBe(false);
    expect(cardRequired(shop, svc, null)).toBe(false);
    expect(cardRequired(shop, svc, 30)).toBe(false);
    expect(cardRequired(shop, svc, 50)).toBe(true);
  });
  it('uses the deposit when there is one', () => {
    expect(cardRequired(shop, { ...svc, deposit_type: 'fixed', deposit_value: 30 }, 3000)).toBe(false); // 30c deposit < minimum
    expect(cardRequired(shop, { ...svc, deposit_type: 'fixed', deposit_value: 500 }, 3000)).toBe(true);
  });
});

describe('require_card on', () => {
  it('deposit service: pay in shop and manual are refused, card books', async () => {
    const w = mk();
    expect(await cardOnlyOf(w)).toBe(true);
    for (const over of [{ pay: 'shop' }, { pay: 'manual', method: 'cashapp' }]) {
      const r = await book(w, over);
      expect(r).toEqual({ status: 400, body: { error: 'card-required', field: 'pay' } });
    }
    expect(w.state.appointments).toHaveLength(0);
    const c = await book(w, { pay: 'card' });
    expect(c.status).toBe(201);
    expect(w.payments.createCardCheckout.mock.calls[0][2]).toBe(1500);
  });

  it('priced service without a deposit: card only, charged the full price', async () => {
    const w = mk({}, {});
    expect(await cardOnlyOf(w)).toBe(true);
    expect((await book(w)).body).toEqual({ error: 'card-required', field: 'pay' });
    expect((await book(w, { pay: 'card' })).status).toBe(201);
    expect(w.payments.createCardCheckout.mock.calls[0][2]).toBe(3000);
  });

  it('pay.inShop in the payload is unchanged (older pages keep working)', async () => {
    const w = mk({ pay_in_shop: true });
    expect(((await getShop({ slug: 'fresh-cuts' }, w.deps)).body as any).shop.pay).toEqual({ inShop: true, card: true, manual: { cashapp: '$fresh' } });
  });

  it('cards off or no Stripe account: nothing changes, the shop is never unbookable', async () => {
    for (const off of [{ stripe_charges_enabled: false }, { stripe_account_id: null }]) {
      const w = mk(off);
      expect(await cardOnlyOf(w)).toBe(false);
      expect((await book(w)).status).toBe(201);
    }
  });

  it('unpriced and 30-cent services keep today\'s options', async () => {
    for (const price of [null, 30]) {
      const w = mk({}, { price_cents: price, deposit_type: 'none' });
      expect(await cardOnlyOf(w)).toBe(false);
      expect((await book(w)).status).toBe(201);
    }
  });

  it("the check uses the booked barber's own price", async () => {
    // base price 30c (not card-only), but Jay charges $30: booking Jay by shop is refused, Mike (30c) is fine.
    const w = mk({}, { price_cents: 30, deposit_type: 'none' });
    w.state.links.push({ service_id: w.ids.cut, member_id: w.ids.jay, price_override_cents: 3000 });
    expect(await cardOnlyOf(w)).toBe(false);
    expect((await book(w, { memberId: w.ids.jay })).body).toEqual({ error: 'card-required', field: 'pay' });
    expect((await book(w, { memberId: w.ids.mike })).status).toBe(201);
  });

  it('a card checkout failure on a card-only service is still the 502 payment-unavailable', async () => {
    const w = mk();
    w.payments.createCardCheckout.mockRejectedValueOnce(new Error('stripe down'));
    expect(await book(w, { pay: 'card' })).toEqual({ status: 502, body: { error: 'payment-unavailable' } });
  });

  it('manage view carries amountRefundedCents', async () => {
    const w = mk();
    const r = await book(w, { pay: 'card' });
    const tok = w.state.appointments[0].manage_token;
    expect(r.status).toBe(201);
    expect(((await getManage({ token: tok }, w.deps)).body as any).appointment.amountRefundedCents).toBe(0);
  });
});
