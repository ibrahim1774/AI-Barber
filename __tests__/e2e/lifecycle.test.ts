/**
 * The barber's whole journey, chained the way it happens on the phone:
 * buy Website at Publish -> live -> upgrade to Bookings -> turn on AI Barber
 * booking -> upgrade to Store -> open the store -> downgrade -> lapse ->
 * resubscribe -> reinstall + restore. Every step goes through the real publish
 * flow, paywall settle, adminSync, link context and api parsing, against the
 * fake backend (harness.ts).
 */
jest.mock('expo-superwall', () => require('./mocks').superwallMock());
jest.mock('expo-sqlite/kv-store', () => require('./mocks').diskMock());

import { Alert } from 'react-native';
import { BOOKSY, FakeServer, P, boot, draft, installFetch, kill, tierFor, type World } from './harness';
import { wipeDisk } from './mocks';

// The site's own booking and shop pages (relative: served from the barber's domain).
const AI_BOOK = '/book';
const SHOP = '/shop';

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
  try {
    w?.unmount();
  } catch {
    /* unmounted */
  }
  jest.restoreAllMocks();
});

async function publish(world: World) {
  const site = await world.m.siteStore.loadSite();
  return world.m.publish.publishFlow(site!, world.deps);
}

/** Let the not-awaited after-publish work (relink, plan refresh, account sync) finish. */
const drain = () => new Promise((r) => setTimeout(r, 20));

const lastSent = () => server.published[server.published.length - 1];

describe('the full journey, signed in', () => {
  it('Website -> Bookings -> AI booking -> Store -> downgrade -> lapse -> resubscribe -> reinstall + restore', async () => {
    w = await boot(server, { user: 'u1' });
    await w.m.siteStore.saveSite(draft());

    // 1. Buy Website at Publish.
    w.willBuy(P.websiteMonthly);
    const first = await publish(w);
    expect(first).toEqual({ kind: 'live', url: 'https://fade-lab.aibarber.org', republished: false });
    await drain();
    await w.superwallSync();
    expect(w.m.paywall.hasEntitlement()).toBe(true);
    expect(w.m.entitlements.getEntitlements()).toEqual({ known: true, hosting: true, bookings: false, store: false });
    let rec = await w.site();
    expect(rec).toMatchObject({ slug: 'fade-lab', transactionId: 'tx-1', serverVersion: 1, editedBy: 'owner' });
    expect(await w.pending()).toBeNull();
    // Website plan: the barber's own Booksy link, no shop link.
    expect(lastSent().bookingUrl).toBe(BOOKSY);
    expect(lastSent().shopUrl).toBeUndefined();
    // The account row got the live site.
    expect(w.sb.upserts.at(-1)?.row).toMatchObject({ deployed_url: 'https://fade-lab.aibarber.org', deployment_status: 'deployed' });
    // The plan was refreshed for the new transaction (signed in).
    expect(w.m.plan.getSharedPlan()).toMatchObject({ tier: 'website', active: true });

    // 2. Upgrade to Bookings from the Bookings tab.
    w.willBuy(P.bookingsMonthly);
    expect(await w.show('bookings_upgrade')).toBe('purchased');
    await drain();
    await w.superwallSync();
    expect(w.m.entitlements.getEntitlements()).toMatchObject({ bookings: true, store: false });
    expect(w.m.plan.getSharedPlan()).toMatchObject({ tier: 'bookings' });

    // 3. Bookings setup creates the shop tied to the purchase, then the barber picks AI Barber booking.
    server.sb.rows.push({ id: 'shop-1', owner_id: 'u1', slug: 'fade-lab', name: 'Fade Lab', bookings_enabled: true, store_enabled: false, ios_otid: 'tx-2' });
    await w.m.siteSync.updateSiteRecord((r) => w.m.bookingChoice.withChoice(r, 'aibarber', { slug: 'fade-lab' }));
    const second = await publish(w);
    expect(second).toMatchObject({ kind: 'live', republished: true });
    expect(lastSent().bookingUrl).toBe(AI_BOOK);
    rec = await w.site();
    // The own link is never lost.
    expect(rec?.inputs).toMatchObject({ ownBookingUrl: BOOKSY, bookingChoice: 'aibarber' });

    // 4. Upgrade to Store and open the store.
    w.willBuy(P.storeYearly);
    expect(await w.show('store_upgrade')).toBe('purchased');
    await drain();
    await w.superwallSync();
    server.shopRow().store_enabled = true;
    // The shop was linked to tx-2; the plan refresh relinked it to the Store purchase.
    expect(server.shopRow().ios_otid).toBe('tx-3');
    await publish(w);
    expect(lastSent()).toMatchObject({ bookingUrl: AI_BOOK, shopUrl: SHOP });

    // 5. Downgrade to Website at the renewal: the AI link and the shop link go, the own link comes back.
    server.renewTo(P.websiteYearly);
    await w.superwallSync();
    expect(w.m.entitlements.getEntitlements()).toMatchObject({ hosting: true, bookings: false, store: false });
    await publish(w);
    expect(lastSent().bookingUrl).toBe(BOOKSY);
    expect(lastSent().shopUrl).toBeUndefined();
    // The choice is still remembered for a later upgrade.
    expect((await w.site())?.inputs.bookingChoice).toBe('aibarber');

    // 6. Lapse: Publish shows the paywall; closing it publishes nothing.
    server.lapse();
    await w.superwallSync();
    expect(w.m.paywall.hasEntitlement()).toBe(false);
    const before = server.published.length;
    const close = w.willDecline();
    const p = publish(w);
    await drain();
    close();
    expect(await p).toEqual({ kind: 'declined' });
    expect(server.published.length).toBe(before);

    // 7. Resubscribe (Bookings) at Publish: same site, republished, AI link back.
    w.willBuy(P.bookingsMonthly);
    const back = await publish(w);
    expect(back).toMatchObject({ kind: 'live', republished: true, url: 'https://fade-lab.aibarber.org' });
    expect(lastSent().bookingUrl).toBe(AI_BOOK);
    await drain();

    // 8. New phone (fresh install), same Apple ID: Restore Purchases brings the site back.
    w.unmount();
    jest.resetModules();
    wipeDisk();
    w = await boot(server, { user: 'u1' }); // signed in as the owner: Restore returns the account's site
    const restored = await w.restore();
    expect(restored).toMatchObject({ active: true, site: { slug: 'fade-lab', transactionId: 'tx-5', serverVersion: server.sites.get('fade-lab')!.version } });
    expect((await w.site())?.data.bookingUrl).toBe(AI_BOOK);
  }, 30000); // a long journey: under full parallel load the default 5 s is not enough
});

describe('the subscription status (editor lock) along the journey', () => {
  it('active while paid; unknown in the first hour after the end; lapsed after; active again on resubscribe', async () => {
    w = await boot(server, { user: 'u1' });
    await w.m.siteStore.saveSite(draft());
    w.willBuy(P.bookingsYearly);
    await publish(w);
    await w.superwallSync();
    const site = await w.site();
    // What SubscriptionStatusSync runs on launch / foreground / a Superwall status change.
    const status = () => w.m.subscriptionStatus.checkSubscriptionStatus({
      site, pendingPublish: false, superwallStatus: w.sw.status,
      customerInfo: async () => ({ subscriptions: server.apple }), iosSite: w.m.api.api.iosSite,
    });
    expect(await status()).toBe('active');
    server.lapse(10 * 60 * 1000);
    await w.superwallSync();
    expect(await status()).toBe('unknown'); // the server takes it down about an hour after the end
    server.apple[0].expirationDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(await status()).toBe('lapsed');
    expect(w.m.subscriptionStatus.isLocked(site, 'lapsed')).toBe(true);
    w.willBuy(P.websiteMonthly);
    expect(await publish(w)).toMatchObject({ kind: 'live', republished: true });
    await w.superwallSync();
    expect(await status()).toBe('active');
  });

  it('a refunded (revoked) purchase locks at once', async () => {
    w = await boot(server, { user: 'u1' });
    await w.m.siteStore.saveSite(draft());
    w.willBuy(P.storeMonthly);
    await publish(w);
    server.apple[0].isActive = false;
    server.apple[0].isRevoked = true;
    await w.superwallSync();
    const site = await w.site();
    expect(await w.m.subscriptionStatus.checkSubscriptionStatus({
      site, pendingPublish: false, superwallStatus: w.sw.status,
      customerInfo: async () => ({ subscriptions: server.apple }), iosSite: w.m.api.api.iosSite,
    })).toBe('lapsed');
  });
});

describe('each of the six products bought at Publish', () => {
  const products = Object.values(P);
  it.each(products)('%s: goes live and unlocks exactly its tier', async (productId) => {
    w = await boot(server, { user: 'u1' });
    await w.m.siteStore.saveSite(draft());
    w.willBuy(productId);
    expect(await publish(w)).toMatchObject({ kind: 'live' });
    await w.superwallSync();
    const e = w.m.entitlements.getEntitlements();
    expect(w.m.entitlements.tierFromEntitlements(e)).toBe(tierFor(productId));
    expect(w.m.paywall.hasEntitlement()).toBe(true);
    await drain();
    expect(w.m.plan.getSharedPlan()?.tier).toBe(tierFor(productId));
  });
});

describe('signed out', () => {
  it('a signed-out payer is sent to the account step: nothing is published, no shop or account sync happens', async () => {
    w = await boot(server, { user: null });
    await w.m.siteStore.saveSite(draft());
    w.willBuy(P.storeMonthly);
    expect(await publish(w)).toEqual({ kind: 'claim-required' });
    await drain();
    expect(server.count('/api/ios/claim-start')).toBe(1);
    expect(server.calls.find((c) => c.path === '/api/ios/claim-start')?.headers?.Authorization).toBeUndefined();
    expect(server.count('/api/ios/publish')).toBe(0);
    expect(server.published).toHaveLength(0);
    expect(await w.pending()).toMatchObject({ state: 'unclaimed', transactionId: 'tx-1' });
    expect(server.count('/api/shop/plan')).toBe(0); // ownerApi refuses without a token, never reaches the server
    expect(w.sb.upserts).toHaveLength(0);
    expect(w.m.plan.getSharedPlan()).toBeNull();
  });

  it('after the account step the saved publish goes out with the Bearer and picks up the shop and the AI link', async () => {
    w = await boot(server, { user: null });
    await w.m.siteStore.saveSite(draft({ inputs: { ...draft().inputs, ownBookingUrl: BOOKSY, bookingChoice: 'aibarber' } }));
    w.willBuy(P.bookingsMonthly);
    expect(await publish(w)).toEqual({ kind: 'claim-required' });
    await w.superwallSync();
    server.sb.rows.push({ id: 'shop-1', owner_id: 'u1', slug: 'fade-lab', bookings_enabled: true, store_enabled: false, ios_otid: 'tx-1' });
    w.sb.setSession({ access_token: 'tok-u1', user: { id: 'u1' } });
    w.m.plan.setSharedPlan(await w.m.plan.getPlan()); // the server says this account owns the Bookings purchase
    expect(await w.m.publish.resumePendingPublish(w.deps)).toMatchObject({ kind: 'live' });
    expect(lastSent().bookingUrl).toBe(AI_BOOK);
    expect(server.calls.find((c) => c.path === '/api/ios/publish')?.headers?.Authorization).toBe('Bearer tok-u1');
    expect(await w.pending()).toBeNull();
  });
});

describe('app killed between steps', () => {
  it('killed after paying, before the transaction was found: the relaunch finishes the publish', async () => {
    w = await boot(server, { user: 'u1' });
    await w.m.siteStore.saveSite(draft());
    // The purchase lands, but CustomerInfo never answers before the kill.
    w.willBuy(P.websiteMonthly, { onRegister: () => undefined });
    let calls = 0;
    w.sw.customerInfo = async () => {
      calls++;
      // The paywall's own verify sees it; the publish's lookup hangs (the app is killed there).
      if (calls > 1) return new Promise(() => {});
      return { subscriptions: server.apple };
    };
    void publish(w);
    await drain();
    const pending = await w.pending();
    expect(pending).toMatchObject({ transactionId: null });
    w = await kill(w);
    const out = await w.m.publish.resumePendingPublish(w.deps);
    expect(out).toMatchObject({ kind: 'live' });
    expect(await w.pending()).toBeNull();
    expect((await w.site())?.slug).toBe('fade-lab');
  });

  it('killed while the publish request was in flight: the relaunch re-sends the same data once', async () => {
    w = await boot(server, { user: 'u1' });
    await w.m.siteStore.saveSite(draft());
    w.willBuy(P.websiteMonthly);
    server.fail('/api/ios/publish', { kind: 'dead' });
    void publish(w);
    await drain();
    expect(await w.pending()).toMatchObject({ transactionId: 'tx-1' });
    w = await kill(w);
    const out = await w.m.publish.resumePendingPublish(w.deps);
    expect(out).toMatchObject({ kind: 'live' });
    expect(server.published).toHaveLength(1);
    expect(await w.m.publish.resumePendingPublish(w.deps)).toBeNull(); // nothing left to send
  });

  it('killed after an upgrade purchase before the plan refresh: Bookings unlocks from Superwall at relaunch', async () => {
    w = await boot(server, { user: 'u1' });
    await w.m.siteStore.saveSite(draft());
    w.willBuy(P.websiteMonthly);
    await publish(w);
    await drain();
    server.fail('/api/shop/plan', { kind: 'dead' });
    w.willBuy(P.bookingsMonthly);
    void w.show('bookings_upgrade');
    await drain();
    w = await kill(w);
    // Superwall (the Apple ID) has Bookings; the server's plan could not be read, so the tab stays locked (fail closed)
    // until it can say this account owns the purchase.
    expect(w.m.entitlements.getSuperwallEntitlements()).toMatchObject({ known: true, bookings: true });
    expect(w.m.entitlements.getEntitlements()).toMatchObject({ known: false, bookings: false });
  });
});

describe('the own Book link after a restore', () => {
  // Fixed (bug 3), flow level: restore fills inputs.bookingUrl from the server copy; clearing the Book
  // link used to delete only ownBookingUrl, so publish put Booksy back.
  async function restoredThenCleared() {
    // Published once from another phone, with the Booksy link.
    w = await boot(server, { user: 'u1' });
    await w.m.siteStore.saveSite(draft());
    w.willBuy(P.websiteMonthly);
    await publish(w);
    w.unmount();
    jest.resetModules();
    wipeDisk();
    // This phone: fresh install, signed in, Restore Purchases.
    w = await boot(server, { user: 'u1' });
    await w.superwallSync();
    const restored = await w.restore();
    expect(restored.site.inputs.bookingUrl).toBe(BOOKSY);
    // The barber clears the Book link in the editor (commitRecord runs syncOwnLink, then saves).
    const prev = (await w.site())!;
    const next = w.m.bookingChoice.syncOwnLink(prev, { ...prev, data: { ...prev.data, bookingUrl: '' } });
    await w.m.siteStore.saveSite({ ...next, updatedAt: Date.now() });
    expect(await publish(w)).toMatchObject({ kind: 'live' });
  }

  it('a Book link cleared after a restore stays cleared on the live site', async () => {
    await restoredThenCleared();
    expect(lastSent().bookingUrl).toBeFalsy();
  });

  const SQUARE = 'https://squareup.com/appointments/book/fade-lab';

  it('support setting a new own link in an admin edit lifts the clear (sync path); the next publish uses it', async () => {
    await restoredThenCleared();
    w.m.adminSync.resetSyncState();
    server.adminEdit((d) => ({ ...d, bookingUrl: SQUARE }));
    expect(await w.m.adminSync.syncQuietly()).toMatchObject({ kind: 'adopted' });
    const rec = (await w.site())!;
    expect(rec.inputs.ownBookingCleared).toBeUndefined();
    expect(w.m.bookingChoice.bookingPrefs(rec)).toEqual({ own: SQUARE, choice: 'own' });
    await publish(w);
    expect(lastSent().bookingUrl).toBe(SQUARE);
  });

  it('the same through the 409 path (admin edit lands mid-publish)', async () => {
    await restoredThenCleared();
    server.before['/api/ios/publish'] = [() => server.adminEdit((d) => ({ ...d, bookingUrl: SQUARE }))];
    expect(await publish(w)).toMatchObject({ kind: 'site-updated' });
    expect((await w.site())?.inputs.ownBookingCleared).toBeUndefined();
    await publish(w);
    expect(lastSent().bookingUrl).toBe(SQUARE);
  });

  it('an admin edit that leaves the Book link alone, or sets an AI Barber link, keeps the clear', async () => {
    await restoredThenCleared();
    w.m.adminSync.resetSyncState();
    server.adminEdit((d) => ({ ...d, area: 'Harlem' }));
    await w.m.adminSync.syncQuietly();
    expect((await w.site())?.inputs.ownBookingCleared).toBe(true);
    w.m.adminSync.resetSyncState();
    server.adminEdit((d) => ({ ...d, bookingUrl: 'https://www.aibarber.org/book/fade-lab' }));
    await w.m.adminSync.syncQuietly();
    const rec = (await w.site())!;
    expect(rec.inputs.ownBookingCleared).toBe(true);
    expect(w.m.bookingChoice.bookingPrefs(rec).own).toBeNull();
  });

  it('an account pull carrying the old Booksy link does not lift the clear', async () => {
    await restoredThenCleared();
    const rec = (await w.site())!;
    w.sb.rows.push({
      id: rec.draftId, user_id: 'u1', deployed_url: rec.deployedUrl,
      site_data: { ...rec.data, bookingUrl: BOOKSY, source: 'ios' },
      updated_at: new Date(rec.updatedAt + 60_000).toISOString(),
    });
    expect(await w.m.account.pullSiteFromAccount('u1')).toBe('adopted');
    const pulled = (await w.site())!;
    expect(pulled.inputs.ownBookingCleared).toBe(true);
    expect(w.m.bookingChoice.bookingPrefs(pulled).own).toBeNull();
  });

  it('a later Restore of the same site does not bring the cleared link back', async () => {
    await restoredThenCleared();
    await w.restore();
    expect((await w.site())?.inputs.ownBookingCleared).toBe(true);
    await publish(w);
    expect(lastSent().bookingUrl).toBeFalsy();
  });
});

describe('what the live site shows (liveLinks) drives the setup prompt', () => {
  const nextLinks = async (world: World) => {
    const rec = (await world.site())!;
    const ctx = await world.m.linkContext.loadLinkContext();
    return world.m.bookingChoice.linksOf(world.m.bookingChoice.linksToSend(rec.data, rec.inputs, ctx));
  };
  const prompt = async (world: World) => {
    const rec = (await world.site())!;
    const { setupPrompt } = require('@/lib/setupPrompt');
    return setupPrompt({ published: !!rec.deployedUrl, ents: world.m.entitlements.getEntitlements(), live: rec.liveLinks ?? null, next: await nextLinks(world) });
  };

  it('publish, admin adoption and restore record the live links; the prompt shows after setup and is gone once updated', async () => {
    w = await boot(server, { user: 'u1' });
    await w.m.siteStore.saveSite(draft());
    w.willBuy(P.bookingsMonthly);
    await publish(w);
    await w.superwallSync();
    expect((await w.site())?.liveLinks).toEqual({ bookingUrl: BOOKSY, shopUrl: null });
    // Bookings setup: shop on, AI Barber chosen.
    server.sb.rows.push({ id: 'shop-1', owner_id: 'u1', slug: 'fade-lab', bookings_enabled: true, store_enabled: false, ios_otid: 'tx-1' });
    await w.m.siteSync.updateSiteRecord((r) => w.m.bookingChoice.withChoice(r, 'aibarber', { slug: 'fade-lab' }));
    expect(await prompt(w)).toEqual({ title: 'Add the Book button to your website?' });
    // Update my site = the normal publish.
    await publish(w);
    expect((await w.site())?.liveLinks).toEqual({ bookingUrl: AI_BOOK, shopUrl: null });
    expect(await prompt(w)).toBeNull();
    // Bookings switched off: the AI button would go, the own link comes back.
    server.shopRow().bookings_enabled = false;
    expect((await prompt(w))?.title).toBe('Point your Book button back to your own booking link?');
    // An admin copy is what is live now.
    w.m.adminSync.resetSyncState();
    server.adminEdit((d) => ({ ...d, bookingUrl: BOOKSY }));
    await w.m.adminSync.syncQuietly();
    expect((await w.site())?.liveLinks).toEqual({ bookingUrl: BOOKSY, shopUrl: null });
    // A restore on a new phone knows what is live too.
    w.unmount();
    jest.resetModules();
    wipeDisk();
    w = await boot(server, { user: 'u1' });
    await w.restore();
    expect((await w.site())?.liveLinks).toEqual({ bookingUrl: BOOKSY, shopUrl: null });
  });
});
