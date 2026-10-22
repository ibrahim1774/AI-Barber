import { describe, it, expect, vi } from 'vitest';
import {
  cancelOwnerAppointment,
  createOwnerAppointment,
  createTimeOff,
  markOwnerAppointment,
  registerPushToken,
  rescheduleOwnerAppointment,
  setupShop,
} from '../../lib/bookings/ownerFlow.js';
import { createAppointment } from '../../lib/bookings/publicFlow.js';
import { OTID, OWNER_USER, world } from './fakeRepo.js';

const AUTH = 'Bearer owner-jwt';
const T10 = '2026-11-03T15:00:00.000Z';

async function publicBooking(w: ReturnType<typeof world>, over: Record<string, unknown> = {}) {
  const r = await createAppointment({
    slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: w.ids.mike, start: T10,
    customer: { name: 'Sam', phone: '5551234567', email: 'sam@example.com' }, pay: 'shop', ...over,
  }, w.deps);
  expect(r.status).toBe(201);
  return w.state.appointments.at(-1)!;
}

describe('owner auth', () => {
  it.each([
    [undefined],
    ['Basic abc'],
    ['Bearer nope'],
  ])('401 for %s', async (h) => {
    const w = world();
    expect(await createOwnerAppointment(h as any, {}, w.deps)).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(await setupShop(h as any, {}, w.deps)).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(await registerPushToken(h as any, {}, w.deps)).toEqual({ status: 401, body: { error: 'unauthorized' } });
  });

  it('a signed-in user without a shop gets 404 no-shop', async () => {
    const w = world();
    w.users['stranger'] = { id: '99999999-9999-4999-8999-999999999999', email: null, fullName: null };
    expect(await cancelOwnerAppointment('Bearer stranger', w.state.members[0].id, w.deps)).toEqual({ status: 404, body: { error: 'no-shop' } });
  });

  it("cannot touch another shop's appointment", async () => {
    const w = world();
    const a = await publicBooking(w);
    w.state.appointments[0].shop_id = crypto.randomUUID(); // belongs elsewhere now
    expect((await cancelOwnerAppointment(AUTH, a.id, w.deps)).status).toBe(404);
    expect((await rescheduleOwnerAppointment(AUTH, a.id, { start: T10 }, w.deps)).status).toBe(404);
  });
});

describe('POST /api/shop/appointments (walk-in)', () => {
  it('skips notice and the slot grid; end = start + duration', async () => {
    const w = world();
    w.setNow('2026-11-03T15:05:00Z');
    const r = await createOwnerAppointment(AUTH, {
      memberId: w.ids.jay, serviceId: w.ids.cut, start: '2026-11-03T15:10:00Z', customer: { name: 'Walk In' },
    }, w.deps);
    expect(r.status).toBe(201);
    expect((r.body as any).appointment).toMatchObject({ start: '2026-11-03T15:10:00.000Z', end: '2026-11-03T15:40:00.000Z', memberName: 'Jay', source: 'walk_in' });
    expect(w.state.appointments[0]).toMatchObject({ payment_status: 'none', payment_method: null, customer_phone: null });
  });

  it('409 slot-taken from the exclusion constraint', async () => {
    const w = world();
    await publicBooking(w);
    const r = await createOwnerAppointment(AUTH, { memberId: w.ids.mike, serviceId: w.ids.cut, start: '2026-11-03T15:15:00Z', customer: { name: 'X' } }, w.deps);
    expect(r.status).toBe(409);
    expect((r.body as any).error).toBe('slot-taken');
    expect((r.body as any).alternatives).toHaveLength(3);
  });

  it('rejects ids that are not this shop’s active member/service', async () => {
    const w = world();
    w.state.members[1].active = false;
    expect((await createOwnerAppointment(AUTH, { memberId: w.ids.jay, serviceId: w.ids.cut, start: T10, customer: { name: 'X' } }, w.deps)).body)
      .toEqual({ error: 'invalid', field: 'memberId' });
    expect((await createOwnerAppointment(AUTH, { memberId: w.ids.mike, serviceId: crypto.randomUUID(), start: T10, customer: { name: 'X' } }, w.deps)).body)
      .toEqual({ error: 'invalid', field: 'serviceId' });
  });
});

describe('POST /api/shop/appointments/:id/cancel', () => {
  it('refunds everything paid even after the cutoff, cancelled_by shop, once', async () => {
    const w = world({ shop: { stripe_account_id: 'acct_1', stripe_charges_enabled: true } });
    const a = await publicBooking(w, { pay: 'card' });
    Object.assign(w.state.appointments[0], { payment_status: 'deposit', amount_paid_cents: 1000 });
    w.setNow('2026-11-03T14:50:00Z');
    const r = await cancelOwnerAppointment(AUTH, a.id, w.deps);
    expect(r.status).toBe(200);
    expect((r.body as any).appointment).toMatchObject({ status: 'cancelled', cancelledBy: 'shop', amountRefundedCents: 1000, paymentStatus: 'refunded' });
    expect(w.payments.refundAppointment.mock.calls[0][2]).toBe(1000);
    expect(w.payments.refundAppointment.mock.calls[0][3]).toEqual({ idempotencyKey: `refund-cancel-${a.id}-1000-0` });
    expect((await cancelOwnerAppointment(AUTH, a.id, w.deps)).status).toBe(200);
    expect(w.payments.refundAppointment).toHaveBeenCalledTimes(1);
    const ev = w.notified.find((e) => e.kind === 'booking_cancelled') as any;
    expect(ev).toEqual({ kind: 'booking_cancelled', appointmentId: a.id, by: 'shop', refundedCents: 1000 });
  });

  it('writes the refunded total as an absolute value that never lowers a higher stored total', async () => {
    const w = world({ shop: { stripe_account_id: 'acct_1', stripe_charges_enabled: true } });
    const a = await publicBooking(w, { pay: 'card' });
    Object.assign(w.state.appointments[0], { payment_status: 'paid', amount_paid_cents: 3000 });
    w.payments.refundAppointment.mockImplementationOnce(async () => {
      // S2's charge.refunded webhook lands first with Stripe's cumulative total (a dashboard
      // refund of 2000 plus ours of 1000)
      w.state.appointments[0].amount_refunded_cents = 3000;
      return { refundedCents: 1000 };
    });
    await cancelOwnerAppointment(AUTH, a.id, w.deps);
    expect(w.state.appointments[0].amount_refunded_cents).toBe(3000); // not 1000 (lowered), not 4000 (incremented)
  });

  it('cancel sets cancelled_at and refunds from the row the atomic claim returned, not an earlier read', async () => {
    const w = world({ shop: { stripe_account_id: 'acct_1', stripe_charges_enabled: true } });
    const a = await publicBooking(w, { pay: 'card' });
    const { cancelAppointment } = await import('../../lib/bookings/core.js');
    const stale = { ...w.state.appointments[0] }; // read while still unpaid
    Object.assign(w.state.appointments[0], { payment_status: 'paid', amount_paid_cents: 3000 }); // payment lands
    w.setNow('2026-11-03T14:50:00Z');
    const out = await cancelAppointment(w.deps, w.shop(), stale, 'shop');
    expect(out.refundedCents).toBe(3000);
    expect(w.payments.refundAppointment.mock.calls[0][1]).toMatchObject({ amount_paid_cents: 3000 });
    expect(w.payments.expireCheckoutSession).not.toHaveBeenCalled(); // the claimed row is no longer an unpaid hold
    expect(w.state.appointments[0]).toMatchObject({ status: 'cancelled', cancelled_at: '2026-11-03T14:50:00.000Z' });
  });

  it('refunds only what is still refundable', async () => {
    const w = world({ shop: { stripe_account_id: 'acct_1', stripe_charges_enabled: true } });
    const a = await publicBooking(w, { pay: 'card' });
    Object.assign(w.state.appointments[0], { payment_status: 'partially_refunded', amount_paid_cents: 3000, amount_refunded_cents: 1000 });
    await cancelOwnerAppointment(AUTH, a.id, w.deps);
    expect(w.payments.refundAppointment.mock.calls[0][2]).toBe(2000);
    expect(w.state.appointments[0]).toMatchObject({ amount_refunded_cents: 3000, payment_status: 'refunded' });
  });

  it('a done appointment cannot be cancelled', async () => {
    const w = world();
    const a = await publicBooking(w);
    w.state.appointments[0].status = 'done';
    expect(await cancelOwnerAppointment(AUTH, a.id, w.deps)).toEqual({ status: 409, body: { error: 'not-cancellable' } });
  });
});

describe('POST /api/shop/appointments/:id/reschedule', () => {
  it('moves in place (owner skips notice), notifies, no refund', async () => {
    const w = world({ shop: { stripe_account_id: 'acct_1', stripe_charges_enabled: true } });
    const a = await publicBooking(w, { pay: 'card' });
    Object.assign(w.state.appointments[0], { payment_status: 'paid', amount_paid_cents: 3000 });
    w.setNow('2026-11-03T14:59:00Z');
    const r = await rescheduleOwnerAppointment(AUTH, a.id, { start: '2026-11-03T15:20:00Z', memberId: w.ids.jay }, w.deps);
    expect(r.status).toBe(200);
    expect((r.body as any).appointment).toMatchObject({ start: '2026-11-03T15:20:00.000Z', end: '2026-11-03T15:50:00.000Z', memberName: 'Jay' });
    expect(w.payments.refundAppointment).not.toHaveBeenCalled();
    expect(w.notified.at(-1)).toEqual({ kind: 'booking_rescheduled', appointmentId: a.id, by: 'shop' });
  });

  it('stamps shop_rescheduled_at and clears reminder_sent_at', async () => {
    const w = world();
    const a = await publicBooking(w);
    w.state.appointments[0].reminder_sent_at = '2026-11-02T10:00:00.000Z';
    w.setNow('2026-11-02T13:00:00Z');
    expect((await rescheduleOwnerAppointment(AUTH, a.id, { start: '2026-11-04T15:00:00Z' }, w.deps)).status).toBe(200);
    expect(w.state.appointments[0]).toMatchObject({ reminder_sent_at: null, shop_rescheduled_at: '2026-11-02T13:00:00.000Z' });
  });

  it('a customer cancel after a shop reschedule refunds in full; cancelled_by stays customer', async () => {
    const w = world({ shop: { stripe_account_id: 'acct_1', stripe_charges_enabled: true } });
    const a = await publicBooking(w, { pay: 'card' });
    Object.assign(w.state.appointments[0], { payment_status: 'paid', amount_paid_cents: 3000 });
    expect((await rescheduleOwnerAppointment(AUTH, a.id, { start: '2026-11-03T16:00:00Z' }, w.deps)).status).toBe(200);
    w.setNow('2026-11-03T15:30:00Z'); // 30 min before the new start, inside the 2 h cutoff
    const { postManage } = await import('../../lib/bookings/publicFlow.js');
    expect((await postManage({ token: a.manage_token, action: 'cancel' }, w.deps)).status).toBe(200);
    expect(w.payments.refundAppointment.mock.calls[0][2]).toBe(3000);
    expect(w.state.appointments[0]).toMatchObject({ cancelled_by: 'customer', amount_refunded_cents: 3000, payment_status: 'refunded' });
  });

  it('owner start fields must be real, whole-minute instants', async () => {
    const w = world();
    const a = await publicBooking(w);
    for (const start of ['2027-02-30T15:00:00Z', '2026-11-03T24:00:00Z', '2026-11-04T15:00:59.999Z', '2026-11-04T15:00:30Z']) {
      expect(await rescheduleOwnerAppointment(AUTH, a.id, { start }, w.deps)).toEqual({ status: 400, body: { error: 'invalid', field: 'start' } });
      expect(await createOwnerAppointment(AUTH, { memberId: w.ids.jay, serviceId: w.ids.cut, start, customer: { name: 'X' } }, w.deps))
        .toEqual({ status: 400, body: { error: 'invalid', field: 'start' } });
      expect(await createTimeOff(AUTH, { memberId: w.ids.jay, start, end: '2027-03-05T00:00:00Z' }, w.deps))
        .toEqual({ status: 400, body: { error: 'invalid', field: 'start' } });
    }
    expect((await rescheduleOwnerAppointment(AUTH, a.id, { start: '2026-11-04T15:00:00.000Z' }, w.deps)).status).toBe(200);
    expect(w.state.appointments).toHaveLength(1);
    expect(w.state.timeOff).toHaveLength(0);
  });

  it('409 when it would overlap another booking', async () => {
    const w = world();
    const a = await publicBooking(w);
    await publicBooking(w, { start: '2026-11-03T16:00:00Z', customer: { name: 'B', phone: '5550001111', email: 'b@example.com' } });
    const r = await rescheduleOwnerAppointment(AUTH, a.id, { start: '2026-11-03T15:45:00Z' }, w.deps);
    expect(r.status).toBe(409);
    expect(w.state.appointments.find((x) => x.id === a.id)!.start_at).toBe(T10);
  });
});

describe('POST /api/shop/appointments/:id/mark', () => {
  const mark = (w: ReturnType<typeof world>, id: string, action: unknown) => markOwnerAppointment(AUTH, id, { action }, w.deps);

  it('done and no_show only from booked; a repeat is a no-op 200', async () => {
    const w = world();
    const a = await publicBooking(w);
    const r = await mark(w, a.id, 'done');
    expect(r.status).toBe(200);
    expect((r.body as any).appointment).toMatchObject({ id: a.id, status: 'done', memberName: 'Mike', paymentStatus: 'none', paymentMethod: 'shop' });
    expect(w.state.appointments[0].status).toBe('done');
    expect((await mark(w, a.id, 'done')).status).toBe(200);
    expect(await mark(w, a.id, 'no_show')).toEqual({ status: 409, body: { error: 'not-markable' } });
    expect(w.state.appointments[0].status).toBe('done');

    const b = await publicBooking(w, { start: '2026-11-03T16:00:00Z', customer: { name: 'B', phone: '5550001111', email: 'b@example.com' } });
    expect(((await mark(w, b.id, 'no_show')).body as any).appointment.status).toBe('no_show');
    w.state.appointments[1].status = 'cancelled';
    expect(await mark(w, b.id, 'done')).toEqual({ status: 409, body: { error: 'not-markable' } });
  });

  it('paid: an in-shop booking becomes paid at its price', async () => {
    const w = world();
    const a = await publicBooking(w);
    const r = await mark(w, a.id, 'paid');
    expect((r.body as any).appointment).toMatchObject({ paymentStatus: 'paid', amountPaidCents: 3000, paymentMethod: 'shop', status: 'booked' });
    expect(w.state.appointments[0]).toMatchObject({ payment_status: 'paid', amount_paid_cents: 3000, payment_method: 'shop' });
    expect((await mark(w, a.id, 'paid')).status).toBe(200); // repeat: no-op
  });

  it('paid: a walk-in with no method becomes shop; a manual rail keeps its method; never below what was paid', async () => {
    const w = world({ shop: { manual_handles: { venmo: '@fresh' } } });
    const walk = await createOwnerAppointment(AUTH, { memberId: w.ids.jay, serviceId: w.ids.cut, start: T10, customer: { name: 'W' } }, w.deps);
    const walkId = (walk.body as any).appointment.id;
    expect(((await mark(w, walkId, 'paid')).body as any).appointment).toMatchObject({ paymentMethod: 'shop', amountPaidCents: 3000 });

    const m = await publicBooking(w, { pay: 'manual' });
    expect(w.state.appointments.find((x) => x.id === m.id)).toMatchObject({ payment_method: 'venmo', payment_status: 'awaiting' });
    Object.assign(w.state.appointments.find((x) => x.id === m.id)!, { payment_status: 'deposit', amount_paid_cents: 4000 });
    expect(((await mark(w, m.id, 'paid')).body as any).appointment).toMatchObject({ paymentMethod: 'venmo', paymentStatus: 'paid', amountPaidCents: 4000 });

    w.state.services[0].price_cents = null;
    const free = await createOwnerAppointment(AUTH, { memberId: w.ids.jay, serviceId: w.ids.cut, start: '2026-11-03T17:00:00Z', customer: { name: 'F' } }, w.deps);
    expect(((await mark(w, (free.body as any).appointment.id, 'paid')).body as any).appointment).toMatchObject({ amountPaidCents: 0, paymentStatus: 'paid' });
  });

  it('paid: 409 for card bookings (Stripe owns card money) and for refunded ones; nothing changes', async () => {
    const w = world({ shop: { stripe_account_id: 'acct_1', stripe_charges_enabled: true } });
    const a = await publicBooking(w, { pay: 'card' });
    const before = JSON.stringify(w.state.appointments[0]);
    expect(await mark(w, a.id, 'paid')).toEqual({ status: 409, body: { error: 'card-payment' } });
    expect(JSON.stringify(w.state.appointments[0])).toBe(before);

    const b = await publicBooking(w, { start: '2026-11-03T16:00:00Z', customer: { name: 'B', phone: '5550001111', email: 'b@example.com' } });
    Object.assign(w.state.appointments[1], { payment_status: 'refunded', payment_method: 'shop' });
    expect(await mark(w, b.id, 'paid')).toEqual({ status: 409, body: { error: 'not-markable' } });
    expect(w.state.appointments[1].payment_status).toBe('refunded');
  });

  it('paid is compare-and-set: a concurrent change is not overwritten', async () => {
    const w = world();
    const a = await publicBooking(w);
    const orig = w.deps.repo.updateAppointment;
    w.deps.repo.updateAppointment = async (id, patch, expect) => {
      Object.assign(w.state.appointments[0], { payment_status: 'refunded' });
      return orig(id, patch, expect);
    };
    expect(await mark(w, a.id, 'paid')).toEqual({ status: 409, body: { error: 'not-markable' } });
    expect(w.state.appointments[0]).toMatchObject({ payment_status: 'refunded', amount_paid_cents: 0 });
  });

  it('validates the action, auth and ownership', async () => {
    const w = world();
    const a = await publicBooking(w);
    expect(await mark(w, a.id, 'refund')).toEqual({ status: 400, body: { error: 'invalid', field: 'action' } });
    expect(await markOwnerAppointment(AUTH, a.id, undefined, w.deps)).toEqual({ status: 400, body: { error: 'invalid', field: 'body' } });
    expect(await markOwnerAppointment('Bearer nope', a.id, { action: 'done' }, w.deps)).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect((await mark(w, crypto.randomUUID(), 'done')).status).toBe(404);
    w.state.appointments[0].shop_id = crypto.randomUUID();
    expect((await mark(w, a.id, 'done')).status).toBe(404);
  });
});

describe('POST /api/shop/time-off', () => {
  it('lists conflicts without cancelling, stores the block once, then cancels with refund', async () => {
    const w = world({ shop: { stripe_account_id: 'acct_1', stripe_charges_enabled: true } });
    const a = await publicBooking(w, { pay: 'card' });
    Object.assign(w.state.appointments[0], { payment_status: 'paid', amount_paid_cents: 3000 });
    const body = { memberId: w.ids.mike, start: '2026-11-03T14:00:00Z', end: '2026-11-03T23:00:00Z', reason: 'Dentist', cancelConflicts: false };
    const r1 = await createTimeOff(AUTH, body, w.deps);
    expect(r1).toEqual({ status: 200, body: { conflicts: [{ id: a.id, start: T10, customerName: 'Sam' }] } });
    expect(w.state.appointments[0].status).toBe('booked');
    const r2 = await createTimeOff(AUTH, { ...body, cancelConflicts: true }, w.deps);
    expect((r2.body as any).conflicts).toHaveLength(1);
    expect(w.state.timeOff).toHaveLength(1);
    expect(w.state.appointments[0]).toMatchObject({ status: 'cancelled', cancelled_by: 'shop', payment_status: 'refunded' });
    expect(w.payments.refundAppointment).toHaveBeenCalledTimes(1);
  });

  it('validates the range and the member', async () => {
    const w = world();
    expect((await createTimeOff(AUTH, { memberId: w.ids.mike, start: '2026-11-03T14:00:00Z', end: '2026-11-03T14:00:00Z' }, w.deps)).body)
      .toEqual({ error: 'invalid', field: 'end' });
    expect((await createTimeOff(AUTH, { memberId: crypto.randomUUID(), start: '2026-11-03T14:00:00Z', end: '2026-11-03T15:00:00Z' }, w.deps)).body)
      .toEqual({ error: 'invalid', field: 'memberId' });
  });
});

describe('POST /api/shop/push-token', () => {
  it('upserts, moving a token to the new user', async () => {
    const w = world();
    const token = 'ExponentPushToken[abcdefghijklmnop]';
    w.state.pushTokens.push({ user_id: 'someone-else', expo_token: token, platform: 'ios' });
    expect(await registerPushToken(AUTH, { expoToken: token, platform: 'ios' }, w.deps)).toEqual({ status: 200, body: {} });
    expect(w.state.pushTokens).toEqual([{ user_id: OWNER_USER, expo_token: token, platform: 'ios' }]);
    expect((await registerPushToken(AUTH, { expoToken: 'junk', platform: 'ios' }, w.deps)).body).toEqual({ error: 'invalid', field: 'expoToken' });
    expect((await registerPushToken(AUTH, { expoToken: token, platform: 'web' }, w.deps)).body).toEqual({ error: 'invalid', field: 'platform' });
  });
});

describe('POST /api/shop/setup', () => {
  const NEW_USER = '22222222-2222-4222-8222-222222222222';
  const SITE = '33333333-3333-4333-8333-333333333333';
  const body = {
    siteId: SITE, name: 'Kings Cuts', timezone: 'America/Chicago', address: '9 Elm', phone: '555-0100',
    services: [{ name: 'Haircut', priceCents: 3500, durationMin: 30 }, { name: 'Beard', priceCents: null, durationMin: 15, description: 'Trim' }],
  };
  const setup = (w: ReturnType<typeof world>, b: Record<string, unknown> = body) => setupShop('Bearer new-jwt', b, w.deps);
  function fresh() {
    const w = world();
    w.users['new-jwt'] = { id: NEW_USER, email: 'k@example.com', fullName: 'King Kong' };
    return w;
  }

  it('creates the shop (service role), owner member, default hours and services', async () => {
    const w = fresh();
    const r = await setup(w);
    expect(r.status).toBe(200);
    const shop = (r.body as any).shop;
    expect(shop).toMatchObject({ slug: 'kings-cuts', name: 'Kings Cuts', timezone: 'America/Chicago', bookingsEnabled: false, purchaseLinked: false });
    const row = w.state.shops.find((s) => s.owner_id === NEW_USER)!;
    // off until the app's setup wizard finishes
    expect(row).toMatchObject({ site_id: SITE, address: '9 Elm', phone: '555-0100', ios_otid: null, bookings_enabled: false });
    const owner = w.state.members.find((m) => m.shop_id === row.id)!;
    expect(owner).toMatchObject({ role: 'owner', user_id: NEW_USER, display_name: 'King Kong' });
    expect(w.state.availability.filter((a) => a.member_id === owner.id).map((a) => [a.weekday, a.start_min, a.end_min]))
      .toEqual([[1, 540, 1080], [2, 540, 1080], [3, 540, 1080], [4, 540, 1080], [5, 540, 1080]]);
    expect(w.state.services.filter((s) => s.shop_id === row.id).map((s) => [s.name, s.price_cents, s.duration_min, s.sort]))
      .toEqual([['Haircut', 3500, 30, 0], ['Beard', null, 15, 1]]);
  });

  it('is idempotent: a second call returns the same shop and adds nothing', async () => {
    const w = fresh();
    const a = await setup(w);
    const b = await setup(w, { ...body, name: 'Other Name' });
    expect((b.body as any).shop.id).toBe((a.body as any).shop.id);
    expect((b.body as any).shop.name).toBe('Kings Cuts');
    expect(w.state.shops).toHaveLength(2);
    expect(w.state.services.filter((s) => s.shop_id === (a.body as any).shop.id)).toHaveLength(2);
    expect(w.state.availability.length).toBe(15);
  });

  it('repairs a half-built shop (no owner member yet)', async () => {
    const w = fresh();
    await setup(w);
    const shopId = w.state.shops[1].id;
    w.state.members = w.state.members.filter((m) => m.shop_id !== shopId);
    await setup(w);
    const owners = w.state.members.filter((m) => m.shop_id === shopId && m.role === 'owner');
    expect(owners).toHaveLength(1);
    // A freshly created owner member gets the default hours.
    expect(w.state.availability.filter((a) => a.member_id === owners[0].id)).toHaveLength(5);
  });

  it('a re-link re-POST (services: []) never gives an owner who closed every day default hours back', async () => {
    const w = fresh();
    const a = await setup(w);
    const shopId = (a.body as any).shop.id;
    const owner = w.state.members.find((m) => m.shop_id === shopId && m.role === 'owner')!;
    w.state.availability = w.state.availability.filter((x) => x.member_id !== owner.id); // closed every day
    (w.deps.purchases!.verify as any).mockResolvedValueOnce({ originalTransactionId: '2000000777' });
    const r = await setup(w, { ...body, services: [], transactionId: '2000000555' });
    expect(r.status).toBe(200);
    expect((r.body as any).shop.purchaseLinked).toBe(true);
    expect(w.state.availability.filter((x) => x.member_id === owner.id)).toHaveLength(0);
    expect(w.state.services.filter((s) => s.shop_id === shopId)).toHaveLength(2);
  });

  it("uses the site's Vercel label as the slug, suffixing when taken or reserved", async () => {
    const w = fresh();
    w.state.sites[SITE] = { user_id: NEW_USER, deployed_url: 'https://kings-barber.vercel.app' };
    expect(((await setup(w)).body as any).shop.slug).toBe('kings-barber');

    const w2 = fresh();
    w2.state.sites[SITE] = { user_id: NEW_USER, deployed_url: 'https://fresh-cuts.vercel.app' }; // taken by the world shop
    expect(((await setup(w2)).body as any).shop.slug).toBe('fresh-cuts-x000');

    const w3 = fresh();
    expect(((await setup(w3, { ...body, name: 'Manage' })).body as any).shop.slug).toBe('manage-x000');
  });

  it("rejects another user's site", async () => {
    const w = fresh();
    w.state.sites[SITE] = { user_id: OWNER_USER, deployed_url: 'https://x.vercel.app' };
    expect(await setup(w)).toEqual({ status: 400, body: { error: 'invalid', field: 'siteId' } });
    expect(w.state.shops).toHaveLength(1);
  });

  describe('per-user write limit on the Apple verify (fix round 2)', () => {
    it('over the limit → 429 rate-limited with Retry-After, before Apple is asked or a shop is made; keyed by user', async () => {
      const w = fresh();
      w.deps.writeLimiter = { allow: vi.fn(async () => false) };
      const r = await setup(w, { ...body, transactionId: '2000000555' });
      expect(r).toEqual({ status: 429, body: { error: 'rate-limited' }, headers: { 'Retry-After': '60' } });
      expect(w.deps.writeLimiter.allow).toHaveBeenCalledWith(NEW_USER, 'write') // the limiter's own 'user' scope;
      expect(w.deps.purchases!.verify).not.toHaveBeenCalled();
      expect(w.state.shops).toHaveLength(1);
    });

    it('a setup without a transaction is not limited (no Apple call)', async () => {
      const w = fresh();
      w.deps.writeLimiter = { allow: vi.fn(async () => false) };
      expect((await setup(w)).status).toBe(200);
      expect(w.deps.writeLimiter.allow).not.toHaveBeenCalled();
    });

    it('a limiter failure fails open', async () => {
      const w = fresh();
      (w.deps.purchases!.verify as any).mockResolvedValueOnce({ originalTransactionId: '2000000888' });
      w.deps.writeLimiter = { allow: vi.fn(async () => { throw new Error('store down'); }) };
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect((await setup(w, { ...body, transactionId: '2000000555' })).status).toBe(200);
      err.mockRestore();
    });
  });

  it('verifies and links the purchase; refuses one owned by someone else', async () => {
    const w = fresh();
    const NEW_OTID = '2000000999';
    (w.deps.purchases!.verify as any).mockResolvedValueOnce({ originalTransactionId: NEW_OTID });
    const r = await setup(w, { ...body, transactionId: '2000000555' });
    expect((r.body as any).shop.purchaseLinked).toBe(true);
    expect(w.state.shops[1].ios_otid).toBe(NEW_OTID);

    const w2 = fresh();
    const r2 = await setup(w2, { ...body, transactionId: '2000000555' }); // verifies to OTID, owned by OWNER_USER
    expect(r2).toEqual({ status: 409, body: { error: 'purchase-in-use' } });
    expect(w2.state.shops).toHaveLength(1);
  });

  it('attaches an account-less purchase to the caller (ios_purchases.user_id was null)', async () => {
    const w = fresh();
    const NEW_OTID = '2000000777';
    w.state.purchases[NEW_OTID] = { user_id: null, product_id: 'com.ibrahim1774.aibarber.store.monthly', revoked_at: null, taken_down_at: null };
    (w.deps.purchases!.verify as any).mockResolvedValueOnce({ originalTransactionId: NEW_OTID });
    expect((await setup(w, { ...body, transactionId: '2000000555' })).status).toBe(200);
    expect(w.deps.purchases!.setUser).toHaveBeenCalledWith(NEW_OTID, NEW_USER);
    expect(w.state.purchases[NEW_OTID].user_id).toBe(NEW_USER);
  });

  it('still creates the shop when linking the purchase to the account fails', async () => {
    const w = fresh();
    const NEW_OTID = '2000000778';
    w.state.purchases[NEW_OTID] = { user_id: null, product_id: 'com.ibrahim1774.aibarber.store.monthly', revoked_at: null, taken_down_at: null };
    (w.deps.purchases!.verify as any).mockResolvedValueOnce({ originalTransactionId: NEW_OTID });
    (w.deps.purchases!.setUser as any).mockRejectedValueOnce(new Error('db down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await setup(w, { ...body, transactionId: '2000000555' })).status).toBe(200);
    expect(w.state.shops.some((sh: any) => sh.owner_id === NEW_USER)).toBe(true);
    err.mockRestore();
  });

  it("does not re-attach a purchase that is already the caller's", async () => {
    const w = world();
    expect((await setupShop(AUTH, { ...body, transactionId: '2000000555' }, w.deps)).status).toBe(200);
    expect(w.deps.purchases!.setUser).not.toHaveBeenCalled();
  });

  it('maps verifier failures', async () => {
    const w = fresh();
    (w.deps.purchases!.verify as any).mockRejectedValueOnce(Object.assign(new Error('nf'), { code: 'not-found' }));
    expect((await setup(w, { ...body, transactionId: '1' })).body).toEqual({ error: 'invalid', field: 'transactionId' });
    (w.deps.purchases!.verify as any).mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'apple-unavailable' }));
    expect((await setup(w, { ...body, transactionId: '1' })).status).toBe(503);
  });

  it('a concurrent setup that already created the shop is returned, not duplicated', async () => {
    const w = fresh();
    const repo = w.deps.repo;
    const origByOwner = repo.shopByOwner;
    let calls = 0;
    repo.shopByOwner = async (id) => (calls++ === 0 ? null : origByOwner(id)); // first look misses
    // the "other request" wins the insert
    await repo.insertShop({ owner_id: NEW_USER, site_id: SITE, slug: 'kings-cuts', name: 'Kings Cuts', timezone: 'America/Chicago', address: null, phone: null, accent: null, bookings_enabled: true });
    const r = await setup(w);
    expect(r.status).toBe(200);
    expect(w.state.shops.filter((s) => s.owner_id === NEW_USER)).toHaveLength(1);
  });

  it.each([
    [{ siteId: 'nope' }, 'siteId'],
    [{ name: '' }, 'name'],
    [{ timezone: 'Mars/Olympus' }, 'timezone'],
    [{ accent: 'red' }, 'accent'],
    [{ transactionId: 'abc' }, 'transactionId'],
    [{ services: [{ name: 'X', priceCents: -1, durationMin: 30 }] }, 'services'],
    [{ services: [{ name: 'X', priceCents: 100, durationMin: 0 }] }, 'services'],
  ])('400 for %j', async (over, field) => {
    const w = fresh();
    expect(await setup(w, { ...body, ...over })).toEqual({ status: 400, body: { error: 'invalid', field } });
  });

  it('the existing world owner gets their shop back', async () => {
    const w = world();
    const r = await setupShop(AUTH, { ...body, transactionId: '2000000555' }, w.deps);
    expect((r.body as any).shop).toMatchObject({ id: w.ids.shopId, slug: 'fresh-cuts', purchaseLinked: true });
    expect(w.state.shops[0].ios_otid).toBe(OTID);
  });
});
