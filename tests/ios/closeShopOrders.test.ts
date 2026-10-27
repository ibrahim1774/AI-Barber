import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createOrder } from '../../lib/store/publicFlow.js';
import { closeShopForDeletion, orderLane, type OrderQueries } from '../../lib/ios/closeShop.js';
import { storeWorld, OWNER_USER, OTHER_USER, type StoreWorld } from '../store/fakeRepo.js';
import { refundOrder as realRefundOrder } from '../../lib/store/payments.js';
import { closureEnv, owedFields, SIX_H } from './closureHarness.js';

process.env.STRIPE_CONNECT_SECRET_KEY ||= 'sk_test_fake_for_closure_tests';

async function place(w: StoreWorld, over: Record<string, unknown> = {}) {
  const r = await createOrder({
    slug: 'fresh-cuts', clientKey: randomUUID(), items: [{ productId: w.ids.oil, quantity: 2 }],
    customer: { name: 'Sam Lee', phone: '5551234567', email: 'sam@example.com' },
    fulfilment: 'pickup', pay: 'manual', expectedTotalCents: 3000, ...over,
  }, w.deps);
  expect(r.status).toBe(201);
  w.notified.length = 0;
  return w.state.orders.at(-1)!;
}
const paidCard = async (w: StoreWorld) => {
  const o = await place(w, { pay: 'card' });
  Object.assign(w.order(o.id), { status: 'paid', payment_status: 'paid', amount_paid_cents: o.total_cents, stripe_payment_intent_id: `pi_${o.id}`, paid_at: '2026-11-02T12:01:00.000Z' });
  return w.order(o.id);
};
const queries = (w: StoreWorld): OrderQueries => ({
  openIds: async (shopId, limit) => w.state.orders.filter((o) => o.shop_id === shopId && ['new', 'paid'].includes(o.status)).slice(0, limit).map((o) => o.id),
  readyIds: async (shopId) => w.state.orders.filter((o) => o.shop_id === shopId && o.status === 'ready').map((o) => o.id),
});
const run = (w: StoreWorld, user = OWNER_USER, e = closureEnv(Date.parse('2026-11-02T12:00:00Z'))) =>
  closeShopForDeletion(user, { now: e.env.now, env: e.env, shopIdFor: async () => w.ids.shopId, lanes: (s, u) => [orderLane(w.deps, u, s, queries(w), e.env)] } as any);
/** Moves both the closure clock and the store's clock. */
const advance = (w: StoreWorld, e: ReturnType<typeof closureEnv>, ms: number) => { e.clock.now += ms; w.setNow(new Date(e.clock.now).toISOString()); };

describe('orders on account deletion', () => {
  it('the refund reaches Stripe on the connected account with an idempotency key', async () => {
    const w = storeWorld();
    const calls: Array<{ headers: Record<string, string>; body: string }> = [];
    w.payments.refundOrder.mockImplementation(async (s: any, o: any, c: number, opts: any) =>
      realRefundOrder(s, o, c, { ...opts, fetch: async (_u: string, init: any) => { calls.push({ headers: init.headers, body: String(init.body) }); return { ok: true, status: 200, json: async () => ({ id: 're_1', status: 'succeeded', amount: c }) } as any; } }));
    const o = await paidCard(w);
    await run(w);
    expect(calls).toHaveLength(1);
    expect(calls[0].headers['Stripe-Account']).toBe('acct_1');
    expect(calls[0].headers['Idempotency-Key']).toMatch(new RegExp(`^refund-order-${o.id}-`));
    expect(calls[0].body).toContain(`payment_intent=pi_${o.id}`);
  });

  it('an unpaid manual order is cancelled through the owner path and the customer is emailed as closed', async () => {
    const w = storeWorld();
    const o = await place(w);
    const r = await run(w);
    expect(r).toMatchObject({ ok: true, ordersCancelled: 1, needsRefund: [] });
    expect(w.order(o.id)).toMatchObject({ status: 'cancelled', cancelled_by: 'shop' });
    expect(w.notified).toEqual([expect.objectContaining({ kind: 'order_cancelled', orderId: o.id, closed: true })]);
  });

  it('a paid card order is refunded through the existing refund path, which cancels it and emails', async () => {
    const w = storeWorld();
    const o = await paidCard(w);
    const r = await run(w);
    expect(w.payments.refundOrder).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, ordersCancelled: 1, needsRefund: [] });
    expect(w.order(o.id)).toMatchObject({ status: 'cancelled', amount_refunded_cents: o.total_cents });
    expect(w.notified.filter((e) => e.kind === 'order_cancelled')).toHaveLength(1);
    expect(w.notified[0]).toMatchObject({ closed: true });
  });

  it('a failed card refund aborts; the retry refunds, and no second email is sent', async () => {
    const w = storeWorld();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const o = await paidCard(w);
    w.payments.refundOrder.mockRejectedValueOnce(new Error('stripe down'));
    expect((await run(w)).ok).toBe(false);
    expect(w.order(o.id).status).toBe('paid');
    expect(w.notified).toEqual([]);
    const r = await run(w);
    expect(r.ok).toBe(true);
    expect(w.order(o.id).status).toBe('cancelled');
    expect(w.notified).toHaveLength(1);
    expect((await run(w)).ok).toBe(true);
    expect(w.notified).toHaveLength(1);
    err.mockRestore();
  });

  describe('a card refund that keeps failing (findings 1 and 2)', () => {
    const setup = async () => {
      const w = storeWorld();
      const e = closureEnv(Date.parse('2026-11-02T12:00:00Z'));
      const o = await paidCard(w);
      w.payments.refundOrder.mockRejectedValue(new Error('stripe down'));
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      return { w, e, o, done: () => err.mockRestore() };
    };

    it('app retries seconds apart never let the deletion proceed: order stays paid, nothing emailed or recorded', async () => {
      const { w, e, o, done } = await setup();
      for (let i = 0; i < 3; i++) {
        expect((await run(w, OWNER_USER, e)).ok).toBe(false);
        advance(w, e, 5_000);
      }
      expect(w.order(o.id).status).toBe('paid');
      expect(w.notified).toEqual([]);
      expect(e.owed.size).toBe(0);
      done();
    });

    it('after 6 hours the order is cancelled, the customer is told the refund is owed, and the record is saved', async () => {
      const { w, e, o, done } = await setup();
      expect((await run(w, OWNER_USER, e)).ok).toBe(false);
      advance(w, e, SIX_H + 1000);
      const r = await run(w, OWNER_USER, e);
      done();
      expect(r).toMatchObject({ ok: true, needsRefund: [`order:${o.id}`] });
      expect(w.order(o.id).status).toBe('cancelled');
      expect(w.notified).toEqual([expect.objectContaining({ kind: 'order_cancelled', orderId: o.id, closed: true, owedCents: o.total_cents })]);
      expect([...e.owed.values()].map(owedFields)).toEqual([{ stripe_account_id: 'acct_1', payment_intent_id: `pi_${o.id}`, owed_cents: o.total_cents, row_id: o.id }]);
      expect(JSON.stringify([...e.owed.values()])).not.toContain('sam@example.com');
    });

    it('a stuck marker from the sweep proceeds at once', async () => {
      const { w, e, o, done } = await setup();
      expect((await run(w, OWNER_USER, e)).ok).toBe(false);
      w.order(o.id).refund_stuck_at = new Date(e.clock.now).toISOString();
      const r = await run(w, OWNER_USER, e);
      done();
      expect(r).toMatchObject({ ok: true, needsRefund: [`order:${o.id}`] });
      expect(w.order(o.id).status).toBe('cancelled');
      expect(w.notified).toHaveLength(1);
    });

    it('if the cancel loses its compare-and-set after the record was saved, the record is removed again (round 2, finding 3)', async () => {
      const { w, e, o, done } = await setup();
      w.order(o.id).refund_stuck_at = new Date(e.clock.now).toISOString();
      const real = w.deps.repo.updateOrder.bind(w.deps.repo);
      let lost = false;
      w.deps.repo.updateOrder = (async (id: string, patch: any, g: any) => {
        if (!lost && patch.status === 'cancelled') { lost = true; return { ok: false, reason: 'stale' }; } // the webhook / sweep got there first
        return real(id, patch, g);
      }) as any;
      const r = await run(w, OWNER_USER, e);
      done();
      expect(lost).toBe(true);
      expect(r).toMatchObject({ ok: false, reason: 'refund-pending' });
      expect(w.notified).toEqual([]);
      expect(e.owed.size).toBe(0);
    });

    it('if the record cannot be saved nothing is cancelled and the call is retryable', async () => {
      const { w, e, o, done } = await setup();
      await run(w, OWNER_USER, e);
      advance(w, e, SIX_H + 1000);
      e.flags.failRecord = true;
      expect((await run(w, OWNER_USER, e)).ok).toBe(false);
      done();
      expect(w.order(o.id).status).toBe('paid');
      expect(w.notified).toEqual([]);
    });
  });

  describe('rows that can never succeed (finding 4)', () => {
    it('a paid card order with no payment intent is let go only after 6 hours: cancelled, emailed, recorded', async () => {
      const w = storeWorld();
      const e = closureEnv(Date.parse('2026-11-02T12:00:00Z'));
      const o = await paidCard(w);
      w.order(o.id).stripe_payment_intent_id = null;
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect((await run(w, OWNER_USER, e)).ok).toBe(false);
      advance(w, e, 5_000);
      expect((await run(w, OWNER_USER, e)).ok).toBe(false);
      expect(w.order(o.id).status).toBe('paid');
      advance(w, e, SIX_H);
      const r = await run(w, OWNER_USER, e);
      err.mockRestore();
      expect(r).toMatchObject({ ok: true, needsRefund: [`order:${o.id}`] });
      expect(w.order(o.id).status).toBe('cancelled');
      expect(w.notified).toEqual([expect.objectContaining({ kind: 'order_cancelled', closed: true, owedCents: o.total_cents })]);
      expect([...e.owed.values()].map(owedFields)).toEqual([{ stripe_account_id: 'acct_1', payment_intent_id: null, owed_cents: o.total_cents, row_id: o.id }]);
    });

    it('a completed hold whose webhook never arrives is let go only after 6 hours: cancelled, emailed, recorded', async () => {
      const w = storeWorld();
      const e = closureEnv(Date.parse('2026-11-02T12:00:00Z'));
      const o = await place(w, { pay: 'card' });
      w.order(o.id).stripe_checkout_session_id = 'cs_done';
      w.payments.closeCheckoutSession.mockResolvedValue('complete');
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect((await run(w, OWNER_USER, e)).ok).toBe(false);
      advance(w, e, 5_000);
      expect((await run(w, OWNER_USER, e)).ok).toBe(false);
      expect(w.order(o.id).status).toBe('new');
      advance(w, e, SIX_H);
      const r = await run(w, OWNER_USER, e);
      err.mockRestore();
      expect(r).toMatchObject({ ok: true, notCancelled: [], needsRefund: [`order:${o.id}`] });
      expect(w.order(o.id).status).toBe('cancelled');
      expect(w.notified).toEqual([expect.objectContaining({ kind: 'order_cancelled', closed: true, owedCents: o.total_cents })]);
      expect([...e.owed.values()].map(owedFields)).toEqual([{ stripe_account_id: 'acct_1', payment_intent_id: null, owed_cents: o.total_cents, row_id: o.id }]);
    });
  });

  it('closing pauses the store flag before any order is read', async () => {
    const w = storeWorld();
    await place(w);
    const seen: boolean[] = [];
    const q = queries(w);
    const e = closureEnv(0);
    await closeShopForDeletion(OWNER_USER, {
      now: e.env.now, env: e.env, shopIdFor: async () => w.ids.shopId,
      pauseShop: async () => { w.shop().store_enabled = false; },
      lanes: (s, u) => [orderLane(w.deps, u, s, { ...q, openIds: async (...a) => { seen.push(w.shop().store_enabled); return q.openIds(...a); } }, e.env)],
    } as any);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((v) => v === false)).toBe(true);
  });

  it('a manual order the customer already paid is cancelled and flagged, with no money moved', async () => {
    const w = storeWorld();
    const o = await place(w);
    Object.assign(w.order(o.id), { status: 'paid', payment_status: 'paid', amount_paid_cents: o.total_cents });
    const r = await run(w);
    expect(w.payments.refundOrder).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, needsRefund: [`order:${o.id}`] });
  });

  it('an unpaid card hold is expired without an email', async () => {
    const w = storeWorld();
    const o = await place(w, { pay: 'card' });
    const r = await run(w);
    expect(r.ok).toBe(true);
    expect(w.order(o.id).status).toBe('cancelled');
    expect(w.notified).toEqual([]);
  });

  it('orders ready for pickup are left alone and reported', async () => {
    const w = storeWorld();
    const o = await place(w);
    w.order(o.id).status = 'ready';
    const r = await run(w);
    expect(r).toMatchObject({ ok: true, ordersCancelled: 0, notCancelled: [`order:${o.id}`] });
    expect(w.order(o.id).status).toBe('ready');
  });

  it("another account's id cannot reach this shop's orders", async () => {
    const w = storeWorld();
    const o = await place(w);
    // Pretend the other account's id is asked about this shop: the owner path 404s, so the cancel fails and nothing is touched.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await run(w, OTHER_USER);
    expect(r.ok).toBe(false);
    expect(w.order(o.id).status).toBe('new');
    err.mockRestore();
  });
});
