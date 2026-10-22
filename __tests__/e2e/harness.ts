/**
 * The e2e world: a fake AI Barber backend behind global.fetch (so the real
 * api.ts / ownerApi.ts parsing runs), a fake App Store account (the Apple ID's
 * subscriptions, which Superwall and the server both read), Supabase (the
 * shared mock: session and ab_shops rows) and the phone's disk (mocks.ts).
 *
 * `boot()` launches the app: fresh module state, the real usePublishDeps /
 * usePaywall / SubscriptionSync rendered in a harness. `kill()` drops every
 * in-memory thing and boots again on the same disk and session.
 *
 * Product -> entitlements here is the cumulative mapping the plans are sold
 * with (Superwall dashboard): Website = hosting; Bookings = hosting+bookings;
 * Store = hosting+bookings+store.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import type React from 'react';
import { disk } from './mocks';

export const P = {
  websiteMonthly: 'com.ibrahim1774.aibarber.hosting.monthly',
  websiteYearly: 'com.ibrahim1774.aibarber.hosting.yearly',
  bookingsMonthly: 'com.ibrahim1774.aibarber.bookings.monthly',
  bookingsYearly: 'com.ibrahim1774.aibarber.bookings.yearly',
  storeMonthly: 'com.ibrahim1774.aibarber.store.monthly',
  storeYearly: 'com.ibrahim1774.aibarber.store.yearly',
} as const;
export type ProductId = (typeof P)[keyof typeof P];

export const DOMAIN_PRODUCT = 'com.ibrahim1774.aibarber.domain.yearly';
export const isDomainProduct = (productId: string): boolean => productId === DOMAIN_PRODUCT;

export function entsFor(productId: string): ('hosting' | 'bookings' | 'store')[] {
  if (productId.includes('.store.')) return ['hosting', 'bookings', 'store'];
  if (productId.includes('.bookings.')) return ['hosting', 'bookings'];
  if (productId.includes('.hosting.')) return ['hosting'];
  return [];
}
export function tierFor(productId: string): 'website' | 'bookings' | 'store' | null {
  const e = entsFor(productId);
  return e.includes('store') ? 'store' : e.includes('bookings') ? 'bookings' : e.includes('hosting') ? 'website' : null;
}

export type AppleSub = {
  transactionId: string;
  productId: string;
  purchaseDate: string;
  isActive: boolean;
  isRevoked: boolean;
  expirationDate: string | null;
};

export type Fault =
  | { kind: 'offline' }
  /** Never answers until the request's AbortController fires. */
  | { kind: 'hang' }
  /** Never answers at all: the process is about to be killed. */
  | { kind: 'dead' }
  /** The server does the work now, but the answer reaches the phone only when `release` resolves. */
  | { kind: 'held'; release: Promise<void> }
  | { kind: 'html'; status: number }
  | { kind: 'json'; status: number; body: unknown };

export type ServerSiteRow = {
  siteId: string;
  deployedUrl: string;
  siteData: any;
  version: number;
  editedBy: 'owner' | 'admin';
  editedAt: string;
};

const T0 = Date.parse('2026-10-01T12:00:00Z');

/** The fake backend + the fake Apple ID. One per test. */
export class FakeServer {
  apple: AppleSub[] = [];
  /** Superwall's status: derived from `apple` unless pinned (e.g. UNKNOWN while it never configures). */
  pinnedStatus: 'UNKNOWN' | null = null;
  /** One subscription group per Apple ID: every purchase shares this original transaction, so the server binds one site. */
  boundSiteId: string | null = null;
  sites = new Map<string, ServerSiteRow>();
  faults: Record<string, Fault[]> = {};
  lastQuery = '';
  /** Run once, just before the next request to a path is handled (e.g. an admin edit landing mid-publish). */
  before: Record<string, (() => void)[]> = {};
  calls: { path: string; method: string; body: any }[] = [];
  /** Every siteData the server accepted, in order. */
  published: any[] = [];
  /** The 409 carries the server copy (true) or only the error code (false). */
  conflictBody = true;
  sb: any = null;
  private n = 0;

  // ---- the Apple ID -------------------------------------------------------

  /** A purchase (also an immediate upgrade within the group): the old one ends, the new one is active. */
  buy(productId: string, opts: { revokeOld?: boolean } = {}): AppleSub {
    this.n++;
    // The domain is its own subscription group: buying it never ends a plan, and the reverse.
    const group = isDomainProduct(productId);
    for (const s of this.apple) {
      if (s.isActive && isDomainProduct(s.productId) === group) {
        s.isActive = false;
        s.expirationDate = new Date(T0 + this.n * 60_000).toISOString();
        if (opts.revokeOld) s.isRevoked = true;
      }
    }
    const sub: AppleSub = {
      transactionId: `tx-${this.n}`,
      productId,
      purchaseDate: new Date(T0 + this.n * 60_000).toISOString(),
      isActive: true,
      isRevoked: false,
      expirationDate: null,
    };
    this.apple.push(sub);
    return sub;
  }

  /** A downgrade (or a plan change) that Apple applies at the renewal: a new transaction in the same group. */
  renewTo(productId: string): AppleSub {
    return this.buy(productId);
  }

  /** The subscription ended `agoMs` ago (no renewal). */
  lapse(agoMs = 2 * 60 * 60 * 1000): void {
    for (const s of this.apple) {
      if (s.isActive && !isDomainProduct(s.productId)) {
        s.isActive = false;
        s.expirationDate = new Date(Date.now() - agoMs).toISOString();
      }
    }
  }

  /** The active plan subscription (the domain one is separate: activeDomainSub). */
  activeSub(): AppleSub | null {
    const act = this.apple.filter((s) => s.isActive && !s.isRevoked && !isDomainProduct(s.productId));
    return act.sort((a, b) => Date.parse(b.purchaseDate) - Date.parse(a.purchaseDate))[0] ?? null;
  }

  superwallStatus(): { status: 'ACTIVE' | 'INACTIVE' | 'UNKNOWN'; ents: string[] } {
    if (this.pinnedStatus) return { status: this.pinnedStatus, ents: [] };
    const a = this.activeSub();
    const d = this.activeDomainSub() ? ['domain'] : [];
    if (a || d.length) return { status: 'ACTIVE', ents: [...(a ? entsFor(a.productId) : []), ...d] };
    return { status: 'INACTIVE', ents: [] };
  }

  activeDomainSub(): AppleSub | null {
    return this.apple.filter((s) => s.isActive && !s.isRevoked && isDomainProduct(s.productId)).at(-1) ?? null;
  }

  // ---- custom domains (/api/ios/domain/*, shapes from the server report) ----
  /** Names the registrar says are taken (search) or that get taken between search and claim (claimTaken). */
  domainTaken = new Set<string>();
  domainClaimTaken = new Set<string>();
  /** Per domain-subscription tx: the claimed name and the states status will walk through, one per read. */
  domains = new Map<string, { domain: string; states: any[] }>();
  /** The states a successful claim walks: first answer is the claim's own (202). */
  domainScript: any[] = [
    { state: 'registering' },
    { state: 'linking' },
    { state: 'live', vercel: { verified: true, dnsOk: true, ssl: 'pending' } },
    { state: 'live', url: '', vercel: { verified: true, dnsOk: true, ssl: 'ready' } },
  ];
  /** A forced claim answer (status code + body) for the next claim. */
  nextClaim: { status: number; body: any } | null = null;

  // ---- admin --------------------------------------------------------------

  /** AI Barber support edits the site from the admin dashboard. */
  adminEdit(change: (d: any) => any): ServerSiteRow {
    const row = this.sites.get(this.boundSiteId!)!;
    row.siteData = change(JSON.parse(JSON.stringify(row.siteData)));
    row.version++;
    row.editedBy = 'admin';
    row.editedAt = new Date().toISOString();
    return row;
  }

  // ---- faults -------------------------------------------------------------

  fail(path: string, fault: Fault, times = 1): void {
    (this.faults[path] ??= []).push(...Array.from({ length: times }, () => fault));
  }

  count(path: string): number {
    return this.calls.filter((c) => c.path === path).length;
  }

  // ---- fetch ----------------------------------------------------------------

  async handle(url: string, init: { method?: string; body?: string; signal?: AbortSignal; headers?: Record<string, string> } = {}) {
    const u = new URL(url);
    const path = u.pathname;
    this.lastQuery = u.search;
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    this.calls.push({ path, method, body });
    this.before[path]?.shift()?.();
    const fault = this.faults[path]?.shift();
    if (fault) {
      if (fault.kind === 'offline') throw new TypeError('Network request failed');
      if (fault.kind === 'dead') return new Promise<never>(() => {});
      if (fault.kind === 'hang') {
        return new Promise<never>((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
        });
      }
      if (fault.kind === 'held') {
        const out = this.route(path, method, body, init.headers ?? {});
        await fault.release;
        return resp(out.status, JSON.stringify(out.body));
      }
      if (fault.kind === 'html') return resp(fault.status, '<!DOCTYPE html><html><body><h1>504 Gateway Timeout</h1></body></html>');
      return resp(fault.status, JSON.stringify(fault.body));
    }
    const out = this.route(path, method, body, init.headers ?? {});
    return resp(out.status, JSON.stringify(out.body));
  }

  private route(path: string, method: string, body: any, headers: Record<string, string>): { status: number; body: unknown } {
    const sub = (tx: string) => this.apple.find((s) => s.transactionId === tx) ?? null;
    switch (path) {
      case '/api/ios/publish': {
        const s = sub(body.transactionId);
        if (!s || !s.isActive || s.isRevoked) return { status: 402, body: { error: 'subscription-inactive' } };
        const existed = this.boundSiteId != null && this.sites.has(this.boundSiteId);
        if (!existed) {
          const slug = String(body.siteData?.shopName ?? 'shop').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'shop';
          this.boundSiteId = slug;
          this.sites.set(slug, {
            siteId: slug, deployedUrl: `https://${slug}.aibarber.org`, siteData: null, version: 0, editedBy: 'owner', editedAt: '',
          });
        }
        const row = this.sites.get(this.boundSiteId!)!;
        if (existed && typeof body.baseVersion === 'number' && row.editedBy === 'admin' && row.version > body.baseVersion) {
          return {
            status: 409,
            body: this.conflictBody ? { error: 'site-updated', site: this.copy(row) } : { error: 'site-updated' },
          };
        }
        row.siteData = body.siteData;
        row.version++;
        row.editedBy = 'owner';
        row.editedAt = new Date().toISOString();
        this.published.push(body.siteData);
        return {
          status: 200,
          body: {
            siteId: row.siteId, deployedUrl: row.deployedUrl, republished: existed,
            version: row.version, editedBy: row.editedBy, editedAt: row.editedAt,
          },
        };
      }
      case '/api/ios/domain/search': {
        const label = String(body?.q ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (label.length < 3) return { status: 400, body: { error: 'invalid', field: 'q' } };
        const names = [label, `${label}barber`, `${label}barbershop`, `the${label}`, `${label}cuts`, `${label}studio`];
        return {
          status: 200,
          body: { results: names.map((n) => ({ domain: `${n}.com`, available: !this.domainTaken.has(`${n}.com`), eligible: !this.domainTaken.has(`${n}.com`) })) },
        };
      }
      case '/api/ios/domain/claim': {
        if (this.nextClaim) {
          const f = this.nextClaim;
          this.nextClaim = null;
          return f;
        }
        const d = sub(body.transactionId);
        if (!d || !isDomainProduct(d.productId)) return { status: 400, body: { error: 'bad-product' } };
        if (!d.isActive) return { status: 402, body: { error: 'subscription-inactive' } };
        const site = sub(body.siteTransactionId);
        if (!site || isDomainProduct(site.productId)) return { status: 400, body: { error: 'bad-product' } };
        const cur = this.domains.get(body.transactionId);
        if (cur && cur.domain !== body.domain && !String(cur.states[0]?.state).startsWith('failed:')) {
          return { status: 409, body: { error: 'slot-in-use', domain: cur.domain, ...cur.states[0] } };
        }
        if (this.domainTaken.has(body.domain)) return { status: 409, body: { error: 'domain-taken' } };
        if (this.domainClaimTaken.has(body.domain)) {
          const failed = { state: 'failed:taken', canRetry: true };
          this.domains.set(body.transactionId, { domain: body.domain, states: [failed] });
          return { status: 409, body: { error: 'claim-failed', domain: body.domain, ...failed } };
        }
        const states = this.domainScript.map((x) => ({ ...x, ...(x.url === '' ? { url: `https://${body.domain}` } : {}) }));
        this.domains.set(body.transactionId, { domain: body.domain, states });
        const first = states[0];
        return { status: first.state === 'live' ? 200 : 202, body: { domain: body.domain, ...first } };
      }
      case '/api/ios/domain/status': {
        const tx = body?.transactionId ?? new URLSearchParams(this.lastQuery).get('transactionId');
        const d = sub(tx);
        if (!d || !isDomainProduct(d.productId)) return { status: 404, body: { error: 'not-found' } };
        const row = this.domains.get(tx);
        if (!row) return { status: 200, body: { domain: null, state: 'none' } };
        if (row.states.length > 1) row.states.shift();
        return { status: 200, body: { domain: row.domain, ...row.states[0] } };
      }
      case '/api/ios/site': {
        const s = sub(body.transactionId);
        if (!s || !this.boundSiteId) return { status: 404, body: { error: 'no-site' } };
        const row = this.sites.get(this.boundSiteId)!;
        return { status: 200, body: { ...this.copy(row), active: s.isActive && !s.isRevoked } };
      }
      case '/api/shop/plan': {
        if (!headers.Authorization) return { status: 401, body: { error: 'unauthorized' } };
        if (method === 'POST' && body?.transactionId) {
          const s = sub(body.transactionId);
          const shop = this.shopRow();
          if (s?.isActive && shop) shop.ios_otid = s.transactionId;
        }
        return { status: 200, body: this.plan() };
      }
      case '/api/shop/setup': {
        if (!headers.Authorization) return { status: 401, body: { error: 'unauthorized' } };
        let shop = this.shopRow();
        if (!shop) {
          shop = { id: 'shop-1', owner_id: this.sb.session.user.id, slug: 'fade-lab', name: body.name, bookings_enabled: false, store_enabled: false, ios_otid: null };
          this.sb.rows.push(shop);
        }
        if (body.transactionId && sub(body.transactionId)?.isActive) shop.ios_otid = body.transactionId;
        return { status: 200, body: { shop: { id: shop.id, slug: shop.slug } } };
      }
      default:
        return { status: 404, body: { error: 'not-found' } };
    }
  }

  copy(row: ServerSiteRow) {
    return {
      siteId: row.siteId, deployedUrl: row.deployedUrl, siteData: row.siteData,
      version: row.version, editedBy: row.editedBy, editedAt: row.editedAt,
    };
  }

  shopRow(): any | null {
    return this.sb?.rows.find((r: any) => r.owner_id && r.owner_id === this.sb.session?.user?.id) ?? null;
  }

  plan() {
    const a = this.activeSub();
    const e = entsFor(a?.productId ?? '');
    const last = [...this.apple].sort((x, y) => Date.parse(y.purchaseDate) - Date.parse(x.purchaseDate))[0];
    return {
      linked: !!this.shopRow()?.ios_otid,
      tier: tierFor(a?.productId ?? ''),
      entitlements: { hosting: e.includes('hosting'), bookings: e.includes('bookings'), store: e.includes('store') },
      active: !!a,
      expiresAt: a ? null : last?.expirationDate ?? null,
      takenDownAt: null,
      revoked: !!last?.isRevoked,
    };
  }
}

function resp(status: number, text: string) {
  return { status, ok: status >= 200 && status < 300, text: async () => text };
}

export function installFetch(server: FakeServer): void {
  (globalThis as any).fetch = (url: string, init: any) => server.handle(url, init);
}

// ---- the app --------------------------------------------------------------

export type World = Awaited<ReturnType<typeof boot>>;

/**
 * Launches the app on the current disk. `user`: the Supabase session the
 * phone has (null: signed out).
 */
export async function boot(server: FakeServer, opts: { user?: string | null } = {}) {
  process.env.EXPO_PUBLIC_SUPERWALL_API_KEY = 'pk_test';
  const ReactM: typeof React = require('react');
  const { act, create } = require('react-test-renderer');
  const { sw } = require('expo-superwall');
  const { sb } = require('@/lib/supabase');
  const m = {
    siteStore: require('@/lib/siteStore') as typeof import('@/lib/siteStore'),
    publish: require('@/lib/publish') as typeof import('@/lib/publish'),
    adminSync: require('@/lib/adminSync') as typeof import('@/lib/adminSync'),
    paywall: require('@/lib/paywall') as typeof import('@/lib/paywall'),
    entitlements: require('@/lib/entitlements') as typeof import('@/lib/entitlements'),
    plan: require('@/lib/plan') as typeof import('@/lib/plan'),
    linkContext: require('@/lib/linkContext') as typeof import('@/lib/linkContext'),
    bookingChoice: require('@/lib/bookingChoice') as typeof import('@/lib/bookingChoice'),
    account: require('@/lib/account') as typeof import('@/lib/account'),
    auth: require('@/lib/auth') as typeof import('@/lib/auth'),
    tierAccess: require('@/lib/tierAccess') as typeof import('@/lib/tierAccess'),
    subscriptionStatus: require('@/lib/subscriptionStatus') as typeof import('@/lib/subscriptionStatus'),
    siteSync: require('@/lib/setup/siteSync') as typeof import('@/lib/setup/siteSync'),
    api: require('@/lib/api') as typeof import('@/lib/api'),
  };
  server.sb = sb;
  sb.reset();
  sw.reset();
  sw.subscriptions = server.apple; // the same Apple ID, read live
  const sws = server.superwallStatus();
  sw.status = sws.status;
  sw.ents = sws.ents;
  if (opts.user) sb.setSession({ access_token: `tok-${opts.user}`, user: { id: opts.user } });

  let deps!: import('@/lib/publish').PublishDeps;
  let show!: (p: 'publish' | 'bookings_upgrade' | 'store_upgrade') => Promise<'purchased' | 'restored' | 'declined'>;
  let restore!: () => Promise<any>;
  let n = 0;
  function Harness(_: { n: number }) {
    deps = m.paywall.usePublishDeps();
    show = m.paywall.usePaywall();
    restore = m.paywall.useRestorePurchases();
    return ReactM.createElement(m.paywall.SubscriptionSync);
  }
  let tree: any;
  await act(async () => {
    tree = create(ReactM.createElement(Harness, { n }));
  });

  const world = {
    server, sw, sb, m, act, user: opts.user ?? null,
    get deps() {
      return deps;
    },
    show: (p: 'publish' | 'bookings_upgrade' | 'store_upgrade') => show(p),
    restore: () => restore(),
    /** Superwall noticed the Apple ID changed (a purchase, renewal or expiry): re-render SubscriptionSync. */
    async superwallSync() {
      const s = server.superwallStatus();
      sw.status = s.status;
      sw.ents = s.ents;
      await act(async () => {
        tree.update(ReactM.createElement(Harness, { n: ++n }));
      });
    },
    /**
     * The paywall for the next placement buys `productId` (Superwall's mirror
     * updates as soon as StoreKit reports it, before the paywall settles).
     */
    willBuy(productId: string, opts2: { onRegister?: () => void } = {}) {
      sw.register = async () => {
        sw.callbacks.onPresent?.({});
        server.buy(productId);
        const s = server.superwallStatus();
        sw.status = s.status;
        sw.ents = s.ents;
        m.entitlements.setEntitlementsFromStatus({ status: s.status, entitlements: s.ents.map((id) => ({ id })) });
        opts2.onRegister?.();
      };
    },
    /** The paywall for the next placement is closed without buying. */
    willDecline() {
      sw.register = () => new Promise<void>(() => {});
      const presentThenClose = () => {
        sw.callbacks.onPresent?.({});
        sw.callbacks.onDismiss?.({ closeReason: 'manualClose' }, { type: 'declined' });
      };
      return presentThenClose;
    },
    /** Renders an element (a screen) in its own tree with this launch's React. */
    async render(el: React.ReactElement) {
      let t: any;
      await act(async () => {
        t = create(el);
      });
      return t;
    },
    /** Renders `useHook` in its own tree; `get()` is its latest value. Throws if the render throws. */
    async probe<T>(useHook: () => T) {
      let value: T;
      let err: unknown = null;
      function Probe() {
        try {
          value = useHook();
        } catch (e) {
          err = e;
          throw e;
        }
        return null;
      }
      let t: any;
      await act(async () => {
        t = create(ReactM.createElement(Probe));
      });
      return {
        get: () => value,
        error: () => err,
        async flush() {
          await act(async () => {
            await new Promise((r) => setTimeout(r, 10));
          });
        },
        unmount: () => act(() => t.unmount()),
      };
    },
    async site() {
      return m.siteStore.loadSite();
    },
    async pending() {
      return m.siteStore.loadPendingPublish();
    },
    unmount() {
      act(() => tree.unmount());
    },
  };
  return world;
}

/** Force-quit and relaunch: in-flight work is abandoned, the disk and the session stay. */
export async function kill(w: World): Promise<World> {
  try {
    w.unmount();
  } catch {
    // already gone
  }
  jest.resetModules();
  return boot(w.server, { user: w.user });
}

/** Snapshot of the phone's disk (for "the disk did not change" checks). */
export function diskSnapshot(): Record<string, string> {
  return Object.fromEntries(disk().entries());
}

// ---- site fixtures --------------------------------------------------------

export const BOOKSY = 'https://booksy.com/en-us/123_fade-lab';

export function siteData(over: Record<string, unknown> = {}): any {
  return {
    shopName: 'Fade Lab',
    area: 'Brooklyn, NY',
    phone: '(555) 010-2030',
    bookingUrl: BOOKSY,
    hero: { heading: 'Sharp cuts', tagline: 'Since 2019', imageUrl: 'https://cdn.example/h.jpg' },
    about: { heading: 'About', description: ['We cut hair.'], imageUrl: '' },
    services: [{ title: 'Cut', price: '$30', description: 'Classic', imageUrl: '' }],
    gallery: ['https://cdn.example/g0.jpg'],
    ...over,
  };
}

/** A freshly imported draft (from a Booksy link), never published. */
export function draft(over: Record<string, unknown> = {}): any {
  return {
    draftId: 'draft-1',
    inputs: { shopName: 'Fade Lab', area: 'Brooklyn, NY', phone: '(555) 010-2030', bookingUrl: BOOKSY, importedFrom: 'booking' },
    data: siteData(),
    updatedAt: Date.now(),
    slug: null,
    deployedUrl: null,
    transactionId: null,
    ...over,
  };
}
