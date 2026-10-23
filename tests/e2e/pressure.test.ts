// E2E pressure: parallel publishes, double submits, large and malformed payloads on every public
// endpoint, missing / forged auth on every authenticated endpoint, and rate limits — all through
// the real api/* handlers, with only their live-deps factories pointed at the in-process world.
vi.mock('@google-cloud/storage', async () => (await import('./harness/gcs.js')).storageModule);
vi.mock('../../lib/deploySite.js', async () => (await import('./harness/vercel.js')).deploySiteModule);
vi.mock('../../lib/siteSubpages.js', async (orig) => (await import('./harness/subpages.js')).subpagesModule(await orig()));
const holder = vi.hoisted(() => ({ deps: {} as Record<string, () => any> }));
vi.mock('../../lib/ios/publishFlow.js', async (orig) => ({ ...(await orig<any>()), liveDeps: () => holder.deps.publish() }));
vi.mock('../../lib/ios/notifications.js', async (orig) => ({ ...(await orig<any>()), liveNotificationDeps: () => holder.deps.notification() }));
vi.mock('../../lib/ios/planFlow.js', async (orig) => ({ ...(await orig<any>()), livePlanDeps: () => holder.deps.plan() }));
vi.mock('../../lib/bookings/live.js', async (orig) => ({ ...(await orig<any>()), liveDeps: () => holder.deps.booking() }));
vi.mock('../../lib/store/live.js', async (orig) => ({ ...(await orig<any>()), liveStoreDeps: () => holder.deps.store() }));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { USER_A, httpReq, httpRes, normHtml, resetBoundaries, siteData, siteWorld, type SiteWorld } from './harness/world.js';
import { BUNDLE, PRODUCTS } from './harness/apple.js';
import { pendingOf } from './harness/gcs.js';
import { vercel } from './harness/vercel.js';
import { net } from './harness/net.js';
import { renderPending } from '../../lib/publishSite.js';
import { world as bookingWorld } from '../bookings/fakeRepo.js';
import { storeWorld } from '../store/fakeRepo.js';
import iosPublish from '../../api/ios/publish.js';
import iosSite from '../../api/ios/site.js';
import iosNotification from '../../api/ios/apple-notification.js';
import iosSweep from '../../api/ios/sweep.js';
import iosDelete from '../../api/ios/delete-account.js';
import shopPlan from '../../api/shop/plan.js';
import shopSetup from '../../api/shop/setup.js';
import shopAppointments from '../../api/shop/appointments.js';
import shopTimeOff from '../../api/shop/time-off.js';
import shopPushToken from '../../api/shop/push-token.js';
import apptCancel from '../../api/shop/appointments/[id]/cancel.js';
import apptMark from '../../api/shop/appointments/[id]/mark.js';
import apptReschedule from '../../api/shop/appointments/[id]/reschedule.js';
import orderMark from '../../api/shop/orders/[id]/mark.js';
import orderRefund from '../../api/shop/orders/[id]/refund.js';
import stripeOnboard from '../../api/shop/stripe/onboard.js';
import stripeStatus from '../../api/shop/stripe/status.js';
import bookAppointments from '../../api/book/appointments.js';
import bookManage from '../../api/book/manage.js';
import bookSent from '../../api/book/sent.js';
import bookShop from '../../api/book/shop.js';
import bookSlots from '../../api/book/slots.js';
import bookDays from '../../api/book/days.js';
import bookIcs from '../../api/book/ics.js';
import bookReminders from '../../api/book/reminders.js';
import bookDailySummary from '../../api/book/daily-summary.js';
import storeOrders from '../../api/store/orders.js';
import storeOrder from '../../api/store/order.js';
import storeSent from '../../api/store/sent.js';
import storeShop from '../../api/store/shop.js';

let w: SiteWorld;
let bw: ReturnType<typeof bookingWorld>;
let sw: ReturnType<typeof storeWorld>;
beforeEach(() => {
  resetBoundaries();
  w = siteWorld();
  bw = bookingWorld();
  sw = storeWorld();
  holder.deps.publish = () => w.publishDeps;
  holder.deps.notification = () => ({
    decodeNotification: w.apple.decodeNotification, decodeTransaction: w.apple.decode, repo: w.repo, bundleId: BUNDLE, now: w.clock.now,
  });
  holder.deps.plan = () => w.planDeps({ id: 'shop-1', ios_otid: null }, { id: randomUUID() });
  holder.deps.booking = () => bw.deps;
  holder.deps.store = () => sw.deps;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type H = (req: any, res: any) => unknown;
async function hit(h: H, over: Parameters<typeof httpReq>[0] = {}) {
  const res = httpRes();
  await h(httpReq(over), res);
  return res as { statusCode: number; body: any; headers: Record<string, string> };
}

// ---------------------------------------------------------------------------
describe('parallel publishes', () => {
  it('10 concurrent first publishes of ONE purchase (a tap storm): all 200 on one slug, one bound row, one project', async () => {
    const { otid, transactionId } = w.apple.buy(PRODUCTS.storeMonthly);
    const rs = await Promise.all(Array.from({ length: 10 }, () => hit(iosPublish, { body: { transactionId, siteData: siteData() } })));
    expect(rs.map((r) => r.statusCode)).toEqual(Array(10).fill(200));
    expect(new Set(rs.map((r) => r.body.siteId))).toEqual(new Set(['fade-lab']));
    expect([...w.db.rows.values()].filter((r) => r.site_slug)).toHaveLength(1);
    expect(w.row(otid)!.site_slug).toBe('fade-lab');
    expect([...vercel.live.keys()]).toEqual(['fade-lab']);
  });

  it('M10 (fixed): 5 DIFFERENT purchases publishing the same shop name at once all get 200 on their own slug (one internal re-pick), nobody overwrites another\'s copy', async () => {
    const buys = Array.from({ length: 5 }, () => w.apple.buy(PRODUCTS.websiteMonthly));
    const rs = await Promise.all(buys.map((b, i) => w.publish(b.transactionId, siteData({ area: `owner-${i}` }))));
    // Was: 1 x 200 and 4 x 503 slug-bind-failed (the app retried).
    expect(rs.map((r) => r.status)).toEqual(Array(5).fill(200));
    const bound = buys.map((b) => w.row(b.otid)!.site_slug);
    expect(new Set(bound).size).toBe(5);
    rs.forEach((r, i) => {
      expect((r.body as any).siteId).toBe(bound[i]);
      expect(pendingOf((r.body as any).siteId).siteData.area).toBe(`owner-${i}`);
    });
  });

  it('20 purchases with 20 different shops in parallel: 20 slugs, 20 deploys, each live page is its own copy', async () => {
    const buys = Array.from({ length: 20 }, () => w.apple.buy(PRODUCTS.bookingsYearly));
    const rs = await Promise.all(buys.map((b, i) => w.publish(b.transactionId, siteData({ shopName: `Shop Number ${i}` }))));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    for (let i = 0; i < 20; i++) {
      const slug = `shop-number-${i}`;
      expect(normHtml(vercel.live.get(slug))).toBe(normHtml(renderPending(pendingOf(slug))[0].html));
    }
  });

  it('I1 (fixed): 10 parallel republishes of one site each get their own version (compare-and-set; no version reuse)', async () => {
    const { transactionId } = w.apple.buy(PRODUCTS.storeMonthly);
    await w.publish(transactionId);
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => w.publish(transactionId, siteData({ area: `edit ${i}` }), { baseVersion: 1 })));
    expect(rs.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(new Set(rs.map((r) => (r.body as any).version)).size).toBe(10);
    expect(pendingOf('fade-lab').version).toBe(11);
    // And the live page is the stored copy (I2).
    expect(normHtml(vercel.live.get('fade-lab'))).toBe(normHtml(renderPending(pendingOf('fade-lab'))[0].html));
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/ios/publish, /api/ios/site, /api/ios/apple-notification: malformed and oversized input', () => {
  const sd = () => siteData();
  const cases: [string, unknown][] = [
    ['no body', undefined],
    ['array body', []],
    ['string garbage', '{nope'],
    ['missing transactionId', { siteData: sd() }],
    ['transactionId number', { transactionId: 123, siteData: sd() }],
    ['transactionId blank', { transactionId: '   ', siteData: sd() }],
    ['missing siteData', { transactionId: '1' }],
    ['shopName number', { transactionId: '1', siteData: { ...sd(), shopName: 5 } }],
    ['shopName blank', { transactionId: '1', siteData: { ...sd(), shopName: '  ' } }],
    ['hero string', { transactionId: '1', siteData: { ...sd(), hero: 'x' } }],
    ['about array', { transactionId: '1', siteData: { ...sd(), about: [] } }],
    ['gallery object', { transactionId: '1', siteData: { ...sd(), gallery: {} } }],
    ['services string', { transactionId: '1', siteData: { ...sd(), services: 'x' } }],
    ['craftImages object', { transactionId: '1', siteData: { ...sd(), craftImages: {} } }],
    ['staff string', { transactionId: '1', siteData: { ...sd(), staff: 'x' } }],
    ['userId number', { transactionId: '1', siteData: sd(), userId: 7 }],
    ['baseVersion -1', { transactionId: '1', siteData: sd(), baseVersion: -1 }],
    ['baseVersion 1.5', { transactionId: '1', siteData: sd(), baseVersion: 1.5 }],
    ['baseVersion "2"', { transactionId: '1', siteData: sd(), baseVersion: '2' }],
    ['inline data: image deep in staff', { transactionId: '1', siteData: { ...sd(), staff: [{ name: 'a', photo: ' data:image/png;base64,AAA' }] } }],
    ['body over 3 MB', { transactionId: '1', siteData: { ...sd(), area: 'x'.repeat(3 * 1024 * 1024) } }],
  ];
  it.each(cases)('publish: %s → 400 before Apple is asked', async (_n, body) => {
    const r = await hit(iosPublish, { body });
    expect(r).toMatchObject({ statusCode: 400, body: { error: 'bad-request' } });
    expect(w.apple.state.calls).toBe(0);
  });

  it('publish: malformed JSON (lazy body getter throws) is 400; GET 405; OPTIONS 200', async () => {
    expect((await hit(iosPublish, { bodyThrows: true })).statusCode).toBe(400);
    expect((await hit(iosPublish, { method: 'GET' })).statusCode).toBe(405);
    expect((await hit(iosPublish, { method: 'OPTIONS' })).statusCode).toBe(200);
  });

  it('publish: unknown transaction 404, Apple down 503, a foreign bundle 400, an unknown product 400', async () => {
    expect((await hit(iosPublish, { body: { transactionId: '424242', siteData: sd() } })).body).toEqual({ error: 'not-found' });
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    w.apple.subs.get(p.otid)!.txs[0].bundleId = 'com.someone.else';
    expect((await hit(iosPublish, { body: { transactionId: p.transactionId, siteData: sd() } })).body).toEqual({ error: 'bad-bundle' });
    const q = w.apple.buy('com.ibrahim1774.aibarber.lifetime');
    expect((await hit(iosPublish, { body: { transactionId: q.transactionId, siteData: sd() } })).body).toEqual({ error: 'bad-product' });
    w.apple.state.down = true;
    expect((await hit(iosPublish, { body: { transactionId: '1', siteData: sd() } })).statusCode).toBe(503);
    expect(w.db.rows.size).toBe(0);
  });

  it('publish: a 2.5 MB site with 3,000 gallery URLs is accepted and deployed (no list caps; size is the only bound)', async () => {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    const gallery = Array.from({ length: 3000 }, (_, i) => `https://img.example/${'g'.repeat(700)}${i}.jpg`);
    const r = await hit(iosPublish, { body: { transactionId: p.transactionId, siteData: siteData({ gallery }) } });
    expect(r.statusCode).toBe(200);
    expect(Object.keys(pendingOf('fade-lab').imageUrlMap)).toContain('gallery2999');
  });

  it('site lookup: bad input 400, unknown 404, no site yet 404, Apple down 503', async () => {
    expect((await hit(iosSite, { body: {} })).statusCode).toBe(400);
    expect((await hit(iosSite, { body: { transactionId: 5 } })).statusCode).toBe(400);
    expect((await hit(iosSite, { bodyThrows: true })).statusCode).toBe(400);
    expect((await hit(iosSite, { body: { transactionId: '999' } })).statusCode).toBe(404);
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    expect((await hit(iosSite, { body: { transactionId: p.transactionId } })).body).toEqual({ error: 'no-site' });
    w.apple.state.down = true;
    expect((await hit(iosSite, { body: { transactionId: p.transactionId } })).statusCode).toBe(503);
  });

  it('apple-notification: missing / forged / foreign-bundle / unknown-environment payloads never touch a purchase', async () => {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    expect((await hit(iosNotification, { body: {} })).statusCode).toBe(400);
    expect((await hit(iosNotification, { body: { signedPayload: 7 } })).statusCode).toBe(400);
    expect((await hit(iosNotification, { body: { signedPayload: JSON.stringify({ forged: true }) } })).body).toEqual({ error: 'bad-signature' });
    expect((await hit(iosNotification, { body: { signedPayload: w.apple.notification('REFUND', p.otid, { bundleId: 'com.other' }) } })).body).toEqual({ ignored: 'bundle' });
    const env = JSON.parse(w.apple.notification('REFUND', p.otid));
    env.data.environment = 'Xcode';
    expect((await hit(iosNotification, { body: { signedPayload: JSON.stringify(env) } })).body).toEqual({ ignored: 'environment' });
    const forgedTx = JSON.parse(w.apple.notification('REFUND', p.otid));
    forgedTx.data.signedTransactionInfo = JSON.stringify({ forged: true });
    expect((await hit(iosNotification, { body: { signedPayload: JSON.stringify(forgedTx) } })).body).toEqual({ error: 'bad-transaction' });
    expect(w.db.rows.size).toBe(0);
    // A real one, delivered twice (Apple retries): recorded once, same state.
    w.apple.refund(p.otid);
    const real = w.apple.notification('REFUND', p.otid);
    expect((await hit(iosNotification, { body: { signedPayload: real } })).statusCode).toBe(200);
    const once = { ...w.row(p.otid) };
    expect((await hit(iosNotification, { body: { signedPayload: real } })).statusCode).toBe(200);
    expect(w.row(p.otid)!.revoked_at).toBe(once.revoked_at);
  });
});

// ---------------------------------------------------------------------------
describe('public booking + store endpoints: malformed fields and wrong types', () => {
  const bookBody = () => ({ slug: 'fresh-cuts', serviceId: bw.ids.cut, memberId: 'any', start: '2026-11-03T15:00:00Z', customer: { name: 'A', phone: '5551234567', email: 'a@example.com' }, pay: 'shop' });
  const bad: [string, (b: any) => unknown][] = [
    ['slug with a dot', (b) => ({ ...b, slug: 'fresh.cuts' })],
    ['slug 200 chars', (b) => ({ ...b, slug: 'a'.repeat(200) })],
    ['slug number', (b) => ({ ...b, slug: 7 })],
    ['serviceId not a uuid', (b) => ({ ...b, serviceId: 'haircut' })],
    ['memberId object', (b) => ({ ...b, memberId: {} })],
    ['customer missing', (b) => ({ ...b, customer: undefined })],
    ['name 101 chars', (b) => ({ ...b, customer: { ...b.customer, name: 'n'.repeat(101) } })],
    ['name only control chars', (b) => ({ ...b, customer: { ...b.customer, name: '\u0000\u0007' } })],
    ['phone letters', (b) => ({ ...b, customer: { ...b.customer, phone: 'call me' } })],
    ['phone 41 chars', (b) => ({ ...b, customer: { ...b.customer, phone: '1'.repeat(41) } })],
    ['email invalid', (b) => ({ ...b, customer: { ...b.customer, email: 'nope' } })],
    ['email 300 chars', (b) => ({ ...b, customer: { ...b.customer, email: `${'e'.repeat(290)}@x.com` } })],
    ['note 501 chars', (b) => ({ ...b, note: 'n'.repeat(501) })],
    ['pay bitcoin', (b) => ({ ...b, pay: 'bitcoin' })],
    ['method with pay shop', (b) => ({ ...b, method: 'venmo' })],
  ];
  it.each(bad)('POST /api/book/appointments: %s → 400, nothing stored', async (_n, f) => {
    const r = await hit(bookAppointments, { body: f(bookBody()) });
    expect(r.statusCode).toBe(400);
    expect(bw.state.appointments).toHaveLength(0);
  });

  const orderBody = () => ({ slug: 'fresh-cuts', clientKey: randomUUID(), items: [{ productId: sw.ids.oil, quantity: 1 }], customer: { name: 'A', phone: '5551234567', email: 'a@example.com' }, fulfilment: 'pickup', pay: 'shop', expectedTotalCents: 1500 });
  const badOrder: [string, (b: any) => unknown][] = [
    ['clientKey short', (b) => ({ ...b, clientKey: 'abc' })],
    ['clientKey with spaces', (b) => ({ ...b, clientKey: 'a b c d e f g h i j k l' })],
    ['items empty', (b) => ({ ...b, items: [] })],
    ['21 lines', (b) => ({ ...b, items: Array.from({ length: 21 }, () => ({ productId: randomUUID(), quantity: 1 })) })],
    ['quantity 0', (b) => ({ ...b, items: [{ productId: sw.ids.oil, quantity: 0 }] })],
    ['quantity 11', (b) => ({ ...b, items: [{ productId: sw.ids.oil, quantity: 11 }] })],
    ['quantity 6 + 6 merged', (b) => ({ ...b, items: [{ productId: sw.ids.oil, quantity: 6 }, { productId: sw.ids.oil.toUpperCase(), quantity: 6 }] })],
    ['quantity "1"', (b) => ({ ...b, items: [{ productId: sw.ids.oil, quantity: '1' }] })],
    ['quantity 1.5', (b) => ({ ...b, items: [{ productId: sw.ids.oil, quantity: 1.5 }] })],
    ['productId not a uuid', (b) => ({ ...b, items: [{ productId: 'oil', quantity: 1 }] })],
    ['another shop\'s product', (b) => ({ ...b, items: [{ productId: sw.ids.foreign, quantity: 1 }] })],
    ['inactive product', (b) => ({ ...b, items: [{ productId: sw.ids.comb, quantity: 1 }], expectedTotalCents: 500 })],
    ['expectedTotalCents negative', (b) => ({ ...b, expectedTotalCents: -1 })],
    ['expectedTotalCents string', (b) => ({ ...b, expectedTotalCents: '1500' })],
    ['fulfilment drone', (b) => ({ ...b, fulfilment: 'drone' })],
    ['in-shop pay for shipping', (b) => ({ ...b, fulfilment: 'shipping', expectedTotalCents: 2000 })],
    ['manual method not offered', (b) => ({ ...b, pay: 'manual', method: 'zelle' })],
    ['customer array', (b) => ({ ...b, customer: [] })],
  ];
  it.each(badOrder)('POST /api/store/orders: %s → 400, no order, no Stripe call', async (_n, f) => {
    const r = await hit(storeOrders, { body: f(orderBody()) });
    expect(r.statusCode).toBe(400);
    expect(sw.state.orders).toHaveLength(0);
    expect(net.calls.filter((u) => u.includes('stripe'))).toHaveLength(0);
  });

  it('GET endpoints: bad slug / token / date / month / ics token are 400 or 404, never 500', async () => {
    const gets: [H, Record<string, string>][] = [
      [bookShop, { slug: '../etc' }], [bookShop, {}], [bookSlots, { slug: 'fresh-cuts', serviceId: bw.ids.cut, memberId: 'any', date: '2026-13-40' }],
      [bookSlots, { slug: 'fresh-cuts', serviceId: 'x', memberId: 'any', date: '2026-11-03' }], [bookDays, { slug: 'fresh-cuts', serviceId: bw.ids.cut, month: '2026-13' }],
      [bookIcs, { t: 'short' }], [bookIcs, {}], [bookManage, { token: 'x' }], [storeShop, { slug: 'UPPER' }], [storeOrder, { token: 'a'.repeat(200) }], [storeOrder, {}],
    ];
    for (const [h, query] of gets) {
      const r = await hit(h, { method: 'GET', query });
      expect([400, 404]).toContain(r.statusCode);
    }
  });

  it('POST /api/store/sent and /api/book/sent and /api/book/manage: bad token / method / action', async () => {
    for (const [h, body] of [
      [storeSent, { token: 'x', method: 'cashapp' }], [storeSent, { token: 'a'.repeat(40), method: 'wire' }], [storeSent, []],
      [bookSent, { token: 'a'.repeat(40), method: 'cashapp' }], [bookSent, { method: 'cashapp' }],
      [bookManage, { token: 'a'.repeat(40), action: 'delete' }], [bookManage, { token: 'a'.repeat(40), action: 'cancel' }],
    ] as [H, unknown][]) {
      const r = await hit(h, { body });
      expect([400, 404]).toContain(r.statusCode);
    }
  });
});

// ---------------------------------------------------------------------------
describe('authenticated endpoints: missing, malformed and forged auth', () => {
  const id = randomUUID();
  const owner: [string, H, string, Record<string, string>][] = [
    ['shop/setup', shopSetup, 'POST', {}], ['shop/appointments', shopAppointments, 'POST', {}], ['shop/time-off', shopTimeOff, 'POST', {}],
    ['shop/push-token', shopPushToken, 'POST', {}], ['shop/plan GET', shopPlan, 'GET', {}], ['shop/plan POST', shopPlan, 'POST', {}],
    ['appointments/:id/cancel', apptCancel, 'POST', { id }], ['appointments/:id/mark', apptMark, 'POST', { id }],
    ['appointments/:id/reschedule', apptReschedule, 'POST', { id }], ['orders/:id/mark', orderMark, 'POST', { id }],
    ['orders/:id/refund', orderRefund, 'POST', { id }], ['shop/stripe/onboard', stripeOnboard, 'POST', {}],
    ['shop/stripe/status', stripeStatus, 'GET', {}], ['ios/delete-account', iosDelete, 'POST', {}],
  ];
  const headersVariants: [string, Record<string, string>][] = [
    ['none', {}], ['empty bearer', { authorization: 'Bearer ' }], ['basic', { authorization: 'Basic b3duZXI6cHc=' }],
    ['forged jwt', { authorization: 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJvd25lciJ9.' }], ['token with spaces', { authorization: 'Bearer owner jwt' }],
  ];
  for (const [name, h, method, query] of owner) {
    it.each(headersVariants)(`${name}: %s auth → 401, nothing written`, async (_v, headers) => {
      const before = JSON.stringify([bw.state, sw.state.orders, [...w.db.rows.values()]]);
      const r = await hit(h, { method, query, headers, body: { action: 'paid', amountCents: 100, transactionId: '1' } });
      expect(r.statusCode).toBe(401);
      expect(JSON.stringify([bw.state, sw.state.orders, [...w.db.rows.values()]])).toBe(before);
    });
  }

  it('a real owner of ANOTHER shop gets 404 on this shop\'s appointment and order', async () => {
    const appt = await hit(bookAppointments, { body: { slug: 'fresh-cuts', serviceId: bw.ids.cut, memberId: 'any', start: '2026-11-03T15:00:00Z', customer: { name: 'A', phone: '5551234567', email: 'a@example.com' }, pay: 'shop' } });
    expect(appt.statusCode).toBe(201);
    bw.users['intruder-jwt'] = { id: randomUUID(), email: 'i@example.com', fullName: null };
    expect((await hit(apptCancel, { query: { id: bw.state.appointments[0].id }, headers: { authorization: 'Bearer intruder-jwt' } })).statusCode).toBe(404);
    expect(bw.state.appointments[0].status).toBe('booked');
  });

  it('cron endpoints refuse without the secret', async () => {
    for (const h of [iosSweep, bookReminders, bookDailySummary] as H[]) {
      for (const headers of [{}, { authorization: 'Bearer nope' }, { 'user-agent': 'vercel-cron/1.0' }]) {
        expect((await hit(h, { method: 'GET', headers })).statusCode).toBe(401);
      }
    }
  });

  it('no request in this file reached a real host (Supabase / Apple / Stripe / Vercel / aibarber.org)', () => {
    for (const u of net.blocked) expect(new URL(u).hostname.endsWith('.invalid')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('rate limits', () => {
  it('public writes: 10 per minute per IP, then 429 with Retry-After; another IP is unaffected', async () => {
    const ip = { 'x-real-ip': '203.0.113.9' };
    const body = () => ({ slug: 'fresh-cuts', clientKey: randomUUID(), items: [{ productId: sw.ids.oil, quantity: 1 }], customer: { name: 'A', phone: '5551234567', email: 'a@example.com' }, fulfilment: 'pickup', pay: 'shop', expectedTotalCents: 1500 });
    const rs = [];
    for (let i = 0; i < 11; i++) rs.push(await hit(storeOrders, { body: body(), headers: ip }));
    expect(rs.slice(0, 10).every((r) => r.statusCode === 201)).toBe(true);
    expect(rs[10]).toMatchObject({ statusCode: 429, body: { error: 'rate-limited' } });
    expect(rs[10].headers['retry-after']).toBe('60');
    expect((await hit(storeOrders, { body: body(), headers: { 'x-real-ip': '203.0.113.10' } })).statusCode).toBe(201);
  });

  it('per-shop order cap across IPs is enforced inside the flow (30/h)', async () => {
    let n = 0;
    sw.deps.limits = { shopOrder: vi.fn(async () => ++n <= 30) };
    const body = () => ({ slug: 'fresh-cuts', clientKey: randomUUID(), items: [{ productId: sw.ids.oil, quantity: 1 }], customer: { name: 'A', phone: '5551234567', email: 'a@example.com' }, fulfilment: 'pickup', pay: 'shop', expectedTotalCents: 1500 });
    const rs = [];
    for (let i = 0; i < 31; i++) rs.push(await hit(storeOrders, { body: body(), headers: { 'x-real-ip': `198.51.100.${i}` } }));
    expect(rs.filter((r) => r.statusCode === 201)).toHaveLength(30);
    expect(rs[30]).toMatchObject({ statusCode: 429, body: { error: 'rate-limited' } });
  });

  it('M9 (fixed): the unauthenticated iOS lookups are rate limited per IP (60/min), before Apple is asked', async () => {
    const rs = [];
    for (let i = 0; i < 100; i++) rs.push(await hit(iosSite, { body: { transactionId: String(900000 + i) }, headers: { 'x-real-ip': '203.0.113.50' } }));
    expect(rs.slice(0, 60).every((r) => r.statusCode === 404)).toBe(true);
    expect(rs.slice(60).every((r) => r.statusCode === 429 && r.headers['retry-after'] === '60')).toBe(true);
    expect(w.apple.state.calls).toBe(120); // was 200: the 40 refused never reached Apple
    // Another address is unaffected.
    expect((await hit(iosSite, { body: { transactionId: '1' }, headers: { 'x-real-ip': '203.0.113.51' } })).statusCode).toBe(404);
  });

  it('M9 (fixed): publishes are limited per IP too (20/min), before Apple is asked', async () => {
    const rs = [];
    for (let i = 0; i < 25; i++) rs.push(await hit(iosPublish, { body: { transactionId: String(800000 + i), siteData: siteData() }, headers: { 'x-real-ip': '203.0.113.60' } }));
    expect(rs.slice(0, 20).every((r) => r.statusCode === 404)).toBe(true);
    expect(rs.slice(20).every((r) => r.statusCode === 429)).toBe(true);
  });

  it('setup: each bogus lookup asks Apple in both environments', async () => {
    for (let i = 0; i < 10; i++) await hit(iosSite, { body: { transactionId: String(900000 + i) }, headers: { 'x-real-ip': '203.0.113.52' } });
    expect(w.apple.state.calls).toBe(20);
  });
});

// ---------------------------------------------------------------------------
describe('I6: POST /api/ios/publish links only through the Authorization header', () => {
  it('the handler forwards the bearer; a body userId alone links nothing', async () => {
    const a = w.apple.buy(PRODUCTS.websiteMonthly);
    expect((await hit(iosPublish, { body: { transactionId: a.transactionId, siteData: siteData(), userId: randomUUID() } })).statusCode).toBe(200);
    expect(w.row(a.otid)!.user_id).toBeNull();
    const r = await hit(iosPublish, { body: { transactionId: a.transactionId, siteData: siteData(), baseVersion: 1 }, headers: { authorization: 'Bearer jwt-a' } });
    expect(r.statusCode).toBe(200);
    expect(w.row(a.otid)!.user_id).toBe(USER_A);
  });
});
