import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// /api/deploy-site through its real default export: only the edges are faked (Supabase auth and
// tables, Stripe, Vercel, GCS). C1 in the 2026-10-22 server report: an unauthenticated POST
// replaced any customer's live site and an app site's stored copy.
const { findBySlug, deployRenderedSite, writePendingSite, readPendingSite, getUser, siteClaims, allow, vercelProjectExists, findShopForSite } = vi.hoisted(() => ({
  findShopForSite: vi.fn(async (_slug: string): Promise<{ id: string; slug: string } | null> => null),
  vercelProjectExists: vi.fn(async (_s: string) => true),
  readPendingSite: vi.fn(async (_s: string): Promise<unknown> => null),
  findBySlug: vi.fn(),
  deployRenderedSite: vi.fn(async (i: { siteId: string }) => ({ deploymentUrl: `https://${i.siteId}.vercel.app`, uploadedImages: {} })),
  writePendingSite: vi.fn(async (_s: string, _p: unknown) => {}),
  getUser: vi.fn(),
  siteClaims: vi.fn(async (_urls: string[]) => [] as { user_id: string }[]),
  allow: vi.fn(async (_k: string, _kind: string) => true),
}));
vi.mock('../../lib/deploySite.js', () => ({ deployRenderedSite }));
vi.mock('../../lib/ios/purchases.js', () => ({ supabasePurchases: () => ({ findBySlug }) }));
// No generations in this fake: the compare-and-set writes fall back to unconditional ones.
vi.mock('../../lib/publishSite.js', async (orig) => ({
  ...(await orig<object>()), writePendingSite, readPendingSite,
  readPendingVersioned: async (s: string) => ({ pending: await readPendingSite(s), generation: null }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser },
    from: (_t: string) => ({ select: () => ({ in: async (_c: string, urls: string[]) => ({ data: await siteClaims(urls), error: null }) }) }),
  }),
}));
vi.mock('../../lib/siteSubpages.js', async (orig) => ({
  ...(await orig<object>()), findShopForSite,
  liveSiteBaseDeps: { projectDomains: async () => [], domainServing: async () => false, updateShop: async () => {} },
}));
vi.mock('../../lib/ios/slug.js', async (orig) => ({ ...(await orig<object>()), vercelProjectExists }));
vi.mock('../../lib/bookings/rateLimit.js', async (orig) => ({ ...(await orig<object>()), publicLimiter: { allow } }));

import handler from '../../api/deploy-site.js';

const OWNER = '3f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const SESSION = 'cs_live_a1B2c3D4e5F6g7H8i9J0';
const TOKENS: Record<string, { id: string; email: string }> = {
  'owner-jwt': { id: OWNER, email: 'barber@example.com' },
  'other-jwt': { id: OTHER, email: 'someone@example.com' },
  'admin-jwt': { id: 'admin-id', email: 'ibrahim3709@gmail.com' },
};

const mkRes = () => { const res: any = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn(), end: vi.fn() }; return res; };
const post = (body: unknown, token?: string) => ({
  method: 'POST', body, headers: { 'x-real-ip': '203.0.113.9', ...(token ? { authorization: `Bearer ${token}` } : {}) },
});
const sd = {
  shopName: 'Fade Lab', hero: { imageUrl: 'https://img/h.jpg' }, about: { imageUrl: '' },
  gallery: [], services: [],
};
const appRow = (over: Record<string, unknown> = {}) => ({
  original_transaction_id: 'o1', product_id: 'p', environment: 'Production', site_slug: 'fade-lab', user_id: OWNER,
  expires_at: '2999-01-01T00:00:00Z', revoked_at: null, taken_down_at: null, ...over,
});
const stripeSession = (over: Record<string, unknown> = {}) => ({
  id: SESSION, payment_status: 'paid', status: 'complete', mode: 'subscription', metadata: { app: 'aibarber', siteId: 'fresh-cuts' },
  client_reference_id: 'fresh-cuts', created: Math.floor(Date.now() / 1000) - 60, ...over,
});

describe('api/deploy-site authorisation (C1)', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://sb.test');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
    findBySlug.mockReset().mockResolvedValue(null);
    deployRenderedSite.mockClear();
    writePendingSite.mockClear();
    readPendingSite.mockReset().mockResolvedValue(null);
    vercelProjectExists.mockReset().mockResolvedValue(true);
    siteClaims.mockReset().mockResolvedValue([]);
    allow.mockReset().mockResolvedValue(true);
    getUser.mockReset().mockImplementation(async (t: string) => (TOKENS[t]
      ? { data: { user: TOKENS[t] }, error: null }
      : { data: { user: null }, error: { status: 401, message: 'invalid JWT' } }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('unauthenticated POST to an app site → 401, nothing deployed, stored copy untouched', async () => {
    findBySlug.mockImplementation(async (s: string) => (s === 'fade-lab' ? appRow() : null));
    const res = mkRes();
    await handler(post({ siteId: 'fade-lab', html: '<h1>phish</h1>', siteData: sd }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'sign-in-required' });
    expect(deployRenderedSite).not.toHaveBeenCalled();
    expect(writePendingSite).not.toHaveBeenCalled();
  });

  it('unauthenticated POST to a web site → 401, nothing deployed', async () => {
    const res = mkRes();
    await handler(post({ siteId: 'fresh-cuts', html: '<h1>phish</h1>' }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(deployRenderedSite).not.toHaveBeenCalled();
  });

  it('wrong owner: another account on an app site → 403; on a web site its owner\'s row claims → 403', async () => {
    findBySlug.mockImplementation(async (s: string) => (s === 'fade-lab' ? appRow() : null));
    const r1 = mkRes();
    await handler(post({ siteId: 'fade-lab', html: '<h1>x</h1>', siteData: sd }, 'other-jwt'), r1);
    expect(r1.status).toHaveBeenCalledWith(403);
    expect(r1.json).toHaveBeenCalledWith({ ok: false, error: 'not-authorized' });

    siteClaims.mockImplementation(async (urls: string[]) => (urls.includes('https://fresh-cuts.vercel.app') ? [{ user_id: OWNER }] : []));
    const r2 = mkRes();
    await handler(post({ siteId: 'fresh-cuts', html: '<h1>x</h1>' }, 'other-jwt'), r2);
    expect(r2.status).toHaveBeenCalledWith(403);
    expect(deployRenderedSite).not.toHaveBeenCalled();
    expect(writePendingSite).not.toHaveBeenCalled();
  });

  it('retargeting: deployedUrl naming a victim\'s app slug never deploys there', async () => {
    findBySlug.mockImplementation(async (s: string) => (s === 'fade-lab' ? appRow() : null));
    // Unauthenticated: refused outright.
    const r1 = mkRes();
    await handler(post({ siteId: 'my-own-site', html: '<h1>x</h1>', deployedUrl: 'https://fade-lab.vercel.app', siteData: sd }), r1);
    expect(r1.status).toHaveBeenCalledWith(401);
    // Signed in as someone else: refused too (never a web deploy on the shop-name slug).
    const r2 = mkRes();
    await handler(post({ siteId: 'my-own-site', html: '<h1>x</h1>', deployedUrl: 'https://fade-lab.vercel.app', siteData: sd }, 'other-jwt'), r2);
    expect(r2.status).toHaveBeenCalledWith(403);
    expect(r2.json).toHaveBeenCalledWith({ ok: false, error: 'not-authorized' });
    expect(deployRenderedSite).not.toHaveBeenCalled();
    expect(writePendingSite).not.toHaveBeenCalled();
  });

  it('admin → may deploy any site (app or claimed web), and never writes an app site\'s stored copy', async () => {
    findBySlug.mockImplementation(async (s: string) => (s === 'fade-lab' ? appRow() : null));
    siteClaims.mockResolvedValue([{ user_id: OWNER }]);
    const r1 = mkRes();
    await handler(post({ siteId: 'fade-lab', html: '<h1>a</h1>', siteData: sd }, 'admin-jwt'), r1);
    expect(r1.status).toHaveBeenCalledWith(200);
    const r2 = mkRes();
    await handler(post({ siteId: 'fresh-cuts', html: '<h1>b</h1>' }, 'admin-jwt'), r2);
    expect(r2.status).toHaveBeenCalledWith(200);
    expect(deployRenderedSite.mock.calls.map((c) => c[0].siteId)).toEqual(['fade-lab', 'fresh-cuts']);
    expect(writePendingSite).not.toHaveBeenCalled();
  });

  it('owner: the app site\'s owner (bearer = ios_purchases.user_id) deploys and refreshes the stored copy', async () => {
    findBySlug.mockImplementation(async (s: string) => (s === 'fade-lab-x7k2' ? appRow({ site_slug: 'fade-lab-x7k2' }) : null));
    const res = mkRes();
    // Renamed on the web: the shop-name slug differs; the owned deployedUrl keeps the bound slug.
    await handler(post({ siteId: 'fade-lab-renamed', html: '<h1/>', deployedUrl: 'https://fade-lab-x7k2.vercel.app', siteData: sd }, 'owner-jwt'), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(deployRenderedSite).toHaveBeenCalledWith(expect.objectContaining({ siteId: 'fade-lab-x7k2' }));
    expect(writePendingSite).toHaveBeenCalledWith('fade-lab-x7k2', expect.objectContaining({ editedBy: 'owner' }));
  });

  it('site subpages: the owner\'s app site with a shop gets the rewrites for the AUTHORISED slug\'s shop only', async () => {
    findBySlug.mockImplementation(async (s: string) => (s === 'fade-lab-x7k2' ? appRow({ site_slug: 'fade-lab-x7k2' }) : null));
    findShopForSite.mockImplementation(async (s: string) => (s === 'fade-lab-x7k2' ? { id: 'shop-1', slug: 'fade-lab' } : null));
    const res = mkRes();
    await handler(post({ siteId: 'fade-lab-renamed', html: '<h1/>', deployedUrl: 'https://fade-lab-x7k2.vercel.app', siteData: sd }, 'owner-jwt'), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(findShopForSite).toHaveBeenCalledWith('fade-lab-x7k2');
    expect(deployRenderedSite).toHaveBeenCalledWith(expect.objectContaining({ siteId: 'fade-lab-x7k2', subpages: { mode: 'full', shopSlug: 'fade-lab' } }));
    findShopForSite.mockReset();
    findShopForSite.mockImplementation(async () => null);
  });

  it('site subpages: a web customer\'s deploy is never looked up and never gets rewrites', async () => {
    siteClaims.mockResolvedValue([{ user_id: OWNER }]);
    findShopForSite.mockClear();
    const res = mkRes();
    await handler(post({ siteId: 'fresh-cuts', html: '<h1/>', siteData: sd }, 'owner-jwt'), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(findShopForSite).not.toHaveBeenCalled();
    expect((deployRenderedSite.mock.calls.at(-1) as any)[0].subpages).toBeUndefined();
  });

  it('owner: a web customer editing the site their account row claims → 200', async () => {
    siteClaims.mockResolvedValue([{ user_id: OWNER }]);
    const res = mkRes();
    await handler(post({ siteId: 'fresh-cuts', html: '<h1/>', siteData: sd }, 'owner-jwt'), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, deploymentUrl: 'https://fresh-cuts.vercel.app' }));
  });

  it('an authorised web deploy stamps the stored pre-checkout copy with the live URL', async () => {
    siteClaims.mockResolvedValue([{ user_id: OWNER }]);
    readPendingSite.mockResolvedValue({ siteId: 'fresh-cuts', siteData: sd } as any);
    const res = mkRes();
    await handler(post({ siteId: 'fresh-cuts', html: '<h1/>' }, 'owner-jwt'), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(writePendingSite).toHaveBeenCalledWith('fresh-cuts', { siteId: 'fresh-cuts', siteData: sd, deployedUrl: 'https://fresh-cuts.vercel.app' });
  });

  it('first publish after checkout: the paid Stripe session for this slug → 200 with no account', async () => {
    const fetchMock = vi.fn(async (_u: string, _i?: unknown) => new Response(JSON.stringify(stripeSession()), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = mkRes();
    await handler(post({ siteId: 'fresh-cuts', html: '<h1/>', imageUrls: {}, checkoutSessionId: SESSION }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`https://api.stripe.com/v1/checkout/sessions/${SESSION}`);
    expect(deployRenderedSite).toHaveBeenCalledWith(expect.objectContaining({ siteId: 'fresh-cuts' }));
  });

  it('a paid session for a different slug does not authorise this one → 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(stripeSession({ metadata: { app: 'aibarber', siteId: 'other-shop' }, client_reference_id: 'other-shop' })), { status: 200 })));
    const res = mkRes();
    await handler(post({ siteId: 'fresh-cuts', html: '<h1/>', checkoutSessionId: SESSION }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(deployRenderedSite).not.toHaveBeenCalled();
  });

  it('a domain-purchase session (mode payment, no metadata.app) never authorises a deploy (review finding 2)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(stripeSession({
      mode: 'payment', metadata: { type: 'domain_purchase', siteId: 'fresh-cuts' }, client_reference_id: null,
    })), { status: 200 })));
    const res = mkRes();
    await handler(post({ siteId: 'fresh-cuts', html: '<h1>phish</h1>', checkoutSessionId: SESSION }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(deployRenderedSite).not.toHaveBeenCalled();
  });

  it('a 49-character claimed slug cannot be reached with a longer siteId; the deploy target is exactly the authorised slug (review finding 1)', async () => {
    const S = 'a'.repeat(45) + '-bcd';
    siteClaims.mockImplementation(async (urls: string[]) => (urls.includes(`https://${S}.vercel.app`) ? [{ user_id: OWNER }] : []));
    const r1 = mkRes();
    await handler(post({ siteId: S + '-zzz', html: '<h1>phish</h1>' }, 'other-jwt'), r1);
    expect(r1.status).toHaveBeenCalledWith(403);
    expect(deployRenderedSite).not.toHaveBeenCalled();
    const r2 = mkRes();
    await handler(post({ siteId: S + '-zzz', html: '<h1/>' }, 'owner-jwt'), r2);
    expect(r2.status).toHaveBeenCalledWith(200);
    expect(deployRenderedSite).toHaveBeenCalledWith(expect.objectContaining({ siteId: S }));
  });

  it('a published (stamped) web site no account of the caller claims → 403 (review finding 4)', async () => {
    readPendingSite.mockResolvedValue({ siteId: 'ada', siteData: sd, deployedUrl: 'https://ada-pearl-phi.vercel.app' });
    const res = mkRes();
    await handler(post({ siteId: 'ada', html: '<h1>phish</h1>' }, 'other-jwt'), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(siteClaims).toHaveBeenCalledWith(expect.arrayContaining(['https://ada.vercel.app', 'https://ada-pearl-phi.vercel.app']));
    expect(deployRenderedSite).not.toHaveBeenCalled();
  });

  it('a brand-new Vercel project needs checkout or the admin: a signed-in user → 403 new-site-needs-checkout (review finding 5)', async () => {
    vercelProjectExists.mockResolvedValue(false);
    const res = mkRes();
    await handler(post({ siteId: 'free-phish-host', html: '<h1>phish</h1>' }, 'other-jwt'), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'new-site-needs-checkout' });
    expect(vercelProjectExists).toHaveBeenCalledWith('free-phish-host');
    expect(deployRenderedSite).not.toHaveBeenCalled();
    const admin = mkRes();
    await handler(post({ siteId: 'free-phish-host', html: '<h1/>' }, 'admin-jwt'), admin);
    expect(admin.status).toHaveBeenCalledWith(200);
  });

  it('a Vercel project lookup failure fails closed (503)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vercelProjectExists.mockRejectedValue(new Error('vercel down'));
    const res = mkRes();
    await handler(post({ siteId: 'fresh-cuts', html: '<h1/>' }, 'other-jwt'), res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(deployRenderedSite).not.toHaveBeenCalled();
  });

  it('a checkout deploy with no stored copy writes one, stamped, in the pending shape, from either caller (review finding 6)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(stripeSession()), { status: 200 })));
    // The Stripe return: the stored pending shape ('uploaded' markers) + its imageUrlMap.
    const pendingShape = { shopName: 'Fresh Cuts', hero: { imageUrl: 'uploaded' }, about: { imageUrl: '' }, gallery: ['uploaded', ''], services: [] };
    // The editor right after paying: real URLs inline.
    const editorShape = { shopName: 'Fresh Cuts', hero: { imageUrl: 'https://img/h.jpg' }, about: { imageUrl: '' }, gallery: ['https://img/g0.jpg', ''], services: [] };
    const map = { hero: 'https://img/h.jpg', gallery0: 'https://img/g0.jpg' };
    for (const [siteData, imageUrls] of [[pendingShape, map], [editorShape, map], [editorShape, {}]] as const) {
      writePendingSite.mockClear();
      const res = mkRes();
      await handler(post({ siteId: 'fresh-cuts', html: '<h1/>', imageUrls, checkoutSessionId: SESSION, siteData, existingSiteId: 'draft-1' }), res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(writePendingSite).toHaveBeenCalledWith('fresh-cuts', expect.objectContaining({
        siteId: 'fresh-cuts', imageUrlMap: map, existingSiteId: 'draft-1', deployedUrl: 'https://fresh-cuts.vercel.app',
        siteData: expect.objectContaining({ hero: { imageUrl: 'uploaded' }, gallery: ['uploaded', ''] }),
      }));
    }
  });

  it('a checkout deploy replaces an unstamped stored copy (anyone could have written it) with its own content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(stripeSession()), { status: 200 })));
    readPendingSite.mockResolvedValue({ siteId: 'fresh-cuts', siteData: { ...sd, shopName: 'PHISH' } });
    const res = mkRes();
    await handler(post({ siteId: 'fresh-cuts', html: '<h1/>', checkoutSessionId: SESSION, siteData: sd }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(writePendingSite).toHaveBeenCalledWith('fresh-cuts', expect.objectContaining({
      siteData: expect.objectContaining({ shopName: 'Fade Lab' }), deployedUrl: 'https://fresh-cuts.vercel.app',
    }));
  });

  it('rate limited → 429 before any lookup', async () => {
    allow.mockResolvedValue(false);
    const res = mkRes();
    await handler(post({ siteId: 'fresh-cuts', html: '<h1/>' }, 'owner-jwt'), res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'rate-limited' });
    expect(allow).toHaveBeenCalledWith('deploy:203.0.113.9', 'write');
    expect(findBySlug).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });

  it('an ios_purchases outage fails closed (503), never as an unauthenticated web deploy', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    findBySlug.mockRejectedValue(new Error('db down'));
    const res = mkRes();
    await handler(post({ siteId: 'fade-lab', html: '<h1/>' }), res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'temporarily-unavailable' });
    expect(deployRenderedSite).not.toHaveBeenCalled();
  });

  it('a taken-down or revoked app site → 402 even for its owner', async () => {
    for (const extra of [{ revoked_at: '2026-10-01T00:00:00Z' }, { taken_down_at: '2026-10-01T00:00:00Z' }]) {
      findBySlug.mockResolvedValue(appRow(extra));
      const res = mkRes();
      await handler(post({ siteId: 'fade-lab', html: '<h1/>', siteData: sd }, 'owner-jwt'), res);
      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'subscription-inactive' });
    }
    expect(deployRenderedSite).not.toHaveBeenCalled();
  });

  it('a deploy failure is a small 500 without internals', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    siteClaims.mockResolvedValue([{ user_id: OWNER }]);
    deployRenderedSite.mockRejectedValueOnce(new Error('VERCEL_TOKEN invalid for team xyz'));
    const res = mkRes();
    await handler(post({ siteId: 'fresh-cuts', html: '<h1/>' }, 'owner-jwt'), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'Deployment failed' });
  });

  it('still validates siteId/html before any lookup', async () => {
    const res = mkRes();
    await handler(post({ html: '<h1/>' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(findBySlug).not.toHaveBeenCalled();
  });
});
