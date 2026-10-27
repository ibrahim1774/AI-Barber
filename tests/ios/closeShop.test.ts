import { describe, it, expect, vi } from 'vitest';
import { closeShopForDeletion, bookingLane, type Lane } from '../../lib/ios/closeShop.js';
import { deleteAccount } from '../../lib/ios/deleteAccount.js';
import { cancellationEmail } from '../../lib/bookings/notify.js';
import { orderCancelledEmail } from '../../lib/store/notify.js';
import { refundAppointment as realRefundAppointment } from '../../lib/bookings/payments.js';
import { closureEnv, owedFields, SIX_H } from './closureHarness.js';

const NOW = Date.parse('2026-10-27T12:00:00Z');
const H = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

// ---- An in-memory booking repo behind the REAL cancelAppointment -----------------------------
function appt(id: string, over: Record<string, any> = {}) {
  return {
    id, shop_id: 'shop1', member_id: 'm1', service_id: null, start_at: iso(NOW + 48 * H), end_at: iso(NOW + 49 * H),
    service_name: 'Fade', price_cents: 3000, duration_min: 60, customer_name: 'Cust', customer_phone: null,
    customer_email: `${id}@example.test`, note: null, status: 'booked', cancelled_by: null, cancelled_at: null,
    reminder_sent_at: null, payment_status: 'none', payment_method: 'shop', amount_paid_cents: 0, amount_refunded_cents: 0,
    stripe_payment_intent_id: null, stripe_checkout_session_id: null, manage_token: 'tok'.repeat(12), source: 'online',
    customer_says_paid_at: null, shop_rescheduled_at: null, refund_due_cents: 0, refund_stuck_at: null, ...over,
  } as any;
}

function world(rows: any[], opts: { failCancelFor?: string[]; refundThrows?: boolean; staleCancelFor?: string[] } = {}) {
  const db = new Map<string, any>(rows.map((r) => [r.id, r]));
  const notified: any[] = [];
  const refunds: any[] = [];
  const stripeCalls: Array<{ headers: Record<string, string>; body: string }> = [];
  const shop = { id: 'shop1', name: 'Fade Lab', cancel_cutoff_min: 0, stripe_account_id: 'acct', stripe_charges_enabled: true };
  const repo: any = {
    appointmentById: async (id: string) => db.get(id) ?? null,
    shopById: async (id: string) => (id === 'shop1' ? shop : null),
    refundAttempts: async () => 0,
    logEvent: async () => {},
    updateAppointment: async (id: string, patch: any, expect?: any) => {
      if (opts.failCancelFor?.includes(id) && patch.status === 'cancelled') throw new Error('db down');
      if (opts.staleCancelFor?.includes(id) && patch.status === 'cancelled') return { ok: false, reason: 'stale' };
      const cur = db.get(id);
      if (!cur) return { ok: false, reason: 'stale' };
      if (typeof expect === 'string' && cur.status !== expect) return { ok: false, reason: 'stale' };
      if (expect && typeof expect === 'object') {
        if (expect.status && cur.status !== expect.status) return { ok: false, reason: 'stale' };
        if (expect.refundedLte != null && cur.amount_refunded_cents > expect.refundedLte) return { ok: false, reason: 'stale' };
      }
      const row = { ...cur, ...patch };
      db.set(id, row);
      return { ok: true, row };
    },
  };
  const payments: any = {
    expireCheckoutSession: async () => true,
    // The REAL refund call over a fake fetch, so the test sees the Stripe-Account header and the Idempotency-Key.
    refundAppointment: vi.fn(async (s: any, a: any, cents: number, o: any) => {
      if (opts.refundThrows) throw new Error('stripe down');
      const r = await realRefundAppointment(s, a, cents, {
        ...o,
        fetch: async (_url: string, init: any) => {
          stripeCalls.push({ headers: init.headers, body: String(init.body) });
          return { ok: true, status: 200, json: async () => ({ id: 're_1', status: 'succeeded', amount: cents }) } as any;
        },
      });
      refunds.push({ id: a.id, cents });
      return r;
    }),
  };
  const flow: any = { repo, payments, notify: async (e: any) => { notified.push(e); }, now: () => NOW, baseUrl: 'https://x.test' };
  const queries = {
    upcomingIds: async (shopId: string, nowIso: string, limit: number) =>
      [...db.values()].filter((r) => r.shop_id === shopId && r.status === 'booked' && r.start_at > nowIso).slice(0, limit).map((r) => r.id),
    // The live query: shop, cancelled by the shop, cancelled at/after the window start, something paid; ordered; paged.
    recentCancelledIds: async (shopId: string, sinceIso: string, limit: number, offset = 0) =>
      [...db.values()]
        .filter((r) => r.shop_id === shopId && r.status === 'cancelled' && r.cancelled_by === 'shop' && (r.cancelled_at ?? '') >= sinceIso && r.amount_paid_cents > 0)
        .sort((a, b) => (a.cancelled_at < b.cancelled_at ? -1 : a.cancelled_at > b.cancelled_at ? 1 : a.id < b.id ? -1 : 1))
        .slice(offset, offset + limit).map((r) => r.id),
  };
  return { db, notified, refunds, stripeCalls, flow, queries, shop };
}

const ports = (lanes: Lane[], shopId: string | null = 'shop1', extra: Record<string, unknown> = {}) => ({ shopIdFor: async () => shopId, lanes: () => lanes, now: () => NOW, ...extra });
process.env.STRIPE_CONNECT_SECRET_KEY ||= 'sk_test_fake_for_closure_tests';

describe('closeShopForDeletion with the real booking cancel path', () => {
  it('cancels every upcoming booking as the shop, with the closed flag on the notification, and leaves past ones alone', async () => {
    const w = world([
      appt('a1'), appt('a2'),
      appt('past', { start_at: iso(NOW - 48 * H), end_at: iso(NOW - 47 * H), status: 'done' }),
      appt('old-booked', { start_at: iso(NOW - 2 * H), end_at: iso(NOW - 1 * H) }),
      appt('other-shop', { shop_id: 'shop2' }),
    ]);
    const r = await closeShopForDeletion('u1', ports([bookingLane(w.flow, 'shop1', w.queries)]));
    expect(r.ok).toBe(true);
    expect(w.db.get('a1').status).toBe('cancelled');
    expect(w.db.get('a2').status).toBe('cancelled');
    expect(w.db.get('a1').cancelled_by).toBe('shop');
    expect(w.db.get('past').status).toBe('done');
    expect(w.db.get('old-booked').status).toBe('booked');
    expect(w.db.get('other-shop').status).toBe('booked');
    expect(w.notified.map((e) => [e.kind, e.appointmentId, e.by, e.closed]).sort()).toEqual([
      ['booking_cancelled', 'a1', 'shop', true],
      ['booking_cancelled', 'a2', 'shop', true],
    ]);
  });

  it('a paid card booking goes through the existing refund path (asserted call) and is not flagged', async () => {
    const w = world([appt('paid', { payment_method: 'card', payment_status: 'paid', amount_paid_cents: 3000, stripe_payment_intent_id: 'pi_1' })]);
    const r = await closeShopForDeletion('u1', ports([bookingLane(w.flow, 'shop1', w.queries)]));
    expect(w.refunds).toEqual([{ id: 'paid', cents: 3000 }]);
    expect(w.db.get('paid').amount_refunded_cents).toBe(3000);
    expect(r).toMatchObject({ ok: true, bookingsCancelled: 1, needsRefund: [] });
  });

  it('a paid card refund reaches Stripe on the connected account with the cancel idempotency key', async () => {
    const w = world([appt('paid', { payment_method: 'card', payment_status: 'paid', amount_paid_cents: 3000, stripe_payment_intent_id: 'pi_1' })]);
    await closeShopForDeletion('u1', ports([bookingLane(w.flow, 'shop1', w.queries)]));
    expect(w.stripeCalls).toHaveLength(1);
    expect(w.stripeCalls[0].headers['Stripe-Account']).toBe('acct');
    expect(w.stripeCalls[0].headers['Idempotency-Key']).toBe('refund-cancel-paid-3000-0');
    expect(w.stripeCalls[0].body).toContain('payment_intent=pi_1');
  });

  describe('a card refund that keeps failing (finding 1)', () => {
    const failing = () => world([appt('paid', { payment_method: 'card', payment_status: 'paid', amount_paid_cents: 3000, stripe_payment_intent_id: 'pi_1', customer_name: 'Pat Q', customer_email: 'pat@example.test' })], { refundThrows: true });

    it('two app retries seconds apart do NOT let the deletion proceed: still a retryable failure, nothing flagged or recorded', async () => {
      const w = failing();
      const e = closureEnv(NOW);
      const lane = () => bookingLane(w.flow, 'shop1', w.queries, e.env);
      const d = () => ports([lane()], 'shop1', { env: e.env, now: e.env.now });
      expect((await closeShopForDeletion('u1', d())).ok).toBe(false);
      e.clock.now += 5_000;
      const second = await closeShopForDeletion('u1', d());
      expect(second).toMatchObject({ ok: false, needsRefund: [] });
      e.clock.now += 5_000;
      expect((await closeShopForDeletion('u1', d())).ok).toBe(false);
      expect(e.owed.size).toBe(0);
      expect(w.db.get('paid').status).toBe('cancelled');
      expect(w.notified).toHaveLength(1); // the cancel email went out once, never again
    });

    it('after 6 hours the deletion proceeds, the refund is flagged and persisted without PII', async () => {
      const w = failing();
      const e = closureEnv(NOW);
      const d = () => ports([bookingLane(w.flow, 'shop1', w.queries, e.env)], 'shop1', { env: e.env, now: e.env.now });
      expect((await closeShopForDeletion('u1', d())).ok).toBe(false);
      e.clock.now += SIX_H - 1000;
      expect((await closeShopForDeletion('u1', d())).ok).toBe(false);
      e.clock.now += 2000;
      const r = await closeShopForDeletion('u1', d());
      expect(r).toMatchObject({ ok: true, needsRefund: ['booking:paid'] });
      expect([...e.owed.values()].map(owedFields)).toEqual([{ stripe_account_id: 'acct', payment_intent_id: 'pi_1', owed_cents: 3000, row_id: 'paid' }]);
      const stored = JSON.stringify([...e.owed.values()]);
      expect(stored).not.toContain('pat@example.test');
      expect(stored).not.toContain('Pat Q');
      expect(w.notified).toHaveLength(1);
    });

    it('a refund the sweep already marked stuck proceeds at once and is persisted', async () => {
      const w = failing();
      const e = closureEnv(NOW);
      const d = () => ports([bookingLane(w.flow, 'shop1', w.queries, e.env)], 'shop1', { env: e.env, now: e.env.now });
      expect((await closeShopForDeletion('u1', d())).ok).toBe(false);
      w.db.set('paid', { ...w.db.get('paid'), refund_stuck_at: iso(NOW + 1000) });
      const r = await closeShopForDeletion('u1', d());
      expect(r).toMatchObject({ ok: true, needsRefund: ['booking:paid'] });
      expect(e.owed.size).toBe(1);
    });

    it('if the record cannot be saved the deletion is aborted (retryable), not lost', async () => {
      const w = failing();
      const e = closureEnv(NOW);
      const d = () => ports([bookingLane(w.flow, 'shop1', w.queries, e.env)], 'shop1', { env: e.env, now: e.env.now });
      await closeShopForDeletion('u1', d());
      e.clock.now += SIX_H + 1;
      e.flags.failRecord = true;
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect((await closeShopForDeletion('u1', d())).ok).toBe(false);
      err.mockRestore();
      e.flags.failRecord = false;
      expect((await closeShopForDeletion('u1', d())).ok).toBe(true);
      expect(e.owed.size).toBe(1);
    });
  });

  it('a paid manual-rail booking (no money path) is cancelled and flagged as needing a refund, never refunded by us', async () => {
    const w = world([appt('venmo', { payment_method: 'venmo', payment_status: 'paid', amount_paid_cents: 2500 })]);
    const r = await closeShopForDeletion('u1', ports([bookingLane(w.flow, 'shop1', w.queries)]));
    expect(w.refunds).toEqual([]);
    expect(w.db.get('venmo').status).toBe('cancelled');
    expect(r).toMatchObject({ ok: true, needsRefund: ['booking:venmo'] });
  });

  it('a booking that stays booked after a failed cancel claim is flagged, recorded, emailed and let go only after 6 hours', async () => {
    const w = world([appt('stuck', { payment_method: 'card', payment_status: 'paid', amount_paid_cents: 3000, stripe_payment_intent_id: 'pi_9' })], { staleCancelFor: ['stuck'] });
    const e = closureEnv(NOW);
    const d = () => ports([bookingLane(w.flow, 'shop1', w.queries, e.env)], 'shop1', { env: e.env, now: e.env.now });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await closeShopForDeletion('u1', d())).ok).toBe(false);
    e.clock.now += 5_000;
    expect((await closeShopForDeletion('u1', d())).ok).toBe(false);
    expect(e.owed.size).toBe(0);
    e.clock.now += SIX_H;
    const r = await closeShopForDeletion('u1', d());
    err.mockRestore();
    expect(r).toMatchObject({ ok: true, notCancelled: ['booking:stuck'], needsRefund: ['booking:stuck'] });
    expect([...e.owed.values()].map(owedFields)).toEqual([{ stripe_account_id: 'acct', payment_intent_id: 'pi_9', owed_cents: 3000, row_id: 'stuck' }]);
    expect(w.notified.filter((n) => n.appointmentId === 'stuck' && n.closed === true)).toHaveLength(1);
    await closeShopForDeletion('u1', d()); // a later retry never emails the same customer again
    expect(w.notified.filter((n) => n.appointmentId === 'stuck' && n.closed === true)).toHaveLength(1);
  });

  it('a failing cancel aborts: ok false, other bookings still cancelled, nothing is reported as done for the failing one', async () => {
    const w = world([appt('a1'), appt('a2'), appt('a3')], { failCancelFor: ['a2'] });
    const r = await closeShopForDeletion('u1', ports([bookingLane(w.flow, 'shop1', w.queries)]));
    expect(r.ok).toBe(false);
    expect(w.db.get('a2').status).toBe('booked');
  });
});

describe('carried refunds from earlier attempts (finding 5)', () => {
  const START = NOW - 2 * H;
  const cancelledPaid = (id: string, at: number, over: Record<string, any> = {}) =>
    appt(id, { status: 'cancelled', cancelled_by: 'shop', cancelled_at: iso(at), payment_method: 'venmo', payment_status: 'paid', amount_paid_cents: 2500, ...over });

  it('pages past 40, so a closure with 45 owed bookings flags all 45', async () => {
    const rows = Array.from({ length: 45 }, (_, i) => cancelledPaid(`c${String(i).padStart(2, '0')}`, START + 1000 + i));
    const w = world(rows);
    const e = closureEnv(NOW);
    e.seen.set('closure:shop1', START);
    const r = await closeShopForDeletion('u1', ports([bookingLane(w.flow, 'shop1', w.queries, e.env)], 'shop1', { env: e.env }));
    expect(r.ok).toBe(true);
    expect(r.needsRefund).toHaveLength(45);
  });

  it('only rows cancelled by this closure run: the owner\'s own earlier manual-rail cancels and unpaid rows are not flagged', async () => {
    const w = world([
      cancelledPaid('mine', START + 5000),
      cancelledPaid('earlier-owner-cancel', START - 3 * H),
      cancelledPaid('free', START + 6000, { amount_paid_cents: 0, payment_method: 'shop', payment_status: 'none' }),
    ]);
    const e = closureEnv(NOW);
    e.seen.set('closure:shop1', START);
    const r = await closeShopForDeletion('u1', ports([bookingLane(w.flow, 'shop1', w.queries, e.env)], 'shop1', { env: e.env }));
    expect(r.needsRefund).toEqual(['booking:mine']);
  });

  it('is ordered deterministically (cancelled_at, then id)', async () => {
    const w = world(['b', 'a', 'c'].map((id) => cancelledPaid(id, START + 1000)));
    const got = await w.queries.recentCancelledIds('shop1', iso(START), 2, 0);
    const next = await w.queries.recentCancelledIds('shop1', iso(START), 2, 2);
    expect([...got, ...next]).toEqual(['a', 'b', 'c']);
  });
});

describe('the shop is switched off first (finding 3)', () => {
  it('pauses bookings and store BEFORE any ids are read, and an unpausable shop deletes nothing', async () => {
    const order: string[] = [];
    const lane: Lane = { label: 'booking', open: async () => { order.push('open'); return []; }, process: async () => ({ cancelled: true }) };
    const r = await closeShopForDeletion('u1', ports([lane], 'shop1', { pauseShop: async (id: string) => { order.push(`pause:${id}`); } }));
    expect(r.ok).toBe(true);
    expect(order[0]).toBe('pause:shop1');
    expect(order.slice(1).every((x) => x === 'open')).toBe(true);

    const lane2 = { ...lane, open: vi.fn(async () => []) };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await closeShopForDeletion('u1', ports([lane2], 'shop1', { pauseShop: async () => { throw new Error('db down'); } }));
    err.mockRestore();
    expect(failed.ok).toBe(false);
    expect(lane2.open).not.toHaveBeenCalled();
  });

  it('re-reads the open ids once after the flags are off to catch stragglers, without redoing what it already handled', async () => {
    let reads = 0;
    const processed: string[] = [];
    const lane: Lane = {
      label: 'booking',
      open: async () => (++reads === 1 ? ['a'] : ['a', 'late']),
      process: async (id) => { processed.push(id); return { cancelled: true }; },
    };
    const r = await closeShopForDeletion('u1', ports([lane], 'shop1', { pauseShop: async () => {} }));
    expect(r).toMatchObject({ ok: true, bookingsCancelled: 2 });
    expect(processed).toEqual(['a', 'late']);
  });
});

describe('retry idempotency (db recovers)', () => {
  it('second call cancels only what is left and emails only those', async () => {
    const failing = new Set(['a2']);
    const w = world([appt('a1'), appt('a2'), appt('a3')]);
    const realUpdate = w.flow.repo.updateAppointment;
    w.flow.repo.updateAppointment = async (id: string, patch: any, expect?: any) => {
      if (failing.has(id) && patch.status === 'cancelled') throw new Error('db down');
      return realUpdate(id, patch, expect);
    };
    const lane = () => bookingLane(w.flow, 'shop1', w.queries);
    expect((await closeShopForDeletion('u1', ports([lane()]))).ok).toBe(false);
    expect(w.notified.map((e) => e.appointmentId).sort()).toEqual(['a1', 'a3']);
    failing.clear();
    const r = await closeShopForDeletion('u1', ports([lane()]));
    expect(r.ok).toBe(true);
    expect(w.notified.map((e) => e.appointmentId).sort()).toEqual(['a1', 'a2', 'a3']); // a2 once more, a1/a3 not repeated
    const again = await closeShopForDeletion('u1', ports([lane()]));
    expect(again.ok).toBe(true);
    expect(w.notified).toHaveLength(3);
  });

  it('caps the work per call and says more remains (retryable) until everything is cancelled', async () => {
    const w = world(Array.from({ length: 7 }, (_, i) => appt(`b${i}`)));
    const lane = () => bookingLane(w.flow, 'shop1', w.queries);
    const a = await closeShopForDeletion('u1', ports([lane()]), { cap: 3 });
    expect(a).toMatchObject({ ok: false, reason: 'more-remaining' });
    expect(w.notified).toHaveLength(3);
    const b = await closeShopForDeletion('u1', ports([lane()]), { cap: 3 });
    expect(b.ok).toBe(false);
    const c = await closeShopForDeletion('u1', ports([lane()]), { cap: 3 });
    expect(c.ok).toBe(true);
    expect(w.notified).toHaveLength(7);
  });
});

describe('closeShopForDeletion basics', () => {
  it('no shop = nothing to do', async () => {
    const r = await closeShopForDeletion('u1', ports([], null));
    expect(r).toMatchObject({ ok: true, bookingsCancelled: 0, ordersCancelled: 0, needsRefund: [] });
  });
  it('a lookup failure is a retryable failure', async () => {
    const r = await closeShopForDeletion('u1', { shopIdFor: async () => { throw new Error('db'); }, lanes: () => [], now: () => NOW });
    expect(r.ok).toBe(false);
  });
  it('logs ids only, never emails or names', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = world([appt('venmo', { payment_method: 'venmo', payment_status: 'paid', amount_paid_cents: 2500 })]);
    await closeShopForDeletion('u1', ports([bookingLane(w.flow, 'shop1', w.queries)]));
    const logged = JSON.stringify([...warn.mock.calls, ...err.mock.calls]);
    expect(logged).not.toContain('example.test');
    expect(logged).not.toContain('Cust');
    warn.mockRestore(); err.mockRestore();
  });
});

describe('orders lane contract (fake lane)', () => {
  it('reports orders cancelled, flagged and not-cancelled', async () => {
    const lane: Lane = {
      label: 'order',
      open: async () => ['o1', 'o2'],
      process: async (id) => (id === 'o1' ? { cancelled: true } : { cancelled: true, needsRefund: true }),
      notCancelled: async () => ['o3'],
    };
    const r = await closeShopForDeletion('u1', ports([lane]));
    expect(r).toMatchObject({ ok: true, ordersCancelled: 2, needsRefund: ['order:o2'], notCancelled: ['order:o3'] });
  });
});

// ---- deleteAccount: cancel + notify FIRST, only then delete ----------------------------------
function mkDeps(over: any = {}) {
  const calls: string[] = [];
  return {
    calls,
    getUser: vi.fn(async () => ({ id: 'u1' })),
    listSites: vi.fn(async () => [{ original_transaction_id: 't1', site_slug: 'fade-lab', environment: 'Production', published_at: 'x' }]),
    takeDown: vi.fn(async () => { calls.push('down'); }),
    purge: vi.fn(async () => { calls.push('purge'); }),
    deleteSites: vi.fn(async () => { calls.push('sites'); }),
    deleteUser: vi.fn(async () => { calls.push('user'); }),
    closeShop: vi.fn(async (_u: string) => { calls.push('close'); return { ok: true as const, bookingsCancelled: 2, ordersCancelled: 1, needsRefund: ['booking:b9'], notCancelled: [] }; }),
    ...over,
  };
}

describe('deleteAccount closes the shop first', () => {
  it('runs closeShop before any takedown or deletion, with the token user only, and reports the outcome', async () => {
    const d = mkDeps();
    const r = await deleteAccount('Bearer jwt', d);
    expect(d.closeShop).toHaveBeenCalledWith('u1');
    expect(d.calls).toEqual(['close', 'down', 'purge', 'sites', 'user']);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ deleted: true, bookingsCancelled: 2, ordersCancelled: 1, needsRefund: ['booking:b9'] });
  });

  it('closeShop not ok -> retryable 500, NOTHING taken down or deleted', async () => {
    const d = mkDeps({ closeShop: vi.fn(async () => ({ ok: false as const, reason: 'cancel-failed', bookingsCancelled: 1, ordersCancelled: 0, needsRefund: [], notCancelled: [] })) });
    const r = await deleteAccount('Bearer jwt', d);
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ error: 'delete-failed', retryable: true });
    expect(d.takeDown).not.toHaveBeenCalled();
    expect(d.purge).not.toHaveBeenCalled();
    expect(d.deleteSites).not.toHaveBeenCalled();
    expect(d.deleteUser).not.toHaveBeenCalled();
  });

  it('closeShop throwing -> same retryable 500', async () => {
    const d = mkDeps({ closeShop: vi.fn(async () => { throw new Error('boom'); }) });
    const r = await deleteAccount('Bearer jwt', d);
    expect(r.status).toBe(500);
    expect(d.deleteUser).not.toHaveBeenCalled();
  });

  it('unauthenticated / bad token never reaches closeShop', async () => {
    const d = mkDeps({ getUser: vi.fn(async () => null) });
    for (const h of [undefined, 'Bearer bad']) expect((await deleteAccount(h, d)).status).toBe(401);
    expect(d.closeShop).not.toHaveBeenCalled();
  });

  it('a move in progress (409) never reaches closeShop', async () => {
    const d = mkDeps({ moveInProgress: async () => true });
    expect((await deleteAccount('Bearer jwt', d)).status).toBe(409);
    expect(d.closeShop).not.toHaveBeenCalled();
  });
});

describe('closed-account emails', () => {
  const ctx: any = {
    shop: { id: 's', name: 'Fade Lab', slug: 'fade-lab', timezone: 'America/New_York', owner_id: 'o', accent: null },
    appt: appt('a1', { amount_paid_cents: 0 }), ownerEmail: 'owner@example.test',
  };
  it('booking email says the business closed its account, with no rebook link', () => {
    const m = cancellationEmail(ctx, 'shop', 0, NOW, true);
    expect(m.text).toMatch(/closed its account/i);
    expect(m.text).toMatch(/cancel/i);
    expect(m.text).not.toMatch(/Book again/);
    expect(m.html).not.toMatch(/Book another time/);
  });
  it('a paid booking with no automatic refund says plainly to contact the shop to confirm the refund', () => {
    const paid = { ...ctx, appt: appt('p', { amount_paid_cents: 2500, payment_method: 'card' }) };
    for (const m of [cancellationEmail(paid, 'shop', 0, NOW, true)]) {
      expect(m.text).toContain('Contact Fade Lab to confirm your refund.');
      expect(m.html).toContain('Contact Fade Lab to confirm your refund.');
      expect(m.text).not.toMatch(/reply to/i);
    }
  });
  it('the normal shop cancel email is unchanged', () => {
    expect(cancellationEmail(ctx, 'shop', 0, NOW).text).toMatch(/had to cancel/);
  });
  it('order email says the business closed its account', () => {
    const octx: any = { shop: ctx.shop, order: { id: 'o1', order_no: 7, total_cents: 1000, customer_email: 'c@example.test', customer_name: 'C', manage_token: 't' }, items: [] };
    const m = orderCancelledEmail(octx, 0, true);
    expect(m.text).toMatch(/closed its account/i);
  });
  it('order email: a refund we could not send says so and tells the customer to contact the shop', () => {
    const octx: any = { shop: ctx.shop, order: { id: 'o1', order_no: 7, total_cents: 1000, amount_paid_cents: 1000, customer_email: 'c@example.test', customer_name: 'C', manage_token: 't' }, items: [] };
    const m = orderCancelledEmail(octx, 0, true, 1000);
    expect(m.text).toContain('Contact Fade Lab to confirm your refund.');
    expect(m.text).toMatch(/\$10/);
    expect(orderCancelledEmail(octx, 0, true).text).toContain('Contact Fade Lab to confirm your refund.');
  });
});
