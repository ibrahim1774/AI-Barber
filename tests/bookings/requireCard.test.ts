import { describe, it, expect, vi } from 'vitest';
import { createAppointment, getShop, getManage } from '../../lib/bookings/publicFlow.js';
import { cardRequired, cardCheckoutRecentlyFailed, inShopAllowed, CARD_FAILURE_WINDOW_MS, STRIPE_MIN_CENTS } from '../../lib/bookings/core.js';
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

    it('Stripe unreachable: stored status untouched, 502 with payOtherWay (the 10-minute window opens)', async () => {
      const w = mk();
      refreshable(w, new Error('stripe unreachable'));
      w.payments.createCardCheckout.mockRejectedValueOnce(new Error('stripe down'));
      expect(await book(w, { pay: 'card' })).toEqual({ status: 502, body: { error: 'payment-unavailable', payOtherWay: true } });
      expect(w.state.shops[0].stripe_charges_enabled).toBe(true);
      expect((await book(w)).status).toBe(201);
    });

    it('Stripe says cards are still on, or says nothing: payOtherWay', async () => {
      for (const result of [true, null]) {
        const w = mk();
        refreshable(w, result);
        w.payments.createCardCheckout.mockRejectedValueOnce(new Error('transient'));
        expect(await book(w, { pay: 'card' })).toEqual({ status: 502, body: { error: 'payment-unavailable', payOtherWay: true } });
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

describe('failed card checkout with cards still on: a short window for the other pay options', () => {
  const stripeOn = (w: ReturnType<typeof world>, result: boolean | null | Error = true) => {
    (w.payments as any).refreshChargesEnabled = vi.fn(async () => { if (result instanceof Error) throw result; return result; });
  };
  const fail = (w: ReturnType<typeof world>, e: any = new Error('stripe 500')) => w.payments.createCardCheckout.mockRejectedValueOnce(e);
  const stamp = (w: ReturnType<typeof world>) => w.state.shops[0].card_checkout_failed_at;

  it('opens: 502 payOtherWay, timestamp stored, cardOnly false, pay in shop books', async () => {
    const w = mk(); stripeOn(w, true); fail(w);
    expect(await book(w, { pay: 'card' })).toEqual({ status: 502, body: { error: 'payment-unavailable', payOtherWay: true } });
    expect(stamp(w)).toBe('2026-11-02T12:00:00.000Z');
    expect(await cardOnlyOf(w)).toBe(false);
    expect((await book(w)).status).toBe(201);
  });

  it('also opens when Stripe cannot be asked (refresh null or throws)', async () => {
    for (const r of [null, new Error('unreachable')]) {
      const w = mk(); stripeOn(w, r as any); fail(w);
      expect(await book(w, { pay: 'card' })).toEqual({ status: 502, body: { error: 'payment-unavailable', payOtherWay: true } });
      expect((await book(w)).status).toBe(201);
    }
  });

  it('closes after 10 minutes: card is required again', async () => {
    const w = mk(); stripeOn(w, true); fail(w);
    await book(w, { pay: 'card' });
    w.setNow('2026-11-02T12:09:59Z');
    expect(await cardOnlyOf(w)).toBe(false);
    w.setNow('2026-11-02T12:10:01Z');
    expect(await cardOnlyOf(w)).toBe(true);
    expect((await book(w)).body).toEqual({ error: 'card-required', field: 'pay' });
    expect(CARD_FAILURE_WINDOW_MS).toBe(600_000);
  });

  it('a shop with pay in shop off and no handles: the window lets pay in shop through (inShopAllowed)', async () => {
    const w = mk({ pay_in_shop: false, manual_handles: {} }); stripeOn(w, true); fail(w);
    const before = ((await getShop({ slug: 'fresh-cuts' }, w.deps)).body as any).shop.pay.inShop;
    expect(before).toBe(false);
    await book(w, { pay: 'card' });
    expect(((await getShop({ slug: 'fresh-cuts' }, w.deps)).body as any).shop.pay.inShop).toBe(true);
    expect((await book(w)).status).toBe(201);
    w.setNow('2026-11-02T12:11:00Z');
    expect(((await getShop({ slug: 'fresh-cuts' }, w.deps)).body as any).shop.pay.inShop).toBe(false);
  });

  it('no timestamp on success, on cardOff, or without the flag', async () => {
    const w1 = mk(); stripeOn(w1, true);
    expect((await book(w1, { pay: 'card' })).status).toBe(201);
    expect(stamp(w1)).toBeUndefined();
    const w2 = mk(); (w2.payments as any).refreshChargesEnabled = vi.fn(async () => { w2.state.shops[0].stripe_charges_enabled = false; return false; }); fail(w2);
    expect((await book(w2, { pay: 'card' })).body).toEqual({ error: 'payment-unavailable', cardOff: true });
    expect(stamp(w2)).toBeUndefined();
    const w3 = mk({ require_card: false }); stripeOn(w3, true); fail(w3);
    expect((await book(w3, { pay: 'card' })).body).toEqual({ error: 'payment-unavailable' });
    expect(stamp(w3)).toBeUndefined();
  });

  it('a write failure never breaks the 502 (plain 502, no hint)', async () => {
    const w = mk(); stripeOn(w, true); fail(w);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    (w.deps.repo as any).markCardCheckoutFailed = vi.fn(async () => { throw new Error('column missing'); });
    expect(await book(w, { pay: 'card' })).toEqual({ status: 502, body: { error: 'payment-unavailable' } });
    vi.restoreAllMocks();
  });

  it('abuse: a Stripe 4xx about the customer\'s email never opens the window; a 5xx, network error or account 4xx does', async () => {
    const stripeErr = (status: number, message: string, code?: string) => Object.assign(new Error(message), { name: 'StripeApiError', status, code });
    for (const e of [stripeErr(400, 'Invalid email address: a@b', 'email_invalid'), stripeErr(400, 'Invalid customer_email')]) {
      const w = mk(); stripeOn(w, true); fail(w, e);
      expect(await book(w, { pay: 'card' })).toEqual({ status: 502, body: { error: 'payment-unavailable' } });
      expect(stamp(w)).toBeUndefined();
      expect(await cardOnlyOf(w)).toBe(true);
    }
    for (const e of [stripeErr(500, 'api error'), stripeErr(0, 'timeout'), stripeErr(403, 'account cannot create sessions'), stripeErr(400, 'This account cannot currently make live charges.'), new TypeError('fetch failed')]) {
      const w = mk(); stripeOn(w, true); fail(w, e);
      expect((await book(w, { pay: 'card' })).body).toEqual({ error: 'payment-unavailable', payOtherWay: true });
    }
  });

  it('flag off: never touches the column, behaviour as before', async () => {
    const w = mk({ require_card: false });
    expect(cardCheckoutRecentlyFailed({ ...w.state.shops[0], card_checkout_failed_at: '2026-11-02T12:00:00Z' }, Date.parse('2026-11-02T12:01:00Z'))).toBe(false);
    expect(inShopAllowed(w.state.shops[0], Date.parse('2026-11-02T12:01:00Z'))).toBe(true);
  });
});
