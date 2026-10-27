/**
 * Account lifecycle, end to end, for each of the three plans (Website, Bookings, Store):
 *  1 pay -> account step -> live          2 sign out        3 sign back in      4 kill + relaunch
 *  5 delete + reinstall                   6 second account on the same Apple ID + Move
 *  7 payment lapse and paying again       8 offline during sign-in / sign-up
 *  9 Back from the account step, Publish returns to it
 *
 * Real modules (auth, authSession, account, claim, claimGuard, publish, plan, planSync, entitlements, tierAccess,
 * moveSubscription, useMoveSubscription, launchRoute, siteStore), the fake backend and Apple ID of __tests__/e2e/harness.ts
 * behind fetch, and the shared Supabase mock. Only network, StoreKit and Superwall are faked. A "kill" is
 * jest.resetModules + boot on the same disk; the server-side database (`db`) outlives every launch.
 */
jest.mock('expo-superwall', () => require('../e2e/mocks').superwallMock());
jest.mock('expo-sqlite/kv-store', () => require('../e2e/mocks').diskMock());

import { Alert } from 'react-native';
import { FakeServer, P, boot, draft, installFetch, type World } from '../e2e/harness';
import { disk, wipeDisk } from '../e2e/mocks';

/* eslint-disable @typescript-eslint/no-require-imports */

type PlanCase = {
  name: 'website' | 'bookings' | 'store';
  product: string;
  ents: { hosting: boolean; bookings: boolean; store: boolean };
};
const PLANS: PlanCase[] = [
  { name: 'website', product: P.websiteMonthly, ents: { hosting: true, bookings: false, store: false } },
  { name: 'bookings', product: P.bookingsMonthly, ents: { hosting: true, bookings: true, store: false } },
  { name: 'store', product: P.storeMonthly, ents: { hosting: true, bookings: true, store: true } },
];

const PW = 'hunter22pw';
const EMAIL = 'sam@example.com';
const EMAIL_B = 'bea@example.com';
const idFor = (email: string) => 'u-' + email.split('@')[0];
const sessionOf = (email: string) => ({ id: idFor(email), email });

let server: FakeServer;
let w: World;
/** public.sites + ab_shops on the Supabase side: survives every kill. */
let db: any[];
/** Accounts that exist without having gone through /api/ios/signup (made on the web). */
let webAccounts: Map<string, string>;
let signInFault: null | 'offline' = null;

// The act of this launch's renderer (jest.resetModules gives every launch its own).
const act = (fn: () => unknown) => w.act(fn);
const drain = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  jest.useRealTimers();
  jest.resetModules();
  wipeDisk();
  server = new FakeServer();
  installFetch(server);
  db = [];
  webAccounts = new Map();
  signInFault = null;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  try {
    w?.unmount();
  } catch {
    /* already unmounted */
  }
  jest.restoreAllMocks();
});

/** The app starts (cold) with `session` in the Keychain, or signed out. */
async function launch(session: { id: string; email: string } | null): Promise<World> {
  const world = await boot(server, { user: session?.id ?? null });
  const { sb, supabase } = require('@/lib/supabase');
  if (session) sb.setSession({ access_token: `tok-${session.id}`, user: session });
  sb.rows = db; // the same server-side tables on every launch

  // public.sites upserts land in the shared db (the mock only records them).
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
      // Awaitable, and chainable like the real builder (.select().maybeSingle()).
      return { select: () => ({ maybeSingle: run }), then: (res: any, rej: any) => run().then(res, rej) };
    };
    return b;
  };

  // Email + password sign-in against the accounts that exist.
  supabase.auth.signInWithPassword.mockImplementation(async ({ email, password }: { email: string; password: string }) => {
    if (signInFault === 'offline') return { data: { user: null, session: null }, error: { name: 'AuthRetryableFetchError', message: 'Network request failed', status: 0 } };
    const e = email.trim().toLowerCase();
    const signup = [...server.calls].reverse().find((c) => c.path === '/api/ios/signup' && String(c.body.email).trim().toLowerCase() === e);
    const known = signup ? signup.body.password : webAccounts.get(e);
    if (known == null || known !== password) {
      return { data: { user: null, session: null }, error: { code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 } };
    }
    const user = sessionOf(e);
    const session = { access_token: `tok-${user.id}`, user };
    sb.setSession(session);
    return { data: { user, session }, error: null };
  });
  w = world;
  return world;
}

/** Force-quit and relaunch with whatever session is in the Keychain. */
async function relaunch(): Promise<World> {
  const s = w.sb.session ? { id: w.sb.session.user.id as string, email: w.sb.session.user.email as string } : null;
  try {
    w.unmount();
  } catch {
    /* gone */
  }
  jest.resetModules();
  return launch(s);
}

const publish = async (world: World) => world.m.publish.publishFlow((await world.m.siteStore.loadSite())!, world.deps);

function claimRunner(world: World) {
  const { createClaimRunner, waitConfig } = require('@/lib/claim');
  // The runner waits out transient/offline publish answers by itself; a virtual clock lets the 3 minutes pass at once.
  let vclock = 0;
  waitConfig.now = () => vclock;
  waitConfig.sleep = async (ms: number) => { vclock += ms; };
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

const FORM = { name: 'Sam Barber', email: EMAIL, phone: '(555) 010-2030', password: PW };

/** The signed-out payer reaches the account step: paid, claim-required, pending 'unclaimed'. */
async function payToAccountStep(p: PlanCase): Promise<World> {
  const world = await launch(null);
  await world.m.siteStore.saveSite(draft());
  world.willBuy(p.product);
  expect(await publish(world)).toEqual({ kind: 'claim-required' });
  await world.superwallSync();
  return world;
}

/** Pay -> sign up (account step) -> live. The account's shop exists server-side for Bookings / Store. */
async function liveAccount(p: PlanCase, email = EMAIL): Promise<{ world: World; uid: string }> {
  const world = await payToAccountStep(p);
  if (p.name !== 'website') {
    db.push({ id: 'shop-1', owner_id: idFor(email), slug: 'fade-lab', name: 'Fade Lab', bookings_enabled: true, store_enabled: p.name === 'store', ios_otid: null });
  }
  const out = await claimRunner(world).submit('signup', { ...FORM, email });
  expect(out).toEqual({ kind: 'live' });
  await drain();
  return { world, uid: idFor(email) };
}

const mountPlanSync = (world: World) => world.render(require('react').createElement(require('@/lib/planSync').PlanSync));

/** Bookings + Store tab gates, as the tabs read them. `statuses` records every status ever rendered. */
async function tabs(world: World) {
  const seen: string[] = [];
  const make = async (need: 'bookings' | 'store') => {
    const statuses: string[] = [];
    const probe = await world.probe(() => {
      const t = world.m.tierAccess.useTierAccess(need);
      statuses.push(t.status);
      seen.push(t.status);
      return t;
    });
    return { probe, statuses };
  };
  const bookings = await make('bookings');
  const store = await make('store');
  return {
    bookings: () => bookings.probe.get(),
    store: () => store.probe.get(),
    seen,
    flush: async () => {
      await bookings.probe.flush();
      await store.probe.flush();
    },
    unmount: async () => {
      await bookings.probe.unmount();
      await store.probe.unmount();
    },
  };
}

/** What the plan grants, as the tabs show it (Website: Bookings and Store locked; Bookings: Store locked). */
async function expectTierAccess(world: World, p: PlanCase) {
  const t = await tabs(world);
  await t.flush();
  expect(t.bookings()).toMatchObject({ status: 'ready', entitled: p.ents.bookings });
  expect(t.store()).toMatchObject({ status: 'ready', entitled: p.ents.store });
  expect(t.seen).not.toContain('error'); // never the "Couldn't load your plan" card
  await t.unmount();
}

function expectEntitlements(world: World, p: PlanCase) {
  expect(world.m.entitlements.getEntitlements()).toMatchObject({ known: true, ...p.ents, ...(p.name === 'website' ? {} : { account: 'self' }) });
}

const { launchRoute } = (() => ({ launchRoute: () => require('@/lib/launchRoute').launchRoute() as Promise<string> }))();
const freshLaunchRoute = (world: World) => {
  world.m.account.resetLaunchPullForTests();
  return launchRoute();
};

describe.each(PLANS)('$name plan', (p) => {
  // ---- 1 ------------------------------------------------------------------------------------------------
  it(`1. pay -> account step (name, email, phone, password) -> live; plan and entitlements are the ${p.name} tier's`, async () => {
    const world = await payToAccountStep(p);
    // paid and held: locked to the account step, nothing published, no account yet
    expect(await world.pending()).toMatchObject({ state: 'unclaimed', transactionId: 'tx-1' });
    expect(await require('@/lib/claimGuard').claimLocked()).toBe(true);
    expect(server.published).toHaveLength(0);
    if (p.name !== 'website') {
      db.push({ id: 'shop-1', owner_id: idFor(EMAIL), slug: 'fade-lab', name: 'Fade Lab', bookings_enabled: true, store_enabled: p.name === 'store', ios_otid: null });
    }

    // the form is exactly four fields: a confirm field does not exist, so a form without one is complete
    const { validateClaim } = require('@/lib/claimValidation');
    expect(validateClaim('signup', FORM)).toEqual({});
    expect(Object.keys(FORM).sort()).toEqual(['email', 'name', 'password', 'phone']);

    const out = await claimRunner(world).submit('signup', FORM);
    expect(out).toEqual({ kind: 'live' });
    await drain();

    // the server got the four fields (+ the verified purchase), the phone normalised; the account then signed in
    const signup = server.calls.find((c) => c.path === '/api/ios/signup')!;
    expect(Object.keys(signup.body).sort()).toEqual(['email', 'name', 'password', 'phone', 'transactionId']);
    expect(signup.body).toMatchObject({ name: 'Sam Barber', email: EMAIL, phone: '+15550102030', transactionId: 'tx-1' });
    expect(world.sb.session?.user.id).toBe(idFor(EMAIL));
    // live, the lock is gone, the site is the account's
    expect(await world.pending()).toBeNull();
    expect(await require('@/lib/claimGuard').claimLocked()).toBe(false);
    expect(server.published).toHaveLength(1);
    expect(server.calls.find((c) => c.path === '/api/ios/publish')?.headers?.Authorization).toBe(`Bearer tok-${idFor(EMAIL)}`);
    expect(await world.site()).toMatchObject({ slug: 'fade-lab', deployedUrl: 'https://fade-lab.aibarber.org', ownerUserId: idFor(EMAIL), transactionId: 'tx-1' });
    expect(db.find((r) => r.user_id === idFor(EMAIL))).toMatchObject({ deployed_url: 'https://fade-lab.aibarber.org' });
    // plan + entitlements + tab gates for exactly this tier
    expect(world.m.plan.getSharedPlan()).toMatchObject({ tier: p.name, active: true, purchaseAccount: 'self', entitlements: p.ents });
    expectEntitlements(world, p);
    await expectTierAccess(world, p);
  });

  // ---- 2 ------------------------------------------------------------------------------------------------
  it('2. sign out clears site, plan, entitlements, customers and the pending record, and lands on the start screen', async () => {
    const { world, uid } = await liveAccount(p);
    require('@/lib/bookings/customersCache').setCustomersCache({ shopId: 'shop-1', shop: {}, customers: [{ id: 'c1' }] });
    expect(await world.site()).not.toBeNull();

    await expect(world.m.auth.signOut()).resolves.toBeUndefined();
    await drain();

    expect(await world.site()).toBeNull();
    expect(await world.pending()).toBeNull();
    expect(world.sb.session).toBeNull();
    expect(world.m.auth.currentUserId()).toBeNull();
    expect(require('@/lib/bookings/customersCache').customersCache).toBeNull();
    expect(world.m.plan.getSharedPlan()).toBeNull();
    // the site was pushed to the account first (that is why it may leave the phone)
    expect(db.find((r) => r.user_id === uid)).toMatchObject({ deployed_url: 'https://fade-lab.aibarber.org' });
    // Bookings / Store are locked for nobody; the Website entitlement is the Apple ID's, which is not the account's
    expect(world.m.entitlements.getEntitlements()).toMatchObject(
      p.name === 'website'
        ? { known: true, hosting: true, bookings: false, store: false }
        : { known: false, hosting: false, bookings: false, store: false },
    );
    // no error: both tabs are locked (no retry card), and the app opens on the start screen
    const t = await tabs(world);
    await t.flush();
    expect(t.bookings()).toMatchObject({ status: 'ready', entitled: false });
    expect(t.store()).toMatchObject({ status: 'ready', entitled: false });
    expect(t.seen).not.toContain('error');
    await t.unmount();
    expect(await freshLaunchRoute(world)).toBe('/start');
    // and it stays that way after a kill
    const again = await relaunch();
    expect(again.sb.session).toBeNull();
    expect(await again.site()).toBeNull();
    expect(await freshLaunchRoute(again)).toBe('/start');
  });

  it('2b. sign out when the site cannot be saved to the account (offline): signed out, tiers locked, the site stays on the phone, and signing back in keeps it', async () => {
    const { world, uid } = await liveAccount(p);
    const edited = { ...(await world.site())!, updatedAt: Date.now() + 1000 };
    await world.m.siteStore.saveSite(edited); // an unsaved edit
    world.sb.upsertError = { message: 'Network request failed' };
    await expect(world.m.auth.signOut()).resolves.toBeUndefined();
    expect(world.sb.session).toBeNull();
    expect(world.m.plan.getSharedPlan()).toBeNull();
    expect(world.m.entitlements.getEntitlements().store).toBe(false);
    expect(await world.site()).toMatchObject({ ownerUserId: uid }); // nothing unsaved is thrown away
    world.sb.upsertError = null;
    await world.m.auth.signIn(EMAIL, PW);
    expect(await world.site()).toMatchObject({ ownerUserId: uid, updatedAt: edited.updatedAt });
    await drain();
    expect(db.find((r) => r.user_id === uid)).toBeTruthy();
  });

  // ---- 3 ------------------------------------------------------------------------------------------------
  describe('3. sign back in with the same email', () => {
    async function signedOutAccount() {
      const { world, uid } = await liveAccount(p);
      await world.m.auth.signOut();
      await drain();
      expect(await world.site()).toBeNull();
      return { world, uid };
    }

    it('pulls the same site, refetches the plan, same tier access, no error state', async () => {
      const { world, uid } = await signedOutAccount();
      await world.m.auth.signIn(EMAIL, PW);
      await drain();
      expect(world.sb.session?.user.id).toBe(uid);
      expect(world.m.auth.takeEmptyAccountNotice()).toBeNull();
      const site = await world.site();
      expect(site).toMatchObject({ deployedUrl: 'https://fade-lab.aibarber.org', ownerUserId: uid });
      expect(site?.data.shopName).toBe('Fade Lab');
      expect(site?.data.services).toEqual([{ title: 'Cut', price: '$30', description: 'Classic', imageUrl: '' }]);
      expect(await freshLaunchRoute(world)).toBe('/edit');
      expect(await world.pending()).toBeNull();

      await mountPlanSync(world);
      await world.probe(() => null).then((x) => x.flush());
      await expectTierAccess(world, p);
      expect(world.m.plan.getSharedPlan() ?? (await world.m.plan.getPlan())).toMatchObject({ tier: p.name, active: true, purchaseAccount: 'self' });
      if (p.name !== 'website') expectEntitlements(world, p);
    });

    it('the plan fetch is slow once: a spinner while it waits, then the tier; never the error card', async () => {
      const { world } = await signedOutAccount();
      await world.m.auth.signIn(EMAIL, PW);
      let release!: () => void;
      server.fail('/api/shop/plan', { kind: 'held', release: new Promise<void>((r) => (release = r)) }, 2); // one per tab
      const t = await tabs(world);
      if (p.name !== 'website') {
        expect(t.bookings().status).toBe('loading');
        expect(t.bookings().entitled).toBe(false); // never unlocked on Superwall alone
      }
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
        release();
      });
      await t.flush();
      expect(t.bookings()).toMatchObject({ status: 'ready', entitled: p.ents.bookings });
      expect(t.store()).toMatchObject({ status: 'ready', entitled: p.ents.store });
      expect(t.seen).not.toContain('error');
      await t.unmount();
    });

    it('the plan answers 404 no-shop: no error card (locked, not an error); a later answer unlocks the tier', async () => {
      const { world } = await signedOutAccount();
      await world.m.auth.signIn(EMAIL, PW);
      server.fail('/api/shop/plan', { kind: 'json', status: 404, body: { error: 'no-shop' } }, 2); // one per tab
      const t = await tabs(world);
      await t.flush();
      expect(t.seen).not.toContain('error');
      expect(t.bookings().status).toBe('ready');
      if (p.name !== 'website') expect(t.bookings().entitled).toBe(false); // fail closed until the server vouches for this account
      expect(t.bookings().status).not.toBe('error');
      // the Retry button (or the next load) reads the real plan
      await act(async () => t.bookings().retry());
      await t.flush();
      expect(t.bookings()).toMatchObject({ status: 'ready', entitled: p.ents.bookings });
      expect(t.store()).toMatchObject({ status: 'ready', entitled: p.ents.store });
      await t.unmount();
    });

    it('a plan fetch that fails once recovers by itself (PlanSync retries) and by Try again, never unlocked in between', async () => {
      if (p.name === 'website') return; // the Website plan needs no server plan to be known: nothing can fail here
      const { world } = await signedOutAccount();
      await world.m.auth.signIn(EMAIL, PW);
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      server.fail('/api/shop/plan', { kind: 'offline' }, 1);
      await mountPlanSync(world);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(50);
      });
      expect(world.m.plan.getSharedPlan()).toBeNull();
      expect(world.m.entitlements.getEntitlements()).toMatchObject({ known: false, bookings: false, store: false });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(16_000);
      });
      expect(world.m.plan.getSharedPlan()).toMatchObject({ tier: p.name, purchaseAccount: 'self' });
      expectEntitlements(world, p);
      jest.useRealTimers();
    });
  });

  // ---- 3 (screens stay mounted) --------------------------------------------------------------------------
  describe('3b. sign out and back in while the app and its tabs stay mounted', () => {
    it('PlanSync and the tab gates follow the session: locked on sign-out, the same tier again on sign-in, no error card', async () => {
      const { world } = await liveAccount(p);
      await mountPlanSync(world);
      const t = await tabs(world);
      await t.flush();
      expect(t.bookings()).toMatchObject({ status: 'ready', entitled: p.ents.bookings });
      expect(t.store()).toMatchObject({ status: 'ready', entitled: p.ents.store });

      await world.m.auth.signOut();
      await t.flush();
      expect(t.bookings()).toMatchObject({ status: 'ready', entitled: false });
      expect(t.store()).toMatchObject({ status: 'ready', entitled: false });

      await world.m.auth.signIn(EMAIL, PW);
      await t.flush();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
      expect(t.bookings()).toMatchObject({ status: 'ready', entitled: p.ents.bookings });
      expect(t.store()).toMatchObject({ status: 'ready', entitled: p.ents.store });
      expect(t.seen).not.toContain('error');
      if (p.name !== 'website') expectEntitlements(world, p);
      await t.unmount();
    });

    it('the first plan fetch after signing in fails (a blip): never unlocked meanwhile; PlanSync recovers it on its own without a tap', async () => {
      if (p.name === 'website') return;
      const { world } = await liveAccount(p);
      await world.m.auth.signOut();
      await drain();
      await world.m.auth.signIn(EMAIL, PW);
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      server.fail('/api/shop/plan', { kind: 'offline' }, 3); // PlanSync's fetch and each tab's
      await mountPlanSync(world);
      const t = await tabs(world);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(50);
      });
      expect(t.bookings().entitled).toBe(false);
      expect(t.store().entitled).toBe(false);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(16_000);
      });
      expect(t.bookings()).toMatchObject({ status: 'ready', entitled: p.ents.bookings });
      expect(t.store()).toMatchObject({ status: 'ready', entitled: p.ents.store });
      // By design a hard failure shows the retry card ("Try again") until PlanSync's 15 s retry lands; it is never an unlock.
      await t.unmount();
    });
  });

  // ---- 4 ------------------------------------------------------------------------------------------------
  it('4. kill and relaunch while signed in: still signed in, same site, same plan and tier access', async () => {
    const { world, uid } = await liveAccount(p);
    const before = await world.site();
    const w2 = await relaunch();
    expect(w2.sb.session?.user.id).toBe(uid);
    expect(await w2.site()).toEqual(before);
    expect(await w2.pending()).toBeNull();
    expect(await freshLaunchRoute(w2)).toBe('/edit');
    expect(w2.m.plan.getSharedPlan()).toBeNull(); // in-memory state starts empty ...
    await mountPlanSync(w2);
    await w2.probe(() => null).then((x) => x.flush());
    await expectTierAccess(w2, p); // ... and is rebuilt from Superwall + the server
    if (p.name !== 'website') expectEntitlements(w2, p);
    expect(await w2.m.account.pullSiteOnLaunch()).toBe('unchanged'); // nothing to re-adopt, nothing lost
    expect((await w2.site())?.data.shopName).toBe('Fade Lab');
  });

  // ---- 5 ------------------------------------------------------------------------------------------------
  describe('5. delete and reinstall (reinstall guard)', () => {
    const KEY = 'sb-test-auth-token';
    const kv = () => require('expo-sqlite/kv-store').default;
    const keychain = (uid: string) =>
      new Map<string, string>([[KEY, JSON.stringify({ user: { id: uid }, refresh_token: 'r' })], [`${KEY}-user`, '{}']]);
    const secureOf = (m: Map<string, string>) => ({
      getItemAsync: async (k: string) => m.get(k) ?? null,
      setItemAsync: async (k: string, v: string) => void m.set(k, v),
      deleteItemAsync: async (k: string) => void m.delete(k),
    });

    it('the Keychain session survives the delete, the guard signs it out before anything reads it and clears the in-memory account', async () => {
      const { uid } = await liveAccount(p);
      const kc = keychain(uid);
      w.unmount();
      wipeDisk(); // the app container is gone; the Keychain is not
      jest.resetModules();
      const world = await launch(sessionOf(EMAIL)); // what supabase-js would have restored from the leftover Keychain
      require('@/lib/bookings/customersCache').setCustomersCache({ shopId: 'shop-1', shop: {}, customers: [{ id: 'c1' }] });
      world.m.plan.setSharedPlan({ ...(await world.m.plan.getPlan()) });

      const { createAuthStorage } = require('@/lib/authSession');
      const storage = createAuthStorage({ kv: kv(), secure: secureOf(kc), storageKey: KEY });
      expect(await storage.getItem(KEY)).toBeNull(); // the guard ran first: no leftover session is ever handed out
      expect(kc.size).toBe(0);
      world.sb.setSession(null); // supabase-js found nothing in the Keychain
      // the app's own data is gone and the cached account is cleared
      expect(await world.site()).toBeNull();
      expect(await world.pending()).toBeNull();
      expect(world.m.plan.getSharedPlan()).toBeNull();
      expect(require('@/lib/bookings/customersCache').customersCache).toBeNull();
      expect(world.m.entitlements.getEntitlements().bookings).toBe(false);
      expect(world.m.entitlements.getEntitlements().store).toBe(false);
      expect(await freshLaunchRoute(world)).toBe('/start');
      expect(disk().get('install.v1')).toBe('1');
    });

    it('an ordinary relaunch (not a reinstall) keeps the Keychain session', async () => {
      const { uid } = await liveAccount(p);
      const kc = keychain(uid);
      const { createAuthStorage } = require('@/lib/authSession');
      const storage = createAuthStorage({ kv: kv(), secure: secureOf(kc), storageKey: KEY });
      expect(await storage.getItem(KEY)).not.toBeNull();
      expect(kc.size).toBe(2);
      expect(await storage.ready()).toBe('existing');
    });
  });

  // ---- 6 ------------------------------------------------------------------------------------------------
  it('6. a second account on the same Apple ID is offered Move; Move gives it the site and tier, the first account is left empty and locked', async () => {
    const { world: a, uid: uidA } = await liveAccount(p);
    await a.m.auth.signOut();
    await drain();
    webAccounts.set(EMAIL_B, 'bea-password');
    const uidB = idFor(EMAIL_B);

    // B signs in on the same phone: nothing of A's, an empty account
    await a.m.auth.signIn(EMAIL_B, 'bea-password');
    expect(a.sb.session?.user.id).toBe(uidB);
    expect(await a.site()).toBeNull();
    expect(a.m.plan.getSharedPlan()).toBeNull();

    // Bookings / Store: paid on this Apple ID but A's -> locked, with the other-account state the Move button sits in
    const t = await tabs(a);
    await t.flush();
    if (p.name !== 'website') {
      expect(a.m.entitlements.getEntitlements()).toMatchObject({ account: 'other', hint: 'o***@gmail.com', bookings: false, store: false });
      expect(t.bookings()).toMatchObject({ status: 'ready', entitled: false, otherAccount: { hint: 'o***@gmail.com' } });
      expect(t.store()).toMatchObject({ status: 'ready', entitled: false });
    }
    await t.unmount();
    // Restore (Website plan's way to the Move offer too): the server says whose it is, and the message offers Move
    const { restoreMessage } = require('@/lib/restoreFlow');
    let restoreError: unknown;
    try {
      await a.m.account.restore({
        restorePurchases: async () => {},
        latestTransactionId: a.deps.latestTransactionId,
        iosSite: a.m.api.api.iosSite,
        store: a.m.siteStore,
      });
    } catch (e) {
      restoreError = e;
    }
    expect(restoreError).toMatchObject({ status: 409, code: 'purchase-other-account' });
    expect(restoreMessage(restoreError, true)).toMatchObject({ movable: true });

    // Move: confirm names the whole business, then the transfer
    (Alert.alert as jest.Mock).mockImplementation((_t: string, _m: string, buttons?: { text: string; onPress?: () => void }[]) => {
      buttons?.find((b) => b.text === 'Move here')?.onPress?.();
    });
    const onMoved = jest.fn();
    const mover = await a.probe(() => require('@/lib/useMoveSubscription').useMoveSubscription({ onMoved }));
    let result: any;
    await act(async () => {
      result = await mover.get().run();
    });
    expect(result).toMatchObject({ kind: 'moved' });
    expect(onMoved).toHaveBeenCalledTimes(1);
    expect(mover.get().error).toBeNull();
    const confirmText = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Move this subscription?')?.[1] as string;
    expect(confirmText).toContain('another account (o***@gmail.com)');
    expect(confirmText).toMatch(p.name === 'website' ? /subscription and your website/ : /subscription, your website, bookings and store/);
    expect(server.transfers).toEqual([{ from: uidA, to: uidB }]);

    // B now owns the tier ...
    expect(a.m.plan.getSharedPlan()).toMatchObject({ tier: p.name, purchaseAccount: 'self', active: true });
    if (p.name !== 'website') expectEntitlements(a, p);
    await expectTierAccess(a, p);
    // ... and the site: signing in again pulls A's former site into B (the row moved with the business)
    await a.m.auth.signOut();
    await a.m.auth.signIn(EMAIL_B, 'bea-password');
    expect(await a.site()).toMatchObject({ deployedUrl: 'https://fade-lab.aibarber.org', ownerUserId: uidB });
    // Restore finds it bound to B's purchase
    const restored = await a.m.account.restore({
      restorePurchases: async () => {},
      latestTransactionId: a.deps.latestTransactionId,
      iosSite: a.m.api.api.iosSite,
      store: a.m.siteStore,
    });
    expect(restored).toMatchObject({ site: { slug: 'fade-lab', ownerUserId: uidB }, active: true });

    // A is left empty and locked
    await a.m.auth.signOut();
    await drain();
    webAccounts.set(EMAIL, PW);
    await a.m.auth.signIn(EMAIL, PW);
    expect(a.sb.session?.user.id).toBe(uidA);
    expect(await a.site()).toBeNull();
    expect(db.some((r) => r.user_id === uidA)).toBe(false);
    expect(db.some((r) => r.owner_id === uidA)).toBe(false);
    const ta = await tabs(a);
    await ta.flush();
    expect(ta.bookings().entitled).toBe(false);
    expect(ta.store().entitled).toBe(false);
    await ta.unmount();
    // A cannot publish with the moved subscription: the server refuses and Move is offered back
    await a.m.siteStore.saveSite(draft({ draftId: 'draft-A2' }));
    const before = server.published.length;
    expect(await publish(a)).toMatchObject({ kind: 'blocked', movable: true });
    expect(server.published).toHaveLength(before);
  });

  // ---- 7 ------------------------------------------------------------------------------------------------
  describe('7. payment lapse', () => {
    it('locks every tier (hosting too), and paying again unlocks it and republishes the same site', async () => {
      const { world, uid } = await liveAccount(p);
      server.lapse();
      await world.superwallSync();
      expect(world.m.entitlements.getEntitlements()).toEqual({ known: true, hosting: false, bookings: false, store: false });
      expect(world.m.paywall.hasEntitlement()).toBe(false);
      const t = await tabs(world);
      await t.flush();
      expect(t.bookings()).toMatchObject({ status: 'ready', entitled: false, hosting: false, expired: false });
      expect(t.store()).toMatchObject({ status: 'ready', entitled: false });
      await t.unmount();
      expect(world.m.plan.getSharedPlan()).toMatchObject({ active: false });
      // Publish asks for payment again; a decline sends nothing
      const sent = server.published.length;
      world.sw.register = () => new Promise<void>(() => {});
      const close = world.willDecline();
      const declined = publish(world);
      await drain();
      close();
      expect(await declined).toEqual({ kind: 'declined' });
      expect(server.published).toHaveLength(sent);

      // pay again
      world.willBuy(p.product);
      expect(await publish(world)).toMatchObject({ kind: 'live', republished: true, url: 'https://fade-lab.aibarber.org' });
      await drain();
      await world.superwallSync();
      expect(world.sb.session?.user.id).toBe(uid);
      expect(await world.site()).toMatchObject({ slug: 'fade-lab', ownerUserId: uid });
      expect(server.published).toHaveLength(sent + 1);
      expect(world.m.plan.getSharedPlan()).toMatchObject({ tier: p.name, active: true, purchaseAccount: 'self' });
      expectEntitlements(world, p);
      await expectTierAccess(world, p);
    });

    it('the server answering 402 to a publish (phone still thinks it is paid): inactive, site kept, nothing live; paying again recovers', async () => {
      const { world } = await liveAccount(p);
      // refunded server-side; StoreKit on the phone has not caught up (still lists it as active)
      server.fail('/api/ios/publish', { kind: 'json', status: 402, body: { error: 'subscription-inactive' } });
      const sent = server.published.length;
      expect(await publish(world)).toEqual({ kind: 'inactive' });
      expect(server.published).toHaveLength(sent);
      expect(await world.site()).toMatchObject({ slug: 'fade-lab' });
      expect(await world.pending()).toBeNull(); // nothing locks the app to /claim
      expect(await require('@/lib/claimGuard').claimLocked()).toBe(false);
      server.lapse();
      await world.superwallSync();
      expect(world.m.entitlements.getEntitlements()).toMatchObject({ known: true, hosting: false, bookings: false, store: false });
      world.willBuy(p.product);
      expect(await publish(world)).toMatchObject({ kind: 'live', republished: true });
    });

    it('a 402 at the account step: the account is not made, the lock is parked, Publish asks to pay again', async () => {
      const world = await payToAccountStep(p);
      server.lapse(); // refunded / expired before the account was made
      const out = await claimRunner(world).submit('signup', FORM);
      expect(out).toMatchObject({ kind: 'inactive' });
      expect(await world.pending()).toBeNull();
      expect(await require('@/lib/claimGuard').claimLocked()).toBe(false);
      expect(world.sb.session).toBeNull();
      await world.superwallSync();
      world.willBuy(p.product);
      expect(await publish(world)).toEqual({ kind: 'claim-required' }); // pays again, then the account step
      expect(await world.pending()).toMatchObject({ state: 'unclaimed', transactionId: 'tx-2' });
    });
  });

  // ---- 8 ------------------------------------------------------------------------------------------------
  describe('8. offline during sign-up and sign-in', () => {
    it('sign up offline: the waiting banner, payment kept and still locked; Try again finishes it', async () => {
      const world = await payToAccountStep(p);
      server.fail('/api/ios/signup', { kind: 'offline' });
      const { WAITING_MESSAGE } = require('@/lib/claim');
      expect(await claimRunner(world).submit('signup', FORM)).toEqual({ kind: 'waiting', message: WAITING_MESSAGE, stage: 'account' });
      expect(world.sb.session).toBeNull();
      expect(await world.pending()).toMatchObject({ state: 'unclaimed' });
      expect(await require('@/lib/claimGuard').claimLocked()).toBe(true);
      expect(server.published).toHaveLength(0);
      // (a fresh runner: the screen keeps its own, but nothing in it is needed to retry a sign up that never reached the server)
      expect(await claimRunner(world).submit('signup', FORM)).toEqual({ kind: 'live' });
      expect(await world.pending()).toBeNull();
    });

    it('the account was created but sign-in is offline: waiting, and Try again only signs in (no second sign up, no 409)', async () => {
      const world = await payToAccountStep(p);
      const runner = claimRunner(world);
      signInFault = 'offline';
      const first = await runner.submit('signup', FORM);
      expect(first).toMatchObject({ kind: 'waiting', stage: 'account' });
      expect(server.count('/api/ios/signup')).toBe(1);
      expect(world.sb.session).toBeNull();
      expect(await require('@/lib/claimGuard').claimLocked()).toBe(true);
      signInFault = null;
      expect(await runner.submit('signup', FORM)).toEqual({ kind: 'live' });
      expect(server.count('/api/ios/signup')).toBe(1);
      expect(server.published).toHaveLength(1);
    });

    it('signed in but the publish request is offline for the whole wait: it retries by itself, then waits (publish stage), session kept; Try again goes live', async () => {
      const world = await payToAccountStep(p);
      const runner = claimRunner(world);
      server.fail('/api/ios/publish', { kind: 'offline' }, 500);
      expect(await runner.submit('signup', FORM)).toMatchObject({ kind: 'waiting', stage: 'publish' });
      // it kept trying by itself (2 s -> 10 s backoff over the 3 minute budget), never a manual tap
      expect(server.count('/api/ios/publish')).toBeGreaterThan(5);
      expect(world.sb.session?.user.id).toBe(idFor(EMAIL));
      expect(await require('@/lib/claimGuard').claimLocked()).toBe(true);
      (server as any).faults['/api/ios/publish'] = []; // back online
      expect(await runner.finish()).toEqual({ kind: 'live' });
      expect(await world.pending()).toBeNull();
      expect(server.count('/api/ios/signup')).toBe(1);
    });

    it('the connection comes back during the wait: no tap needed, it ends live and publishes once', async () => {
      const world = await payToAccountStep(p);
      const runner = claimRunner(world);
      server.fail('/api/ios/publish', { kind: 'offline' }, 2);
      expect(await runner.submit('signup', FORM)).toEqual({ kind: 'live' });
      expect(server.count('/api/ios/signup')).toBe(1);
      expect(server.published).toHaveLength(1);
      expect(await world.pending()).toBeNull();
    });

    it('a plain sign-in offline throws the connection sentence (no crash, nothing changed); online it works', async () => {
      const { world } = await liveAccount(p);
      await world.m.auth.signOut();
      await drain();
      signInFault = 'offline';
      await expect(world.m.auth.signIn(EMAIL, PW)).rejects.toThrow(world.m.auth.OFFLINE);
      expect(world.sb.session).toBeNull();
      expect(await world.site()).toBeNull();
      signInFault = null;
      await expect(world.m.auth.signIn(EMAIL, PW)).resolves.toBeUndefined();
      expect(await world.site()).toMatchObject({ deployedUrl: 'https://fade-lab.aibarber.org' });
    });

    it('signed in but the account lookup of the site fails: no crash, still signed in, and the next launch brings the site back', async () => {
      const { world, uid } = await liveAccount(p);
      await world.m.auth.signOut();
      await drain();
      world.sb.selectError = { message: 'Network request failed' };
      await expect(world.m.auth.signIn(EMAIL, PW)).resolves.toBeUndefined();
      expect(world.sb.session?.user.id).toBe(uid);
      expect(await world.site()).toBeNull();
      world.sb.selectError = null;
      expect(await freshLaunchRoute(world)).toBe('/edit');
      expect(await world.site()).toMatchObject({ deployedUrl: 'https://fade-lab.aibarber.org', ownerUserId: uid });
    });
  });

  // ---- 9 ------------------------------------------------------------------------------------------------
  it('9. Back from the account step goes to the editor; Publish skips the paywall and returns to the account step', async () => {
    const world = await payToAccountStep(p);
    const { claimLocked, pauseClaim } = require('@/lib/claimGuard');
    expect(await claimLocked()).toBe(true);
    expect(await freshLaunchRoute(world)).toBe('/claim');

    await pauseClaim(); // the Back button of the account step
    expect(await world.pending()).toMatchObject({ state: 'paused', transactionId: 'tx-1' });
    expect(await claimLocked()).toBe(false);
    expect(await freshLaunchRoute(world)).toBe('/edit'); // the editor, with the draft
    expect(await world.site()).toMatchObject({ draftId: 'draft-1' });
    // a kill in the editor stays in the editor
    const w2 = await relaunch();
    expect(await freshLaunchRoute(w2)).toBe('/edit');

    // Publish: no second payment, no publish without an account, straight back to the account step
    const boughtBefore = server.apple.length;
    expect(await publish(w2)).toEqual({ kind: 'claim-required' });
    expect(server.apple).toHaveLength(boughtBefore);
    expect(server.published).toHaveLength(0);
    expect(await w2.pending()).toMatchObject({ state: 'unclaimed', transactionId: 'tx-1' });
    expect(await require('@/lib/claimGuard').claimLocked()).toBe(true);

    // and the account step still completes it, for this tier
    if (p.name !== 'website') {
      db.push({ id: 'shop-1', owner_id: idFor(EMAIL), slug: 'fade-lab', name: 'Fade Lab', bookings_enabled: true, store_enabled: p.name === 'store', ios_otid: null });
    }
    expect(await claimRunner(w2).submit('signup', FORM)).toEqual({ kind: 'live' });
    await drain();
    await w2.superwallSync();
    expect(w2.m.plan.getSharedPlan()).toMatchObject({ tier: p.name, purchaseAccount: 'self' });
    expect(server.apple).toHaveLength(boughtBefore);
  });
});
