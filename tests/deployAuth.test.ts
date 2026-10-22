import { describe, it, expect, vi, afterEach } from 'vitest';
import { authorizeDeploy, bearerOf, CHECKOUT_PROOF_MAX_AGE_MS, type CheckoutProof, type DeployAuthDeps } from '../lib/deployAuth.js';
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
  claims?: Record<string, string[]>;
}

function deps(w: World = {}) {
  const d = {
    userOf: vi.fn(async (t: string) => w.users?.[t] ?? null),
    findBySlug: vi.fn(async (s: string) => w.rows?.[s] ?? null),
    checkoutSession: vi.fn(async (id: string) => w.sessions?.[id] ?? null),
    webClaimants: vi.fn(async (s: string) => w.claims?.[s] ?? []),
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
  ({ paid: true, siteId, app: 'aibarber', created: Math.floor(NOW / 1000) - 60, ...over });

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

  it('retargeting: deployedUrl naming someone else\'s app slug is ignored; the deploy stays on the caller\'s own slug', async () => {
    quiet();
    const d = deps({ users, rows: { 'fade-lab': iosRow() } });
    const r = await authorizeDeploy(
      { siteId: 'my-own-site', deployedUrl: 'https://fade-lab.vercel.app', authorization: 'Bearer other-jwt' }, d);
    expect(r).toMatchObject({ ok: true, target: 'my-own-site', row: null, actor: 'web-user' });
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

  it('a session from before metadata.app existed still counts', async () => {
    const d = deps({ sessions: { [SESSION]: paid('fresh-cuts', { app: null }) } });
    expect((await authorizeDeploy({ siteId: 'fresh-cuts', checkoutSessionId: SESSION }, d)).ok).toBe(true);
  });

  it.each([
    ['for another slug', paid('other-shop')],
    ['unpaid', paid('fresh-cuts', { paid: false })],
    ['another app on the Stripe account', paid('fresh-cuts', { app: 'primehub' })],
    ['older than the proof window', paid('fresh-cuts', { created: Math.floor((NOW - CHECKOUT_PROOF_MAX_AGE_MS) / 1000) - 1 })],
  ])('a checkout session %s → 403', async (_label, proof) => {
    quiet();
    const d = deps({ sessions: { [SESSION]: proof } });
    expect(await authorizeDeploy({ siteId: 'fresh-cuts', checkoutSessionId: SESSION }, d))
      .toEqual({ ok: false, status: 403, error: 'not-authorized' });
  });

  it('a malformed session id is never sent to Stripe', async () => {
    const d = deps();
    const r = await authorizeDeploy({ siteId: 'fresh-cuts', checkoutSessionId: '../v1/customers' }, d);
    expect(r.status).toBe(403);
    expect(d.checkoutSession).not.toHaveBeenCalled();
  });

  it('a signed-in caller whose account row claims the slug → ok', async () => {
    const d = deps({ users, claims: { 'fresh-cuts': [OWNER] } });
    expect(await authorizeDeploy({ siteId: 'fresh-cuts', authorization: 'Bearer owner-jwt' }, d))
      .toEqual({ ok: true, target: 'fresh-cuts', row: null, actor: 'web-user', userId: OWNER });
  });

  it('a signed-in caller on an unclaimed slug (new site, renamed shop) → ok', async () => {
    const d = deps({ users });
    expect((await authorizeDeploy({ siteId: 'brand-new', authorization: 'Bearer other-jwt' }, d)).ok).toBe(true);
  });

  it('wrong owner: a slug another account\'s row claims → 403', async () => {
    quiet();
    const d = deps({ users, claims: { 'fresh-cuts': [OWNER] } });
    expect(await authorizeDeploy({ siteId: 'fresh-cuts', authorization: 'Bearer other-jwt' }, d))
      .toEqual({ ok: false, status: 403, error: 'not-authorized' });
  });

  it('the admin may deploy any web slug, claimed or not', async () => {
    const d = deps({ users, claims: { 'fresh-cuts': [OWNER] } });
    expect(await authorizeDeploy({ siteId: 'fresh-cuts', authorization: 'Bearer admin-jwt' }, d))
      .toMatchObject({ ok: true, target: 'fresh-cuts', actor: 'admin' });
  });

  it('an empty slug → 400', async () => {
    expect((await authorizeDeploy({ siteId: '!!!' }, deps())).status).toBe(400);
  });
});

describe('authorizeDeploy fails closed', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['findBySlug', 'userOf', 'webClaimants', 'checkoutSession'] as const)('%s throwing → 503, never a deploy', async (dep) => {
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
