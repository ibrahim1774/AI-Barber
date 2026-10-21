import { describe, it, expect } from 'vitest';
import {
  cancelOwnerAppointment,
  createOwnerAppointment,
  createTimeOff,
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
    expect((await cancelOwnerAppointment(AUTH, a.id, w.deps)).status).toBe(200);
    expect(w.payments.refundAppointment).toHaveBeenCalledTimes(1);
    const ev = w.notified.find((e) => e.kind === 'booking_cancelled') as any;
    expect(ev).toEqual({ kind: 'booking_cancelled', appointmentId: a.id, by: 'shop', refundedCents: 1000 });
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

  it('409 when it would overlap another booking', async () => {
    const w = world();
    const a = await publicBooking(w);
    await publicBooking(w, { start: '2026-11-03T16:00:00Z', customer: { name: 'B', phone: '5550001111', email: 'b@example.com' } });
    const r = await rescheduleOwnerAppointment(AUTH, a.id, { start: '2026-11-03T15:45:00Z' }, w.deps);
    expect(r.status).toBe(409);
    expect(w.state.appointments.find((x) => x.id === a.id)!.start_at).toBe(T10);
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
    expect(shop).toMatchObject({ slug: 'kings-cuts', name: 'Kings Cuts', timezone: 'America/Chicago', bookingsEnabled: true, purchaseLinked: false });
    const row = w.state.shops.find((s) => s.owner_id === NEW_USER)!;
    expect(row).toMatchObject({ site_id: SITE, address: '9 Elm', phone: '555-0100', ios_otid: null });
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
    expect(w.state.members.filter((m) => m.shop_id === shopId && m.role === 'owner')).toHaveLength(1);
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
