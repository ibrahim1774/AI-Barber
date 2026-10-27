/**
 * Offline / slow / malformed at every network step of publish, resume, the
 * plan and the tier gate, through the real api.ts and ownerApi.ts parsing.
 * "Fixed (bug N)" tests guard the fixes from the 2026-10-22 fix round.
 */
jest.mock('expo-superwall', () => require('./mocks').superwallMock());
jest.mock('expo-sqlite/kv-store', () => require('./mocks').diskMock());

import { Alert } from 'react-native';
import { BOOKSY, FakeServer, P, boot, draft, installFetch, kill, type World } from './harness';
import { wipeDisk } from './mocks';

let server: FakeServer;
let w: World;

beforeEach(async () => {
  jest.resetModules();
  wipeDisk();
  server = new FakeServer();
  installFetch(server);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  try {
    w?.unmount();
  } catch {
    /* unmounted */
  }
  jest.restoreAllMocks();
});

const drain = () => new Promise((r) => setTimeout(r, 20));

async function publish(world: World) {
  const site = await world.m.siteStore.loadSite();
  return world.m.publish.publishFlow(site!, world.deps);
}

/** A live Website-plan site on the phone (published once). */
async function liveWebsite(user: string | null = 'u1') {
  w = await boot(server, { user });
  await w.m.siteStore.saveSite(draft());
  w.willBuy(P.websiteMonthly);
  expect(await publish(w)).toMatchObject({ kind: 'live' });
  await drain();
  await w.superwallSync();
}

describe('first publish (paid this run), the publish request fails', () => {
  beforeEach(async () => {
    w = await boot(server, { user: 'u1' });
    await w.m.siteStore.saveSite(draft());
    w.willBuy(P.websiteMonthly);
  });

  it.each([
    ['offline', { kind: 'offline' as const }],
    ['HTML 504 gateway page', { kind: 'html' as const, status: 504 }],
    ['503 temporarily-unavailable', { kind: 'json' as const, status: 503, body: { error: 'temporarily-unavailable' } }],
    ['404 while Apple catches up', { kind: 'json' as const, status: 404, body: { error: 'transaction-not-found' } }],
    ['200 with a non-JSON body', { kind: 'html' as const, status: 200 }],
  ])('%s: "payment went through" pending, kept for the relaunch, which finishes it', async (_n, fault) => {
    server.fail('/api/ios/publish', fault);
    const out = await publish(w);
    expect(out).toMatchObject({ kind: 'pending', message: w.m.publish.PENDING_MESSAGE });
    expect((out as { offline?: boolean }).offline).toBe(fault.kind === 'offline' ? true : undefined);
    expect(await w.pending()).toMatchObject({ transactionId: 'tx-1' });
    expect((await w.site())?.slug).toBeNull();
    w = await kill(w);
    expect(await w.m.publish.resumePendingPublish(w.deps)).toMatchObject({ kind: 'live' });
    expect(await w.pending()).toBeNull();
    expect(server.published).toHaveLength(1);
  });

  it('a request that never answers is aborted after 100 s and kept as pending', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    server.fail('/api/ios/publish', { kind: 'hang' });
    let out: unknown = null;
    const p = publish(w).then((o) => (out = o));
    await jest.advanceTimersByTimeAsync(99_000);
    expect(out).toBeNull();
    await jest.advanceTimersByTimeAsync(2_000);
    await p;
    expect(out).toMatchObject({ kind: 'pending', message: w.m.publish.PENDING_MESSAGE, transient: true });
    // a timeout is not "offline": the request reached a server that may still be deploying
    expect((out as { offline?: boolean }).offline).toBeUndefined();
    expect(await w.pending()).toMatchObject({ transactionId: 'tx-1' });
  });

  it('402: subscription inactive; the pending publish is dropped, the site kept', async () => {
    server.fail('/api/ios/publish', { kind: 'json', status: 402, body: { error: 'subscription-inactive' } });
    expect(await publish(w)).toEqual({ kind: 'inactive' });
    expect(await w.pending()).toBeNull();
    expect((await w.site())?.data.shopName).toBe('Fade Lab');
  });

  it('400 bad-request: thrown (error screen), the pending publish is dropped', async () => {
    server.fail('/api/ios/publish', { kind: 'json', status: 400, body: { error: 'bad-request' } });
    await expect(publish(w)).rejects.toMatchObject({ status: 400, code: 'bad-request' });
    expect(await w.pending()).toBeNull();
  });

  // Fixed (bug 1): a JSON 200 without siteId / deployedUrl was treated as live.
  it('a garbled 200 ({}) is not "live": the pending publish is kept, the record untouched, the relaunch finishes it', async () => {
    server.fail('/api/ios/publish', { kind: 'json', status: 200, body: {} });
    const out = await publish(w);
    expect(out).toMatchObject({ kind: 'pending', message: w.m.publish.PENDING_MESSAGE });
    expect(await w.pending()).toMatchObject({ transactionId: 'tx-1' });
    expect(await w.site()).toMatchObject({ slug: null, deployedUrl: null });
    w = await kill(w);
    expect(await w.m.publish.resumePendingPublish(w.deps)).toMatchObject({ kind: 'live', url: 'https://fade-lab.aibarber.org' });
  });

  it('wrong types in a 200 (siteId number, deployedUrl null) are not stored as the live site', async () => {
    server.fail('/api/ios/publish', { kind: 'json', status: 200, body: { siteId: 42, deployedUrl: null, republished: 'yes', version: '7' } });
    const out = await publish(w);
    expect(out.kind).toBe('pending');
    expect(await w.pending()).toMatchObject({ transactionId: 'tx-1' });
    expect((await w.site())?.slug).toBeNull();
  });
});

describe('the other network steps of a publish', () => {
  it('the pre-publish admin sync offline / timing out: the publish still goes through', async () => {
    await liveWebsite();
    server.fail('/api/ios/site', { kind: 'offline' });
    expect(await publish(w)).toMatchObject({ kind: 'live', republished: true });
  });

  it('the pre-publish admin sync hanging: given up after 8 s, then published', async () => {
    await liveWebsite();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    server.fail('/api/ios/site', { kind: 'hang' });
    let out: any = null;
    const p = publish(w).then((o) => (out = o));
    await jest.advanceTimersByTimeAsync(7_000);
    expect(out).toBeNull();
    await jest.advanceTimersByTimeAsync(2_000);
    await p;
    expect(out).toMatchObject({ kind: 'live' });
  });

  it('the shop lookup failing (Supabase down): unknown context, the site links are kept, not removed', async () => {
    await liveWebsite();
    w.sb.selectError = { message: 'offline' };
    await publish(w);
    expect(server.published.at(-1).bookingUrl).toBe(BOOKSY);
  });

  // Fixed (bug 9): loadLinkContext (two Supabase reads) ran before every publish with no cap.
  it('a hung shop lookup is given up after 8 s like the admin sync (unknown context), and the publish goes out', async () => {
    await liveWebsite();
    jest.spyOn(require('@/lib/shop'), 'loadMyShop').mockImplementation(() => new Promise(() => {}));
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    let out: any = null;
    const p = publish(w).then((o) => (out = o));
    await jest.advanceTimersByTimeAsync(7_500);
    expect(out).toBeNull();
    await jest.advanceTimersByTimeAsync(1_000);
    await p;
    expect(out).toMatchObject({ kind: 'live' });
    expect(server.published.at(-1).bookingUrl).toBe(BOOKSY); // unknown context: the site's own link stays
  });

  it('the plan refresh after publish failing: still live, nothing thrown', async () => {
    w = await boot(server, { user: 'u1' });
    await w.m.siteStore.saveSite(draft());
    w.willBuy(P.websiteMonthly);
    server.fail('/api/shop/plan', { kind: 'html', status: 502 });
    expect(await publish(w)).toMatchObject({ kind: 'live' });
    await drain();
    expect(w.m.plan.getSharedPlan()).toBeNull();
  });

  it('the account sync failing after publish: still live', async () => {
    w = await boot(server, { user: 'u1' });
    await w.m.siteStore.saveSite(draft());
    w.sb.upsertError = { message: 'rls' };
    w.willBuy(P.websiteMonthly);
    expect(await publish(w)).toMatchObject({ kind: 'live' });
  });

  it('CustomerInfo failing right after the purchase: unconfirmed (never "payment went through"); the relaunch finishes it', async () => {
    w = await boot(server, { user: 'u1' });
    await w.m.siteStore.saveSite(draft());
    w.willBuy(P.websiteMonthly);
    let n = 0;
    w.sw.customerInfo = async () => {
      n++;
      if (n === 1) return { subscriptions: server.apple }; // the paywall's own check
      throw new Error('offline');
    };
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    let out: any = null;
    const p = publish(w).then((o) => (out = o));
    await jest.advanceTimersByTimeAsync(5_000);
    await p;
    expect(out).toEqual({ kind: 'pending', message: w.m.publish.UNCONFIRMED_MESSAGE });
    expect(await w.pending()).toMatchObject({ transactionId: null });
    jest.useRealTimers();
    w = await kill(w);
    expect(await w.m.publish.resumePendingPublish(w.deps)).toMatchObject({ kind: 'live' });
  });

  it('a paid pending publish older than 7 days is dropped at launch', async () => {
    w = await boot(server, { user: 'u1' });
    await w.m.siteStore.saveSite(draft());
    await w.m.siteStore.savePendingPublish({ transactionId: 'tx-9', data: draft().data, createdAt: Date.now() - 8 * 86_400_000 });
    expect(await w.m.publish.resumePendingPublish(w.deps)).toBeNull();
    expect(await w.pending()).toBeNull();
    expect(server.count('/api/ios/publish')).toBe(0);
  });

  it('Superwall never configured at launch: a no-id pending publish waits (6 s cap), it is not dropped', async () => {
    w = await boot(server, { user: 'u1' });
    await w.m.siteStore.saveSite(draft());
    await w.m.siteStore.savePendingPublish({ transactionId: null, data: draft().data, createdAt: Date.now() });
    w.sw.customerInfo = () => new Promise(() => {});
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    let out: any = null;
    const p = w.m.publish.resumePendingPublish(w.deps).then((o) => (out = o));
    await jest.advanceTimersByTimeAsync(6_100);
    await p;
    expect(out).toMatchObject({ kind: 'pending', message: w.m.publish.UPDATING_MESSAGE });
    expect(await w.pending()).toMatchObject({ transactionId: null });
  });
});

describe('the plan (GET /api/shop/plan) and the tier gate', () => {
  /** A signed-in barber whose Superwall never reports (offline launch): the server's plan decides the tabs. */
  async function superwallUnknown() {
    server.buy(P.bookingsMonthly);
    server.pinnedStatus = 'UNKNOWN';
    w = await boot(server, { user: 'u1' });
    expect(w.m.entitlements.getEntitlements().known).toBe(false);
  }

  it('Superwall unknown, plan answers: Bookings is entitled, Store is not', async () => {
    await superwallUnknown();
    const b = await w.probe(() => w.m.tierAccess.useTierAccess('bookings'));
    await b.flush();
    expect(b.get()).toMatchObject({ status: 'ready', entitled: true, hosting: true, expired: false });
    const s = await w.probe(() => w.m.tierAccess.useTierAccess('store'));
    await s.flush();
    expect(s.get()).toMatchObject({ status: 'ready', entitled: false });
  });

  it('Superwall unknown, plan offline: error (Try again), never an endless spinner; Retry recovers', async () => {
    await superwallUnknown();
    server.fail('/api/shop/plan', { kind: 'offline' });
    const b = await w.probe(() => w.m.tierAccess.useTierAccess('bookings'));
    await b.flush();
    expect(b.get().status).toBe('error');
    await w.act(async () => b.get().retry());
    await b.flush();
    expect(b.get()).toMatchObject({ status: 'ready', entitled: true });
  });

  it('Superwall unknown and signed out: the plan cannot be asked, locked (not a spinner, never unlocked)', async () => {
    server.buy(P.bookingsMonthly);
    server.pinnedStatus = 'UNKNOWN';
    w = await boot(server, { user: null });
    const b = await w.probe(() => w.m.tierAccess.useTierAccess('bookings'));
    await b.flush();
    expect(b.get()).toMatchObject({ status: 'ready', entitled: false });
  });

  // Fixed (bug 4): a 200 whose body isn't JSON was stored as "no plan yet" and the tab stayed 'loading'.
  it('a 200 HTML page for the plan shows the error card (not an endless spinner); Retry recovers', async () => {
    await superwallUnknown();
    server.fail('/api/shop/plan', { kind: 'html', status: 200 });
    const b = await w.probe(() => w.m.tierAccess.useTierAccess('bookings'));
    await b.flush();
    await b.flush();
    expect(b.get().status).toBe('error');
    await w.act(async () => b.get().retry());
    await b.flush();
    expect(b.get()).toMatchObject({ status: 'ready', entitled: true });
  });

  // Fixed (bug 2): a 200 JSON plan without `entitlements` crashed the Bookings / Store tab render.
  it('a plan of {} (Superwall unknown) does not crash the tab: error, retryable', async () => {
    await superwallUnknown();
    server.fail('/api/shop/plan', { kind: 'json', status: 200, body: {} });
    const b = await w.probe(() => w.m.tierAccess.useTierAccess('bookings'));
    await b.flush();
    expect(b.error()).toBeNull();
    expect(b.get().status).toBe('error');
  });

  it('a plan with wrong types is normalised (only true is true)', async () => {
    await superwallUnknown();
    server.fail('/api/shop/plan', { kind: 'json', status: 200, body: { tier: 'gold', entitlements: { hosting: 'yes', bookings: 1, store: true }, expiresAt: 5, active: true, purchaseAccount: 'self' } });
    const s = await w.probe(() => w.m.tierAccess.useTierAccess('store'));
    await s.flush();
    expect(s.get()).toMatchObject({ status: 'ready', entitled: true, hosting: false });
    expect(w.m.plan.getSharedPlan()).toMatchObject({ tier: null, expiresAt: null, entitlements: { hosting: false, bookings: false, store: true } });
  });

  it('a plan of {} after a lapse (Superwall INACTIVE) does not crash the tab', async () => {
    server.buy(P.bookingsMonthly);
    server.lapse();
    w = await boot(server, { user: 'u1' });
    expect(w.m.entitlements.getEntitlements()).toMatchObject({ known: true, hosting: false });
    server.fail('/api/shop/plan', { kind: 'json', status: 200, body: {} });
    const b = await w.probe(() => w.m.tierAccess.useTierAccess('bookings'));
    await b.flush();
    expect(b.error()).toBeNull();
  });

  it('lapsed under 30 days: Bookings readable (not expired); over 30 days: expired (upgrade card only)', async () => {
    server.buy(P.bookingsMonthly);
    server.lapse(3 * 86_400_000);
    w = await boot(server, { user: 'u1' });
    const recent = await w.probe(() => w.m.tierAccess.useTierAccess('bookings'));
    await recent.flush();
    expect(recent.get()).toMatchObject({ status: 'ready', entitled: false, hosting: false, expired: false });
    recent.unmount();
    w.m.plan.setSharedPlan(null);
    server.apple[0].expirationDate = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const old = await w.probe(() => w.m.tierAccess.useTierAccess('bookings'));
    await old.flush();
    expect(old.get()).toMatchObject({ status: 'ready', entitled: false, expired: true });
  });

  it('Superwall says Store but the plan is not loaded: locked until the server confirms this account owns it', async () => {
    server.buy(P.storeMonthly);
    w = await boot(server, { user: 'u1' });
    expect(w.m.entitlements.getEntitlements()).toMatchObject({ known: false, store: false }); // fail closed until the plan lands
    const gate = await w.probe(() => w.m.tierAccess.useTierAccess('store'));
    await gate.flush();
    expect(gate.get()).toMatchObject({ status: 'ready', entitled: true });
    expect(server.count('/api/shop/plan')).toBe(1);
  });
});
