// Phase 4 tiers: the booking page opens only on the Bookings or Store plan, and owner bookings
// writes that create or move bookings need it too. Cancel and mark never do (spec §11).
import { describe, it, expect, vi } from 'vitest';
import {
  cancelOwnerAppointment,
  createOwnerAppointment,
  createTimeOff,
  markOwnerAppointment,
  rescheduleOwnerAppointment,
  setupShop,
} from '../../lib/bookings/ownerFlow.js';
import { makePurchaseVerifier } from '../../lib/bookings/live.js';
import { makeVerifier, type VerifiedTx } from '../../lib/ios/appleVerify.js';
import { createAppointment, getShop, postSent } from '../../lib/bookings/publicFlow.js';
import { bookingsOpen, ownerBookingsAllowed } from '../../lib/bookings/core.js';
import { OTID, world } from './fakeRepo.js';

const P = 'com.ibrahim1774.aibarber.';
const AUTH = 'Bearer owner-jwt';
const T10 = '2026-11-03T15:00:00.000Z';
const T11 = '2026-11-03T16:00:00.000Z';
const PAUSED = { status: 423, body: { error: 'bookings-paused' } };

function onProduct(product: string) {
  const w = world();
  w.state.purchases[OTID].product_id = P + product;
  return w;
}

const book = (w: ReturnType<typeof world>, start = T10) => createAppointment({
  slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: w.ids.mike, start,
  customer: { name: 'Sam', phone: '5551234567', email: 'sam@example.com' }, pay: 'shop',
}, w.deps);

/** A booking made while the shop was on a plan with bookings, then the plan changes. */
async function existingBookingThenProduct(product: string) {
  const w = world();
  const r = await book(w);
  expect(r.status).toBe(201);
  w.state.purchases[OTID].product_id = P + product;
  return { w, appt: w.state.appointments.at(-1)! };
}

describe('public booking page gate', () => {
  it.each(['hosting.monthly', 'hosting.yearly'])('%s → GET /api/book/shop paused and a create is 423', async (product) => {
    const w = onProduct(product);
    expect(await getShop({ slug: 'fresh-cuts' }, w.deps)).toEqual({ status: 200, body: { paused: true, shop: { name: 'Fresh Cuts' } } });
    expect(await book(w)).toEqual(PAUSED);
    expect(await bookingsOpen(w.deps.repo, w.shop())).toBe(false);
  });

  it.each(['bookings.monthly', 'bookings.yearly', 'store.monthly', 'store.yearly'])('%s → open', async (product) => {
    const w = onProduct(product);
    const r = await getShop({ slug: 'fresh-cuts' }, w.deps);
    expect((r.body as any).paused).toBe(false);
    expect((await book(w)).status).toBe(201);
  });

  it('an unknown or missing product is paused (fails closed)', async () => {
    for (const product of ['com.other.app', null]) {
      const w = world();
      w.state.purchases[OTID].product_id = product;
      expect(await bookingsOpen(w.deps.repo, w.shop())).toBe(false);
    }
  });

  it('a lapse (taken down) pauses even on Store', async () => {
    const w = onProduct('store.monthly');
    w.state.purchases[OTID].taken_down_at = '2026-10-01T00:00:00Z';
    expect(await bookingsOpen(w.deps.repo, w.shop())).toBe(false);
  });
});

describe('owner bookings writes on the Website plan', () => {
  it('walk-in create → 423 bookings-paused (nothing written)', async () => {
    const w = onProduct('hosting.monthly');
    expect(await createOwnerAppointment(AUTH, { memberId: w.ids.mike, serviceId: w.ids.cut, start: T10, customer: { name: 'Walk In' } }, w.deps))
      .toEqual(PAUSED);
    expect(w.state.appointments).toHaveLength(0);
  });

  it('reschedule → 423', async () => {
    const { w, appt } = await existingBookingThenProduct('hosting.monthly');
    expect(await rescheduleOwnerAppointment(AUTH, appt.id, { start: T11 }, w.deps)).toEqual(PAUSED);
    expect(w.state.appointments[0].start_at).toBe(appt.start_at);
  });

  it('time-off → 423', async () => {
    const w = onProduct('hosting.yearly');
    expect(await createTimeOff(AUTH, { memberId: w.ids.jay, start: T10, end: T11 }, w.deps)).toEqual(PAUSED);
    expect(w.state.timeOff).toHaveLength(0);
  });

  it('owner cancel still works (refunds customers)', async () => {
    const { w, appt } = await existingBookingThenProduct('hosting.monthly');
    const r = await cancelOwnerAppointment(AUTH, appt.id, w.deps);
    expect(r.status).toBe(200);
    expect(w.state.appointments[0].status).toBe('cancelled');
  });

  it('mark (paid, done) still works', async () => {
    const { w, appt } = await existingBookingThenProduct('hosting.monthly');
    expect((await markOwnerAppointment(AUTH, appt.id, { action: 'paid' }, w.deps)).status).toBe(200);
    expect((await markOwnerAppointment(AUTH, appt.id, { action: 'done' }, w.deps)).status).toBe(200);
    expect(w.state.appointments[0].status).toBe('done');
  });

  it('bookings_enabled off does not block the owner (the gate ignores it)', async () => {
    const w = onProduct('bookings.monthly');
    w.state.shops[0].bookings_enabled = false;
    expect(await ownerBookingsAllowed(w.deps.repo, w.shop())).toBe(true);
    expect((await createOwnerAppointment(AUTH, { memberId: w.ids.mike, serviceId: w.ids.cut, start: T10, customer: { name: 'X' } }, w.deps)).status).toBe(201);
  });

  it.each(['bookings.yearly', 'store.monthly'])('%s → walk-in, reschedule and time-off allowed', async (product) => {
    const w = onProduct(product);
    expect((await createOwnerAppointment(AUTH, { memberId: w.ids.mike, serviceId: w.ids.cut, start: T10, customer: { name: 'X' } }, w.deps)).status).toBe(201);
    const id = w.state.appointments[0].id;
    expect((await rescheduleOwnerAppointment(AUTH, id, { start: T11 }, w.deps)).status).toBe(200);
    expect((await createTimeOff(AUTH, { memberId: w.ids.jay, start: T10, end: T11 }, w.deps)).status).toBe(200);
  });

  it('ios_otid null → owner create 423', async () => {
    const w = world({ shop: { ios_otid: null } });
    expect(await createOwnerAppointment(AUTH, { memberId: w.ids.mike, serviceId: w.ids.cut, start: T10, customer: { name: 'X' } }, w.deps))
      .toEqual(PAUSED);
  });

  it('revoked or taken down → owner create 423', async () => {
    for (const k of ['revoked_at', 'taken_down_at'] as const) {
      const w = onProduct('store.monthly');
      w.state.purchases[OTID][k] = '2026-10-01T00:00:00Z';
      expect(await ownerBookingsAllowed(w.deps.repo, w.shop())).toBe(false);
      expect((await createOwnerAppointment(AUTH, { memberId: w.ids.mike, serviceId: w.ids.cut, start: T10, customer: { name: 'X' } }, w.deps)).status).toBe(423);
    }
  });
});

// Controller update (2026-10-21): the publish paywall sells all six products, so /api/shop/setup
// must link a Bookings or Store purchase made at publish and record its tier straight away.
describe('POST /api/shop/setup with any of the six products', () => {
  const NEW_USER = '22222222-2222-4222-8222-222222222222';
  const NEW_OTID = '2000000444';
  const body = { siteId: '33333333-3333-4333-8333-333333333333', name: 'Kings', timezone: 'America/New_York', transactionId: '2000000555' };

  /** The production PurchaseVerifier over a real makeVerifier (fake Apple) and a fake ios_purchases. */
  function liveLike(w: ReturnType<typeof world>, productId: string) {
    const upserts: VerifiedTx[] = [];
    const verify = makeVerifier({
      bundleId: 'b',
      lookup: async (env) => (env === 'Production' ? { status: 200, signedTransactionInfo: 's' } : { status: 404 }),
      decode: async () => ({ bundleId: 'b', productId, originalTransactionId: NEW_OTID, transactionId: '2000000555', purchaseDate: 1, expiresDate: 4_000_000_000_000 }),
      statuses: async () => ({ status: 200, items: [{ status: 1, originalTransactionId: NEW_OTID, signedTransactionInfo: 'l' }] }),
    });
    const repo = {
      upsertVerified: vi.fn(async (tx: VerifiedTx, _opts?: { checkedAt?: number }) => {
        upserts.push(tx);
        // What the gate reads back from ios_purchases.
        w.state.purchases[tx.originalTransactionId] = { user_id: null, product_id: tx.productId, revoked_at: null, taken_down_at: null };
        return {} as any;
      }),
      setUser: vi.fn(async (otid: string, userId: string) => { w.state.purchases[otid].user_id = userId; }),
    };
    return { purchases: makePurchaseVerifier(async () => ({ verify, repo }), () => 1000), repo, upserts };
  }

  it.each([
    ['bookings.monthly', true],
    ['store.yearly', true],
    ['hosting.monthly', false],
  ])('%s: verifies, links, records the tier; the booking page follows it', async (suffix, bookable) => {
    const w = world();
    w.users['new-jwt'] = { id: NEW_USER, email: null, fullName: 'King' };
    const { purchases, repo, upserts } = liveLike(w, P + suffix);
    w.deps.purchases = purchases;
    const r = await setupShop('Bearer new-jwt', body, w.deps);
    expect(r.status).toBe(200);
    expect((r.body as any).shop.purchaseLinked).toBe(true);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ originalTransactionId: NEW_OTID, productId: P + suffix, productPurchasedAt: 1 });
    expect(repo.upsertVerified.mock.calls[0][1]).toEqual({ checkedAt: 1000 });
    expect(w.state.purchases[NEW_OTID].user_id).toBe(NEW_USER);
    const shop = w.state.shops.find((s) => s.owner_id === NEW_USER)!;
    expect(shop.ios_otid).toBe(NEW_OTID);
    expect(await ownerBookingsAllowed(w.deps.repo, shop)).toBe(bookable);
  });

  it('an unknown product is 400 invalid transactionId (no shop linked)', async () => {
    const w = world();
    w.users['new-jwt'] = { id: NEW_USER, email: null, fullName: 'King' };
    const { purchases, upserts } = liveLike(w, 'com.other.app.monthly');
    w.deps.purchases = purchases;
    expect(await setupShop('Bearer new-jwt', body, w.deps)).toEqual({ status: 400, body: { error: 'invalid', field: 'transactionId' } });
    expect(upserts).toHaveLength(0);
  });
});

// I2: the sweep only takes down bound, published Production purchases. A shop linked to any
// other purchase must close its booking page itself once that purchase has lapsed.
describe('a linked purchase the sweep never takes down', () => {
  const LAPSED = '2026-01-01T00:00:00Z'; // long past, whatever the clock
  it.each([
    ['unbound (a second Apple ID linked through setup)', { site_slug: null }],
    ['Sandbox', { environment: 'Sandbox', site_slug: 'fresh-cuts', published_at: '2025-12-01T00:00:00Z' }],
  ])('%s and expired → booking page paused, owner writes 423', async (_n, over) => {
    const w = onProduct('store.monthly');
    Object.assign(w.state.purchases[OTID], { expires_at: LAPSED, ...over });
    expect(await getShop({ slug: 'fresh-cuts' }, w.deps)).toEqual({ status: 200, body: { paused: true, shop: { name: 'Fresh Cuts' } } });
    expect(await book(w)).toEqual(PAUSED);
    expect(await createOwnerAppointment(AUTH, { memberId: w.ids.mike, serviceId: w.ids.cut, start: T10, customer: { name: 'X' } }, w.deps)).toEqual(PAUSED);
  });

  it('a bound, published Production purchase past expiry stays open (the sweep decides, with Apple)', async () => {
    const w = onProduct('store.monthly');
    Object.assign(w.state.purchases[OTID], { expires_at: LAPSED, site_slug: 'fresh-cuts', published_at: '2025-12-01T00:00:00Z', environment: 'Production' });
    expect((await book(w)).status).toBe(201);
  });
});

// M5 (controller ruling): a customer's "I've sent it" on an EXISTING booking still works after a
// downgrade, so customers never get stuck; only a full lapse refuses it.
describe('POST /api/book/sent after a downgrade', () => {
  async function manualBooking() {
    const w = world({ shop: { manual_handles: { cashapp: '$fresh' } } });
    const r = await createAppointment({
      slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: w.ids.mike, start: T10,
      customer: { name: 'Sam', phone: '5551234567', email: 'sam@example.com' }, pay: 'manual', method: 'cashapp',
    }, w.deps);
    expect(r.status).toBe(201);
    return { w, appt: w.state.appointments.at(-1)! };
  }

  it.each(['hosting.monthly', 'hosting.yearly'])('on %s → 200, recorded', async (product) => {
    const { w, appt } = await manualBooking();
    w.state.purchases[OTID].product_id = P + product;
    expect(await postSent({ token: appt.manage_token, method: 'cashapp' }, w.deps)).toEqual({ status: 200, body: {} });
    expect(w.state.appointments[0].customer_says_paid_at).not.toBeNull();
  });

  it.each([
    ['taken down', { taken_down_at: '2026-10-01T00:00:00Z' }],
    ['revoked', { revoked_at: '2026-10-01T00:00:00Z' }],
    ['an unswept purchase past expiry', { site_slug: null, expires_at: '2026-01-01T00:00:00Z' }],
  ])('a full lapse (%s) → 423', async (_n, over) => {
    const { w, appt } = await manualBooking();
    Object.assign(w.state.purchases[OTID], over);
    expect(await postSent({ token: appt.manage_token, method: 'cashapp' }, w.deps)).toEqual(PAUSED);
  });
});
