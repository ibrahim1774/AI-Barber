import { describe, it, expect } from 'vitest';
import {
  createAppointment,
  getDays,
  getIcs,
  getManage,
  getShop,
  getSlots,
  postManage,
  postSent,
} from '../../lib/bookings/publicFlow.js';
import { makeService, OTID, world } from './fakeRepo.js';

const T10 = '2026-11-03T15:00:00.000Z'; // Tue 10:00 EST
const customer = { name: 'Sam Lee', phone: '(555) 123-4567', email: 'sam@example.com' };

function bookBody(w: ReturnType<typeof world>, over: Record<string, unknown> = {}) {
  return { slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: 'any', start: T10, customer, pay: 'shop', ...over };
}

async function book(w: ReturnType<typeof world>, over: Record<string, unknown> = {}) {
  return createAppointment(bookBody(w, over), w.deps);
}

describe('GET /api/book/shop', () => {
  it('returns shop, bookable services and members', async () => {
    const w = world({ shop: { address: '1 Main St', manual_handles: { cashapp: '$fresh', venmo: '  ', bogus: 'x' } as any } });
    w.state.services.push(makeService({ id: crypto.randomUUID(), shop_id: w.ids.shopId, name: 'Hidden', bookable: false }));
    const r = await getShop({ slug: 'fresh-cuts' }, w.deps);
    expect(r.status).toBe(200);
    const b = r.body as any;
    expect(b.paused).toBe(false);
    expect(b.shop).toMatchObject({ slug: 'fresh-cuts', name: 'Fresh Cuts', timezone: 'America/New_York', address: '1 Main St', cancelCutoffMin: 120 });
    expect(b.shop.pay).toEqual({ inShop: true, card: false, manual: { cashapp: '$fresh' } });
    expect(b.services).toEqual([{ id: w.ids.cut, name: 'Haircut', priceCents: 3000, durationMin: 30, description: null, photoUrl: null, depositCents: 0 }]);
    expect(b.members.map((m: any) => [m.name, m.serviceIds])).toEqual([['Mike', null], ['Jay', null]]);
  });

  it('per-barber service lists when ab_service_members restricts a service', async () => {
    const w = world();
    const beard = crypto.randomUUID();
    w.state.services.push(makeService({ id: beard, shop_id: w.ids.shopId, name: 'Beard', sort: 1 }));
    w.state.links.push({ service_id: beard, member_id: w.ids.jay, price_override_cents: null });
    const b = (await getShop({ slug: 'fresh-cuts' }, w.deps)).body as any;
    expect(b.members.find((m: any) => m.name === 'Mike').serviceIds).toEqual([w.ids.cut]);
    expect(b.members.find((m: any) => m.name === 'Jay').serviceIds).toBeNull();
  });

  it('inactive members are hidden', async () => {
    const w = world();
    w.state.members[1].active = false;
    const b = (await getShop({ slug: 'fresh-cuts' }, w.deps)).body as any;
    expect(b.members.map((m: any) => m.name)).toEqual(['Mike']);
  });

  it('404 for unknown or malformed slugs', async () => {
    const w = world();
    expect((await getShop({ slug: 'nope' }, w.deps)).status).toBe(404);
    expect((await getShop({ slug: 'Bad Slug' }, w.deps)).status).toBe(404);
    expect((await getShop({}, w.deps)).status).toBe(404);
  });

  it.each([
    ['bookings disabled', (w: any) => { w.state.shops[0].bookings_enabled = false; }],
    ['no linked purchase', (w: any) => { w.state.shops[0].ios_otid = null; }],
    ['purchase row missing', (w: any) => { delete w.state.purchases[OTID]; }],
    ['purchase revoked', (w: any) => { w.state.purchases[OTID].revoked_at = '2026-10-01T00:00:00Z'; }],
    ['site taken down', (w: any) => { w.state.purchases[OTID].taken_down_at = '2026-10-01T00:00:00Z'; }],
    ['invalid timezone (logged, not a 500)', (w: any) => { w.state.shops[0].timezone = 'Mars/Olympus'; }],
  ])('paused when %s', async (_n, mutate) => {
    const w = world();
    mutate(w);
    const r = await getShop({ slug: 'fresh-cuts' }, w.deps);
    expect(r).toEqual({ status: 200, body: { paused: true, shop: { name: 'Fresh Cuts' } } });
    expect((await getSlots({ slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: 'any', date: '2026-11-03' }, w.deps)).status).toBe(423);
    expect(await book(w)).toEqual({ status: 423, body: { error: 'bookings-paused' } });
  });
});

describe('GET /api/book/slots and /days', () => {
  it('slots honour hours, min notice and the shop timezone', async () => {
    const w = world();
    w.setNow('2026-11-03T15:10:00Z'); // Tue 10:10 EST; 2 h notice -> first slot 12:30 EST
    const r = await getSlots({ slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: 'any', date: '2026-11-03' }, w.deps);
    const slots = (r.body as any).slots;
    expect(slots[0]).toEqual({ start: '2026-11-03T17:30:00.000Z', memberId: w.ids.mike });
    expect(slots.at(-1).start).toBe('2026-11-03T22:30:00.000Z'); // 17:30 EST, last 30-min slot before 18:00
  });

  it('a busy barber falls through to the next one for "any"', async () => {
    const w = world();
    expect((await book(w, { memberId: w.ids.mike })).status).toBe(201);
    const slots = (await getSlots({ slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: 'any', date: '2026-11-03' }, w.deps)).body as any;
    expect(slots.slots.find((s: any) => s.start === T10)).toEqual({ start: T10, memberId: w.ids.jay });
    const mikeOnly = (await getSlots({ slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: w.ids.mike, date: '2026-11-03' }, w.deps)).body as any;
    expect(mikeOnly.slots.some((s: any) => s.start === T10)).toBe(false);
  });

  it('closed day has no slots; days lists only open, bookable days within lead days', async () => {
    const w = world({ shop: { lead_days: 7 } });
    const sun = await getSlots({ slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: 'any', date: '2026-11-08' }, w.deps);
    expect((sun.body as any).slots).toEqual([]);
    const r = await getDays({ slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: 'any', month: '2026-11' }, w.deps);
    expect(r.status).toBe(200);
    expect(Object.keys((r.body as any).days)).toEqual(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
    expect((r.body as any).timezone).toBe('America/New_York');
  });

  it('validates params and ids belong to the shop', async () => {
    const w = world();
    const other = crypto.randomUUID();
    expect((await getDays({ slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: 'any', month: '2026-13' }, w.deps)).body).toEqual({ error: 'invalid', field: 'month' });
    expect((await getSlots({ slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: 'any', date: '2026-02-30' }, w.deps)).body).toEqual({ error: 'invalid', field: 'date' });
    expect((await getSlots({ slug: 'fresh-cuts', serviceId: other, memberId: 'any', date: '2026-11-03' }, w.deps)).body).toEqual({ error: 'invalid', field: 'serviceId' });
    expect((await getSlots({ slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: other, date: '2026-11-03' }, w.deps)).body).toEqual({ error: 'invalid', field: 'memberId' });
  });
});

describe('POST /api/book/appointments', () => {
  it('books the first free barber, end = start + duration, and notifies', async () => {
    const w = world();
    const r = await book(w);
    expect(r.status).toBe(201);
    const a = (r.body as any).appointment;
    expect(a).toMatchObject({ start: T10, end: '2026-11-03T15:30:00.000Z', serviceName: 'Haircut', memberName: 'Mike', priceCents: 3000, depositCents: 0 });
    const row = w.state.appointments[0];
    expect(a.manageUrl).toBe(`https://www.aibarber.org/book/manage/${row.manage_token}`);
    expect(row).toMatchObject({ status: 'booked', payment_status: 'none', payment_method: 'shop', source: 'online', customer_phone: '(555) 123-4567' });
    expect((r.body as any).checkoutUrl).toBeUndefined();
    expect(w.notified).toEqual([{ kind: 'booking_created', appointmentId: row.id }]);
  });

  it('rejects a duplicate (same normalized phone, same start) across barbers', async () => {
    const w = world();
    expect((await book(w)).status).toBe(201);
    const r = await book(w, { customer: { ...customer, phone: '+1 555.123.4567' } });
    expect(r).toEqual({ status: 409, body: { error: 'duplicate' } });
    expect(w.state.appointments).toHaveLength(1);
  });

  it('409 slot-taken with the next 3 free starts when every barber is taken', async () => {
    const w = world();
    expect((await book(w)).status).toBe(201);
    expect((await book(w, { customer: { ...customer, phone: '555 000 1111' } })).status).toBe(201);
    const r = await book(w, { customer: { ...customer, phone: '555 000 2222' } });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({
      error: 'slot-taken',
      alternatives: [
        { start: '2026-11-03T15:30:00.000Z', memberId: w.ids.mike },
        { start: '2026-11-03T16:00:00.000Z', memberId: w.ids.mike },
        { start: '2026-11-03T16:30:00.000Z', memberId: w.ids.mike },
      ],
    });
  });

  it('a 23P01 race on the first barber falls over to the next free one', async () => {
    const w = world();
    const orig = w.deps.repo.insertAppointment;
    let first = true;
    w.deps.repo.insertAppointment = async (row) => {
      if (first) { first = false; return { ok: false, reason: 'overlap' }; } // lost the race for Mike
      return orig(row);
    };
    const r = await book(w);
    expect(r.status).toBe(201);
    expect((r.body as any).appointment.memberName).toBe('Jay');
  });

  it('a 23P01 race on a specific barber is a 409 with alternatives', async () => {
    const w = world();
    w.deps.repo.insertAppointment = async () => ({ ok: false, reason: 'overlap' });
    const r = await book(w, { memberId: w.ids.jay });
    expect(r.status).toBe(409);
    expect((r.body as any).error).toBe('slot-taken');
    expect((r.body as any).alternatives).toHaveLength(3);
  });

  it('enforces minimum notice, lead days, hours and time off server-side', async () => {
    const w = world();
    w.setNow('2026-11-03T14:00:00Z'); // 9:00 EST; 10:00 is within the 2 h notice
    expect((await book(w)).status).toBe(409);
    w.setNow('2026-11-02T12:00:00Z');
    expect((await book(w, { start: '2026-12-15T15:00:00.000Z' })).status).toBe(409); // > 30 lead days
    expect((await book(w, { start: '2026-11-03T15:10:00.000Z' })).status).toBe(409); // off the slot grid
    expect((await book(w, { start: '2026-11-03T23:00:00.000Z' })).status).toBe(409); // 18:00 = closed
    expect((await book(w, { start: '2026-11-08T15:00:00.000Z' })).status).toBe(409); // Sunday
    for (const m of [w.ids.mike, w.ids.jay]) {
      w.state.timeOff.push({ id: crypto.randomUUID(), member_id: m, start_at: '2026-11-03T14:00:00Z', end_at: '2026-11-03T18:00:00Z', reason: null });
    }
    expect((await book(w)).status).toBe(409);
    expect(w.state.appointments).toHaveLength(0);
  });

  it('accepts any explicit offset but rejects a start without one', async () => {
    const w = world();
    expect((await book(w, { start: '2026-11-03T10:00:00-05:00' })).status).toBe(201);
    expect((await book(w, { start: '2026-11-03T10:30:00', customer: { ...customer, phone: '5550009999' } })).body).toEqual({ error: 'invalid', field: 'start' });
  });

  it.each([
    [{ customer: { ...customer, name: ' ' } }, 'customer.name'],
    [{ customer: { ...customer, phone: '12' } }, 'customer.phone'],
    [{ customer: { ...customer, email: 'nope' } }, 'customer.email'],
    [{ customer: undefined }, 'customer'],
    [{ pay: 'bitcoin' }, 'pay'],
    [{ note: 'x'.repeat(501) }, 'note'],
    [{ serviceId: 'not-a-uuid' }, 'serviceId'],
    [{ memberId: '11111111-2222-4333-8444-555555555555' }, 'memberId'],
  ])('400 invalid for %j', async (over, field) => {
    const w = world();
    expect(await book(w, over as any)).toEqual({ status: 400, body: { error: 'invalid', field } });
  });

  it('rejects a service of another shop, an inactive service and an inactive barber', async () => {
    const w = world();
    const foreign = crypto.randomUUID();
    w.state.services.push(makeService({ id: foreign, shop_id: crypto.randomUUID() }));
    expect((await book(w, { serviceId: foreign })).body).toEqual({ error: 'invalid', field: 'serviceId' });
    w.state.services[0].active = false;
    expect((await book(w)).body).toEqual({ error: 'invalid', field: 'serviceId' });
    w.state.services[0].active = true;
    w.state.members[1].active = false;
    expect((await book(w, { memberId: w.ids.jay })).body).toEqual({ error: 'invalid', field: 'memberId' });
  });

  it('rejects a barber who does not offer the service', async () => {
    const w = world();
    w.state.links.push({ service_id: w.ids.cut, member_id: w.ids.jay, price_override_cents: 4000 });
    expect((await book(w, { memberId: w.ids.mike })).body).toEqual({ error: 'invalid', field: 'memberId' });
    const r = await book(w);
    expect((r.body as any).appointment).toMatchObject({ memberName: 'Jay', priceCents: 4000 });
  });

  it('pay methods must be offered by the shop', async () => {
    const w = world({ shop: { pay_in_shop: false } });
    expect((await book(w)).body).toEqual({ error: 'invalid', field: 'pay' });
    expect((await book(w, { pay: 'manual' })).body).toEqual({ error: 'invalid', field: 'pay' });
    expect((await book(w, { pay: 'card' })).body).toEqual({ error: 'invalid', field: 'pay' });
  });

  it('manual pay is booked as awaiting confirmation', async () => {
    const w = world({ shop: { manual_handles: { cashapp: '$fresh' } } });
    expect((await book(w, { pay: 'manual' })).status).toBe(201);
    expect(w.state.appointments[0]).toMatchObject({ payment_status: 'awaiting', payment_method: null });
  });

  describe('card', () => {
    const cardShop = { stripe_account_id: 'acct_1', stripe_charges_enabled: true };

    it('holds the slot, charges the deposit and returns the checkout URL', async () => {
      const w = world({ shop: cardShop });
      Object.assign(w.state.services[0], { deposit_type: 'percent', deposit_value: 50 });
      const r = await book(w, { pay: 'card' });
      expect(r.status).toBe(201);
      const row = w.state.appointments[0];
      expect((r.body as any).checkoutUrl).toBe(`https://checkout.stripe.test/${row.id}`);
      expect((r.body as any).appointment.depositCents).toBe(1500);
      expect(w.payments.createCardCheckout).toHaveBeenCalledWith(expect.objectContaining({ id: w.ids.shopId }), expect.objectContaining({ id: row.id }), 1500);
      expect(row).toMatchObject({ status: 'booked', payment_status: 'awaiting', payment_method: 'card', stripe_checkout_session_id: `cs_${row.id}` });
    });

    it('charges the full price without a deposit', async () => {
      const w = world({ shop: cardShop });
      await book(w, { pay: 'card' });
      expect(w.payments.createCardCheckout.mock.calls[0][2]).toBe(3000);
    });

    it('a null price and no deposit cannot be paid by card', async () => {
      const w = world({ shop: cardShop });
      w.state.services[0].price_cents = null;
      expect((await book(w, { pay: 'card' })).body).toEqual({ error: 'invalid', field: 'pay' });
    });

    it('drops the hold when checkout cannot be created', async () => {
      const w = world({ shop: cardShop });
      w.payments.createCardCheckout.mockRejectedValueOnce(new Error('stripe down'));
      expect(await book(w, { pay: 'card' })).toEqual({ status: 502, body: { error: 'payment-unavailable' } });
      expect(w.state.appointments).toHaveLength(0);
      expect(w.notified).toHaveLength(0);
    });
  });
});

describe('manage by token', () => {
  async function booked(w: ReturnType<typeof world>, over: Record<string, unknown> = {}) {
    await book(w, over);
    return w.state.appointments.at(-1)!;
  }

  it('GET returns the appointment, ids and what the customer may do', async () => {
    const w = world({ shop: { address: '1 Main St' } });
    const a = await booked(w);
    const r = await getManage({ token: a.manage_token }, w.deps);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      appointment: {
        id: a.id, start: T10, end: '2026-11-03T15:30:00.000Z', status: 'booked',
        serviceId: w.ids.cut, serviceName: 'Haircut', memberId: w.ids.mike, memberName: 'Mike',
        priceCents: 3000, amountPaidCents: 0, paymentStatus: 'none',
        shop: { name: 'Fresh Cuts', slug: 'fresh-cuts', address: '1 Main St', phone: null, timezone: 'America/New_York' },
      },
      canCancel: true, canReschedule: true, refundCentsIfCancelled: 0,
    });
    expect((await getManage({ token: 'x'.repeat(40) }, w.deps)).status).toBe(404);
    expect((await getManage({ token: 'short' }, w.deps)).status).toBe(404);
  });

  it('customer cancel before the cutoff refunds a card payment in full, once', async () => {
    const w = world({ shop: { stripe_account_id: 'acct_1', stripe_charges_enabled: true } });
    const a = await booked(w, { pay: 'card' });
    Object.assign(w.state.appointments[0], { payment_status: 'paid', amount_paid_cents: 3000 });
    expect(((await getManage({ token: a.manage_token }, w.deps)).body as any).refundCentsIfCancelled).toBe(3000);
    const r = await postManage({ token: a.manage_token, action: 'cancel' }, w.deps);
    expect(r.status).toBe(200);
    expect((r.body as any).appointment.status).toBe('cancelled');
    expect(w.payments.refundAppointment).toHaveBeenCalledTimes(1);
    expect(w.payments.refundAppointment.mock.calls[0][2]).toBe(3000);
    expect(w.state.appointments[0]).toMatchObject({ status: 'cancelled', cancelled_by: 'customer', amount_refunded_cents: 3000, payment_status: 'refunded' });
    // double tap: idempotent, no second refund
    expect((await postManage({ token: a.manage_token, action: 'cancel' }, w.deps)).status).toBe(200);
    expect(w.payments.refundAppointment).toHaveBeenCalledTimes(1);
    expect(w.notified.filter((e) => e.kind === 'booking_cancelled')).toHaveLength(1);
  });

  it('customer cancel after the cutoff keeps the deposit (no refund) and is too late after start', async () => {
    const w = world({ shop: { stripe_account_id: 'acct_1', stripe_charges_enabled: true } });
    const a = await booked(w, { pay: 'card' });
    Object.assign(w.state.appointments[0], { payment_status: 'deposit', amount_paid_cents: 1000 });
    w.setNow('2026-11-03T14:00:00Z'); // 1 h before, cutoff is 2 h
    const g = (await getManage({ token: a.manage_token }, w.deps)).body as any;
    expect(g).toMatchObject({ canCancel: true, canReschedule: false, refundCentsIfCancelled: 0 });
    w.setNow('2026-11-03T15:00:00Z');
    expect(await postManage({ token: a.manage_token, action: 'cancel' }, w.deps)).toEqual({ status: 403, body: { error: 'too-late' } });
    w.setNow('2026-11-03T14:30:00Z');
    expect((await postManage({ token: a.manage_token, action: 'cancel' }, w.deps)).status).toBe(200);
    expect(w.payments.refundAppointment).not.toHaveBeenCalled();
  });

  it('an unpaid card hold can always be cancelled and frees the slot without a refund call', async () => {
    const w = world({ shop: { stripe_account_id: 'acct_1', stripe_charges_enabled: true } });
    const a = await booked(w, { pay: 'card' });
    w.setNow('2026-11-03T15:05:00Z'); // even past the start
    expect(((await getManage({ token: a.manage_token }, w.deps)).body as any).canCancel).toBe(true);
    expect((await postManage({ token: a.manage_token, action: 'cancel' }, w.deps)).status).toBe(200);
    expect(w.payments.refundAppointment).not.toHaveBeenCalled();
    expect(w.payments.expireCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ id: w.ids.shopId }), `cs_${a.id}`);
    w.setNow('2026-11-02T12:00:00Z');
    expect((await book(w, { memberId: w.ids.mike, customer: { ...customer, phone: '555 777 8888' } })).status).toBe(201);
  });

  it('manual rails never move money on cancel', async () => {
    const w = world({ shop: { manual_handles: { venmo: '@fresh' } } });
    const a = await booked(w, { pay: 'manual' });
    Object.assign(w.state.appointments[0], { payment_status: 'paid', payment_method: 'venmo', amount_paid_cents: 3000 });
    expect(((await getManage({ token: a.manage_token }, w.deps)).body as any).refundCentsIfCancelled).toBe(0);
    await postManage({ token: a.manage_token, action: 'cancel' }, w.deps);
    expect(w.payments.refundAppointment).not.toHaveBeenCalled();
  });

  it('a failed refund is logged and the booking stays cancelled', async () => {
    const w = world({ shop: { stripe_account_id: 'acct_1', stripe_charges_enabled: true } });
    const a = await booked(w, { pay: 'card' });
    Object.assign(w.state.appointments[0], { payment_status: 'paid', amount_paid_cents: 3000 });
    w.payments.refundAppointment.mockRejectedValueOnce(new Error('stripe down'));
    expect((await postManage({ token: a.manage_token, action: 'cancel' }, w.deps)).status).toBe(200);
    expect(w.state.appointments[0]).toMatchObject({ status: 'cancelled', amount_refunded_cents: 0, payment_status: 'paid' });
    expect(w.state.events.map((e) => e.kind)).toEqual(['refund_failed']);
  });

  it('cancel still works while bookings are paused; reschedule does not', async () => {
    const w = world();
    const a = await booked(w);
    w.state.shops[0].bookings_enabled = false;
    expect(((await getManage({ token: a.manage_token }, w.deps)).body as any)).toMatchObject({ canCancel: true, canReschedule: false });
    expect(await postManage({ token: a.manage_token, action: 'reschedule', start: '2026-11-03T16:00:00Z' }, w.deps)).toEqual({ status: 423, body: { error: 'bookings-paused' } });
    expect((await postManage({ token: a.manage_token, action: 'cancel' }, w.deps)).status).toBe(200);
  });

  it('reschedule moves the booking in place, even overlapping its own old time', async () => {
    const w = world({ shop: { slot_step_min: 15 } });
    const a = await booked(w, { memberId: w.ids.mike });
    const r = await postManage({ token: a.manage_token, action: 'reschedule', start: '2026-11-03T15:15:00Z' }, w.deps);
    expect(r.status).toBe(200);
    expect((r.body as any).appointment).toMatchObject({ id: a.id, start: '2026-11-03T15:15:00.000Z', end: '2026-11-03T15:45:00.000Z', memberName: 'Mike' });
    expect(w.state.appointments).toHaveLength(1);
    expect(w.notified.at(-1)).toEqual({ kind: 'booking_rescheduled', appointmentId: a.id, by: 'customer' });
  });

  it('reschedule to a taken time is 409 with alternatives; after the cutoff 403', async () => {
    const w = world();
    const a = await booked(w, { memberId: w.ids.mike });
    await book(w, { memberId: w.ids.mike, start: '2026-11-03T16:00:00Z', customer: { ...customer, phone: '5550001111' } });
    const r = await postManage({ token: a.manage_token, action: 'reschedule', start: '2026-11-03T16:00:00Z' }, w.deps);
    expect(r.status).toBe(409);
    expect((r.body as any).alternatives[0]).toEqual({ start: '2026-11-03T16:30:00.000Z', memberId: w.ids.mike });
    w.setNow('2026-11-03T13:30:00Z');
    expect((await postManage({ token: a.manage_token, action: 'reschedule', start: '2026-11-04T16:00:00Z' }, w.deps)).body).toEqual({ error: 'too-late' });
  });

  it('reschedule can switch to another barber or "any"', async () => {
    const w = world();
    const a = await booked(w, { memberId: w.ids.mike });
    const r = await postManage({ token: a.manage_token, action: 'reschedule', start: '2026-11-04T15:00:00Z', memberId: w.ids.jay }, w.deps);
    expect((r.body as any).appointment.memberName).toBe('Jay');
  });
});

describe('POST /api/book/sent', () => {
  it('stamps customer_says_paid_at and pushes once', async () => {
    const w = world({ shop: { manual_handles: { cashapp: '$fresh' } } });
    await book(w, { pay: 'manual' });
    const a = w.state.appointments[0];
    expect(await postSent({ token: a.manage_token, method: 'cashapp' }, w.deps)).toEqual({ status: 200, body: {} });
    expect(w.state.appointments[0].customer_says_paid_at).toBe('2026-11-02T12:00:00.000Z');
    expect(w.state.appointments[0].payment_method).toBe('cashapp');
    await postSent({ token: a.manage_token, method: 'cashapp' }, w.deps);
    expect(w.notified.filter((e) => e.kind === 'customer_says_paid')).toEqual([
      { kind: 'customer_says_paid', appointmentId: a.id, method: 'cashapp', amountCents: 3000 },
    ]);
  });

  it('rejects a method the shop does not take', async () => {
    const w = world({ shop: { manual_handles: { cashapp: '$fresh' } } });
    await book(w, { pay: 'manual' });
    expect((await postSent({ token: w.state.appointments[0].manage_token, method: 'zelle' }, w.deps)).body).toEqual({ error: 'invalid', field: 'method' });
    expect((await postSent({ token: w.state.appointments[0].manage_token, method: 'gold' }, w.deps)).body).toEqual({ error: 'invalid', field: 'method' });
  });
});

describe('GET /api/book/ics', () => {
  it("returns the barber's live appointments as text/calendar", async () => {
    const w = world();
    await book(w, { memberId: w.ids.mike });
    await book(w, { memberId: w.ids.jay, customer: { ...customer, phone: '5550001111' } });
    const r = await getIcs({ t: w.state.members[0].ics_token }, w.deps);
    expect(r.status).toBe(200);
    expect(r.contentType).toBe('text/calendar; charset=utf-8');
    const body = r.body as string;
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(body).toContain('DTSTART:20261103T150000Z');
    expect(body).toContain('SUMMARY:Sam Lee – Haircut');
    expect((await getIcs({ t: 'z'.repeat(40) }, w.deps)).status).toBe(404);
  });
});
