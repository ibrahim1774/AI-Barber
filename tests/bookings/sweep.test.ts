import { describe, it, expect } from 'vitest';
import { expireStaleCardHolds } from '../../lib/bookings/core.js';
import { createAppointment } from '../../lib/bookings/publicFlow.js';
import { world } from './fakeRepo.js';

const cardShop = { stripe_account_id: 'acct_1', stripe_charges_enabled: true };

async function cardHold(w: ReturnType<typeof world>, start: string, phone: string) {
  const r = await createAppointment({
    slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: w.ids.mike, start,
    customer: { name: 'Sam', phone, email: 'sam@example.com' }, pay: 'card',
  }, w.deps);
  expect(r.status).toBe(201);
  return w.state.appointments.at(-1)!;
}

describe('expireStaleCardHolds (orphaned card holds)', () => {
  it('expires unpaid card holds older than 35 minutes without refunding or notifying', async () => {
    const w = world({ shop: cardShop });
    const old = await cardHold(w, '2026-11-03T15:00:00Z', '5550000001');
    const orphan = await cardHold(w, '2026-11-03T16:00:00Z', '5550000002');
    w.state.appointments.find((a) => a.id === orphan.id)!.stripe_checkout_session_id = null; // died before Checkout
    w.setNow('2026-11-02T12:34:00Z');
    const young = await cardHold(w, '2026-11-03T17:00:00Z', '5550000003');
    w.notified.length = 0;

    w.setNow('2026-11-02T12:36:00Z'); // the first two are 36 min old, the third 2 min
    expect(await expireStaleCardHolds(w.deps)).toEqual({ expired: 2 });
    for (const id of [old.id, orphan.id]) {
      expect(w.state.appointments.find((a) => a.id === id)).toMatchObject({
        status: 'cancelled', cancelled_by: 'customer', cancelled_at: '2026-11-02T12:36:00.000Z', payment_status: 'none', amount_refunded_cents: 0,
      });
    }
    expect(w.state.appointments.find((a) => a.id === young.id)!.status).toBe('booked');
    expect(w.payments.expireCheckoutSession).toHaveBeenCalledTimes(1);
    expect(w.payments.expireCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ id: w.ids.shopId }), `cs_${old.id}`);
    expect(w.payments.refundAppointment).not.toHaveBeenCalled();
    expect(w.notified).toEqual([]);
    expect(await expireStaleCardHolds(w.deps)).toEqual({ expired: 0 }); // idempotent
  });

  it('leaves paid card bookings and non-card bookings alone', async () => {
    const w = world({ shop: { ...cardShop, manual_handles: { cashapp: '$x' } } });
    const paid = await cardHold(w, '2026-11-03T15:00:00Z', '5550000001');
    Object.assign(w.state.appointments[0], { payment_status: 'paid', amount_paid_cents: 3000 });
    await createAppointment({
      slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: w.ids.jay, start: '2026-11-03T15:00:00Z',
      customer: { name: 'M', phone: '5550000009', email: 'm@example.com' }, pay: 'manual',
    }, w.deps);
    w.setNow('2026-11-03T12:00:00Z');
    expect(await expireStaleCardHolds(w.deps)).toEqual({ expired: 0 });
    expect(w.state.appointments.every((a) => a.status === 'booked')).toBe(true);
    expect(paid.id).toBeTruthy();
  });

  it('a payment that lands mid-sweep is never overwritten (compare-and-set)', async () => {
    const w = world({ shop: cardShop });
    await cardHold(w, '2026-11-03T15:00:00Z', '5550000001');
    const orig = w.deps.repo.updateAppointment;
    w.deps.repo.updateAppointment = async (id, patch, expect) => {
      Object.assign(w.state.appointments[0], { payment_status: 'paid', amount_paid_cents: 3000 }); // webhook wins the race
      return orig(id, patch, expect);
    };
    w.setNow('2026-11-02T13:00:00Z');
    expect(await expireStaleCardHolds(w.deps)).toEqual({ expired: 0 });
    expect(w.state.appointments[0]).toMatchObject({ status: 'booked', payment_status: 'paid' });
    expect(w.payments.expireCheckoutSession).not.toHaveBeenCalled();
  });
});
