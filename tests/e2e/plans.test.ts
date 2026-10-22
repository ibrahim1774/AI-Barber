// E2E: each of the six products (Website / Bookings / Store × monthly / yearly) through the real
// iOS publish flow, site lookup, tier link strip, and the bookings + store gates.
vi.mock('@google-cloud/storage', async () => (await import('./harness/gcs.js')).storageModule);
vi.mock('../../lib/deploySite.js', async () => (await import('./harness/vercel.js')).deploySiteModule);

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AI_BOOK, AI_SHOP, BOOKSY, NOW, normHtml, resetBoundaries, siteData, siteWorld, type SiteWorld } from './harness/world.js';
import { PRODUCTS, periodOf } from './harness/apple.js';
import { pendingOf } from './harness/gcs.js';
import { deploysOf, vercel } from './harness/vercel.js';
import { net } from './harness/net.js';
import { renderPending } from '../../lib/publishSite.js';
import { getShop } from '../../lib/bookings/publicFlow.js';
import { createOwnerAppointment, rescheduleOwnerAppointment, createTimeOff, cancelOwnerAppointment, markOwnerAppointment } from '../../lib/bookings/ownerFlow.js';
import { getStoreShop, createOrder } from '../../lib/store/publicFlow.js';
import { world as bookingWorld } from '../bookings/fakeRepo.js';
import { storeWorld } from '../store/fakeRepo.js';

const PLANS = [
  { name: 'Website monthly', product: PRODUCTS.websiteMonthly, bookings: false, store: false },
  { name: 'Website yearly', product: PRODUCTS.websiteYearly, bookings: false, store: false },
  { name: 'Bookings monthly', product: PRODUCTS.bookingsMonthly, bookings: true, store: false },
  { name: 'Bookings yearly', product: PRODUCTS.bookingsYearly, bookings: true, store: false },
  { name: 'Store monthly', product: PRODUCTS.storeMonthly, bookings: true, store: true },
  { name: 'Store yearly', product: PRODUCTS.storeYearly, bookings: true, store: true },
] as const;

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

describe.each(PLANS)('$name', (plan) => {
  it('first publish binds a slug, stores v1, deploys the rendered copy and stamps published_at', async () => {
    const { otid, transactionId } = w.apple.buy(plan.product);
    const r = await w.publish(transactionId, siteData({ bookingUrl: AI_BOOK, shopUrl: AI_SHOP } as any));
    expect(r.status).toBe(200);
    const body = r.body as any;
    expect(body).toMatchObject({ siteId: 'fade-lab', deployedUrl: 'https://fade-lab.vercel.app', republished: false, version: 1, editedBy: 'owner' });
    const row = w.row(otid)!;
    expect(row.site_slug).toBe('fade-lab');
    expect(row.product_id).toBe(plan.product);
    expect(row.published_at).not.toBeNull();
    expect(Date.parse(row.expires_at!)).toBe(w.apple.latest(otid).expiresDate);
    expect(w.apple.latest(otid).expiresDate - w.apple.latest(otid).purchaseDate).toBe(periodOf(plan.product));
    const stored = pendingOf('fade-lab');
    expect(stored.version).toBe(1);
    expect('bookingUrl' in stored.siteData).toBe(plan.bookings);
    expect('shopUrl' in stored.siteData).toBe(plan.store);
    // The live site is exactly the stored copy rendered (deployRenderedSite got that HTML).
    expect(deploysOf('fade-lab')).toHaveLength(1);
    expect(normHtml(vercel.live.get('fade-lab'))).toBe(normHtml(renderPending(stored)));
    expect(net.blocked).toEqual([]);
  });

  it('a Booksy link is never stripped, whatever the plan', async () => {
    const { transactionId } = w.apple.buy(plan.product);
    await w.publish(transactionId, siteData({ bookingUrl: BOOKSY }));
    expect(pendingOf('fade-lab').siteData.bookingUrl).toBe(BOOKSY);
  });

  it('republish keeps the slug after a rename, force-deploys, bumps the version and reports republished', async () => {
    const { otid, transactionId } = w.apple.buy(plan.product);
    await w.publish(transactionId);
    const r = await w.publish(transactionId, siteData({ shopName: 'Totally New Name' }), { baseVersion: 1 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ siteId: 'fade-lab', republished: true, version: 2 });
    expect(deploysOf('fade-lab')).toHaveLength(2);
    expect(deploysOf('totally-new-name')).toHaveLength(0);
    expect(pendingOf('fade-lab').siteData.shopName).toBe('Totally New Name');
    expect(w.row(otid)!.site_slug).toBe('fade-lab');
  });

  it('a renewal transaction id publishes onto the same purchase and slug', async () => {
    const { otid, transactionId } = w.apple.buy(plan.product);
    await w.publish(transactionId);
    const renewal = w.apple.renew(otid);
    const r = await w.publish(renewal.transactionId, siteData(), { baseVersion: 1 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ siteId: 'fade-lab', version: 2 });
    expect(w.db.rows.size).toBe(1);
  });

  it('site lookup returns the stored copy with real image URLs, version and active', async () => {
    const { transactionId } = w.apple.buy(plan.product);
    await w.publish(transactionId);
    const r = await w.lookup(transactionId);
    expect(r.status).toBe(200);
    const b = r.body as any;
    expect(b).toMatchObject({ siteId: 'fade-lab', deployedUrl: 'https://fade-lab.vercel.app', active: true, version: 1, editedBy: 'owner' });
    expect(b.siteData.hero.imageUrl).toBe('https://img.example/hero.jpg');
    expect(b.siteData.gallery).toEqual(['https://img.example/g0.jpg', '']);
    expect(b.siteData.staff[0].photo).toBe('https://img.example/s0.jpg');
  });

  it('booking page and owner booking writes follow the plan (423 without bookings); cancel and mark always work', async () => {
    const { otid, transactionId } = w.apple.buy(plan.product);
    await w.publish(transactionId);
    const b = bookingWorld({ shop: { ios_otid: otid } });
    b.deps.repo.purchase = w.gateRow;
    const page = await getShop({ slug: 'fresh-cuts' }, b.deps);
    expect((page.body as any).paused).toBe(!plan.bookings);

    const walkIn = await createOwnerAppointment('Bearer owner-jwt', {
      start: '2026-11-03T15:00:00Z', memberId: b.ids.mike, serviceId: b.ids.cut, customer: { name: 'Walk In' },
    }, b.deps);
    expect(walkIn.status).toBe(plan.bookings ? 201 : 423);
    const timeOff = await createTimeOff('Bearer owner-jwt', { memberId: b.ids.jay, start: '2026-11-04T15:00:00Z', end: '2026-11-04T16:00:00Z' }, b.deps);
    expect(timeOff.status).toBe(plan.bookings ? 200 : 423);

    // An existing booking (made before a downgrade, say) can always be marked and cancelled.
    b.state.appointments.push({
      id: '9d0f1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b', shop_id: b.ids.shopId, member_id: b.ids.mike, service_id: b.ids.cut,
      start_at: '2026-11-05T15:00:00.000Z', end_at: '2026-11-05T15:30:00.000Z', service_name: 'Haircut', price_cents: 3000,
      duration_min: 30, customer_name: 'Old', customer_phone: '5550001111', customer_email: 'old@example.com', note: null,
      status: 'booked', payment_status: 'none', payment_method: null, source: 'online', cancelled_by: null, cancelled_at: null,
      reminder_sent_at: null, amount_paid_cents: 0, amount_refunded_cents: 0, stripe_payment_intent_id: null,
      stripe_checkout_session_id: null, manage_token: 'x'.repeat(40), customer_says_paid_at: null, shop_rescheduled_at: null,
      refund_due_cents: 0, refund_stuck_at: null, created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString(),
    } as any);
    const resched = await rescheduleOwnerAppointment('Bearer owner-jwt', '9d0f1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b', { start: '2026-11-05T16:00:00Z' }, b.deps);
    expect(resched.status).toBe(plan.bookings ? 200 : 423);
    const mark = await markOwnerAppointment('Bearer owner-jwt', '9d0f1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b', { action: 'paid' }, b.deps);
    expect(mark.status).toBe(200);
    const cancel = await cancelOwnerAppointment('Bearer owner-jwt', '9d0f1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b', b.deps);
    expect(cancel.status).toBe(200);
  });

  it('store page and order create follow the plan (423 without store)', async () => {
    const { otid, transactionId } = w.apple.buy(plan.product);
    await w.publish(transactionId);
    const s = storeWorld({ shop: { ios_otid: otid } });
    s.deps.repo.purchase = w.gateRow;
    const page = await getStoreShop({ slug: 'fresh-cuts' }, s.deps);
    expect((page.body as any).paused).toBe(!plan.store);
    const order = await createOrder({
      slug: 'fresh-cuts', clientKey: 'k'.repeat(20), items: [{ productId: s.ids.oil, quantity: 1 }],
      customer: { name: 'Sam', phone: '5551234567', email: 'sam@example.com' }, fulfilment: 'pickup', pay: 'shop', expectedTotalCents: 1500,
    }, s.deps);
    expect(order.status).toBe(plan.store ? 201 : 423);
  });
});

// ---------------------------------------------------------------------------
// Book-link matrix, server half: what the published site may carry (tier strip) and whether the
// AI Barber booking page it points to is open (bookings_enabled × purchase linked × tier). The
// app-side resolver (own link vs AI link, shop exists) lives in the iOS repo.
describe('Book-link matrix (server half)', () => {
  const cases = PLANS.flatMap((plan) => [true, false].flatMap((enabled) => [true, false].map((linkedPurchase) => ({ plan, enabled, linkedPurchase }))));
  it.each(cases)('$plan.name, bookings_enabled=$enabled, linked=$linkedPurchase', async ({ plan, enabled, linkedPurchase }) => {
    const { otid, transactionId } = w.apple.buy(plan.product);
    await w.publish(transactionId, siteData({ bookingUrl: AI_BOOK }));
    const b = bookingWorld({ shop: { ios_otid: linkedPurchase ? otid : null, bookings_enabled: enabled } });
    b.deps.repo.purchase = w.gateRow;
    const page = (await getShop({ slug: 'fresh-cuts' }, b.deps)).body as any;
    const open = enabled && linkedPurchase && plan.bookings;
    expect(page.paused).toBe(!open);
    // The site keeps the AI Book link only on a plan with bookings (shop state is the app's call).
    expect(pendingOf('fade-lab').siteData.bookingUrl === AI_BOOK).toBe(plan.bookings);
  });

  it.each([
    ['https://aibarber.org/book/fade-lab'], ['http://www.aibarber.org/book'], ['AIBARBER.ORG/book?x=1'], ['https://www.aibarber.org/book#top'],
  ])('a Website plan strips the AI Book link written as %s', async (url) => {
    const { transactionId } = w.apple.buy(PRODUCTS.websiteMonthly);
    await w.publish(transactionId, siteData({ bookingUrl: url }));
    expect(pendingOf('fade-lab').siteData).not.toHaveProperty('bookingUrl');
  });

  it.each([['https://aibarber.org:443/book/fade-lab'], ['https://www.aibarber.org./book/fade-lab']])(
    'setup: the AI Barber URL written as %s is not recognised and is kept on a Website plan', async (url) => {
      const { transactionId } = w.apple.buy(PRODUCTS.websiteMonthly);
      await w.publish(transactionId, siteData({ bookingUrl: url }));
      expect(pendingOf('fade-lab').siteData.bookingUrl).toBe(url);
    });

  it.fails('BUG (minor): the same AI Barber booking URL with an explicit :443 port or a trailing-dot host survives the Website-plan strip', async () => {
    const { transactionId } = w.apple.buy(PRODUCTS.websiteMonthly);
    await w.publish(transactionId, siteData({ bookingUrl: 'https://aibarber.org:443/book/fade-lab' }));
    expect(pendingOf('fade-lab').siteData).not.toHaveProperty('bookingUrl');
  });
});
