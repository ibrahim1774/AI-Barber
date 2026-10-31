// One in-process AI Barber backend for the e2e scenarios. Real code everywhere except the
// external boundaries: GCS (gcs.ts, via vi.mock in the test file), Vercel deploys (vercel.ts, via
// vi.mock), the network (net.ts: fake Stripe, fake *.vercel.app, everything else blocked), the
// App Store (apple.ts behind the real makeVerifier) and Supabase (purchasesDb.ts behind the real
// supabasePurchases repo; the bookings/store fake repos for the shop tables, with their gates
// reading the SAME ios_purchases rows, so an Apple event reaches the 423 gates).
//
// Test files must declare, before importing this module:
//   vi.mock('@google-cloud/storage', async () => (await import('./harness/gcs.js')).storageModule);
//   vi.mock('../../lib/deploySite.js', async () => (await import('./harness/vercel.js')).deploySiteModule);
import { vi } from 'vitest';
import { runIosPublish, runIosSiteLookup, type PublishDeps } from '../../../lib/ios/publishFlow.js';
import { supabasePurchases, type PurchaseRow } from '../../../lib/ios/purchases.js';
import { makeIsTaken, urlServes, vercelProjectExists } from '../../../lib/ios/slug.js';
import { handleAppleNotification } from '../../../lib/ios/notifications.js';
import { makeStripPending, sweepIos } from '../../../lib/ios/sweep.js';
import { offlineHtml } from '../../../lib/ios/offlinePage.js';
import { getPlan, refreshPlan, type PlanDeps } from '../../../lib/ios/planFlow.js';
import { publishSite, readPendingSite, readPendingVersioned, renderPending, slugify, writePendingSite } from '../../../lib/publishSite.js';
import { deployRenderedSite } from '../../../lib/deploySite.js';
import { gcsSiteStore } from '../../../lib/admin/live.js';
import type { AdminSitesDeps, AuditEvent } from '../../../lib/admin/sites.js';
import { makeAdminSitesHandler } from '../../../api/admin/sites.js';
import { memoryStore } from '../../../lib/bookings/rateLimit.js';
import type { PurchaseGateRow } from '../../../lib/bookings/repo.js';
import type { WebsiteData } from '../../../types.js';
import { fakeApple, BUNDLE } from './apple.js';
import { purchasesDb } from './purchasesDb.js';
import { resetGcs } from './gcs.js';
import { resetVercel } from './vercel.js';
import { resetSubpages } from './subpages.js';
import { resetStripe } from './stripe.js';
import { installNetwork } from './net.js';

export const NOW = Date.parse('2026-11-02T12:00:00Z');
export const DAY = 86_400_000;
export const ADMIN = 'ibrahim3709@gmail.com';
/** Two Supabase accounts (app users). */
export const USER_A = '3f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f';
export const USER_B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

export function siteData(over: Partial<WebsiteData> = {}): WebsiteData {
  return {
    shopName: 'Fade Lab',
    area: 'Austin',
    phone: '555-0100',
    template: 'luxe',
    hero: { heading: 'Sharp cuts', tagline: 'Since 2010', imageUrl: 'https://img.example/hero.jpg' },
    about: { heading: 'About', description: ['We cut hair.'], imageUrl: 'https://img.example/about.jpg' },
    services: [{ title: 'Fade', subtitle: '', description: 'A fade', icon: 'scissors', imageUrl: '', price: '$30' }],
    gallery: ['https://img.example/g0.jpg', ''],
    craftImages: ['https://img.example/c0.jpg'],
    staff: [{ name: 'Sam', photo: 'https://img.example/s0.jpg' }] as any,
    contact: { address: '1 Main St', email: 'fade@example.com' },
    ...over,
  } as WebsiteData;
}

export const AI_BOOK = 'https://www.aibarber.org/book/fade-lab';
export const AI_SHOP = 'https://www.aibarber.org/shop/fade-lab';
export const BOOKSY = 'https://booksy.com/en-us/123_fade-lab';

/** A clock that moves forward on every read (1 ms), so no two writes share a timestamp. */
export function makeClock(start = NOW) {
  let t = start;
  return { now: () => t++, peek: () => t, advance: (ms: number) => { t += ms; }, set: (ms: number) => { t = ms; } };
}

/** Reset every fake boundary and stub the network. Call in beforeEach. */
export function resetBoundaries() {
  resetGcs();
  resetVercel();
  resetSubpages();
  resetStripe();
  installNetwork();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

export function siteWorld() {
  const clock = makeClock();
  const apple = fakeApple(clock.now);
  const db = purchasesDb();
  const repo = supabasePurchases(db.client);
  const audits: AuditEvent[] = [];
  const emails = new Map<string, string>();
  const shopOwners = new Map<string, string>();

  const publishDeps: PublishDeps = {
    verify: (id) => apple.verify(id),
    repo,
    isTaken: makeIsTaken({
      pendingExists: async (s) => (await readPendingSite(s)) !== null,
      repoTaken: (s) => repo.slugTaken(s),
      projectExists: vercelProjectExists,
      urlServes,
    }),
    writePending: writePendingSite,
    publish: (slug, opts) => publishSite(slug, opts),
    readPending: readPendingSite,
    readPendingVersioned,
    // Supabase auth for the publish bearer (I6): jwt-a / jwt-b are two app accounts.
    userOf: async (t) => (({ 'jwt-a': { id: USER_A }, 'jwt-b': { id: USER_B } }) as Record<string, { id: string }>)[t] ?? null,
    emailOf: async (id) => emails.get(id) ?? null,
    // Legacy (unlinked) purchases: who owns the shop/site bound to the otid. Tests set `shopOwners`.
    bindingOwner: async (row) => shopOwners.get(row.original_transaction_id) ?? null,
    now: clock.now,
  };

  const adminDeps = (over: Partial<AdminSitesDeps> = {}): AdminSitesDeps => ({
    listBound: async () => [...db.rows.values()].filter((r) => r.site_slug).map((r) => ({ ...r }) as PurchaseRow),
    findBySlug: (slug) => repo.findBySlug(slugify(slug)),
    emailsByUserId: async () => new Map(emails),
    store: gcsSiteStore(),
    publish: (slug, opts) => publishSite(slug, opts),
    render: (p) => renderPending(p),
    audit: async (e) => { audits.push(e); },
    now: clock.now,
    ...over,
  });

  const adminTokens: Record<string, string> = { 'admin-token': ADMIN, 'user-token': 'someone@example.com' };
  const adminHandler = (over: Partial<Parameters<typeof makeAdminSitesHandler>[0]> = {}) =>
    makeAdminSitesHandler({
      emailOf: () => async (token) => adminTokens[token] ?? null,
      core: () => adminDeps(),
      reads: memoryStore(),
      writes: memoryStore(),
      now: clock.now,
      configured: () => true,
      ...over,
    });

  /** The ios_purchases row as the bookings/store gates read it. */
  const gateRow = async (otid: string): Promise<PurchaseGateRow | null> => {
    const r = await repo.get(otid);
    return r ? {
      user_id: r.user_id, product_id: r.product_id, revoked_at: r.revoked_at, taken_down_at: r.taken_down_at,
      expires_at: r.expires_at, site_slug: r.site_slug, published_at: r.published_at, environment: r.environment,
    } : null;
  };

  const planDeps = (shop: { id: string; ios_otid: string | null }, user: { id: string }, over: Partial<PlanDeps> = {}): PlanDeps => ({
    getUser: async (jwt) => (jwt === 'owner-jwt' ? { id: user.id, email: 'o@example.com', fullName: null } : null),
    shopByOwner: async (uid) => (uid === user.id ? shop : null),
    purchase: (otid) => repo.get(otid),
    purchasesOfUser: (uid) => repo.ofUser!(uid),
    verify: (id) => apple.verify(id),
    upsertVerified: (tx, opts) => repo.upsertVerified(tx, opts),
    setShopOtid: async (_id, otid) => { shop.ios_otid = otid; return 'ok'; },
    setUserIfUnlinked: (otid, uid) => repo.setUserIfUnlinked(otid, uid),
    now: clock.now,
    ...over,
  });

  return {
    clock, apple, db, repo, audits, emails, shopOwners, adminTokens, publishDeps,
    publish: (transactionId: string, sd: WebsiteData = siteData(), extra: Record<string, unknown> = {}, ctx: { authorization?: string } = {}) =>
      runIosPublish({ transactionId, siteData: sd, ...extra } as any, publishDeps, ctx),
    lookup: (transactionId: string, authorization?: string) => runIosSiteLookup(transactionId, publishDeps, { authorization }),
    notify: (signedPayload: string) =>
      handleAppleNotification(signedPayload, {
        decodeNotification: apple.decodeNotification, decodeTransaction: apple.decode, repo, bundleId: BUNDLE, now: clock.now,
      }),
    sweep: (opts: { takedownSandbox?: boolean; limit?: number } = {}) =>
      sweepIos({
        repo,
        publish: (slug, o) => publishSite(slug, o),
        deployOffline: async (slug) => { await deployRenderedSite({ siteId: slug, html: offlineHtml() }); },
        verify: (otid) => apple.verify(otid),
        takedownSandbox: opts.takedownSandbox,
        stripPending: makeStripPending({ readPending: readPendingSite, writePending: writePendingSite, readPendingVersioned }),
      }, opts.limit ?? 50, { now: clock.now }),
    adminDeps,
    adminHandler,
    gateRow,
    planDeps,
    getPlan, refreshPlan,
    row: (otid: string) => db.row(otid) as PurchaseRow | undefined,
  };
}

export type SiteWorld = ReturnType<typeof siteWorld>;

/** A minimal VercelRequest / VercelResponse pair for driving api/* handlers in-process. */
export function httpReq(over: { method?: string; body?: unknown; query?: Record<string, string>; headers?: Record<string, string>; url?: string; bodyThrows?: boolean } = {}) {
  const req: any = {
    method: over.method ?? 'POST',
    query: over.query ?? {},
    headers: { 'x-forwarded-for': `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`, ...(over.headers ?? {}) },
    url: over.url ?? '/',
  };
  if (over.bodyThrows) Object.defineProperty(req, 'body', { get() { throw new SyntaxError('Unexpected token'); } });
  else req.body = over.body;
  return req;
}

export function httpRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as any,
    ended: false,
    setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; return this; },
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; this.ended = true; return this; },
    send(b: any) { this.body = b; this.ended = true; return this; },
    end() { this.ended = true; return this; },
  };
  return res;
}

/** Rendered HTML without the per-render published-at stamp, so two renders of one copy compare equal. */
export const normHtml = (h: string | undefined | null) => (h ?? '').replace(/<meta name="published-at" content="[^"]*">/g, '');
