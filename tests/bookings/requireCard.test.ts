import { describe, it, expect, vi } from 'vitest';
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

  describe('card checkout failure (stale charges_enabled must not lock the shop out)', () => {
    const refreshable = (w: ReturnType<typeof world>, result: boolean | null | Error) => {
      (w.payments as any).refreshChargesEnabled = vi.fn(async (shop: { id: string }) => {
        if (result instanceof Error) throw result;
        if (result === false) { const s = w.state.shops.find((x) => x.id === shop.id)!; s.stripe_charges_enabled = false; }
        return result;
      });
      return (w.payments as any).refreshChargesEnabled as ReturnType<typeof vi.fn>;
    };

    it('Stripe says cards are off: stored status is updated, 502 carries cardOff, and the next attempt may pay in shop', async () => {
      const w = mk();
      const refresh = refreshable(w, false);
      w.payments.createCardCheckout.mockRejectedValueOnce(new Error('stripe restricted'));
      expect(await book(w, { pay: 'card' })).toEqual({ status: 502, body: { error: 'payment-unavailable', cardOff: true } });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(w.state.appointments).toHaveLength(0);
      expect(await cardOnlyOf(w)).toBe(false);
      expect((await book(w)).status).toBe(201);
    });

    it('Stripe unreachable: plain 502 (no hint), nothing changed', async () => {
      const w = mk();
      refreshable(w, new Error('stripe unreachable'));
      w.payments.createCardCheckout.mockRejectedValueOnce(new Error('stripe down'));
      expect(await book(w, { pay: 'card' })).toEqual({ status: 502, body: { error: 'payment-unavailable' } });
      expect(w.state.shops[0].stripe_charges_enabled).toBe(true);
      expect((await book(w)).body).toEqual({ error: 'card-required', field: 'pay' });
    });

    it('Stripe says cards are still on, or says nothing: plain 502', async () => {
      for (const result of [true, null]) {
        const w = mk();
        refreshable(w, result);
        w.payments.createCardCheckout.mockRejectedValueOnce(new Error('transient'));
        expect(await book(w, { pay: 'card' })).toEqual({ status: 502, body: { error: 'payment-unavailable' } });
      }
    });

    it('no Stripe call on the success path, and none for a shop without require_card', async () => {
      const w = mk();
      const refresh = refreshable(w, false);
      expect((await book(w, { pay: 'card' })).status).toBe(201);
      expect(refresh).not.toHaveBeenCalled();
      const w2 = mk({ require_card: false });
      const refresh2 = refreshable(w2, false);
      w2.payments.createCardCheckout.mockRejectedValueOnce(new Error('stripe down'));
      expect(await book(w2, { pay: 'card' })).toEqual({ status: 502, body: { error: 'payment-unavailable' } });
      expect(refresh2).not.toHaveBeenCalled();
    });
  });

  describe("per-barber prices (Jay's own price differs from the base)", () => {
    // base $30 (card-required), Jay charges $0 (free: not card-required, and card is impossible for him)
    const jayFree = () => {
      const w = mk({}, { deposit_type: 'none' });
      w.state.links.push({ service_id: w.ids.cut, member_id: w.ids.jay, price_override_cents: 0 });
      return w;
    };
    const svcOf = async (w: ReturnType<typeof world>) => ((await getShop({ slug: 'fresh-cuts' }, w.deps)).body as any).services[0];

    it('payload: cardOnly only when EVERY offering barber is card-required; cardOnlyMemberIds names the ones who are; uniformPrice false', async () => {
      const w = jayFree();
      const s = await svcOf(w);
      expect(s.cardOnly).toBe(false);
      expect(s.cardOnlyMemberIds).toEqual([w.ids.mike]);
      expect(s.uniformPrice).toBe(false);
    });

    it('payload: all barbers card-required -> cardOnly true and no member list', async () => {
      const w = mk({}, { deposit_type: 'none' });
      const s = await svcOf(w);
      expect(s).toMatchObject({ cardOnly: true, uniformPrice: true });
      expect('cardOnlyMemberIds' in s).toBe(false);
    });

    it('payload: a barber who does not offer the service is ignored', async () => {
      const w = jayFree();
      const kids = crypto.randomUUID();
      w.state.services.push(makeService({ id: kids, shop_id: w.ids.shopId, name: 'Kids', sort: 1 }));
      w.state.links.push({ service_id: kids, member_id: w.ids.mike, price_override_cents: null });
      const b = (await getShop({ slug: 'fresh-cuts' }, w.deps)).body as any;
      const k = b.services.find((x: any) => x.id === kids);
      expect(k).toMatchObject({ cardOnly: true, uniformPrice: true });
    });

    it('pay in shop with "any": a card-required first barber is skipped, the next free barber books', async () => {
      const w = jayFree();
      const r = await book(w);
      expect(r.status).toBe(201);
      expect((r.body as any).appointment.memberName).toBe('Jay');
      expect(w.state.appointments[0].member_id).toBe(w.ids.jay);
    });

    it('pay in shop with a specific card-required barber is card-required; the barber who is not required books', async () => {
      const w = jayFree();
      expect((await book(w, { memberId: w.ids.mike })).body).toEqual({ error: 'card-required', field: 'pay' });
      expect((await book(w, { memberId: w.ids.jay })).status).toBe(201);
    });

    it('pay in shop with "any" when every free barber is card-required: card-required (not slot-taken)', async () => {
      const w = mk({}, { deposit_type: 'none' });
      expect(await book(w)).toEqual({ status: 400, body: { error: 'card-required', field: 'pay' } });
    });

    it('card with "any": a first barber whose charge is under the minimum is skipped for the next (no more dead end)', async () => {
      const w = jayFree();
      w.state.links.push({ service_id: w.ids.cut, member_id: w.ids.mike, price_override_cents: 3000 });
      // Jay ($0) is first in "free" order here only if Mike is busy; make Jay first by sorting members
      w.state.members.find((m) => m.id === w.ids.jay)!.sort = -1;
      const r = await book(w, { pay: 'card' });
      expect(r.status).toBe(201);
      expect((r.body as any).appointment.memberName).toBe('Mike');
      expect(w.payments.createCardCheckout.mock.calls[0][2]).toBe(3000);
    });

    it('card with Jay chosen (charge $0): invalid pay, so the page can go back and offer shop', async () => {
      const w = jayFree();
      expect((await book(w, { pay: 'card', memberId: w.ids.jay })).body).toEqual({ error: 'invalid', field: 'pay' });
    });

    it('when the barber who does not need card is busy, only the card-required one is free: card-required', async () => {
      const w = jayFree();
      // Mike is card-required (skipped for shop); Jay is taken by another customer at that time.
      await book(w, { memberId: w.ids.jay, customer: { ...customer, phone: '5550009999' } });
      expect(await book(w)).toEqual({ status: 400, body: { error: 'card-required', field: 'pay' } });
    });
  });

  it('manage view carries amountRefundedCents', async () => {
    const w = mk();
    const r = await book(w, { pay: 'card' });
    const tok = w.state.appointments[0].manage_token;
    expect(r.status).toBe(201);
    expect(((await getManage({ token: tok }, w.deps)).body as any).appointment.amountRefundedCents).toBe(0);
  });
});
