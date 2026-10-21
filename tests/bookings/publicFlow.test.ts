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

  it('per-barber service lists: rows restrict that barber only (per member)', async () => {
    const w = world();
    const beard = crypto.randomUUID();
    w.state.services.push(makeService({ id: beard, shop_id: w.ids.shopId, name: 'Beard', sort: 1 }));
    w.state.links.push({ service_id: beard, member_id: w.ids.jay, price_override_cents: null });
    const b = (await getShop({ slug: 'fresh-cuts' }, w.deps)).body as any;
    expect(b.members.find((m: any) => m.name === 'Mike').serviceIds).toBeNull();
    expect(b.members.find((m: any) => m.name === 'Jay').serviceIds).toEqual([beard]);
  });

  it('a barber restricted to Kids: serviceIds is right for both barbers', async () => {
    const w = world();
    const kids = crypto.randomUUID();
    w.state.services.push(makeService({ id: kids, shop_id: w.ids.shopId, name: 'Kids cut', sort: 1 }));
    w.state.links.push({ service_id: kids, member_id: w.ids.mike, price_override_cents: null });
    const b = (await getShop({ slug: 'fresh-cuts' }, w.deps)).body as any;
    expect(b.members.map((m: any) => [m.name, m.serviceIds])).toEqual([['Mike', [kids]], ['Jay', null]]);
  });

  it('a restriction to a deactivated service falls back to every service', async () => {
    const w = world();
    const old = crypto.randomUUID();
    w.state.services.push(makeService({ id: old, shop_id: w.ids.shopId, name: 'Old', sort: 1, active: false }));
    w.state.links.push({ service_id: old, member_id: w.ids.mike, price_override_cents: null });
    const b = (await getShop({ slug: 'fresh-cuts' }, w.deps)).body as any;
    expect(b.members.map((m: any) => [m.name, m.serviceIds])).toEqual([['Mike', null], ['Jay', null]]);
    const r = await book(w, { memberId: w.ids.mike });
    expect(r.status).toBe(201);
    expect((r.body as any).appointment.memberName).toBe('Mike');
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

  it.each([
    ['00000000-0000-4000-8000-000000000000', 409],
    ['ffffffff-ffff-4fff-8fff-ffffffffffff', 201],
  ])('a twin that raced past the duplicate check: smallest id wins (twin %s -> %i)', async (twinId, expected) => {
    const w = world();
    const orig = w.deps.repo.insertAppointment;
    w.deps.repo.insertAppointment = async (row) => {
      // the other submission lands on Jay between our duplicate check and our insert
      await orig({ ...row, member_id: w.ids.jay });
      w.state.appointments.at(-1)!.id = twinId;
      return orig(row);
    };
    const r = await book(w);
    expect(r.status).toBe(expected);
    if (expected === 409) expect(r.body).toEqual({ error: 'duplicate' });
    expect(w.state.appointments.map((a) => a.id)).toContain(twinId);
    expect(w.state.appointments).toHaveLength(expected === 409 ? 1 : 2);
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

  it('per-shop cap: 429 with a friendly message and nothing inserted; only bookable requests count', async () => {
    const w = world();
    const counted: string[] = [];
    let allow = true;
    w.deps.limits = { shopBooking: async (id) => { counted.push(id); return allow; } };
    expect((await book(w, { customer: { ...customer, name: '' } })).status).toBe(400); // invalid: not counted
    expect((await book(w, { start: '2026-11-08T15:00:00.000Z' })).status).toBe(409); // closed day: not counted
    expect(counted).toEqual([]);
    expect((await book(w)).status).toBe(201);
    expect(counted).toEqual([w.ids.shopId]);
    allow = false;
    const r = await book(w, { customer: { ...customer, phone: '5550001111' } });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ error: 'rate-limited', message: expect.stringMatching(/try again in a few minutes/) });
    expect(r.headers).toEqual({ 'Retry-After': '300' });
    expect(w.state.appointments).toHaveLength(1);
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
    const beard = crypto.randomUUID();
    w.state.services.push(makeService({ id: beard, shop_id: w.ids.shopId, name: 'Beard', sort: 1 }));
    // Mike does Beard only; Jay does everything (his Haircut row is just a price override).
    w.state.links.push({ service_id: beard, member_id: w.ids.mike, price_override_cents: null });
    w.state.links.push({ service_id: w.ids.cut, member_id: w.ids.jay, price_override_cents: 4000 });
    expect((await book(w, { memberId: w.ids.mike })).body).toEqual({ error: 'invalid', field: 'memberId' });
    const r = await book(w);
    expect((r.body as any).appointment).toMatchObject({ memberName: 'Jay', priceCents: 4000 });
  });

  it('a barber restricted to Kids is not offered for Haircut; others still are for Kids', async () => {
    const w = world();
    const kids = crypto.randomUUID();
    w.state.services.push(makeService({ id: kids, shop_id: w.ids.shopId, name: 'Kids cut', sort: 1 }));
    w.state.links.push({ service_id: kids, member_id: w.ids.mike, price_override_cents: null });
    // Haircut: Mike is out, Jay is in.
    expect((await book(w, { memberId: w.ids.mike })).body).toEqual({ error: 'invalid', field: 'memberId' });
    // Kids: Jay (no rows) is still offered alongside Mike.
    const r = await book(w, { serviceId: kids, memberId: w.ids.jay });
    expect(r.status).toBe(201);
    expect((r.body as any).appointment.memberName).toBe('Jay');
  });

  it('pay methods must be offered by the shop', async () => {
    const w = world({ shop: { pay_in_shop: false } });
    expect((await book(w)).body).toEqual({ error: 'invalid', field: 'pay' });
    expect((await book(w, { pay: 'manual' })).body).toEqual({ error: 'invalid', field: 'pay' });
    expect((await book(w, { pay: 'card' })).body).toEqual({ error: 'invalid', field: 'pay' });
  });

  it('manual pay is booked as awaiting confirmation, on the only rail the shop takes', async () => {
    const w = world({ shop: { manual_handles: { cashapp: '$fresh' } } });
    expect((await book(w, { pay: 'manual' })).status).toBe(201);
    expect(w.state.appointments[0]).toMatchObject({ payment_status: 'awaiting', payment_method: 'cashapp' });
  });

  it('manual pay stores the rail named at booking; none named with several rails stays null', async () => {
    const w = world({ shop: { manual_handles: { cashapp: '$fresh', venmo: '@fresh' } } });
    expect((await book(w, { pay: 'manual', method: 'venmo' })).status).toBe(201);
    expect(w.state.appointments[0].payment_method).toBe('venmo');
    expect((await book(w, { pay: 'manual', customer: { ...customer, phone: '5550001111' } })).status).toBe(201);
    expect(w.state.appointments[1].payment_method).toBeNull();
  });

  it.each([
    [{ pay: 'manual', method: 'zelle' }, 'not a rail the shop takes'],
    [{ pay: 'manual', method: 'gold' }, 'not a manual rail'],
    [{ pay: 'shop', method: 'cashapp' }, 'a method without manual pay'],
  ])('400 invalid method for %j (%s)', async (over) => {
    const w = world({ shop: { manual_handles: { cashapp: '$fresh' } } });
    expect(await book(w, over)).toEqual({ status: 400, body: { error: 'invalid', field: 'method' } });
    expect(w.state.appointments).toHaveLength(0);
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

    it('never hard-deletes a hold that already has a checkout session: it is cancelled instead', async () => {
      const w = world({ shop: cardShop });
      w.payments.createCardCheckout.mockImplementationOnce(async (_s, a) => {
        // the session id landed on the row, then the call failed (e.g. a timeout after Stripe answered)
        w.state.appointments.find((x) => x.id === a.id)!.stripe_checkout_session_id = 'cs_landed';
        throw new Error('timeout');
      });
      expect(await book(w, { pay: 'card' })).toEqual({ status: 502, body: { error: 'payment-unavailable' } });
      expect(w.state.appointments).toHaveLength(1);
      expect(w.state.appointments[0]).toMatchObject({ status: 'cancelled', cancelled_by: 'customer', stripe_checkout_session_id: 'cs_landed' });
      // the slot is free again
      expect((await book(w, { memberId: w.ids.mike, customer: { ...customer, phone: '5550002222' } })).status).toBe(201);
    });

    it('stores the checkout session id on the appointment before responding', async () => {
      const w = world({ shop: cardShop });
      let storedAtResponse: string | null = null;
      const r = await book(w, { pay: 'card' });
      storedAtResponse = w.state.appointments[0].stripe_checkout_session_id;
      expect(r.status).toBe(201);
      expect(storedAtResponse).toBe(`cs_${w.state.appointments[0].id}`);
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
    expect(w.payments.refundAppointment.mock.calls[0][3]).toEqual({ idempotencyKey: `refund-cancel-${a.id}` });
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

  it('customer cancel after a shop reschedule refunds in full even inside the cutoff (cancelled_by stays customer)', async () => {
    const w = world({ shop: { stripe_account_id: 'acct_1', stripe_charges_enabled: true } });
    const a = await booked(w, { pay: 'card' });
    Object.assign(w.state.appointments[0], { payment_status: 'deposit', amount_paid_cents: 1000 });
    w.setNow('2026-11-03T14:00:00Z'); // 1 h before, inside the 2 h cutoff
    expect(((await getManage({ token: a.manage_token }, w.deps)).body as any).refundCentsIfCancelled).toBe(0);
    w.state.appointments[0].shop_rescheduled_at = '2026-11-02T18:00:00.000Z';
    expect(((await getManage({ token: a.manage_token }, w.deps)).body as any).refundCentsIfCancelled).toBe(1000);
    expect((await postManage({ token: a.manage_token, action: 'cancel' }, w.deps)).status).toBe(200);
    expect(w.payments.refundAppointment.mock.calls[0][2]).toBe(1000);
    expect(w.state.appointments[0]).toMatchObject({ status: 'cancelled', cancelled_by: 'customer', amount_refunded_cents: 1000, payment_status: 'refunded' });
  });

  it('customer reschedule clears reminder_sent_at', async () => {
    const w = world();
    const a = await booked(w);
    w.state.appointments[0].reminder_sent_at = '2026-11-02T10:00:00.000Z';
    expect((await postManage({ token: a.manage_token, action: 'reschedule', start: '2026-11-04T15:00:00Z' }, w.deps)).status).toBe(200);
    expect(w.state.appointments[0].reminder_sent_at).toBeNull();
  });

  it('customer reschedule re-runs the duplicate check (same phone, same start, other barber)', async () => {
    const w = world();
    await booked(w, { memberId: w.ids.mike });
    const second = await booked(w, { memberId: w.ids.jay, start: '2026-11-03T16:00:00Z' });
    const r = await postManage({ token: second.manage_token, action: 'reschedule', start: T10, memberId: 'any' }, w.deps);
    expect(r).toEqual({ status: 409, body: { error: 'duplicate' } });
    expect(w.state.appointments[1].start_at).toBe('2026-11-03T16:00:00.000Z');
  });

  it('customer reschedule is compare-and-set on the old start: a concurrent owner move wins (409)', async () => {
    const w = world();
    const a = await booked(w, { memberId: w.ids.mike });
    const orig = w.deps.repo.updateAppointment;
    w.deps.repo.updateAppointment = async (id, patch, expect) => {
      // the owner moves it to 11:00 between our read and our write
      Object.assign(w.state.appointments[0], { start_at: '2026-11-03T16:00:00.000Z', end_at: '2026-11-03T16:30:00.000Z' });
      return orig(id, patch, expect);
    };
    const r = await postManage({ token: a.manage_token, action: 'reschedule', start: '2026-11-04T15:00:00Z' }, w.deps);
    expect(r).toEqual({ status: 409, body: { error: 'appointment-changed' } });
    expect(w.state.appointments[0].start_at).toBe('2026-11-03T16:00:00.000Z');
    expect(w.notified.filter((e) => e.kind === 'booking_rescheduled')).toHaveLength(0);
  });

  it('reschedule can switch to another barber or "any"', async () => {
    const w = world();
    const a = await booked(w, { memberId: w.ids.mike });
    const r = await postManage({ token: a.manage_token, action: 'reschedule', start: '2026-11-04T15:00:00Z', memberId: w.ids.jay }, w.deps);
    expect((r.body as any).appointment.memberName).toBe('Jay');
  });
});

describe('POST /api/book/sent', () => {
  const handles = { manual_handles: { cashapp: '$fresh', venmo: '@fresh' } };

  it('stamps customer_says_paid_at and pushes once (happy path)', async () => {
    const w = world({ shop: handles });
    await book(w, { pay: 'manual', method: 'cashapp' });
    const a = w.state.appointments[0];
    expect(await postSent({ token: a.manage_token, method: 'cashapp' }, w.deps)).toEqual({ status: 200, body: {} });
    expect(w.state.appointments[0].customer_says_paid_at).toBe('2026-11-02T12:00:00.000Z');
    expect(w.state.appointments[0]).toMatchObject({ payment_method: 'cashapp', payment_status: 'awaiting' });
    await postSent({ token: a.manage_token, method: 'cashapp' }, w.deps);
    expect(w.notified.filter((e) => e.kind === 'customer_says_paid')).toEqual([
      { kind: 'customer_says_paid', appointmentId: a.id, method: 'cashapp', amountCents: 3000 },
    ]);
  });

  async function expectRejected(w: ReturnType<typeof world>, token: string, method: string) {
    const before = JSON.stringify(w.state.appointments);
    expect(await postSent({ token, method }, w.deps)).toEqual({ status: 409, body: { error: 'not-awaiting-payment' } });
    expect(JSON.stringify(w.state.appointments)).toBe(before); // nothing changed
    expect(w.notified.filter((e) => e.kind === 'customer_says_paid')).toHaveLength(0); // no push
  }

  it("409 for a pay:'shop' booking, without rewriting its method", async () => {
    const w = world({ shop: handles });
    await book(w, { pay: 'shop' });
    await expectRejected(w, w.state.appointments[0].manage_token, 'cashapp');
    expect(w.state.appointments[0].payment_method).toBe('shop');
  });

  it('409 for a walk-in, even one carrying an email and a manual method', async () => {
    const w = world({ shop: handles });
    const { createOwnerAppointment } = await import('../../lib/bookings/ownerFlow.js');
    const r = await createOwnerAppointment('Bearer owner-jwt', {
      memberId: w.ids.mike, serviceId: w.ids.cut, start: T10, customer: { name: 'Walk In', email: 'w@example.com' },
    }, w.deps);
    expect(r.status).toBe(201);
    const walkIn = w.state.appointments[0];
    await expectRejected(w, walkIn.manage_token, 'cashapp');
    Object.assign(walkIn, { payment_method: 'cashapp', payment_status: 'awaiting' });
    await expectRejected(w, walkIn.manage_token, 'cashapp');
  });

  it('409 for a method other than the one chosen at booking', async () => {
    const w = world({ shop: handles });
    await book(w, { pay: 'manual', method: 'cashapp' });
    await expectRejected(w, w.state.appointments[0].manage_token, 'venmo');
    expect(w.state.appointments[0].payment_method).toBe('cashapp');
  });

  it('409 for a manual booking with no rail recorded, a card booking, or one already paid', async () => {
    const w = world({ shop: { ...handles, stripe_account_id: 'acct_1', stripe_charges_enabled: true } });
    await book(w, { pay: 'manual' }); // several rails, none named -> null
    await expectRejected(w, w.state.appointments[0].manage_token, 'cashapp');
    await book(w, { pay: 'card', customer: { ...customer, phone: '5550001111' } });
    await expectRejected(w, w.state.appointments[1].manage_token, 'cashapp');
    await book(w, { pay: 'manual', method: 'venmo', start: '2026-11-03T16:00:00.000Z', customer: { ...customer, phone: '5550002222' } });
    w.state.appointments[2].payment_status = 'paid';
    await expectRejected(w, w.state.appointments[2].manage_token, 'venmo');
  });

  it('rejects a method the shop does not take', async () => {
    const w = world({ shop: { manual_handles: { cashapp: '$fresh' } } });
    await book(w, { pay: 'manual' });
    expect((await postSent({ token: w.state.appointments[0].manage_token, method: 'zelle' }, w.deps)).body).toEqual({ error: 'invalid', field: 'method' });
    expect((await postSent({ token: w.state.appointments[0].manage_token, method: 'gold' }, w.deps)).body).toEqual({ error: 'invalid', field: 'method' });
  });
});

describe('strict input', () => {
  it.each([
    '2026-11-31T15:00:00Z', // Nov 31 would roll over to Dec 1
    '2026-02-30T15:00:00Z',
    '2026-11-03T24:00:00Z', // T24 would roll over to the next day
    '2026-11-03T15:60:00Z',
  ])('rejects the rolled-over instant %s', async (start) => {
    const w = world();
    expect(await book(w, { start })).toEqual({ status: 400, body: { error: 'invalid', field: 'start' } });
  });

  it('strips control characters from the name and note; newlines in the note become spaces', async () => {
    const w = world();
    const r = await book(w, { customer: { ...customer, name: 'Sam\u0000 Lee\u0007\n' }, note: 'Fade\r\nlow on the sides\u001b[31m\ttoo' });
    expect(r.status).toBe(201);
    expect(w.state.appointments[0]).toMatchObject({ customer_name: 'Sam Lee', note: 'Fade low on the sides[31m too' });
  });

  it('a name made only of control characters is invalid', async () => {
    const w = world();
    expect(await book(w, { customer: { ...customer, name: '\u0001\u0002\n' } })).toEqual({ status: 400, body: { error: 'invalid', field: 'customer.name' } });
  });
});

describe('timezones at the API level', () => {
  it('a Honolulu shop open until 22:00 lists and books slots past UTC midnight under the local date', async () => {
    const w = world({ shop: { timezone: 'Pacific/Honolulu', min_notice_min: 0 } });
    for (const a of w.state.availability) a.end_min = 22 * 60;
    const date = '2026-11-03'; // Tue
    const slots = ((await getSlots({ slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: 'any', date }, w.deps)).body as any).slots;
    expect(slots[0].start).toBe('2026-11-03T19:00:00.000Z'); // 9:00 HST
    expect(slots.at(-1).start).toBe('2026-11-04T07:30:00.000Z'); // 21:30 HST, the next UTC day
    const days = ((await getDays({ slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: 'any', month: '2026-11' }, w.deps)).body as any).days;
    expect(days[date]).toBe(true);
    expect(days['2026-11-02']).toBeUndefined(); // Monday closed
    expect(days['2026-11-08']).toBeUndefined(); // Sunday closed
    const r = await book(w, { start: '2026-11-04T07:30:00.000Z' });
    expect(r.status).toBe(201);
    expect((r.body as any).appointment).toMatchObject({ start: '2026-11-04T07:30:00.000Z', end: '2026-11-04T08:00:00.000Z' });
    // and the next local day's slots do not include it
    const wed = ((await getSlots({ slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: w.ids.mike, date: '2026-11-04' }, w.deps)).body as any).slots;
    expect(wed[0].start).toBe('2026-11-04T19:00:00.000Z');
  });

  it('New York across the 2026-11-01 DST end: 9:00 local is 13:00Z before and 14:00Z after', async () => {
    const w = world();
    w.setNow('2026-10-29T12:00:00Z');
    const sat = ((await getSlots({ slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: 'any', date: '2026-10-31' }, w.deps)).body as any).slots;
    const tue = ((await getSlots({ slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: 'any', date: '2026-11-03' }, w.deps)).body as any).slots;
    expect(sat[0].start).toBe('2026-10-31T13:00:00.000Z');
    expect(sat.at(-1).start).toBe('2026-10-31T21:30:00.000Z'); // 17:30 EDT
    expect(tue[0].start).toBe('2026-11-03T14:00:00.000Z');
    expect(tue.at(-1).start).toBe('2026-11-03T22:30:00.000Z'); // 17:30 EST
    const days = ((await getDays({ slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: 'any', month: '2026-11' }, w.deps)).body as any).days;
    expect(days['2026-11-01']).toBeUndefined(); // the DST Sunday is closed
    expect(days['2026-11-03']).toBe(true);
    expect((await book(w, { start: '2026-10-31T13:00:00.000Z' })).status).toBe(201);
    expect((await book(w, { start: '2026-11-03T14:00:00.000Z' })).status).toBe(201);
    // 9:00 EST-equivalent on the EDT Saturday (14:00Z = 10:00 EDT) is a normal slot, 13:00Z on Tuesday (8:00 EST) is closed
    expect((await book(w, { start: '2026-11-03T13:00:00.000Z', customer: { ...customer, phone: '5550001111' } })).status).toBe(409);
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
    expect(body).toContain('SUMMARY:Haircut · Sam Lee');
    expect(body).toContain('UID:');
    expect((await getIcs({ t: 'z'.repeat(40) }, w.deps)).status).toBe(404);
  });
});
