// E2E: booking races, time off, timezone / DST boundaries, past times, and the reminders cron's
// time budget through the real /api/book/reminders handler.
vi.mock('../../lib/bookings/live.js', async (importOriginal) => {
  const real: any = await importOriginal();
  return { ...real, liveDeps: () => (globalThis as any).__e2eBookingDeps() };
});
vi.mock('../../lib/store/live.js', async (importOriginal) => {
  const real: any = await importOriginal();
  return { ...real, liveStoreDeps: () => (globalThis as any).__e2eStoreDeps() };
});
vi.mock('../../lib/bookings/notify.js', async (importOriginal) => {
  const real: any = await importOriginal();
  return { ...real, liveReminderDeps: () => (globalThis as any).__e2eReminderDeps() };
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createAppointment, getSlots, postManage, postSent, getShop } from '../../lib/bookings/publicFlow.js';
import { createOwnerAppointment, createTimeOff, rescheduleOwnerAppointment } from '../../lib/bookings/ownerFlow.js';
import { runReminders, REMINDER_BUDGET_MS } from '../../lib/bookings/notify.js';
import { expireStaleCardHolds } from '../../lib/bookings/core.js';
import { handleConnectEvent, type WebhookDeps } from '../../lib/bookings/payments.js';
import remindersHandler from '../../api/book/reminders.js';
import { world, type State } from '../bookings/fakeRepo.js';
import { storeWorld } from '../store/fakeRepo.js';
import { httpReq, httpRes } from './harness/world.js';

type W = ReturnType<typeof world>;
let b: W;
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  b = world();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const customer = (n = 1) => ({ name: `Customer ${n}`, phone: `55500${String(n).padStart(5, '0')}`, email: `c${n}@example.com` });
const book = (over: Record<string, unknown> = {}, w: W = b) => createAppointment({
  slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: 'any', start: '2026-11-03T15:00:00Z', customer: customer(), pay: 'shop', ...over,
}, w.deps);
const live = (s: State) => s.appointments.filter((a) => a.status !== 'cancelled');

// ---------------------------------------------------------------------------
describe('double-booking races', () => {
  it('two customers race for the same barber and time: exactly one booking, the other 409 slot-taken with alternatives', async () => {
    const [x, y] = await Promise.all([
      book({ memberId: b.ids.mike, customer: customer(1) }),
      book({ memberId: b.ids.mike, customer: customer(2) }),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    const loser = x.status === 409 ? x : y;
    expect(loser.body).toMatchObject({ error: 'slot-taken' });
    expect((loser.body as any).alternatives.length).toBeGreaterThan(0);
    expect(live(b.state)).toHaveLength(1);
  });

  it('"any barber": three racers for one start fill both barbers, the third gets 409', async () => {
    const rs = await Promise.all([1, 2, 3].map((n) => book({ customer: customer(n) })));
    expect(rs.map((r) => r.status).sort()).toEqual([201, 201, 409]);
    expect(new Set(live(b.state).map((a) => a.member_id)).size).toBe(2);
  });

  /**
   * Two submits of one "any" booking, interleaved: B passes the duplicate pre-check, then A runs to
   * completion (insert on Mike + twin check), then B inserts on Jay and runs its twin check. Ids are
   * fixed so the test decides which copy has the smaller id ("the smallest id wins").
   */
  async function interleavedTwins(aId: string, bId: string) {
    const repo = b.deps.repo;
    const realStarting = repo.appointmentsStartingAt;
    const realInsert = repo.insertAppointment;
    const ids = [aId, bId];
    let calls = 0;
    let releaseB!: () => void;
    const bHeld = new Promise<void>((r) => { releaseB = r; });
    repo.appointmentsStartingAt = async (...args: Parameters<typeof realStarting>) => {
      const rows = await realStarting(...args);
      if (++calls === 1) await bHeld; // B's pre-check saw nothing; hold B here
      return rows;
    };
    repo.insertAppointment = async (row) => realInsert({ ...row, id: ids.shift()! } as any);
    const B = book();
    await vi.waitFor(() => expect(calls).toBe(1));
    const A = await book();
    releaseB();
    return { A, B: await B };
  }

  it('setup: interleaved double submit where the later copy has the larger id: one booking', async () => {
    const { A, B } = await interleavedTwins('00000000-0000-4000-8000-000000000001', 'ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect([A.status, B.status]).toEqual([201, 409]);
    expect(live(b.state)).toHaveLength(1);
  });

  it.fails('BUG: interleaved double submit where the later copy has the smaller id: the customer holds BOTH barbers', async () => {
    const { A, B } = await interleavedTwins('ffffffff-ffff-4fff-bfff-ffffffffffff', '00000000-0000-4000-8000-000000000001');
    expect(A.status).toBe(201);
    expect(B.status).toBe(409);
    expect(live(b.state)).toHaveLength(1);
  });

  it('an owner walk-in racing an online booking for the same barber: one wins', async () => {
    const [online, walk] = await Promise.all([
      book({ memberId: b.ids.mike }),
      createOwnerAppointment('Bearer owner-jwt', { start: '2026-11-03T15:00:00Z', memberId: b.ids.mike, serviceId: b.ids.cut, customer: { name: 'W' } }, b.deps),
    ]);
    expect([online.status, walk.status].sort()).toEqual([201, 409]);
    expect(live(b.state)).toHaveLength(1);
  });

  it('a customer reschedule racing an owner reschedule of the same booking: the second gets 409, never a silent overwrite', async () => {
    const r = await book({ memberId: b.ids.mike });
    const token = b.state.appointments[0].manage_token;
    const id = b.state.appointments[0].id;
    const [cust, own] = await Promise.all([
      postManage({ action: 'reschedule', token, start: '2026-11-03T16:00:00Z' }, b.deps),
      rescheduleOwnerAppointment('Bearer owner-jwt', id, { start: '2026-11-03T17:00:00Z' }, b.deps),
    ]);
    expect(r.status).toBe(201);
    const statuses = [cust.status, own.status];
    expect(statuses).toContain(200);
    const final = b.state.appointments[0].start_at;
    expect(['2026-11-03T16:00:00.000Z', '2026-11-03T17:00:00.000Z']).toContain(final);
  });
});

// ---------------------------------------------------------------------------
describe('time off', () => {
  it('a booking inside time off is refused; time off over a booking reports it and, when asked, cancels it', async () => {
    await createTimeOff('Bearer owner-jwt', { memberId: b.ids.mike, start: '2026-11-03T14:00:00Z', end: '2026-11-03T16:00:00Z' }, b.deps);
    expect((await book({ memberId: b.ids.mike })).body).toMatchObject({ error: 'slot-taken' });
    const jay = await book({ memberId: b.ids.jay });
    expect(jay.status).toBe(201);
    const ask = await createTimeOff('Bearer owner-jwt', { memberId: b.ids.jay, start: '2026-11-03T14:30:00Z', end: '2026-11-03T15:15:00Z' }, b.deps);
    expect((ask.body as any).conflicts).toHaveLength(1);
    expect(live(b.state)).toHaveLength(1);
    const cancel = await createTimeOff('Bearer owner-jwt', { memberId: b.ids.jay, start: '2026-11-03T14:30:00Z', end: '2026-11-03T15:15:00Z', cancelConflicts: true }, b.deps);
    expect((cancel.body as any).conflicts).toHaveLength(1);
    expect(live(b.state)).toHaveLength(0);
    expect(b.state.timeOff.filter((t) => t.member_id === b.ids.jay)).toHaveLength(1);
    expect(b.notified.filter((n) => n.kind === 'booking_cancelled')).toHaveLength(1);
  });

  it('time off touching a booking edge-to-edge is not a conflict (half-open ranges)', async () => {
    await book({ memberId: b.ids.mike });
    const r = await createTimeOff('Bearer owner-jwt', { memberId: b.ids.mike, start: '2026-11-03T15:30:00Z', end: '2026-11-03T17:00:00Z' }, b.deps);
    expect((r.body as any).conflicts).toEqual([]);
  });

  it('malformed time off: end before start, longer than a year, seconds, no offset, foreign member', async () => {
    const T = (body: Record<string, unknown>) => createTimeOff('Bearer owner-jwt', { memberId: b.ids.mike, start: '2026-11-03T14:00:00Z', end: '2026-11-03T16:00:00Z', ...body }, b.deps);
    expect((await T({ end: '2026-11-03T13:00:00Z' })).status).toBe(400);
    expect((await T({ end: '2027-11-05T14:00:00Z' })).status).toBe(400);
    expect((await T({ start: '2026-11-03T14:00:30Z' })).status).toBe(400);
    expect((await T({ start: '2026-11-03T14:00:00' })).status).toBe(400);
    expect((await T({ memberId: randomUUID() })).status).toBe(400);
    expect((await T({ cancelConflicts: 'yes' })).status).toBe(400);
  });

  it.fails('BUG (minor): time off added while a booking request is in flight: the booking lands inside it and the owner is told of no conflict', async () => {
    const realTimeOff = b.deps.repo.timeOff;
    let fired = false;
    let ownerResult: any;
    b.deps.repo.timeOff = async (...args: Parameters<typeof realTimeOff>) => {
      const rows = await realTimeOff(...args);
      if (!fired) {
        fired = true;
        ownerResult = await createTimeOff('Bearer owner-jwt', { memberId: b.ids.mike, start: '2026-11-03T14:00:00Z', end: '2026-11-03T18:00:00Z' }, b.deps);
      }
      return rows;
    };
    const r = await book({ memberId: b.ids.mike });
    const insideTimeOff = r.status === 201;
    const ownerTold = (ownerResult?.body?.conflicts ?? []).length > 0;
    expect(!insideTimeOff || ownerTold).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('timezones and DST', () => {
  const sunday = (w: W, startMin: number, endMin: number) => {
    for (const m of [w.ids.mike, w.ids.jay]) w.state.availability.push({ member_id: m, weekday: 6, start_min: startMin, end_min: endMin, break_start_min: null, break_end_min: null });
  };

  it('fall back (America/New_York, 2026-11-01): slots are unique instants, ascending, inside the wall-clock hours', async () => {
    b.setNow('2026-10-29T12:00:00Z');
    sunday(b, 0, 240);
    const r = await getSlots({ slug: 'fresh-cuts', serviceId: b.ids.cut, memberId: b.ids.mike, date: '2026-11-01' }, b.deps);
    const starts = (r.body as any).slots.map((s: any) => Date.parse(s.start));
    expect(new Set(starts).size).toBe(starts.length);
    expect([...starts].sort((x, y) => x - y)).toEqual(starts);
    expect(starts[0]).toBe(Date.parse('2026-11-01T04:00:00Z')); // 00:00 EDT
    expect(starts.at(-1)! + 30 * 60_000).toBeLessThanOrEqual(Date.parse('2026-11-01T09:00:00Z')); // 04:00 EST
    // A booking at 09:00 local the day after DST ends is 14:00Z, not 13:00Z.
    b.setNow('2026-11-02T12:00:00Z');
    expect((await book({ start: '2026-11-03T09:00:00-05:00' })).status).toBe(201);
    expect((await book({ start: '2026-11-03T08:00:00-05:00', customer: customer(9) })).body).toMatchObject({ error: 'slot-taken' });
  });

  it('spring forward (2027-03-14): no slot starts in the missing hour and every slot fits before close', async () => {
    b.setNow('2027-03-10T12:00:00Z');
    sunday(b, 60, 240); // 01:00–04:00 wall clock: 2 real hours that day
    const r = await getSlots({ slug: 'fresh-cuts', serviceId: b.ids.cut, memberId: b.ids.mike, date: '2027-03-14' }, b.deps);
    const starts = (r.body as any).slots.map((s: any) => s.start);
    expect(starts.length).toBe(4);
    expect(starts[0]).toBe('2027-03-14T06:00:00.000Z');
    expect(starts.at(-1)).toBe('2027-03-14T07:30:00.000Z');
    // "02:30 at -05:00" is the real instant 03:30 EDT (a slot); the close (04:00 EDT) is not.
    expect((await book({ start: '2027-03-14T02:30:00-05:00' })).status).toBe(201);
    expect(b.state.appointments.at(-1)!.start_at).toBe('2027-03-14T07:30:00.000Z');
    expect((await book({ start: '2027-03-14T08:00:00Z', customer: customer(7) })).status).toBe(409);
  });

  it('a half-hour-offset zone (Asia/Kolkata) and an explicit +05:30 start book the right instant', async () => {
    const k = world({ shop: { timezone: 'Asia/Kolkata' } });
    k.setNow('2026-11-02T00:00:00Z');
    const r = await book({ start: '2026-11-03T09:00:00+05:30' }, k);
    expect(r.status).toBe(201);
    expect(k.state.appointments[0].start_at).toBe('2026-11-03T03:30:00.000Z');
  });

  it('an invalid stored timezone pauses the page instead of crashing', async () => {
    const bad = world({ shop: { timezone: 'Mars/Olympus' } });
    expect(((await getShop({ slug: 'fresh-cuts' }, bad.deps)).body as any).paused).toBe(true);
    expect((await book({}, bad)).status).toBe(423);
  });

  it.each([
    ['no offset', '2026-11-03T15:00:00'], ['24:00', '2026-11-03T24:00:00Z'], ['Feb 30', '2027-02-30T15:00:00Z'],
    ['date only', '2026-11-03'], ['epoch number', 1793804400000], ['offset +24:00', '2026-11-03T15:00:00+24:00'],
  ])('a malformed start (%s) is 400', async (_n, start) => {
    expect((await book({ start })).body).toMatchObject({ error: 'invalid', field: 'start' });
  });
});

// ---------------------------------------------------------------------------
describe('past times and notice', () => {
  it('a customer cannot book in the past or inside the minimum notice; exactly at the notice boundary is fine', async () => {
    expect((await book({ start: '2026-11-02T11:00:00Z' })).status).toBe(409);
    b.setNow('2026-11-03T12:30:00Z'); // 120 min notice: 14:30Z is the earliest; 15:00Z ok, 14:00Z not.
    expect((await book({ start: '2026-11-03T14:00:00Z' })).status).toBe(409);
    expect((await book({ start: '2026-11-03T15:00:00Z' })).status).toBe(201);
  });

  it('past the lead window (30 days) is refused', async () => {
    expect((await book({ start: '2026-12-08T15:00:00Z' })).status).toBe(409);
  });

  it('an owner may log a past walk-in (no notice rules for owners)', async () => {
    const r = await createOwnerAppointment('Bearer owner-jwt', { start: '2026-10-31T15:00:00Z', memberId: b.ids.mike, serviceId: b.ids.cut, customer: { name: 'Yesterday' } }, b.deps);
    expect(r.status).toBe(201);
  });

  it('a customer cannot cancel after the start, nor reschedule inside the cutoff or into the past', async () => {
    await book({ memberId: b.ids.mike });
    const token = b.state.appointments[0].manage_token;
    expect((await postManage({ action: 'reschedule', token, start: '2026-11-02T10:00:00Z' }, b.deps)).status).toBe(409);
    b.setNow('2026-11-03T13:30:00Z'); // 90 min before start, inside the 120 min cutoff
    expect((await postManage({ action: 'reschedule', token, start: '2026-11-04T15:00:00Z' }, b.deps)).body).toEqual({ error: 'too-late' });
    b.setNow('2026-11-03T15:00:01Z');
    expect((await postManage({ action: 'cancel', token }, b.deps)).body).toEqual({ error: 'too-late' });
  });
});

// ---------------------------------------------------------------------------
describe('"I\'ve sent it" (manual rail) on a booking', () => {
  it('M5 (fixed): a double-tapped "I\'ve sent it" pushes the barber once (once-only guard on the write); both taps answer 200', async () => {
    b.state.shops[0].manual_handles = { cashapp: '$fresh' };
    await book({ pay: 'manual' });
    const token = b.state.appointments[0].manage_token;
    const rs = await Promise.all([postSent({ token, method: 'cashapp' }, b.deps), postSent({ token, method: 'cashapp' }, b.deps)]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    expect(b.notified.filter((n) => n.kind === 'customer_says_paid')).toHaveLength(1);
  });

  it('setup: sequential taps push once', async () => {
    b.state.shops[0].manual_handles = { cashapp: '$fresh' };
    await book({ pay: 'manual' });
    const token = b.state.appointments[0].manage_token;
    await postSent({ token, method: 'cashapp' }, b.deps);
    await postSent({ token, method: 'cashapp' }, b.deps);
    expect(b.notified.filter((n) => n.kind === 'customer_says_paid')).toHaveLength(1);
  });

  it('P2 (fixed; was POLICY 423): after the owner switches bookings off, an existing customer can still say "I\'ve sent it"', async () => {
    b.state.shops[0].manual_handles = { cashapp: '$fresh' };
    await book({ pay: 'manual' });
    b.state.shops[0].bookings_enabled = false;
    const r = await postSent({ token: b.state.appointments[0].manage_token, method: 'cashapp' }, b.deps);
    expect(r.status).toBe(200);
    expect(b.notified.filter((n) => n.kind === 'customer_says_paid')).toHaveLength(1);
    // New bookings stay closed.
    expect((await book({ customer: customer(5) })).status).toBe(423);
  });
});

// ---------------------------------------------------------------------------
describe('booking card-hold sweep vs a customer who paid on time (webhook late)', () => {
  /** A card hold created 36 min ago whose Checkout the customer completed at minute 31. */
  function paidOnTimeHold() {
    b.state.shops[0].stripe_account_id = 'acct_1';
    b.state.shops[0].stripe_charges_enabled = true;
    const created = Date.parse('2026-11-02T11:24:00Z');
    const id = randomUUID();
    b.state.appointments.push({
      id, shop_id: b.ids.shopId, member_id: b.ids.mike, service_id: b.ids.cut, start_at: '2026-11-03T15:00:00.000Z', end_at: '2026-11-03T15:30:00.000Z',
      service_name: 'Haircut', price_cents: 3000, duration_min: 30, customer_name: 'Paid', customer_phone: '5550101010', customer_email: 'p@example.com',
      note: null, status: 'booked', payment_status: 'awaiting', payment_method: 'card', source: 'online', cancelled_by: null, cancelled_at: null,
      reminder_sent_at: null, amount_paid_cents: 0, amount_refunded_cents: 0, stripe_payment_intent_id: null, stripe_checkout_session_id: 'cs_paid',
      manage_token: 'p'.repeat(40), customer_says_paid_at: null, shop_rescheduled_at: null, refund_due_cents: 0, refund_stuck_at: null,
      created_at: new Date(created).toISOString(), updated_at: new Date(created).toISOString(),
    } as any);
    // Stripe refuses to expire a session that is already complete (expireCheckoutSession → false).
    b.deps.payments.expireCheckoutSession = vi.fn(async () => false) as any;
    return id;
  }

  /** The appointment side of the Connect webhook over the booking world's rows (live deps' guards). */
  function apptWebhook(refunds: { pi: string; amount: number; key: string }[]): WebhookDeps {
    const seen = new Set<string>();
    const a = (id: string) => b.state.appointments.find((x) => x.id === id)!;
    const clone = (x: any) => (x ? JSON.parse(JSON.stringify(x)) : null);
    return {
      eventProcessed: async (id) => seen.has(id), recordEvent: async (id) => { seen.add(id); },
      appointmentBySession: async (sid) => clone(b.state.appointments.find((x) => x.stripe_checkout_session_id === sid)),
      appointmentByPaymentIntent: async (pi) => clone(b.state.appointments.find((x) => x.stripe_payment_intent_id === pi)),
      appointmentById: async (id) => clone(b.state.appointments.find((x) => x.id === id)),
      shop: async (id) => clone(b.state.shops.find((x) => x.id === id)),
      markPaid: async (id, f) => {
        const x = a(id);
        if (x.status === 'cancelled' || x.stripe_payment_intent_id) return false;
        Object.assign(x, { payment_status: f.paymentStatus, payment_method: 'card', amount_paid_cents: f.amountPaidCents, stripe_payment_intent_id: f.paymentIntentId, paid_at: new Date().toISOString() });
        return true;
      },
      recordPaidAfterCancel: async (id, f) => {
        const x = a(id) as any;
        if (x.status !== 'cancelled' || x.paid_at || x.stripe_payment_intent_id) return false;
        Object.assign(x, { payment_method: 'card', amount_paid_cents: f.amountPaidCents, stripe_payment_intent_id: f.paymentIntentId });
        return true;
      },
      expireHold: async () => false,
      setRefunded: async (id, total, ps) => { const x = a(id); if (x.amount_refunded_cents <= total) Object.assign(x, { amount_refunded_cents: total, payment_status: ps }); },
      setChargesEnabledForAccount: async () => {}, disconnectAccount: async () => false,
      refund: async (_s, appt, amount, key) => { refunds.push({ pi: appt.stripe_payment_intent_id!, amount, key }); return { refundedCents: amount }; },
      notify: async () => {}, now: () => b.deps.now(),
    };
  }

  const completed = { id: 'evt_late_paid', type: 'checkout.session.completed', account: 'acct_1', data: { object: {
    id: 'cs_paid', payment_status: 'paid', amount_total: 3000, currency: 'usd', payment_intent: 'pi_paid', client_reference_id: null, metadata: {},
  } } };

  it('setup (was: cancelled, then refunded in full by the late webhook): the sweep leaves the hold; the late webhook books the payment, no refund', async () => {
    const id = paidOnTimeHold();
    // Live payments answer 'complete' (closeCheckoutSession reads the session after the refused expire).
    (b.deps.payments as any).closeCheckoutSession = vi.fn(async () => 'complete');
    expect(await expireStaleCardHolds(b.deps)).toEqual({ expired: 0, paid: 1, unresolved: 0 });
    expect(b.state.appointments.find((x) => x.id === id)).toMatchObject({ status: 'booked', payment_status: 'awaiting' });
    const refunds: { pi: string; amount: number; key: string }[] = [];
    expect(await handleConnectEvent(completed as any, apptWebhook(refunds))).not.toBe('refunded:cancelled-before-payment');
    expect(b.state.appointments.find((x) => x.id === id)).toMatchObject({ status: 'booked', amount_paid_cents: 3000 });
    expect(refunds).toEqual([]);
  });

  it('I7 (fixed): a customer who paid on time keeps the booking (Stripe is asked first, like the store sweep)', async () => {
    const id = paidOnTimeHold();
    await expireStaleCardHolds(b.deps);
    expect(b.state.appointments.find((x) => x.id === id)!.status).toBe('booked');
  });
});

// ---------------------------------------------------------------------------
describe('reminders cron', () => {
  it('runReminders stops claiming at its budget and defers the rest (many shops, slow SMTP)', async () => {
    let t = 0;
    const ids = Array.from({ length: 400 }, (_, i) => `appt-${i}`);
    const sent: string[] = [];
    const r = await runReminders({
      dueReminders: async () => ids,
      claimReminder: async () => true,
      markReminderSent: async (id) => { sent.push(id); },
      releaseReminder: async () => {},
      // Each reminder costs 1 s (SMTP); a null context counts as handled and is stamped.
      loadContext: async () => { t += 1_000; return null; },
      sendEmail: async () => 'sent',
      now: () => Date.parse('2026-11-02T12:00:00Z'),
    } as any, { clock: () => t });
    expect(r.sent).toBe(Math.floor(REMINDER_BUDGET_MS / 1000) + 1);
    expect(r.deferred).toBe(400 - r.sent);
    expect(t).toBeLessThanOrEqual(REMINDER_BUDGET_MS + 1_000);
  });

  function cronWorld(opts: { stripeMs: number; holds: number; refunds: number }) {
    let t = Date.parse('2026-11-02T12:00:00Z');
    vi.spyOn(Date, 'now').mockImplementation(() => t);
    vi.stubEnv('CRON_SECRET', 'e2e-cron');
    const bw = world();
    bw.deps.now = () => t;
    const slow = async () => { t += opts.stripeMs; throw new Error('Stripe timeout'); };
    bw.deps.payments.expireCheckoutSession = vi.fn(slow) as any;
    bw.deps.payments.refundAppointment = vi.fn(slow) as any;
    for (let i = 0; i < opts.holds; i++) {
      bw.state.appointments.push({
        ...JSON.parse(JSON.stringify(bw.state.appointments[0] ?? {})), id: randomUUID(), shop_id: bw.ids.shopId, member_id: bw.ids.mike,
        start_at: new Date(t + (i + 50) * 3600_000).toISOString(), end_at: new Date(t + (i + 50) * 3600_000 + 1_800_000).toISOString(),
        status: 'booked', payment_method: 'card', payment_status: 'awaiting', amount_paid_cents: 0, amount_refunded_cents: 0,
        stripe_checkout_session_id: `cs_${i}`, created_at: new Date(t - 3600_000).toISOString(), updated_at: new Date(t - 3600_000).toISOString(),
        refund_due_cents: 0, refund_stuck_at: null, customer_phone: '5550000000', manage_token: 'm'.repeat(40) + i,
      } as any);
    }
    for (let i = 0; i < opts.refunds; i++) {
      bw.state.appointments.push({
        id: randomUUID(), shop_id: bw.ids.shopId, member_id: bw.ids.jay, service_id: bw.ids.cut,
        start_at: new Date(t - (i + 2) * 3600_000).toISOString(), end_at: new Date(t - (i + 2) * 3600_000 + 1_800_000).toISOString(),
        status: 'cancelled', payment_method: 'card', payment_status: 'paid', amount_paid_cents: 3000, amount_refunded_cents: 0,
        refund_due_cents: 3000, refund_stuck_at: null, stripe_payment_intent_id: `pi_${i}`, cancelled_at: new Date(t - 600_000).toISOString(),
        created_at: new Date(t - 7200_000).toISOString(), updated_at: new Date(t - 600_000).toISOString(),
      } as any);
    }
    const sw = storeWorld();
    sw.deps.now = () => t;
    (globalThis as any).__e2eBookingDeps = () => bw.deps;
    (globalThis as any).__e2eStoreDeps = () => sw.deps;
    let remindersStartedAt: number | null = null;
    (globalThis as any).__e2eReminderDeps = () => ({
      dueReminders: async () => { remindersStartedAt = t; return ['r1', 'r2']; },
      claimReminder: async () => true, markReminderSent: async () => {}, releaseReminder: async () => {},
      loadContext: async () => null, sendEmail: async () => 'sent', now: () => t,
    });
    const started = t;
    return { elapsed: () => t - started, remindersStartedAt: () => (remindersStartedAt == null ? null : remindersStartedAt - started) };
  }

  it('setup: with Stripe answering fast, the whole run is quick and reminders go out', async () => {
    const c = cronWorld({ stripeMs: 200, holds: 50, refunds: 25 });
    const res = httpRes();
    await remindersHandler(httpReq({ method: 'GET', headers: { authorization: 'Bearer e2e-cron' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ sent: 2 });
    expect(c.elapsed()).toBeLessThan(60_000);
  });

  it('I4 (fixed): with Stripe timing out (10 s), the booking sweeps stop at the shared budget and reminders start well before maxDuration (300 s)', async () => {
    const c = cronWorld({ stripeMs: 10_000, holds: 50, refunds: 25 });
    const res = httpRes();
    await remindersHandler(httpReq({ method: 'GET', headers: { authorization: 'Bearer e2e-cron' } }), res);
    // Vercel kills the function at 300 s: everything, reminders included, must have started well before.
    expect(c.remindersStartedAt()!).toBeLessThan(300_000 - 40_000);
  });

  it('the cron refuses without the secret (and a spoofed vercel-cron user agent is not enough once a secret is set)', async () => {
    vi.stubEnv('CRON_SECRET', 'e2e-cron');
    for (const headers of [{}, { authorization: 'Bearer wrong' }, { 'user-agent': 'vercel-cron/1.0' }]) {
      const res = httpRes();
      await remindersHandler(httpReq({ method: 'GET', headers }), res);
      expect(res.statusCode).toBe(401);
    }
  });
});
