/**
 * State matrix, part 1: the account STATES a user can be in. Each state is one row of STATES; adding a state is one
 * entry. A state prepares the fake world (App Store, server, phone disk, Supabase rows) BEFORE the app boots; the app
 * then launches for real (harness boot: real Superwall sync, session, entitlements) and the screens are rendered on top.
 *
 * Everything is faked at the network edge only (global.fetch -> FakeServer, StoreKit/Superwall mocks, Supabase mock);
 * the hooks, stores and screens are the real ones.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { P, siteData as baseSiteData, draft as baseDraft, type FakeServer } from '../../__tests__/e2e/harness';
import { disk } from '../../__tests__/e2e/mocks';

export type Ctx = {
  server: FakeServer;
  /** public.sites + ab_shops rows (the Supabase mock's `rows`). */
  db: any[];
  /** Network switch: while true every request fails like a dead connection. */
  net: { offline: boolean };
};

export type StateDef = {
  id: string;
  title: string;
  /** The Supabase session the phone has at launch (null: signed out). */
  user: string | null;
  /** A paid publish waits for its account (pending record that locks the app to /claim): see ScreenDef.allowedWhenLocked. */
  claimLocked?: boolean;
  /** A site record is on the phone (the app opens on the Edit tab). Defaults to what prepare() wrote: set explicitly below. */
  hasSite: boolean;
  /** Prepares the world before launch. */
  prepare(c: Ctx): void;
  /** Plan endpoint answers slowly: held until `release()`, then success. The cell asserts the settled screen after the release. */
  slowPlan?: boolean;
};

export const UID = 'u-sam';
export const SITE_URL = 'https://fade-lab.aibarber.org';

/** The harness fixture plus the blocks the renderer requires (contact, hours, pages): the Edit tab renders it for real. */
const siteData = (over: Record<string, unknown> = {}) => {
  const { defaultPages } = require('@/lib/sitePages');
  return baseSiteData({
    template: 'luxe',
    contact: { address: '1 Main St, Brooklyn, NY', email: 'hi@example.com' },
    hours: [{ day: 'Mon', open: '09:00', close: '17:00' }, { day: 'Sun', open: '', close: '', closed: true }],
    pages: defaultPages(),
    ...over,
  });
};
const draft = () => ({ ...baseDraft(), data: siteData() });

const write = (key: string, v: unknown) => disk().set(key, JSON.stringify(v));

export type StartOption = 'booking' | 'google' | 'manual';

/** A site made on the phone (never published) by one of the three start options. */
export function savedDraft(option: StartOption) {
  const base = draft();
  if (option === 'booking') return base; // importedFrom: 'booking', has bookingUrl
  if (option === 'google') {
    return { ...base, inputs: { ...base.inputs, importedFrom: 'gbp', bookingUrl: undefined }, data: siteData({ importedFrom: 'gbp', bookingUrl: '' }) };
  }
  const { importedFrom: _i, bookingUrl: _b, ...inputs } = base.inputs;
  return { ...base, inputs: { ...inputs, bookingUrl: '' }, data: siteData({ bookingUrl: '' }) };
}

/** A published site that belongs to the signed-in account. */
export function publishedSite(tx: string | null) {
  return { ...draft(), slug: 'fade-lab', deployedUrl: SITE_URL, transactionId: tx, ownerUserId: UID, syncedAt: Date.now(), accountSyncedAt: Date.now(), updatedAt: Date.now() - 5 };
}

export const shopRow = (store: boolean, linked = true) => ({
  id: 'shop-1', owner_id: UID, slug: 'fade-lab', name: 'Fade Lab', timezone: 'America/New_York',
  bookings_enabled: true, store_enabled: store, ios_otid: linked ? 'tx-1' : null,
});

function signedInWithPlan(product: string, opts: { lapseMs?: number; shop?: 'bookings' | 'store' | null } = {}) {
  return (c: Ctx) => {
    const sub = c.server.buy(product);
    write('site.v1', publishedSite(sub.transactionId));
    c.server.purchaseOwner = UID;
    c.server.boundSiteId = 'fade-lab';
    c.server.sites.set('fade-lab', { siteId: 'fade-lab', deployedUrl: SITE_URL, siteData: siteData(), version: 1, editedBy: 'owner', editedAt: '' });
    if (opts.shop) c.db.push({ ...shopRow(opts.shop === 'store'), ios_otid: sub.transactionId });
    c.db.push({ id: 'fade-lab', user_id: UID, deployed_url: SITE_URL, site_data: siteData(), updated_at: new Date().toISOString() });
    if (opts.lapseMs != null) c.server.lapse(opts.lapseMs);
  };
}

const DAY = 24 * 60 * 60 * 1000;

export const STATES: StateDef[] = [
  { id: 'S1', hasSite: false, title: 'fresh install: no site, signed out, unpaid', user: null, prepare: () => {} },
  { id: 'S2a', hasSite: true, title: 'site from a booking link, signed out, unpaid', user: null, prepare: () => write('site.v1', savedDraft('booking')) },
  { id: 'S2b', hasSite: true, title: 'site from a Google listing, signed out, unpaid', user: null, prepare: () => write('site.v1', savedDraft('google')) },
  { id: 'S2c', hasSite: true, title: 'site from scratch (typed), signed out, unpaid', user: null, prepare: () => write('site.v1', savedDraft('manual')) },
  {
    id: 'S3', hasSite: true, claimLocked: true, title: 'paid, account step not done (pending record, no session)', user: null,
    prepare: (c) => {
      const sub = c.server.buy(P.websiteMonthly);
      write('site.v1', savedDraft('booking'));
      write('pendingPublish.v1', { transactionId: sub.transactionId, data: siteData(), createdAt: Date.now(), state: 'unclaimed', target: { draftId: 'draft-1' } });
    },
  },
  { id: 'S4', hasSite: true, title: 'paid + account, Website plan', user: UID, prepare: signedInWithPlan(P.websiteMonthly) },
  { id: 'S5', hasSite: true, title: 'paid + account, Bookings plan', user: UID, prepare: signedInWithPlan(P.bookingsMonthly, { shop: 'bookings' }) },
  { id: 'S6', hasSite: true, title: 'paid + account, Store plan', user: UID, prepare: signedInWithPlan(P.storeMonthly, { shop: 'store' }) },
  {
    id: 'S7', hasSite: true, title: 'paid on this Apple ID, but the purchase belongs to another account', user: 'u-bea',
    prepare: (c) => {
      const sub = c.server.buy(P.bookingsMonthly);
      c.server.purchaseOwner = UID; // someone else owns it
      write('site.v1', { ...savedDraft('booking'), ownerUserId: 'u-bea' });
      void sub;
    },
  },
  {
    id: 'S7b', hasSite: true, claimLocked: true, title: 'paid, the server refused the publish: purchase belongs to another account (conflict record)', user: 'u-bea',
    prepare: (c) => {
      const sub = c.server.buy(P.bookingsMonthly);
      c.server.purchaseOwner = UID;
      write('site.v1', savedDraft('booking'));
      write('pendingPublish.v1', {
        transactionId: sub.transactionId, data: siteData(), createdAt: Date.now(), state: 'conflict', target: { draftId: 'draft-1' },
        conflict: { code: 'purchase-other-account', hint: 'o***@gmail.com' },
      });
    },
  },
  { id: 'S8a', hasSite: true, title: 'lapsed Bookings plan, ended 2 hours ago (read-only window)', user: UID, prepare: (c) => signedInWithPlan(P.bookingsMonthly, { shop: 'bookings', lapseMs: 2 * 3600_000 })(c) },
  { id: 'S8b', hasSite: true, title: 'lapsed Bookings plan, ended 45 days ago', user: UID, prepare: (c) => signedInWithPlan(P.bookingsMonthly, { shop: 'bookings', lapseMs: 45 * DAY })(c) },
  { id: 'S8c', hasSite: true, title: 'lapsed Website plan, ended 45 days ago', user: UID, prepare: (c) => signedInWithPlan(P.websiteMonthly, { lapseMs: 45 * DAY })(c) },
  {
    id: 'S9a', hasSite: true, title: 'offline at launch, never paid, signed out', user: null,
    prepare: (c) => { c.net.offline = true; write('site.v1', savedDraft('booking')); },
  },
  {
    id: 'S9b', hasSite: true, title: 'offline at launch, Store plan, signed in', user: UID,
    prepare: (c) => { signedInWithPlan(P.storeMonthly, { shop: 'store' })(c); c.net.offline = true; },
  },
  { id: 'S9c', hasSite: false, title: 'offline at launch, fresh install (no site, signed out)', user: null, prepare: (c) => { c.net.offline = true; } },
  {
    id: 'S9d', hasSite: true, claimLocked: true, title: 'paid, account exists but the publish is unconfirmed (claiming), offline', user: UID,
    prepare: (c) => {
      const sub = c.server.buy(P.websiteMonthly);
      write('site.v1', savedDraft('booking'));
      write('pendingPublish.v1', { transactionId: sub.transactionId, data: siteData(), createdAt: Date.now(), state: 'claiming', target: { draftId: 'draft-1' } });
      c.net.offline = true;
    },
  },
  {
    id: 'S10', hasSite: true, title: 'signed in, plan endpoint answers 404 no-shop', user: UID,
    prepare: (c) => {
      write('site.v1', { ...savedDraft('manual'), ownerUserId: UID });
      c.server.fail('/api/shop/plan', { kind: 'json', status: 404, body: { error: 'no-shop' } }, 50);
    },
  },
  {
    id: 'S11', hasSite: true, title: 'signed in, Bookings plan, plan endpoint answers 401', user: UID,
    prepare: (c) => {
      signedInWithPlan(P.bookingsMonthly, { shop: 'bookings' })(c);
      c.server.fail('/api/shop/plan', { kind: 'json', status: 401, body: { error: 'unauthorized' } }, 50);
    },
  },
  { id: 'S12', hasSite: true, title: 'signed in, Bookings plan, plan endpoint slow then success', user: UID, prepare: signedInWithPlan(P.bookingsMonthly, { shop: 'bookings' }), slowPlan: true },
];

/**
 * The shared Supabase mock answers only `select().eq().maybeSingle()` on `ab_shops` / `sites`. Every other table
 * (members, services, appointments, time off, products, orders, customers...) answers an empty list, like a shop with
 * nothing in it yet, so the screens behind a plan can render their real empty state instead of a mock error.
 */
export function installEmptyTables(supabase: any, sb: any, net: { offline: boolean }): void {
  if (net.offline) sb.selectError = { message: 'Network request failed' }; // Supabase is just as unreachable as the API
  const real = supabase.from;
  supabase.from = (table: string) => {
    if (table === 'ab_shops' || table === 'sites') return real(table);
    const chain: any = new Proxy(() => {}, {
      get(_t, prop) {
        const error = net.offline ? { message: 'Network request failed' } : null;
        if (prop === 'then') return (res: (v: unknown) => unknown) => Promise.resolve({ data: error ? null : [], error, count: 0 }).then(res);
        if (prop === 'maybeSingle' || prop === 'single') return async () => ({ data: null, error });
        return () => chain;
      },
    });
    return chain;
  };
}
