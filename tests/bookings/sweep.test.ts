import { describe, it, expect, vi } from 'vitest';
import { expireStaleCardHolds, retryPendingRefunds } from '../../lib/bookings/core.js';
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
    expect(await expireStaleCardHolds(w.deps)).toEqual({ expired: 2, paid: 0, unresolved: 0 });
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
    expect(await expireStaleCardHolds(w.deps)).toEqual({ expired: 0, paid: 0, unresolved: 0 }); // idempotent
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
    expect(await expireStaleCardHolds(w.deps)).toEqual({ expired: 0, paid: 0, unresolved: 0 });
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
    expect(await expireStaleCardHolds(w.deps)).toMatchObject({ expired: 0 });
    expect(w.state.appointments[0]).toMatchObject({ status: 'booked', payment_status: 'paid' });
    // Stripe is asked first now (e2e I7); the cancel is still compare-and-set.
    expect(w.payments.expireCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it('I7: asks Stripe before cancelling: complete is left to the webhook (alerted once after an hour), unknown is left for the next run', async () => {
    const w = world({ shop: cardShop });
    const paid = await cardHold(w, '2026-11-03T15:00:00Z', '5550000001');
    const open = await cardHold(w, '2026-11-03T16:00:00Z', '5550000002');
    const expired = await cardHold(w, '2026-11-03T17:00:00Z', '5550000003');
    const states: Record<string, 'complete' | 'unknown' | 'expired'> = { [`cs_${paid.id}`]: 'complete', [`cs_${open.id}`]: 'unknown', [`cs_${expired.id}`]: 'expired' };
    (w.deps.payments as any).closeCheckoutSession = vi.fn(async (_s: unknown, sid: string) => states[sid]);
    const logged: string[] = [];
    const realLog = w.deps.repo.logEvent;
    w.deps.repo.logEvent = async (shop, kind, payload) => { logged.push(kind); return realLog(shop, kind, payload); };
    w.setNow('2026-11-02T12:40:00Z');
    expect(await expireStaleCardHolds(w.deps)).toEqual({ expired: 1, paid: 1, unresolved: 1 });
    const status = (id: string) => w.state.appointments.find((a) => a.id === id)!.status;
    expect([status(paid.id), status(open.id), status(expired.id)]).toEqual(['booked', 'booked', 'cancelled']);
    expect(logged).toEqual([]);
    w.setNow('2026-11-02T13:05:00Z'); // past the hour: one alert for the paid-but-unrecorded hold
    await expireStaleCardHolds(w.deps);
    await expireStaleCardHolds(w.deps);
    expect(logged).toEqual(['hold_paid_unrecorded']);
  });

  it('I4: stops starting holds once the shared budget is spent', async () => {
    const w = world({ shop: cardShop });
    for (let i = 0; i < 3; i++) await cardHold(w, `2026-11-03T1${5 + i}:00:00Z`, `555000000${i}`);
    w.setNow('2026-11-02T12:40:00Z');
    let t = 0;
    (w.deps.payments as any).closeCheckoutSession = vi.fn(async () => { t += 10_000; return 'expired'; });
    expect(await expireStaleCardHolds(w.deps, 50, { deadline: 15_000, clock: () => t })).toMatchObject({ expired: 2 });
  });
});

describe('cancel refunds: refund_due_cents and retryPendingRefunds', () => {
  /** A fake Stripe: one refund per idempotency key (a repeat returns the same refund). */
  function fakeStripe(w: ReturnType<typeof world>) {
    const refunds = new Map<string, number>();
    const mode = { fail: false, loseResponse: false };
    w.payments.refundAppointment.mockImplementation(async (_s, _a, amount, opts) => {
      if (mode.fail) throw new Error('stripe timeout');
      const key = opts!.idempotencyKey!;
      if (!refunds.has(key)) refunds.set(key, amount);
      if (mode.loseResponse) throw new Error('socket hang up'); // Stripe did it, we never heard back
      return { refundedCents: refunds.get(key)! };
    });
    return { refunds, mode };
  }

  async function paidCardBooking(w: ReturnType<typeof world>) {
    const a = await cardHold(w, '2026-11-03T15:00:00Z', '5550000001');
    Object.assign(w.state.appointments[0], { payment_status: 'paid', amount_paid_cents: 3000, stripe_payment_intent_id: 'pi_1' });
    return a;
  }

  async function customerCancel(w: ReturnType<typeof world>, token: string) {
    const { postManage } = await import('../../lib/bookings/publicFlow.js');
    return postManage({ token, action: 'cancel' }, w.deps);
  }

  it('a failed refund still cancels (200), stays owed, and the sweep refunds it later with the same key', async () => {
    const w = world({ shop: cardShop });
    const stripe = fakeStripe(w);
    const a = await paidCardBooking(w);
    stripe.mode.fail = true;
    expect((await customerCancel(w, a.manage_token)).status).toBe(200);
    expect(w.state.appointments[0]).toMatchObject({ status: 'cancelled', refund_due_cents: 3000, amount_refunded_cents: 0, payment_status: 'paid' });
    expect(w.state.events.map((e) => e.kind)).toEqual(['refund_failed']);

    stripe.mode.fail = false;
    w.setNow('2026-11-02T12:01:00Z');
    expect(await retryPendingRefunds(w.deps, Date.parse('2026-11-02T12:01:00Z'))).toMatchObject({ retried: 0 }); // < 2 min
    w.setNow('2026-11-02T12:03:00Z');
    expect(await retryPendingRefunds(w.deps, Date.parse('2026-11-02T12:03:00Z'))).toEqual({ retried: 1, refunded: 1, failed: 0, stuck: 0 });
    expect(w.state.appointments[0]).toMatchObject({ refund_due_cents: 3000, amount_refunded_cents: 3000, payment_status: 'refunded' });
    const keys = w.payments.refundAppointment.mock.calls.map((c) => c[3]);
    expect(keys).toEqual([{ idempotencyKey: `refund-cancel-${a.id}` }, { idempotencyKey: `refund-cancel-${a.id}` }]);
    expect(w.payments.refundAppointment.mock.calls.map((c) => c[2])).toEqual([3000, 3000]);
    expect(await retryPendingRefunds(w.deps, Date.parse('2026-11-02T12:10:00Z'))).toMatchObject({ retried: 0 }); // nothing left
  });

  it('no double refund when the first attempt went through at Stripe but the response was lost', async () => {
    const w = world({ shop: cardShop });
    const stripe = fakeStripe(w);
    const a = await paidCardBooking(w);
    stripe.mode.loseResponse = true;
    expect((await customerCancel(w, a.manage_token)).status).toBe(200);
    expect(w.state.appointments[0]).toMatchObject({ refund_due_cents: 3000, amount_refunded_cents: 0 });
    stripe.mode.loseResponse = false;
    w.setNow('2026-11-02T12:05:00Z');
    await retryPendingRefunds(w.deps, Date.parse('2026-11-02T12:05:00Z'));
    expect(stripe.refunds).toEqual(new Map([[`refund-cancel-${a.id}`, 3000]])); // one refund at Stripe
    expect(w.state.appointments[0]).toMatchObject({ amount_refunded_cents: 3000, payment_status: 'refunded' });
  });

  it('a late customer cancel where the shop keeps the money: refund_due_cents = 0 and no refund call', async () => {
    const w = world({ shop: cardShop });
    fakeStripe(w);
    const a = await paidCardBooking(w);
    w.setNow('2026-11-03T14:30:00Z'); // 30 min before, inside the 2 h cutoff
    expect((await customerCancel(w, a.manage_token)).status).toBe(200);
    expect(w.state.appointments[0]).toMatchObject({ status: 'cancelled', refund_due_cents: 0, amount_refunded_cents: 0 });
    expect(w.payments.refundAppointment).not.toHaveBeenCalled();
    expect(await retryPendingRefunds(w.deps, Date.parse('2026-11-04T00:00:00Z'))).toMatchObject({ retried: 0 });
  });

  it('a successful cancel refund records due = refunded (nothing pending)', async () => {
    const w = world({ shop: cardShop });
    fakeStripe(w);
    const a = await paidCardBooking(w);
    expect((await customerCancel(w, a.manage_token)).status).toBe(200);
    expect(w.state.appointments[0]).toMatchObject({ refund_due_cents: 3000, amount_refunded_cents: 3000 });
  });

  it('retries for 23 h after the cancel, then marks it stuck: debt kept on the row, one refund_stuck event, not picked again', async () => {
    const w = world({ shop: cardShop });
    const stripe = fakeStripe(w);
    const a = await paidCardBooking(w);
    stripe.mode.fail = true;
    await customerCancel(w, a.manage_token); // cancelled_at 2026-11-02T12:00Z
    expect((await retryPendingRefunds(w.deps, Date.parse('2026-11-03T10:59:00Z'))).retried).toBe(1); // 22 h 59 m: still retried
    const calls = w.payments.refundAppointment.mock.calls.length;
    w.setNow('2026-11-03T11:00:00Z'); // 23 h
    expect(await retryPendingRefunds(w.deps, Date.parse('2026-11-03T11:00:00Z'))).toEqual({ retried: 0, refunded: 0, failed: 0, stuck: 1 });
    expect(w.payments.refundAppointment.mock.calls.length).toBe(calls);
    expect(w.state.appointments[0]).toMatchObject({
      refund_due_cents: 3000, amount_refunded_cents: 0, refund_stuck_at: '2026-11-03T11:00:00.000Z', status: 'cancelled',
    });
    const stuck = w.state.events.filter((e) => e.kind === 'refund_stuck');
    expect(stuck).toHaveLength(1);
    expect(stuck[0]).toMatchObject({ shop_id: w.ids.shopId, payload: { appointmentId: a.id, dueCents: 3000, refundedCents: 0, owedCents: 3000, paymentIntent: 'pi_1' } });
    expect(await retryPendingRefunds(w.deps, Date.parse('2026-11-03T12:00:00Z'))).toEqual({ retried: 0, refunded: 0, failed: 0, stuck: 0 });
    expect(w.state.events.filter((e) => e.kind === 'refund_stuck')).toHaveLength(1);
  });

  it('refund_failed is logged once (first failure), not on every retry', async () => {
    const w = world({ shop: cardShop });
    const stripe = fakeStripe(w);
    const a = await paidCardBooking(w);
    stripe.mode.fail = true;
    await customerCancel(w, a.manage_token);
    for (const t of ['2026-11-02T12:05:00Z', '2026-11-02T12:20:00Z', '2026-11-02T12:35:00Z']) {
      w.setNow(t);
      expect((await retryPendingRefunds(w.deps, Date.parse(t))).failed).toBe(1);
    }
    expect(w.state.events.map((e) => e.kind)).toEqual(['refund_failed']);
    expect(w.payments.refundAppointment).toHaveBeenCalledTimes(4);
  });

  it('a retry that fails again stays pending; at most 25 rows per run', async () => {
    const w = world({ shop: cardShop });
    const stripe = fakeStripe(w);
    for (let i = 0; i < 30; i++) { // 16 half-hour slots x 2 barbers on Wed 9:00-17:00 EST
      const start = new Date(Date.parse('2026-11-04T14:00:00Z') + (i % 16) * 30 * 60_000).toISOString();
      const r = await createAppointment({
        slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: 'any', start,
        customer: { name: 'S', phone: `55500${String(i).padStart(5, '0')}`, email: 's@example.com' }, pay: 'card',
      }, w.deps);
      expect(r.status).toBe(201);
    }
    for (const a of w.state.appointments) {
      Object.assign(a, { status: 'cancelled', cancelled_at: '2026-11-02T12:00:00.000Z', payment_status: 'paid', amount_paid_cents: 3000,
        stripe_payment_intent_id: `pi_${a.id}`, refund_due_cents: 3000 });
    }
    stripe.mode.fail = true;
    const r = await retryPendingRefunds(w.deps, Date.parse('2026-11-02T13:00:00Z'));
    expect(r).toEqual({ retried: 25, refunded: 0, failed: 25, stuck: 0 });
    expect(w.state.appointments.every((a) => a.refund_due_cents === 3000 && a.amount_refunded_cents === 0)).toBe(true);
  });
});
