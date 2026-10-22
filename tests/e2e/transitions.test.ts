// E2E: plan transitions through Apple (notifications + the verifier), the publish flow, the iOS
// sweep, /api/shop/plan, and the bookings + store gates reading the same ios_purchases row.
vi.mock('@google-cloud/storage', async () => (await import('./harness/gcs.js')).storageModule);
vi.mock('../../lib/deploySite.js', async () => (await import('./harness/vercel.js')).deploySiteModule);

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AI_BOOK, AI_SHOP, DAY, resetBoundaries, siteData, siteWorld, type SiteWorld } from './harness/world.js';
import { PRODUCTS } from './harness/apple.js';
import { pendingOf } from './harness/gcs.js';
import { deploysOf, vercel } from './harness/vercel.js';
import { getShop as getBookingShop, createAppointment } from '../../lib/bookings/publicFlow.js';
import { createOwnerAppointment, cancelOwnerAppointment } from '../../lib/bookings/ownerFlow.js';
import { getStoreShop, createOrder, postOrderSent } from '../../lib/store/publicFlow.js';
import { markOwnerOrder, refundOwnerOrder } from '../../lib/store/ownerFlow.js';
import { updateSite } from '../../lib/admin/sites.js';
import { world as bookingWorld } from '../bookings/fakeRepo.js';
import { storeWorld } from '../store/fakeRepo.js';

let w: SiteWorld;
beforeEach(() => {
  resetBoundaries();
  w = siteWorld();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const OFFLINE = 'Website unavailable';
const live = (slug = 'fade-lab') => vercel.live.get(slug) ?? '';
const linked = (otid: string) => {
  const b = bookingWorld({ shop: { ios_otid: otid } });
  b.deps.repo.purchase = w.gateRow;
  const s = storeWorld({ shop: { ios_otid: otid } });
  s.deps.repo.purchase = w.gateRow;
  return { b, s };
};
const gates = async (otid: string) => {
  const { b, s } = linked(otid);
  return {
    bookings: !((await getBookingShop({ slug: 'fresh-cuts' }, b.deps)).body as any).paused,
    store: !((await getStoreShop({ slug: 'fresh-cuts' }, s.deps)).body as any).paused,
  };
};
const full = siteData({ bookingUrl: AI_BOOK, shopUrl: AI_SHOP } as any);

// ---------------------------------------------------------------------------
describe('upgrade Website → Bookings → Store (same subscription group)', () => {
  it('links, gates and the Book/Shop strip follow each upgrade; a late notification for the replaced product never moves it back', async () => {
    const { otid, transactionId } = w.apple.buy(PRODUCTS.websiteMonthly);
    await w.publish(transactionId, full);
    expect(pendingOf('fade-lab').siteData).not.toHaveProperty('bookingUrl');
    expect(pendingOf('fade-lab').siteData).not.toHaveProperty('shopUrl');
    expect(await gates(otid)).toEqual({ bookings: false, store: false });

    w.clock.advance(DAY);
    const websiteTx = w.apple.latest(otid);
    w.apple.upgrade(otid, PRODUCTS.bookingsMonthly);
    expect((await w.notify(w.apple.notification('DID_CHANGE_RENEWAL_PREF', otid))).status).toBe(200);
    expect(w.row(otid)!.product_id).toBe(PRODUCTS.bookingsMonthly);
    expect(await gates(otid)).toEqual({ bookings: true, store: false });
    await w.publish(transactionId, full, { baseVersion: 1 });
    expect(pendingOf('fade-lab').siteData.bookingUrl).toBe(AI_BOOK);
    expect(pendingOf('fade-lab').siteData).not.toHaveProperty('shopUrl');

    w.clock.advance(DAY);
    w.apple.upgrade(otid, PRODUCTS.storeYearly);
    await w.notify(w.apple.notification('DID_CHANGE_RENEWAL_PREF', otid));
    expect(await gates(otid)).toEqual({ bookings: true, store: true });
    await w.publish(transactionId, full, { baseVersion: 2 });
    expect(pendingOf('fade-lab').siteData).toMatchObject({ bookingUrl: AI_BOOK, shopUrl: AI_SHOP });
    expect(live()).toContain('/shop/fade-lab');

    // Apple retries the old Website transaction's notification days later (it carries isUpgraded + a revocation date).
    await w.notify(w.apple.notification('DID_RENEW', otid, { tx: websiteTx }));
    expect(w.row(otid)).toMatchObject({ product_id: PRODUCTS.storeYearly, revoked_at: null });
    expect(await gates(otid)).toEqual({ bookings: true, store: true });
  });

  it('the app\'s POST /api/shop/plan right after the upgrade reads Apple and reports the new tier before any notification', async () => {
    const { otid, transactionId } = w.apple.buy(PRODUCTS.websiteMonthly);
    await w.publish(transactionId);
    const shop = { id: 'shop-1', ios_otid: otid as string | null };
    w.apple.upgrade(otid, PRODUCTS.storeMonthly);
    const r = await w.refreshPlan('Bearer owner-jwt', { transactionId }, w.planDeps(shop, { id: randomUUID() }));
    expect(r.body).toMatchObject({ linked: true, tier: 'store', active: true, entitlements: { hosting: true, bookings: true, store: true } });
    expect(await gates(otid)).toEqual({ bookings: true, store: true });
  });
});

// ---------------------------------------------------------------------------
describe('downgrade Store → Website at renewal', () => {
  async function storeShopWithOrders() {
    const { otid, transactionId } = w.apple.buy(PRODUCTS.storeMonthly);
    await w.publish(transactionId, full);
    const { b, s } = linked(otid);
    const manual = await createOrder({
      slug: 'fresh-cuts', clientKey: randomUUID(), items: [{ productId: s.ids.balm, quantity: 1 }],
      customer: { name: 'Ana', phone: '5550001111', email: 'ana@example.com' }, fulfilment: 'pickup', pay: 'manual', expectedTotalCents: 2000,
    }, s.deps);
    expect(manual.status).toBe(201);
    const walkIn = await createOwnerAppointment('Bearer owner-jwt', {
      start: '2026-11-03T15:00:00Z', memberId: b.ids.mike, serviceId: b.ids.cut, customer: { name: 'Kept' },
    }, b.deps);
    expect(walkIn.status).toBe(201);
    // The barber scheduled a downgrade; at renewal Apple bills Website.
    w.clock.advance(30 * DAY);
    w.apple.renew(otid, { productId: PRODUCTS.websiteMonthly });
    await w.notify(w.apple.notification('DID_RENEW', otid));
    return { otid, transactionId, b, s, order: s.state.orders[0], appt: (walkIn.body as any).appointment };
  }

  it('new bookings and orders are refused (423); existing customers and owner actions keep working', async () => {
    const { otid, b, s, order, appt } = await storeShopWithOrders();
    expect(w.row(otid)!.product_id).toBe(PRODUCTS.websiteMonthly);
    expect(await gates(otid)).toEqual({ bookings: false, store: false });
    const newOrder = await createOrder({
      slug: 'fresh-cuts', clientKey: randomUUID(), items: [{ productId: s.ids.balm, quantity: 1 }],
      customer: { name: 'New', phone: '5550002222', email: 'n@example.com' }, fulfilment: 'pickup', pay: 'shop', expectedTotalCents: 2000,
    }, s.deps);
    expect(newOrder).toMatchObject({ status: 423, body: { error: 'store-paused' } });
    const newBooking = await createAppointment({
      slug: 'fresh-cuts', serviceId: b.ids.cut, memberId: 'any', start: '2026-11-04T15:00:00Z',
      customer: { name: 'X', phone: '5550003333', email: 'x@example.com' }, pay: 'shop',
    }, b.deps);
    expect(newBooking).toMatchObject({ status: 423, body: { error: 'bookings-paused' } });
    expect((await createOwnerAppointment('Bearer owner-jwt', {
      start: '2026-11-05T15:00:00Z', memberId: b.ids.mike, serviceId: b.ids.cut, customer: { name: 'No' },
    }, b.deps)).status).toBe(423);
    // The customer who already ordered can still say "I've sent it"; the owner can still fulfil, cancel bookings.
    expect((await postOrderSent({ token: order.manage_token, method: 'cashapp' }, s.deps)).status).toBe(200);
    expect((await markOwnerOrder('Bearer owner-jwt', order.id, { action: 'paid' }, s.deps)).status).toBe(200);
    expect((await markOwnerOrder('Bearer owner-jwt', order.id, { action: 'ready' }, s.deps)).status).toBe(200);
    expect((await cancelOwnerAppointment('Bearer owner-jwt', appt.id, b.deps)).status).toBe(200);
  });

  it('the next phone publish drops the Book and Shop links from the stored copy and the live site', async () => {
    const { transactionId } = await storeShopWithOrders();
    const r = await w.publish(transactionId, full, { baseVersion: 1 });
    expect(r.status).toBe(200);
    expect(pendingOf('fade-lab').siteData).not.toHaveProperty('shopUrl');
    expect(pendingOf('fade-lab').siteData).not.toHaveProperty('bookingUrl');
    expect(live()).not.toContain('/shop/fade-lab');
  });

  it.fails('BUG (minor): until the app republishes, the live site keeps the Shop button pointing at a paused store', async () => {
    await storeShopWithOrders();
    expect(live()).not.toContain('/shop/fade-lab');
  });

  it('a pending card refund on a pre-downgrade order is still possible (owner money actions are never gated)', async () => {
    const { s } = await storeShopWithOrders();
    const o = s.state.orders[0];
    Object.assign(s.state.orders[0], { payment_method: 'card', payment_status: 'paid', status: 'paid', amount_paid_cents: 2000, stripe_payment_intent_id: 'pi_x', paid_at: new Date().toISOString() });
    const r = await refundOwnerOrder('Bearer owner-jwt', o.id, { amountCents: 500 }, s.deps);
    expect(r.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe('lapse → sweep takedown → renewal restore', () => {
  async function lapsed(product: string = PRODUCTS.storeMonthly) {
    const p = w.apple.buy(product);
    await w.publish(p.transactionId, full);
    w.clock.advance(31 * DAY);
    await w.notify(w.apple.notification('EXPIRED', p.otid));
    return p;
  }

  it('the sweep asks Apple, deploys the offline page, closes every gate and keeps the content; publish is 402; lookup says inactive', async () => {
    const { otid, transactionId } = await lapsed();
    const s = await w.sweep();
    expect(s.takenDown).toEqual(['fade-lab']);
    expect(live()).toContain(OFFLINE);
    expect(w.row(otid)!.taken_down_at).not.toBeNull();
    expect(await gates(otid)).toEqual({ bookings: false, store: false });
    expect(pendingOf('fade-lab').siteData.shopName).toBe('Fade Lab');
    expect((await w.publish(transactionId, full, { baseVersion: 1 })).body).toEqual({ error: 'subscription-inactive' });
    expect((await w.lookup(transactionId)).body).toMatchObject({ active: false, version: 1 });
    // A second sweep does nothing more.
    expect((await w.sweep()).takenDown).toEqual([]);
  });

  it('billing grace (Apple status 4) keeps the site up; billing retry (3) takes it down', async () => {
    const { otid } = await lapsed();
    w.apple.setStatus(otid, 4);
    expect((await w.sweep()).stillActive).toEqual(['fade-lab']);
    expect(live()).not.toContain(OFFLINE);
    w.apple.setStatus(otid, 3);
    expect((await w.sweep()).takenDown).toEqual(['fade-lab']);
  });

  it('Apple unreachable: nothing is taken down on a guess', async () => {
    await lapsed();
    w.apple.state.down = true;
    const s = await w.sweep();
    expect(s.appleUnavailable).toEqual(['fade-lab']);
    expect(live()).not.toContain(OFFLINE);
  });

  it('renewal (DID_RENEW) → the next sweep restores the same content on the same slug and reopens the gates', async () => {
    const { otid } = await lapsed();
    await w.sweep();
    w.apple.renew(otid, { at: w.clock.peek() });
    await w.notify(w.apple.notification('DID_RENEW', otid));
    const s = await w.sweep();
    expect(s.restored).toEqual(['fade-lab']);
    expect(live()).not.toContain(OFFLINE);
    expect(live()).toContain('Fade');
    expect(w.row(otid)!.taken_down_at).toBeNull();
    expect(await gates(otid)).toEqual({ bookings: true, store: true });
  });

  it('a phone publish after resubscribing restores the site at once (no wait for the sweep)', async () => {
    const { otid, transactionId } = await lapsed();
    await w.sweep();
    w.apple.renew(otid, { at: w.clock.peek() });
    const r = await w.publish(transactionId, full, { baseVersion: 1 });
    expect(r.status).toBe(200);
    expect(w.row(otid)!.taken_down_at).toBeNull();
    expect(live()).not.toContain(OFFLINE);
  });

  it('an admin edit while taken down is stored, not deployed; it goes live with the restore', async () => {
    const { otid } = await lapsed();
    await w.sweep();
    const r = await updateSite('fade-lab', { set: { area: 'Admin while down' } }, w.adminDeps());
    expect(r).toMatchObject({ ok: true, deployed: false, skipped: 'site-offline', offline: 'taken-down', version: 2 });
    expect(live()).toContain(OFFLINE);
    w.apple.renew(otid, { at: w.clock.peek() });
    await w.notify(w.apple.notification('DID_RENEW', otid));
    expect((await w.sweep()).restored).toEqual(['fade-lab']);
    expect(live()).toContain('Admin while down');
  });
});

// ---------------------------------------------------------------------------
describe('refund / revoke by Apple', () => {
  it('REFUND closes the gates at once; the sweep takes the site down; REFUND_REVERSED brings it all back', async () => {
    const { otid, transactionId } = w.apple.buy(PRODUCTS.storeMonthly);
    await w.publish(transactionId, full);
    w.apple.refund(otid);
    await w.notify(w.apple.notification('REFUND', otid));
    expect(w.row(otid)!.revoked_at).not.toBeNull();
    expect(await gates(otid)).toEqual({ bookings: false, store: false });
    expect((await w.publish(transactionId, full, { baseVersion: 1 })).status).toBe(402);
    expect((await w.sweep()).takenDown).toEqual(['fade-lab']);
    // Apple reverses the refund.
    delete w.apple.latest(otid).revocationDate;
    await w.notify(w.apple.notification('REFUND_REVERSED', otid));
    expect(w.row(otid)!.revoked_at).toBeNull();
    expect((await w.sweep()).restored).toEqual(['fade-lab']);
    expect(await gates(otid)).toEqual({ bookings: true, store: true });
  });

  it('a resubscribe after a refund (same otid, SUBSCRIBED) clears the revocation and restores', async () => {
    const { otid } = w.apple.buy(PRODUCTS.bookingsMonthly);
    await w.publish(otid, full);
    w.clock.advance(DAY);
    w.apple.refund(otid);
    await w.notify(w.apple.notification('REFUND', otid));
    await w.sweep();
    w.clock.advance(DAY);
    w.apple.renew(otid, { at: w.clock.peek() });
    await w.notify(w.apple.notification('SUBSCRIBED', otid));
    expect(w.row(otid)!.revoked_at).toBeNull();
    expect((await w.sweep()).restored).toEqual(['fade-lab']);
    expect(await gates(otid)).toEqual({ bookings: true, store: false });
  });
});

// ---------------------------------------------------------------------------
describe('/api/shop/plan relink: only an active purchase takes over the link', () => {
  it('an active second purchase relinks; an expired or refunded one never does; another user\'s purchase is 409', async () => {
    const user = { id: randomUUID() };
    const first = w.apple.buy(PRODUCTS.storeMonthly);
    await w.publish(first.transactionId);
    const shop = { id: 'shop-1', ios_otid: first.otid as string | null };
    const deps = () => w.planDeps(shop, user);

    const expired = w.apple.buy(PRODUCTS.websiteMonthly, { at: w.clock.peek() - 40 * DAY });
    const r1 = await w.refreshPlan('Bearer owner-jwt', { transactionId: expired.transactionId }, deps());
    expect(r1.status).toBe(200);
    expect(shop.ios_otid).toBe(first.otid);
    expect(r1.body).toMatchObject({ tier: 'store', active: true });

    const refunded = w.apple.buy(PRODUCTS.websiteYearly);
    w.apple.refund(refunded.otid);
    await w.refreshPlan('Bearer owner-jwt', { transactionId: refunded.transactionId }, deps());
    expect(shop.ios_otid).toBe(first.otid);

    const retry = w.apple.buy(PRODUCTS.bookingsMonthly);
    w.apple.setStatus(retry.otid, 3);
    await w.refreshPlan('Bearer owner-jwt', { transactionId: retry.transactionId }, deps());
    expect(shop.ios_otid).toBe(first.otid);

    const theirs = w.apple.buy(PRODUCTS.storeMonthly);
    await w.repo.upsertVerified(await w.apple.verify(theirs.transactionId));
    await w.repo.setUser(theirs.otid, randomUUID());
    expect((await w.refreshPlan('Bearer owner-jwt', { transactionId: theirs.transactionId }, deps())).body).toEqual({ error: 'purchase-in-use' });
    expect(shop.ios_otid).toBe(first.otid);

    const second = w.apple.buy(PRODUCTS.bookingsYearly);
    const r2 = await w.refreshPlan('Bearer owner-jwt', { transactionId: second.transactionId }, deps());
    expect(shop.ios_otid).toBe(second.otid);
    expect(r2.body).toMatchObject({ tier: 'bookings', entitlements: { store: false, bookings: true } });
  });

  it('malformed, unknown and forged inputs', async () => {
    const shop = { id: 'shop-1', ios_otid: null as string | null };
    const deps = w.planDeps(shop, { id: randomUUID() });
    for (const body of [{}, { transactionId: 'abc' }, { transactionId: '1'.repeat(33) }, { transactionId: 123 }, null, [], 'x']) {
      expect((await w.refreshPlan('Bearer owner-jwt', body, deps)).status).toBe(400);
    }
    expect((await w.refreshPlan('Bearer owner-jwt', { transactionId: '999999999' }, deps)).body).toEqual({ error: 'invalid', field: 'transactionId' });
    expect((await w.refreshPlan(undefined, { transactionId: '1' }, deps)).status).toBe(401);
    expect((await w.refreshPlan('Bearer nope', { transactionId: '1' }, deps)).status).toBe(401);
    w.apple.state.down = true;
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    expect((await w.refreshPlan('Bearer owner-jwt', { transactionId: p.transactionId }, deps)).status).toBe(503);
    expect(shop.ios_otid).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('Sandbox vs Production', () => {
  it('a Sandbox purchase publishes under the ios-test- prefix and the verifier finds it after Production says 404', async () => {
    const { otid, transactionId } = w.apple.buy(PRODUCTS.websiteMonthly, { env: 'Sandbox' });
    const r = await w.publish(transactionId);
    expect(r.body).toMatchObject({ siteId: 'ios-test-fade-lab' });
    expect(w.row(otid)!.environment).toBe('Sandbox');
    expect(w.apple.state.lookups).toEqual([`Production:${transactionId}`, `Sandbox:${transactionId}`]);
    // A Production purchase for the same shop name gets the plain slug: no collision.
    const prod = w.apple.buy(PRODUCTS.websiteMonthly);
    expect((await w.publish(prod.transactionId)).body).toMatchObject({ siteId: 'fade-lab' });
  });

  it('an inactive Sandbox purchase gets its gates closed but its website stays up (App Review), unless IOS_TAKEDOWN_SANDBOX', async () => {
    const { otid, transactionId } = w.apple.buy(PRODUCTS.storeMonthly, { env: 'Sandbox' });
    await w.publish(transactionId);
    w.clock.advance(31 * DAY);
    const s = await w.sweep();
    expect(s.sandboxGatesClosed).toEqual(['ios-test-fade-lab']);
    expect(live('ios-test-fade-lab')).not.toContain(OFFLINE);
    expect(await gates(otid)).toEqual({ bookings: false, store: false });
    // With the switch on, the next takedown candidate is taken down for real.
    const two = w.apple.buy(PRODUCTS.storeMonthly, { env: 'Sandbox' });
    await w.publish(two.transactionId, siteData({ shopName: 'Other Shop' }));
    w.clock.advance(31 * DAY);
    expect((await w.sweep({ takedownSandbox: true })).takenDown).toEqual(['ios-test-other-shop']);
  });

  it('POLICY: a Sandbox (TestFlight) purchase linked through /api/shop/plan opens the production Store and Bookings gates', async () => {
    const { otid, transactionId } = w.apple.buy(PRODUCTS.storeMonthly, { env: 'Sandbox' });
    const shop = { id: 'shop-1', ios_otid: null as string | null };
    const r = await w.refreshPlan('Bearer owner-jwt', { transactionId }, w.planDeps(shop, { id: randomUUID() }));
    expect(r.body).toMatchObject({ linked: true, tier: 'store', active: true });
    expect(await gates(otid)).toEqual({ bookings: true, store: true });
  });
});
