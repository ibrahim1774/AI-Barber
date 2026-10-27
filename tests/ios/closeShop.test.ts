import { describe, it, expect, vi } from 'vitest';
import { closeShopForDeletion, bookingLane, type Lane } from '../../lib/ios/closeShop.js';
import { deleteAccount } from '../../lib/ios/deleteAccount.js';
import { cancellationEmail } from '../../lib/bookings/notify.js';
import { orderCancelledEmail } from '../../lib/store/notify.js';

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

function world(rows: any[], opts: { failCancelFor?: string[]; refundThrows?: boolean } = {}) {
  const db = new Map<string, any>(rows.map((r) => [r.id, r]));
  const notified: any[] = [];
  const refunds: any[] = [];
  const shop = { id: 'shop1', name: 'Fade Lab', cancel_cutoff_min: 0, stripe_account_id: 'acct', stripe_charges_enabled: true };
  const repo: any = {
    appointmentById: async (id: string) => db.get(id) ?? null,
    shopById: async (id: string) => (id === 'shop1' ? shop : null),
    refundAttempts: async () => 0,
    logEvent: async () => {},
    updateAppointment: async (id: string, patch: any, expect?: any) => {
      if (opts.failCancelFor?.includes(id) && patch.status === 'cancelled') throw new Error('db down');
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
    refundAppointment: vi.fn(async (_s: any, a: any, cents: number) => {
      if (opts.refundThrows) throw new Error('stripe down');
      refunds.push({ id: a.id, cents });
      return { refundedCents: cents };
    }),
  };
  const flow: any = { repo, payments, notify: async (e: any) => { notified.push(e); }, now: () => NOW, baseUrl: 'https://x.test' };
  const queries = {
    upcomingIds: async (shopId: string, nowIso: string, limit: number) =>
      [...db.values()].filter((r) => r.shop_id === shopId && r.status === 'booked' && r.start_at > nowIso).slice(0, limit).map((r) => r.id),
    recentCancelledIds: async (shopId: string, sinceIso: string, limit: number) =>
      [...db.values()].filter((r) => r.shop_id === shopId && r.status === 'cancelled' && r.cancelled_by === 'shop' && (r.cancelled_at ?? '') >= sinceIso).slice(0, limit).map((r) => r.id),
  };
  return { db, notified, refunds, flow, queries, shop };
}

const ports = (lanes: Lane[], shopId: string | null = 'shop1') => ({ shopIdFor: async () => shopId, lanes: () => lanes, now: () => NOW });

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

  it('a failed card refund aborts (retry later); on the next call the refund is retried, and if it still fails it is flagged and the deletion may go on', async () => {
    const w = world([appt('paid', { payment_method: 'card', payment_status: 'paid', amount_paid_cents: 3000, stripe_payment_intent_id: 'pi_1' })], { refundThrows: true });
    const first = await closeShopForDeletion('u1', ports([bookingLane(w.flow, 'shop1', w.queries)]));
    expect(first.ok).toBe(false);
    expect(w.db.get('paid').status).toBe('cancelled');
    w.notified.length = 0;
    const second = await closeShopForDeletion('u1', ports([bookingLane(w.flow, 'shop1', w.queries)]));
    expect(second).toMatchObject({ ok: true, needsRefund: ['booking:paid'] });
    expect(w.notified).toEqual([]); // no second email
  });

  it('a paid manual-rail booking (no money path) is cancelled and flagged as needing a refund, never refunded by us', async () => {
    const w = world([appt('venmo', { payment_method: 'venmo', payment_status: 'paid', amount_paid_cents: 2500 })]);
    const r = await closeShopForDeletion('u1', ports([bookingLane(w.flow, 'shop1', w.queries)]));
    expect(w.refunds).toEqual([]);
    expect(w.db.get('venmo').status).toBe('cancelled');
    expect(r).toMatchObject({ ok: true, needsRefund: ['booking:venmo'] });
  });

  it('a failing cancel aborts: ok false, other bookings still cancelled, nothing is reported as done for the failing one', async () => {
    const w = world([appt('a1'), appt('a2'), appt('a3')], { failCancelFor: ['a2'] });
    const r = await closeShopForDeletion('u1', ports([bookingLane(w.flow, 'shop1', w.queries)]));
    expect(r.ok).toBe(false);
    expect(w.db.get('a2').status).toBe('booked');
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
  it('the normal shop cancel email is unchanged', () => {
    expect(cancellationEmail(ctx, 'shop', 0, NOW).text).toMatch(/had to cancel/);
  });
  it('order email says the business closed its account', () => {
    const octx: any = { shop: ctx.shop, order: { id: 'o1', order_no: 7, total_cents: 1000, customer_email: 'c@example.test', customer_name: 'C', manage_token: 't' }, items: [] };
    const m = orderCancelledEmail(octx, 0, true);
    expect(m.text).toMatch(/closed its account/i);
  });
});
