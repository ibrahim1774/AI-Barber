/**
 * Sign out, then sign back in (same phone, or a fresh install / second iPhone): everything the account owns comes back
 * with no re-publish and no plan picked again (build 36, 2026-10-28, support@davoxa.com):
 *  - the plan and the Bookings / Store tabs, decided by the server's word for THIS account, also when this iPhone's
 *    Superwall says INACTIVE (a Sandbox renewal gap, another Apple ID on this iPhone, a renewal it has not seen yet);
 *  - a tab that was mounted while signed out asks again after the sign-in (no Retry needed);
 *  - the site (text, images, services, hours, gallery), the Book-button choice and the barber's own link;
 *  - the shop (ab_shops) and its link to the live site and the subscription (slug / transaction found again);
 *  - the published site is preferred over a newer unpublished draft row.
 * And it stays locked when the purchase is another account's, or not active.
 *
 * Same fake backend as accountLifecycle.test.tsx; only network, StoreKit and Superwall are faked.
 */
jest.mock('expo-superwall', () => require('../e2e/mocks').superwallMock());
jest.mock('expo-sqlite/kv-store', () => require('../e2e/mocks').diskMock());

import { Alert } from 'react-native';
import { BOOKSY, FakeServer, P, boot, draft, installFetch, type World } from '../e2e/harness';
import { wipeDisk } from '../e2e/mocks';

/* eslint-disable @typescript-eslint/no-require-imports */

type PlanCase = { name: 'website' | 'bookings' | 'store'; product: string; ents: { hosting: boolean; bookings: boolean; store: boolean } };
const PLANS: PlanCase[] = [
  { name: 'website', product: P.websiteMonthly, ents: { hosting: true, bookings: false, store: false } },
  { name: 'bookings', product: P.bookingsMonthly, ents: { hosting: true, bookings: true, store: false } },
  { name: 'store', product: P.storeMonthly, ents: { hosting: true, bookings: true, store: true } },
];

const PW = 'hunter22pw';
const EMAIL = 'sam@example.com';
const idFor = (email: string) => 'u-' + email.split('@')[0];

let server: FakeServer;
let w: World;
let db: any[];

const act = (fn: () => unknown) => w.act(fn);
const drain = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  jest.useRealTimers();
  jest.resetModules();
  wipeDisk();
  server = new FakeServer();
  installFetch(server);
  db = [];
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  try {
    w?.unmount();
  } catch {
    /* gone */
  }
  jest.restoreAllMocks();
});

async function launch(session: { id: string; email: string } | null): Promise<World> {
  const world = await boot(server, { user: session?.id ?? null });
  const { sb, supabase } = require('@/lib/supabase');
  if (session) sb.setSession({ access_token: `tok-${session.id}`, user: session });
  sb.rows = db;
  const from = supabase.from;
  supabase.from = (table: string) => {
    const b = from(table);
    if (table !== 'sites') return b;
    const upsert = b.upsert;
    b.upsert = (row: any, opts: unknown) => {
      const run = async () => {
        const r = await upsert(row, opts);
        if (!r.error) {
          const i = db.findIndex((x) => x.id === row.id);
          if (i >= 0) db[i] = { ...row };
          else db.push({ ...row });
        }
        return r;
      };
      return { select: () => ({ maybeSingle: run }), then: (res: any, rej: any) => run().then(res, rej) };
    };
    return b;
  };
  supabase.auth.signInWithPassword.mockImplementation(async ({ email, password }: { email: string; password: string }) => {
    const e = email.trim().toLowerCase();
    const signup = [...server.calls].reverse().find((c) => c.path === '/api/ios/signup' && String(c.body.email).trim().toLowerCase() === e);
    if (!signup || signup.body.password !== password) {
      return { data: { user: null, session: null }, error: { code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 } };
    }
    const user = { id: idFor(e), email: e };
    const session = { access_token: `tok-${user.id}`, user };
    sb.setSession(session);
    return { data: { user, session }, error: null };
  });
  w = world;
  return world;
}

const publish = async (world: World) => world.m.publish.publishFlow((await world.m.siteStore.loadSite())!, world.deps);

function claimRunner(world: World) {
  const { createClaimRunner, waitConfig } = require('@/lib/claim');
  let vclock = 0;
  waitConfig.now = () => vclock;
  waitConfig.sleep = async (ms: number) => {
    vclock += ms;
  };
  return createClaimRunner({
    signup: world.m.api.api.signup,
    transactionId: async () => (await world.m.siteStore.loadPendingPublish())?.transactionId ?? (await world.deps.latestTransactionId()),
    signIn: world.m.auth.signIn,
    finish: () => world.m.publish.resumePendingPublish(world.deps),
    parkInactive: () => world.m.siteStore.savePendingPublish(null),
    dropSession: async () => {
      await require('@/lib/supabase').supabase.auth.signOut({ scope: 'local' });
    },
  });
}

/** Pay -> account step -> live, with the account's shop (and a $30-deposit Haircut) for Bookings / Store. */
async function liveAccount(p: PlanCase, siteOver: Record<string, unknown> = {}): Promise<{ world: World; uid: string }> {
  const world = await launch(null);
  await world.m.siteStore.saveSite(draft(siteOver));
  world.willBuy(p.product);
  expect(await publish(world)).toEqual({ kind: 'claim-required' });
  await world.superwallSync();
  const uid = idFor(EMAIL);
  db.push({ id: 'shop-1', owner_id: uid, slug: 'fade-lab', name: 'Fade Lab', bookings_enabled: true, store_enabled: p.name === 'store', ios_otid: null, timezone: 'America/New_York' });
  db.push({ id: 'svc-1', shop_id: 'shop-1', name: 'Haircut', duration_min: 30, deposit_type: 'fixed', deposit_value: 3000, active: true });
  const out = await claimRunner(world).submit('signup', { name: 'Sam Barber', email: EMAIL, phone: '(555) 010-2030', password: PW });
  expect(out).toEqual({ kind: 'live' });
  await drain();
  return { world, uid };
}

/** This iPhone's Superwall reports INACTIVE and StoreKit lists nothing (another Apple ID, or a Sandbox renewal gap). */
async function deviceSeesNoSubscription(world: World) {
  world.sw.status = 'INACTIVE';
  world.sw.ents = [];
  world.sw.subscriptions = [];
  await act(async () => world.m.entitlements.setEntitlementsFromStatus({ status: 'INACTIVE' }));
}

const mountPlanSync = (world: World) => world.render(require('react').createElement(require('@/lib/planSync').PlanSync));

async function tabs(world: World) {
  const seen: string[] = [];
  const make = async (need: 'bookings' | 'store') =>
    world.probe(() => {
      const t = world.m.tierAccess.useTierAccess(need);
      seen.push(t.status);
      return t;
    });
  const bookings = await make('bookings');
  const store = await make('store');
  return {
    bookings: () => bookings.get(),
    store: () => store.get(),
    seen,
    flush: async () => {
      await bookings.flush();
      await store.flush();
    },
    unmount: async () => {
      await bookings.unmount();
      await store.unmount();
    },
  };
}

const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
};

describe.each(PLANS)('$name plan', (p) => {
  it("sign out, then sign in on an iPhone whose Superwall says INACTIVE: the account's own active purchase restores the plan, tabs and Settings; nothing is re-published or re-bought", async () => {
    const { world, uid } = await liveAccount(p);
    const published = server.published.length;
    const paid = server.apple.length;
    await world.m.auth.signOut();
    await drain();
    await deviceSeesNoSubscription(world);
    await mountPlanSync(world);

    await world.m.auth.signIn(EMAIL, PW);
    await settle();
    const t = await tabs(world);
    await t.flush();
    await settle();
    expect(t.bookings()).toMatchObject({ status: 'ready', entitled: p.ents.bookings, expired: false });
    expect(t.store()).toMatchObject({ status: 'ready', entitled: p.ents.store, expired: false });
    expect(t.seen).not.toContain('error');
    const ents = world.m.entitlements.getEntitlements();
    expect(ents).toMatchObject({ known: true, ...p.ents, account: 'self' });
    // Settings: no "Offline · Renew to put your site back", and the Plan row names the plan
    const site = await world.site();
    expect(site).toMatchObject({ deployedUrl: 'https://fade-lab.aibarber.org', ownerUserId: uid });
    expect(world.m.subscriptionStatus.siteOffline(site, 'unknown', ents)).toBe(false);
    expect(world.m.plan.planLabel(world.m.entitlements.tierFromEntitlements(ents))).toBe(world.m.plan.planLabel(p.name));
    // nothing published, nothing bought
    expect(server.published).toHaveLength(published);
    expect(server.apple).toHaveLength(paid);
    await t.unmount();
  });

  it('a tab mounted while signed out asks for the plan again once the sign-in lands (no Retry, no PlanSync needed)', async () => {
    if (p.name === 'website') return; // nothing is gated by the server for the Website plan
    const { world } = await liveAccount(p);
    await world.m.auth.signOut();
    await drain();
    const t = await tabs(world);
    await t.flush();
    expect(t.bookings()).toMatchObject({ status: 'ready', entitled: false });
    await world.m.auth.signIn(EMAIL, PW);
    await settle();
    await t.flush();
    expect(t.bookings()).toMatchObject({ status: 'ready', entitled: p.ents.bookings });
    expect(t.store()).toMatchObject({ status: 'ready', entitled: p.ents.store });
    await t.unmount();
  });

  it('same Apple ID, purchase linked to this account: after sign-in the site finds its subscription again (slug, transaction, live links), read-only', async () => {
    const { world, uid } = await liveAccount(p);
    const published = server.published.length;
    await world.m.auth.signOut();
    await drain();
    await world.m.auth.signIn(EMAIL, PW);
    await drain();
    expect(await world.site()).toMatchObject({ slug: null, transactionId: null, ownerUserId: uid });
    // The open editor holds the unbound record; it is told, so its next save can't write slug / transaction back to null.
    const told: any[] = [];
    const off = world.m.account.onSiteAdopted((s: any) => told.push(s));
    expect(await world.m.account.rebindAdoptedSite({ latestTransactionId: world.deps.latestTransactionId })).toBe(true);
    off();
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ slug: 'fade-lab', transactionId: 'tx-1' });
    expect(await world.site()).toMatchObject({ slug: 'fade-lab', transactionId: 'tx-1', ownerUserId: uid, deployedUrl: 'https://fade-lab.aibarber.org' });
    expect(server.published).toHaveLength(published);
  });

  it("the shop and its services are there after sign-in, with no publish (they never left the account)", async () => {
    const { world, uid } = await liveAccount(p);
    const published = server.published.length;
    await world.m.auth.signOut();
    await drain();
    await world.m.auth.signIn(EMAIL, PW);
    await drain();
    const shop = await require('@/lib/shop').loadMyShop();
    expect(shop).toMatchObject({ id: 'shop-1', slug: 'fade-lab' });
    expect(db.find((r) => r.id === 'svc-1')).toMatchObject({ shop_id: 'shop-1', name: 'Haircut', deposit_value: 3000 });
    expect(db.find((r) => r.id === 'shop-1')?.owner_id).toBe(uid);
    expect(server.published).toHaveLength(published);
  });
});

describe('the site and the Book button come back', () => {
  const store = PLANS[2];
  const RICH = {
    hours: [{ day: 'Mon', open: '9:00', close: '17:00' }],
    gallery: ['https://cdn.example/g0.jpg', 'https://cdn.example/g1.jpg'],
    logo: { url: 'https://cdn.example/logo.png', w: 400, h: 200 },
  };

  it('text, images, services and hours: the same after sign-out and sign-in, and on a fresh install signing in', async () => {
    const { world } = await liveAccount(store);
    const base = await world.site();
    await world.m.siteStore.saveSite({ ...base!, data: { ...base!.data, ...RICH }, updatedAt: Date.now() + 1 });
    await world.m.auth.signOut(); // pushes, then clears the phone
    await drain();
    expect(await world.site()).toBeNull();
    await world.m.auth.signIn(EMAIL, PW);
    await drain();
    const back = await world.site();
    for (const k of ['shopName', 'hero', 'about', 'services', 'gallery', 'hours', 'logo'] as const) {
      expect(back!.data[k]).toEqual({ ...base!.data, ...RICH }[k]);
    }

    // a fresh install (or a second iPhone) signs in to the same account
    await world.m.auth.signOut();
    await drain();
    world.unmount();
    wipeDisk();
    jest.resetModules();
    const w2 = await launch(null);
    await w2.m.auth.signIn(EMAIL, PW);
    await drain();
    const fresh = await w2.site();
    expect(fresh).toMatchObject({ deployedUrl: 'https://fade-lab.aibarber.org' });
    for (const k of ['shopName', 'hero', 'about', 'services', 'gallery', 'hours', 'logo'] as const) {
      expect(fresh!.data[k]).toEqual({ ...base!.data, ...RICH }[k]);
    }
  });

  it('header choice (logo / name) and a 6-photo gallery come back exactly as the editor showed them (the live copy)', async () => {
    const { world } = await liveAccount(store);
    const { DEMO_GALLERY_STOCK } = require('@/web/lib/stockImages');
    const six = ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg', DEMO_GALLERY_STOCK[0], 'https://cdn.example/c.jpg', 'https://cdn.example/d.jpg', 'https://cdn.example/e.jpg'];
    const base = await world.site();
    const data = { ...base!.data, logo: { url: 'https://cdn.example/logo.png', w: 400, h: 200 }, headerShow: 'name' as const, gallery: six };
    await world.m.siteStore.saveSite({ ...base!, data, updatedAt: Date.now() + 1 });
    const shown = world.m.publish.publishPayload(data); // what the editor shows and what goes live
    await world.m.auth.signOut();
    await drain();
    await world.m.auth.signIn(EMAIL, PW);
    await drain();
    const back = (await world.site())!.data;
    expect(back.headerShow).toBe('name');
    expect(back.logo).toEqual(data.logo);
    expect(back.gallery).toEqual(shown.gallery);
  });

  it("the Book button switched off ('call') stays off, and an own link kept under the built-in booking is not lost", async () => {
    const { world } = await liveAccount(store);
    const bc = world.m.bookingChoice;
    let s = await world.site();
    await world.m.siteStore.saveSite({ ...bc.withChoice(s!, 'call'), updatedAt: Date.now() + 1 });
    await world.m.auth.signOut();
    await drain();
    await world.m.auth.signIn(EMAIL, PW);
    await drain();
    s = await world.site();
    expect(bc.bookingPrefs(s!)).toEqual({ own: BOOKSY, choice: 'call' });

    await world.m.siteStore.saveSite({ ...bc.withChoice(s!, 'aibarber'), updatedAt: Date.now() + 2 });
    expect((await world.site())!.data.bookingUrl).toBe('/book');
    await world.m.auth.signOut();
    await drain();
    await world.m.auth.signIn(EMAIL, PW);
    await drain();
    expect(bc.bookingPrefs((await world.site())!)).toEqual({ own: BOOKSY, choice: 'aibarber' });
  });

  it("a row from before the Book prefs were stored: a live site with no Book link comes back as 'call', never as the built-in Book", async () => {
    const { world, uid } = await liveAccount(store);
    await world.m.auth.signOut();
    await drain();
    const row = db.find((r) => r.user_id === uid && r.site_data?.source === 'ios');
    const { bookingUrl: _drop, iosPrefs: _prefs, ...rest } = row.site_data;
    row.site_data = rest;
    await world.m.auth.signIn(EMAIL, PW);
    await drain();
    expect(world.m.bookingChoice.bookingPrefs((await world.site())!).choice).toBe('call');
  });

  it('the published site is adopted, not a newer unpublished draft row of the same account', async () => {
    const { world, uid } = await liveAccount(store);
    await world.m.auth.signOut();
    await drain();
    db.push({
      id: 'draft-2', user_id: uid, site_data: { shopName: 'Scratch', area: '', phone: '', source: 'ios' },
      deployed_url: null, deployment_status: 'draft', updated_at: new Date(Date.now() + 60_000).toISOString(),
    });
    await world.m.auth.signIn(EMAIL, PW);
    await drain();
    expect(await world.site()).toMatchObject({ deployedUrl: 'https://fade-lab.aibarber.org' });
    expect((await world.site())!.data.shopName).toBe('Fade Lab');
  });
});

describe('sign-out leaves nothing of the account on the phone', () => {
  it("this phone's push token is removed from the account (no more booking pushes here), and registers again on the next sign-in", async () => {
    const { world, uid } = await liveAccount(PLANS[1]);
    const Storage = require('expo-sqlite/kv-store').default;
    await Storage.setItem('bookings.pushToken.v1', `${uid}:ExponentPushToken[abc]`);
    await world.m.auth.signOut();
    await drain();
    const del = world.sb.deletes.find((d: any) => d.table === 'ab_push_tokens');
    expect(del?.filters).toEqual([['user_id', uid], ['expo_token', 'ExponentPushToken[abc]']]);
    expect(await Storage.getItem('bookings.pushToken.v1')).toBeNull();
    expect(require('@/lib/bookings/pushStamp').getSentThisRun()).toBeNull();
  });

  it("another account's stamp is never used to delete anything", async () => {
    const { world } = await liveAccount(PLANS[1]);
    const Storage = require('expo-sqlite/kv-store').default;
    await Storage.setItem('bookings.pushToken.v1', 'u-other:ExponentPushToken[abc]');
    await world.m.auth.signOut();
    await drain();
    expect(world.sb.deletes.find((d: any) => d.table === 'ab_push_tokens')).toBeUndefined();
  });
});

describe('still locked when the server does not vouch for this account', () => {
  it("Superwall INACTIVE and the purchase is another account's: Bookings and Store stay locked", async () => {
    const { world } = await liveAccount(PLANS[2]);
    await world.m.auth.signOut();
    await drain();
    server.purchaseOwner = 'u-someone-else';
    await deviceSeesNoSubscription(world);
    await mountPlanSync(world);
    await world.m.auth.signIn(EMAIL, PW);
    await settle();
    const t = await tabs(world);
    await t.flush();
    await settle();
    expect(t.bookings().entitled).toBe(false);
    expect(t.store().entitled).toBe(false);
    expect(world.m.entitlements.getEntitlements()).toMatchObject({ bookings: false, store: false });
    await t.unmount();
  });

  it('Superwall goes INACTIVE and the server agrees (a real lapse): the cached active plan stops granting at once', async () => {
    const { world } = await liveAccount(PLANS[2]);
    await mountPlanSync(world);
    await settle();
    expect(world.m.entitlements.getEntitlements()).toMatchObject({ store: true, account: 'self' });
    server.lapse();
    await world.superwallSync();
    expect(world.m.entitlements.getEntitlements()).toMatchObject({ bookings: false, store: false });
    await settle();
    expect(world.m.plan.getSharedPlan()).toMatchObject({ active: false });
    expect(world.m.entitlements.getEntitlements()).toMatchObject({ hosting: false, bookings: false, store: false });
  });
});
