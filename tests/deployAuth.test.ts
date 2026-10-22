import { describe, it, expect, vi, afterEach } from 'vitest';
import { authorizeDeploy, authorizeSiteOwner, bearerOf, CHECKOUT_PROOF_MAX_AGE_MS, type CheckoutProof, type DeployAuthDeps } from '../lib/deployAuth.js';
import { ADMIN_EMAIL } from '../lib/admin/auth.js';
import type { PurchaseRow } from '../lib/ios/purchases.js';

const NOW = 1_800_000_000_000;
const OWNER = '3f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const SESSION = 'cs_live_a1B2c3D4e5F6g7H8i9J0';

function iosRow(over: Partial<PurchaseRow> = {}): PurchaseRow {
  return {
    original_transaction_id: 'o1', product_id: 'p', environment: 'Production', site_slug: 'fade-lab',
    user_id: OWNER, expires_at: null, revoked_at: null, last_notification: null,
    published_at: null, taken_down_at: null, lapse_checked_at: null, ...over,
  };
}

interface World {
  users?: Record<string, { id: string; email: string | null }>;
  rows?: Record<string, PurchaseRow>;
  sessions?: Record<string, CheckoutProof>;
  /** sites rows by deployed_url origin. */
  claims?: Record<string, string[]>;
  /** Server stamps on pending-sites/{slug}.json. */
  stamps?: Record<string, string>;
  /** Existing Vercel projects (default: every slug has one). */
  projects?: string[];
}

function deps(w: World = {}) {
  const d = {
    userOf: vi.fn(async (t: string) => w.users?.[t] ?? null),
    findBySlug: vi.fn(async (s: string) => w.rows?.[s] ?? null),
    checkoutSession: vi.fn(async (id: string) => w.sessions?.[id] ?? null),
    webClaimants: vi.fn(async (urls: string[]) => [...new Set(urls.flatMap((u) => w.claims?.[u] ?? []))]),
    storedStamp: vi.fn(async (s: string) => w.stamps?.[s] ?? null),
    projectExists: vi.fn(async (s: string) => (w.projects ? w.projects.includes(s) : true)),
    now: () => NOW,
  };
  return d satisfies DeployAuthDeps;
}

const users = {
  'owner-jwt': { id: OWNER, email: 'barber@example.com' },
  'other-jwt': { id: OTHER, email: 'someone@example.com' },
  'admin-jwt': { id: 'admin-id', email: ADMIN_EMAIL },
};
const paid = (siteId: string, over: Partial<CheckoutProof> = {}): CheckoutProof =>
  ({ paid: true, status: 'complete', mode: 'subscription', siteId, app: 'aibarber', created: Math.floor(NOW / 1000) - 60, ...over });
const url = (slug: string) => `https://${slug}.vercel.app`;

describe('authorizeDeploy: app (iOS) sites', () => {
  afterEach(() => vi.restoreAllMocks());
  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

  it('unauthenticated → 401, whatever the body says', async () => {
    quiet();
    const d = deps({ rows: { 'fade-lab': iosRow() } });
    expect(await authorizeDeploy({ siteId: 'fade-lab' }, d)).toEqual({ ok: false, status: 401, error: 'sign-in-required' });
  });

  it('a signed-in account that is not ios_purchases.user_id → 403', async () => {
    quiet();
    const d = deps({ users, rows: { 'fade-lab': iosRow() } });
    expect(await authorizeDeploy({ siteId: 'fade-lab', authorization: 'Bearer other-jwt' }, d))
      .toEqual({ ok: false, status: 403, error: 'not-authorized' });
  });

  it('a purchase not linked to any account (user_id null) → 403 even for a signed-in caller', async () => {
    quiet();
    const d = deps({ users, rows: { 'fade-lab': iosRow({ user_id: null }) } });
    expect((await authorizeDeploy({ siteId: 'fade-lab', authorization: 'Bearer other-jwt' }, d)).status).toBe(403);
  });

  it('a paid checkout session never authorises an app slug', async () => {
    quiet();
    const d = deps({ rows: { 'fade-lab': iosRow() }, sessions: { [SESSION]: paid('fade-lab') } });
    const r = await authorizeDeploy({ siteId: 'fade-lab', checkoutSessionId: SESSION }, d);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(d.checkoutSession).not.toHaveBeenCalled();
  });

  it('the owner (bearer user = ios_purchases.user_id) → ok, target is the bound slug', async () => {
    const row = iosRow();
    const d = deps({ users, rows: { 'fade-lab': row } });
    expect(await authorizeDeploy({ siteId: 'Fade Lab', authorization: 'Bearer owner-jwt' }, d))
      .toEqual({ ok: true, target: 'fade-lab', row, actor: 'app-owner', userId: OWNER });
  });

  it('the owner renaming the shop on the web keeps deploying to the bound slug (deployedUrl hint they own)', async () => {
    const row = iosRow({ site_slug: 'fade-lab-x7k2' });
    const d = deps({ users, rows: { 'fade-lab-x7k2': row } });
    const r = await authorizeDeploy(
      { siteId: 'brand-new-name', deployedUrl: 'https://fade-lab-x7k2.vercel.app', authorization: 'Bearer owner-jwt' }, d);
    expect(r).toMatchObject({ ok: true, target: 'fade-lab-x7k2', actor: 'app-owner' });
  });

  it('retargeting: deployedUrl naming someone else\'s app slug → 403, never a web deploy on the shop-name slug', async () => {
    quiet();
    const d = deps({ users, rows: { 'fade-lab': iosRow() } });
    const r = await authorizeDeploy(
      { siteId: 'my-own-site', deployedUrl: 'https://fade-lab.vercel.app', authorization: 'Bearer other-jwt' }, d);
    expect(r).toEqual({ ok: false, status: 403, error: 'not-authorized' });
  });

  it('an unlinked app owner editing on the web (hint = their app slug, user_id null) → 403, not a deploy to the shop-name project', async () => {
    quiet();
    const d = deps({ users, rows: { 'fade-lab-x7k2': iosRow({ site_slug: 'fade-lab-x7k2', user_id: null }) } });
    const r = await authorizeDeploy(
      { siteId: 'fade-lab', deployedUrl: 'https://fade-lab-x7k2.vercel.app', authorization: 'Bearer owner-jwt' }, d);
    expect(r).toEqual({ ok: false, status: 403, error: 'not-authorized' });
    expect(d.webClaimants).not.toHaveBeenCalled();
  });

  it('retargeting without any session → 401 (the hint never authorises by itself)', async () => {
    quiet();
    const d = deps({ rows: { 'fade-lab': iosRow() } });
    const r = await authorizeDeploy({ siteId: 'my-own-site', deployedUrl: 'https://fade-lab.vercel.app' }, d);
    expect(r).toEqual({ ok: false, status: 401, error: 'sign-in-required' });
  });

  it('the admin may deploy any app site (and follows the hint)', async () => {
    const d = deps({ users, rows: { 'fade-lab': iosRow(), 'fade-lab-x7k2': iosRow({ site_slug: 'fade-lab-x7k2' }) } });
    expect(await authorizeDeploy({ siteId: 'fade-lab', authorization: 'Bearer admin-jwt' }, d))
      .toMatchObject({ ok: true, target: 'fade-lab', actor: 'admin' });
    expect(await authorizeDeploy({ siteId: 'x', deployedUrl: 'https://fade-lab-x7k2.vercel.app', authorization: 'Bearer admin-jwt' }, d))
      .toMatchObject({ ok: true, target: 'fade-lab-x7k2', actor: 'admin' });
  });
});

describe('authorizeDeploy: web sites', () => {
  afterEach(() => vi.restoreAllMocks());
  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

  it('unauthenticated, no checkout → 401', async () => {
    expect(await authorizeDeploy({ siteId: 'fresh-cuts' }, deps())).toEqual({ ok: false, status: 401, error: 'sign-in-required' });
  });

  it('an invalid or expired token → 401', async () => {
    expect((await authorizeDeploy({ siteId: 'fresh-cuts', authorization: 'Bearer junk' }, deps({ users }))).status).toBe(401);
  });

  it('first publish after checkout: a paid aibarber session for exactly this slug → ok', async () => {
    const d = deps({ sessions: { [SESSION]: paid('fresh-cuts') } });
    expect(await authorizeDeploy({ siteId: 'fresh-cuts', checkoutSessionId: SESSION }, d))
      .toEqual({ ok: true, target: 'fresh-cuts', row: null, actor: 'checkout', userId: null });
  });

  it.each([
    ['for another slug', paid('other-shop')],
    ['unpaid', paid('fresh-cuts', { paid: false })],
    ['not complete', paid('fresh-cuts', { status: 'open' })],
    ['with no metadata.app (a domain purchase)', paid('fresh-cuts', { app: null, mode: 'payment' })],
    ['with no metadata.app, even in subscription mode', paid('fresh-cuts', { app: null })],
    ['in payment mode, even with app=aibarber', paid('fresh-cuts', { mode: 'payment' })],
    ['another app on the Stripe account', paid('fresh-cuts', { app: 'primehub' })],
    ['older than the proof window', paid('fresh-cuts', { created: Math.floor((NOW - CHECKOUT_PROOF_MAX_AGE_MS) / 1000) - 1 })],
  ])('a checkout session %s → 403', async (_label, proof) => {
    quiet();
    const d = deps({ sessions: { [SESSION]: proof } });
    expect(await authorizeDeploy({ siteId: 'fresh-cuts', checkoutSessionId: SESSION }, d))
      .toEqual({ ok: false, status: 403, error: 'checkout-not-valid' });
  });

  it('a malformed session id is never sent to Stripe', async () => {
    const d = deps();
    const r = await authorizeDeploy({ siteId: 'fresh-cuts', checkoutSessionId: '../v1/customers' }, d);
    expect(r.status).toBe(403);
    expect(d.checkoutSession).not.toHaveBeenCalled();
  });

  it('a domain-purchase session on a slug another account claims → 403, nothing deployed (review finding 2)', async () => {
    quiet();
    const d = deps({ sessions: { [SESSION]: paid('fresh-cuts', { app: null, mode: 'payment' }) }, claims: { [url('fresh-cuts')]: [OWNER] } });
    expect((await authorizeDeploy({ siteId: 'fresh-cuts', checkoutSessionId: SESSION }, d)).ok).toBe(false);
  });

  it('a signed-in caller whose account row claims the slug → ok', async () => {
    const d = deps({ users, claims: { [url('fresh-cuts')]: [OWNER] } });
    expect(await authorizeDeploy({ siteId: 'fresh-cuts', authorization: 'Bearer owner-jwt' }, d))
      .toEqual({ ok: true, target: 'fresh-cuts', row: null, actor: 'web-user', userId: OWNER });
  });

  it('a signed-in caller on an existing, unstamped, unclaimed project → ok (the old rule)', async () => {
    const d = deps({ users, projects: ['old-site'] });
    expect((await authorizeDeploy({ siteId: 'old-site', authorization: 'Bearer other-jwt' }, d)).ok).toBe(true);
  });

  it('wrong owner: a slug another account\'s row claims → 403', async () => {
    quiet();
    const d = deps({ users, claims: { [url('fresh-cuts')]: [OWNER] } });
    expect(await authorizeDeploy({ siteId: 'fresh-cuts', authorization: 'Bearer other-jwt' }, d))
      .toEqual({ ok: false, status: 403, error: 'not-authorized' });
  });

  it('the admin may deploy any web slug, claimed or not', async () => {
    const d = deps({ users, claims: { [url('fresh-cuts')]: [OWNER] } });
    expect(await authorizeDeploy({ siteId: 'fresh-cuts', authorization: 'Bearer admin-jwt' }, d))
      .toMatchObject({ ok: true, target: 'fresh-cuts', actor: 'admin' });
  });

  it('a 49-character slug cannot be reached through a longer siteId (review finding 1)', async () => {
    quiet();
    const S = 'a'.repeat(45) + '-bcd';
    expect(S).toHaveLength(49);
    const d = deps({ users, claims: { [url(S)]: [OWNER] } });
    const r = await authorizeDeploy({ siteId: S + '-zzz', authorization: 'Bearer other-jwt' }, d);
    expect(r).toEqual({ ok: false, status: 403, error: 'not-authorized' });
    expect(d.webClaimants).toHaveBeenCalledWith([url(S)]);
    // The owner, same siteId: the target is the canonical slug, the one deployed to.
    expect(await authorizeDeploy({ siteId: S + '-zzz', authorization: 'Bearer owner-jwt' }, d))
      .toMatchObject({ ok: true, target: S });
  });

  it('a checkout for the 50-character client slug (trailing dash) authorises the canonical slug', async () => {
    const S = 'a'.repeat(45) + '-bcd';
    const d = deps({ sessions: { [SESSION]: paid(S + '-') } });
    expect(await authorizeDeploy({ siteId: S + '-', checkoutSessionId: SESSION }, d)).toMatchObject({ ok: true, target: S });
  });

  it('an empty slug → 400', async () => {
    expect((await authorizeDeploy({ siteId: '!!!' }, deps())).status).toBe(400);
  });
});

describe('authorizeDeploy: published (stamped) web sites and new projects', () => {
  afterEach(() => vi.restoreAllMocks());
  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
  const ALIAS = 'https://ada-pearl-phi.vercel.app';

  it('a stamp that is not an https URL still marks the site published', async () => {
    quiet();
    const d = deps({ users, stamps: { ada: 'not a url' } });
    expect((await authorizeDeploy({ siteId: 'ada', authorization: 'Bearer other-jwt' }, d)).status).toBe(403);
    expect(d.webClaimants).toHaveBeenCalledWith([url('ada')]);
  });

  it('a stamped copy no account claims → 403 for a signed-in stranger (review finding 4)', async () => {
    quiet();
    const d = deps({ users, stamps: { ada: ALIAS } });
    expect(await authorizeDeploy({ siteId: 'ada', authorization: 'Bearer other-jwt' }, d))
      .toEqual({ ok: false, status: 403, error: 'not-authorized' });
    expect(d.webClaimants).toHaveBeenCalledWith([url('ada'), ALIAS]);
  });

  it('a stamped team-alias site: another account\'s row on the stamped URL refuses; the owner\'s row allows', async () => {
    quiet();
    const d = deps({ users, stamps: { ada: `${ALIAS}/` }, claims: { [ALIAS]: [OWNER] } });
    expect((await authorizeDeploy({ siteId: 'ada', authorization: 'Bearer other-jwt' }, d)).status).toBe(403);
    expect(await authorizeDeploy({ siteId: 'ada', authorization: 'Bearer owner-jwt' }, d)).toMatchObject({ ok: true, actor: 'web-user' });
  });

  it('a stamped site: checkout proof and the admin still work', async () => {
    const d = deps({ users, stamps: { 'fresh-cuts': url('fresh-cuts') }, sessions: { [SESSION]: paid('fresh-cuts') } });
    expect((await authorizeDeploy({ siteId: 'fresh-cuts', checkoutSessionId: SESSION }, d)).actor).toBe('checkout');
    expect((await authorizeDeploy({ siteId: 'fresh-cuts', authorization: 'Bearer admin-jwt' }, d)).actor).toBe('admin');
  });

  it('a brand-new project (no stamp, no Vercel project) → 403 new-site-needs-checkout for a signed-in user (review finding 5)', async () => {
    quiet();
    const d = deps({ users, projects: [] });
    expect(await authorizeDeploy({ siteId: 'brand-new', authorization: 'Bearer other-jwt' }, d))
      .toEqual({ ok: false, status: 403, error: 'new-site-needs-checkout' });
  });

  it('a forged row claiming the new slug\'s own URL does not open a new project', async () => {
    quiet();
    const d = deps({ users, projects: [], claims: { [url('brand-new')]: [OTHER] } });
    expect((await authorizeDeploy({ siteId: 'brand-new', authorization: 'Bearer other-jwt' }, d)).error).toBe('new-site-needs-checkout');
  });

  it('a brand-new project: checkout proof or the admin → ok', async () => {
    const d = deps({ users, projects: [], sessions: { [SESSION]: paid('brand-new') } });
    expect((await authorizeDeploy({ siteId: 'brand-new', checkoutSessionId: SESSION }, d)).ok).toBe(true);
    expect((await authorizeDeploy({ siteId: 'brand-new', authorization: 'Bearer admin-jwt' }, d)).ok).toBe(true);
  });

  it('rename: the only account claiming the old URL (an existing project) may create the new slug', async () => {
    const d = deps({ users, projects: ['fresh-cuts'], claims: { [url('fresh-cuts')]: [OWNER] } });
    expect(await authorizeDeploy(
      { siteId: 'fresh-cuts-nyc', deployedUrl: 'https://fresh-cuts.vercel.app/', authorization: 'Bearer owner-jwt' }, d))
      .toEqual({ ok: true, target: 'fresh-cuts-nyc', row: null, actor: 'web-user', userId: OWNER });
  });

  it.each([
    ['the caller does not claim the old URL', { projects: ['fresh-cuts'], claims: {} }],
    ['another account also claims the old URL', { projects: ['fresh-cuts'], claims: { [url('fresh-cuts')]: [OWNER, OTHER] } }],
    ['the old project does not exist', { projects: [], claims: { [url('fresh-cuts')]: [OWNER] } }],
  ])('rename refused when %s', async (_label, w) => {
    quiet();
    const d = deps({ users, ...w });
    expect((await authorizeDeploy(
      { siteId: 'fresh-cuts-nyc', deployedUrl: 'https://fresh-cuts.vercel.app', authorization: 'Bearer owner-jwt' }, d)).error)
      .toBe('new-site-needs-checkout');
  });
});

describe('authorizeDeploy fails closed', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['findBySlug', 'userOf', 'webClaimants', 'checkoutSession', 'storedStamp', 'projectExists'] as const)('%s throwing → 503, never a deploy', async (dep) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps({ users, sessions: { [SESSION]: paid('fresh-cuts') } });
    d[dep].mockRejectedValue(new Error('down'));
    const r = await authorizeDeploy({ siteId: 'fresh-cuts', authorization: 'Bearer other-jwt', checkoutSessionId: dep === 'checkoutSession' ? SESSION : undefined }, d);
    expect(r).toEqual({ ok: false, status: 503, error: 'temporarily-unavailable' });
  });

  it('a lookup that never answers → 503 after the cap', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = { ...deps(), lookupTimeoutMs: 20 };
    d.findBySlug.mockImplementation(() => new Promise<PurchaseRow | null>(() => {}));
    expect((await authorizeDeploy({ siteId: 'fresh-cuts' }, d)).status).toBe(503);
  });
});

describe('bearerOf', () => {
  it('strips the scheme, tolerates arrays and junk', () => {
    expect(bearerOf('Bearer abc')).toBe('abc');
    expect(bearerOf(['bearer xyz'])).toBe('xyz');
    expect(bearerOf(undefined)).toBe('');
    expect(bearerOf(42)).toBe('');
  });
});

describe('authorizeSiteOwner (paid add-ons: the web custom-domain flow)', () => {
  afterEach(() => vi.restoreAllMocks());
  const quiet = () => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); };

  it('no token → 401; bad token → 401', async () => {
    expect(await authorizeSiteOwner({ siteId: 'fresh-cuts' }, deps())).toEqual({ ok: false, status: 401, error: 'sign-in-required' });
    expect((await authorizeSiteOwner({ siteId: 'fresh-cuts', authorization: 'Bearer junk' }, deps({ users }))).status).toBe(401);
  });

  it('a checkout session is never enough (no session input at all)', async () => {
    const d = deps({ users, sessions: { [SESSION]: paid('fresh-cuts') } });
    expect((await authorizeSiteOwner({ siteId: 'fresh-cuts', checkoutSessionId: SESSION } as any, d)).status).toBe(401);
  });

  it('admin: any slug', async () => {
    expect(await authorizeSiteOwner({ siteId: 'Fresh Cuts', authorization: 'Bearer admin-jwt' }, deps({ users })))
      .toMatchObject({ ok: true, target: 'fresh-cuts', actor: 'admin' });
  });

  it('app slug: only ios_purchases.user_id', async () => {
    const d = deps({ users, rows: { 'fade-lab': iosRow() } });
    expect(await authorizeSiteOwner({ siteId: 'fade-lab', authorization: 'Bearer owner-jwt' }, d)).toMatchObject({ ok: true, target: 'fade-lab', actor: 'app-owner' });
    expect(await authorizeSiteOwner({ siteId: 'fade-lab', authorization: 'Bearer other-jwt' }, d)).toEqual({ ok: false, status: 403, error: 'not-authorized' });
  });

  it('web slug: the caller claims it and nobody else does', async () => {
    const mine = deps({ users, claims: { [url('fresh-cuts')]: [OWNER] } });
    expect(await authorizeSiteOwner({ siteId: 'fresh-cuts', authorization: 'Bearer owner-jwt' }, mine)).toMatchObject({ ok: true, target: 'fresh-cuts', actor: 'web-user' });
    const contested = deps({ users, claims: { [url('fresh-cuts')]: [OWNER, OTHER] } });
    expect((await authorizeSiteOwner({ siteId: 'fresh-cuts', authorization: 'Bearer owner-jwt' }, contested)).status).toBe(403);
    // unclaimed + existing project: deploy-site allows a signed-in user; a paid add-on does not
    const unclaimed = deps({ users });
    expect((await authorizeSiteOwner({ siteId: 'fresh-cuts', authorization: 'Bearer owner-jwt' }, unclaimed)).status).toBe(403);
    // the stamped URL counts too
    const stamped = deps({ users, stamps: { 'fresh-cuts': 'https://fresh-cuts-x1.vercel.app' }, claims: { 'https://fresh-cuts-x1.vercel.app': [OTHER] } });
    expect((await authorizeSiteOwner({ siteId: 'fresh-cuts', authorization: 'Bearer owner-jwt' }, stamped)).status).toBe(403);
  });

  it('every lookup failure is 503 (fail closed)', async () => {
    quiet();
    const d1 = deps({ users });
    d1.findBySlug.mockRejectedValueOnce(new Error('db'));
    expect((await authorizeSiteOwner({ siteId: 'fresh-cuts', authorization: 'Bearer owner-jwt' }, d1)).status).toBe(503);
    const d2 = deps({ users });
    d2.webClaimants.mockRejectedValueOnce(new Error('db'));
    expect((await authorizeSiteOwner({ siteId: 'fresh-cuts', authorization: 'Bearer owner-jwt' }, d2)).status).toBe(503);
  });
});

describe('a website domain checkout is never deploy proof', () => {
  it('mode subscription but app aibarber-domain → refused', async () => {
    const d = deps({ sessions: { [SESSION]: paid('fresh-cuts', { app: 'aibarber-domain' }) } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await authorizeDeploy({ siteId: 'fresh-cuts', checkoutSessionId: SESSION }, d)).ok).toBe(false);
  });
});
