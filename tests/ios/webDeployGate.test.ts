import { describe, it, expect, vi, afterEach } from 'vitest';
import { gatedWebDeploy, vercelAppLabel, type AuthorisedTarget, type WebDeployDeps } from '../../lib/ios/webDeployGate.js';
import type { PurchaseRow } from '../../lib/ios/purchases.js';
import type { PendingSite } from '../../lib/publishSite.js';
import type { WebsiteData } from '../../types.js';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

function iosRow(over: Partial<PurchaseRow> = {}): PurchaseRow {
  return {
    original_transaction_id: 'o1', product_id: 'p', environment: 'Production', site_slug: 'fade-studio-x7k2',
    user_id: null, expires_at: iso(NOW + 10 * DAY), revoked_at: null, last_notification: null,
    published_at: iso(NOW - 10 * DAY), taken_down_at: null, lapse_checked_at: null, ...over,
  };
}

const siteData = (): WebsiteData => ({
  shopName: 'Fade Studio Renamed',
  area: 'Austin',
  phone: '555',
  hero: { heading: 'H', tagline: 'T', imageUrl: 'https://storage.googleapis.com/b/fade/hero.jpg' },
  about: { heading: 'A', description: ['d'], imageUrl: '' },
  services: [{ name: 'Fade', price: '$30', imageUrl: 'https://x/svc.jpg' }],
  gallery: ['https://storage.googleapis.com/b/fade/g0.jpg', ''],
  staff: [{ name: 'Sam', photo: 'https://storage.googleapis.com/b/fade/s0.jpg' }],
} as unknown as WebsiteData);

function deps() {
  const d = {
    deploy: vi.fn(async (i: { siteId: string }) => ({ deploymentUrl: `https://${i.siteId}.vercel.app`, uploadedImages: {} })),
    writePending: vi.fn(async (_slug: string, _p: PendingSite) => {}),
    now: () => NOW,
  };
  return d satisfies WebDeployDeps;
}

const body = (over: Record<string, unknown> = {}) => ({
  html: '<html></html>', imageUrls: { hero: 'https://h' }, ...over,
});

/** What lib/deployAuth.ts authorised: the app owner of `row`, a web caller (row null), or the admin. */
const owner = (row: PurchaseRow = iosRow()): AuthorisedTarget => ({ target: row.site_slug!, row, actor: 'app-owner' });
const web = (target = 'fresh-cuts'): AuthorisedTarget => ({ target, row: null, actor: 'web-user' });

describe('gatedWebDeploy', () => {
  afterEach(() => vi.restoreAllMocks());

  it('web site (no iOS row) → deploys the authorised slug, writes nothing', async () => {
    const d = deps();
    const out = await gatedWebDeploy(body({ siteData: siteData() }), web('fade-studio-x7k2'), d);
    expect(out.blocked).toBe(false);
    expect(out.result!.deploymentUrl).toBe('https://fade-studio-x7k2.vercel.app');
    // siteData is never passed to the deployer, and neither are raw `images`
    expect(d.deploy).toHaveBeenCalledWith({ siteId: 'fade-studio-x7k2', html: '<html></html>', imageUrls: { hero: 'https://h' }, css: undefined });
    expect(d.writePending).not.toHaveBeenCalled();
  });

  it('raw `images` in the input are never forwarded (they would write anywhere in the bucket)', async () => {
    const d = deps();
    await gatedWebDeploy({ ...body(), images: [{ key: 'k', filename: 'fade-lab.json', base64: 'data:image/jpeg;base64,AA' }] } as any, web('pending-sites'), d);
    expect(Object.keys(d.deploy.mock.calls[0][0])).not.toContain('images');
  });

  it('a web deploy stamps the live URL on the stored copy (server-owned stamp); an app deploy does not', async () => {
    const d = { ...deps(), stampWebPending: vi.fn(async (_s: string, _u: string) => {}) };
    await gatedWebDeploy(body(), web('fresh-cuts'), d);
    expect(d.stampWebPending).toHaveBeenCalledWith('fresh-cuts', 'https://fresh-cuts.vercel.app');
    d.stampWebPending.mockClear();
    await gatedWebDeploy(body(), owner(), d);
    expect(d.stampWebPending).not.toHaveBeenCalled();
  });

  it('a failing stamp never fails a deploy that went live', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = { ...deps(), stampWebPending: vi.fn(async () => { throw new Error('gcs down'); }) };
    const out = await gatedWebDeploy(body(), web('fresh-cuts'), d);
    expect(out.blocked).toBe(false);
    expect(out.result!.deploymentUrl).toBe('https://fresh-cuts.vercel.app');
  });

  it('the admin deploying an app site never writes its stored copy (admin edits go through /api/admin/sites)', async () => {
    const d = deps();
    const out = await gatedWebDeploy(body({ siteData: siteData() }), { target: 'fade-studio-x7k2', row: iosRow(), actor: 'admin' }, d);
    expect(out.blocked).toBe(false);
    expect(d.deploy).toHaveBeenCalledTimes(1);
    expect(d.writePending).not.toHaveBeenCalled();
  });

  it('revoked iOS row → blocked, nothing deployed or written', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const row = iosRow({ revoked_at: iso(NOW - 1) });
    const d = deps();
    expect(await gatedWebDeploy(body({ siteData: siteData() }), owner(row), d)).toEqual({ blocked: true });
    expect(d.deploy).not.toHaveBeenCalled();
    expect(d.writePending).not.toHaveBeenCalled();
  });

  it('an expired (not taken down, not revoked) iOS row still deploys: expiry is Apple\'s call (billing grace)', async () => {
    const row = iosRow({ expires_at: iso(NOW - 5 * DAY) });
    const d = deps();
    const out = await gatedWebDeploy(body({ siteData: siteData() }), owner(row), d);
    expect(out.blocked).toBe(false);
    expect(d.deploy).toHaveBeenCalledTimes(1);
    expect(d.writePending).toHaveBeenCalledTimes(1);
  });

  it('taken-down iOS row → blocked even if the subscription is active again (restore owns that)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const row = iosRow({ taken_down_at: iso(NOW - DAY) });
    const d = deps();
    expect(await gatedWebDeploy(body(), owner(row), d)).toEqual({ blocked: true });
    expect(d.deploy).not.toHaveBeenCalled();
  });

  it('active iOS row with siteData → deploys, then writes the pending file in the publishFlow shape', async () => {
    const row = iosRow();
    const d = deps();
    const out = await gatedWebDeploy(body({ siteData: siteData() }), owner(row), d);
    expect(out.blocked).toBe(false);
    expect(d.deploy).toHaveBeenCalledTimes(1);
    expect(d.writePending).toHaveBeenCalledTimes(1);
    const [slug, pending] = d.writePending.mock.calls[0];
    expect(slug).toBe('fade-studio-x7k2');
    expect(pending).toEqual({
      siteId: 'fade-studio-x7k2',
      existingSiteId: null,
      timestamp: NOW,
      deployedUrl: 'https://fade-studio-x7k2.vercel.app',
      version: 1,
      editedBy: 'owner',
      editedAt: iso(NOW),
      imageUrlMap: {
        hero: 'https://storage.googleapis.com/b/fade/hero.jpg',
        gallery0: 'https://storage.googleapis.com/b/fade/g0.jpg',
        staff0: 'https://storage.googleapis.com/b/fade/s0.jpg',
      },
      siteData: expect.objectContaining({
        shopName: 'Fade Studio Renamed',
        hero: expect.objectContaining({ imageUrl: 'uploaded' }),
        about: expect.objectContaining({ imageUrl: '' }),
        gallery: ['uploaded', ''],
        services: [expect.objectContaining({ imageUrl: '' })],
        staff: [expect.objectContaining({ photo: 'uploaded' })],
      }),
    });
    // deploy happens before the pending write
    expect(d.deploy.mock.invocationCallOrder[0]).toBeLessThan(d.writePending.mock.invocationCallOrder[0]);
  });

  it('active iOS row without siteData → deploys, writes nothing', async () => {
    const row = iosRow();
    const d = deps();
    const out = await gatedWebDeploy(body(), owner(row), d);
    expect(out.blocked).toBe(false);
    expect(d.writePending).not.toHaveBeenCalled();
  });

  it('malformed siteData or a failing pending write never fails a deploy that went live', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const row1 = iosRow();
    const d1 = deps();
    expect((await gatedWebDeploy(body({ siteData: { shopName: 'x', gallery: 'nope' } }), owner(row1), d1)).blocked).toBe(false);
    expect(d1.writePending).not.toHaveBeenCalled();
    const row2 = iosRow();
    const d2 = deps();
    d2.writePending.mockRejectedValueOnce(new Error('gcs down'));
    const out = await gatedWebDeploy(body({ siteData: siteData() }), owner(row2), d2);
    expect(out.blocked).toBe(false);
    expect(out.result!.deploymentUrl).toContain('vercel.app');
    expect(err).toHaveBeenCalled();
  });

  it('a deploy error propagates (handler keeps its existing 500)', async () => {
    const d = deps();
    d.deploy.mockRejectedValueOnce(new Error('vercel'));
    await expect(gatedWebDeploy(body(), web(), d)).rejects.toThrow('vercel');
  });
});

describe('gatedWebDeploy: a Sandbox row the sweep only gate-closed (N4)', () => {
  const sandboxDown = () => iosRow({ environment: 'Sandbox', taken_down_at: iso(NOW - DAY), expires_at: iso(NOW - 2 * DAY) });

  it('its website is still up (no offline page without IOS_TAKEDOWN_SANDBOX), so a web deploy goes ahead', async () => {
    const row = sandboxDown();
    const d = deps();
    const out = await gatedWebDeploy(body({ siteData: siteData() }), owner(row), d);
    expect(out.blocked).toBe(false);
    expect(d.deploy).toHaveBeenCalledTimes(1);
    expect(d.writePending).toHaveBeenCalledTimes(1);
  });

  it('with takedownSandbox (the offline page was deployed) it is blocked like Production', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const row = sandboxDown();
    const d = { ...deps(), takedownSandbox: true };
    expect(await gatedWebDeploy(body(), owner(row), d)).toEqual({ blocked: true });
    expect(d.deploy).not.toHaveBeenCalled();
  });

  it('a revoked Sandbox row is still blocked', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const row = iosRow({ environment: 'Sandbox', revoked_at: iso(NOW - 1) });
    const d = deps();
    expect(await gatedWebDeploy(body(), owner(row), d)).toEqual({ blocked: true });
  });
});

describe('gatedWebDeploy tiers (M3): the pending copy gets the same link strip as the app publish', () => {
  const P = 'com.ibrahim1774.aibarber.';
  const linked = () => ({ ...siteData(), bookingUrl: 'https://www.aibarber.org/book/fade', shopUrl: 'https://www.aibarber.org/shop/fade' });

  it.each([
    ['hosting.monthly', false, false],
    ['bookings.yearly', true, false],
    ['store.monthly', true, true],
  ])('%s', async (suffix, keepsBook, keepsShop) => {
    const row = iosRow({ product_id: P + suffix });
    const d = deps();
    await gatedWebDeploy(body({ siteData: linked() }), owner(row), d);
    const sd = d.writePending.mock.calls[0][1].siteData as any;
    expect('bookingUrl' in sd).toBe(keepsBook);
    expect('shopUrl' in sd).toBe(keepsShop);
  });

  it('a Booksy link is kept on Website', async () => {
    const row = iosRow({ product_id: `${P}hosting.monthly` });
    const d = deps();
    await gatedWebDeploy(body({ siteData: { ...siteData(), bookingUrl: 'https://booksy.com/x' } }), owner(row), d);
    expect((d.writePending.mock.calls[0][1].siteData as any).bookingUrl).toBe('https://booksy.com/x');
  });
});

describe('vercelAppLabel', () => {
  it('first label of a *.vercel.app host', () => {
    expect(vercelAppLabel('https://fade-studio-x7k2.vercel.app')).toBe('fade-studio-x7k2');
    expect(vercelAppLabel('https://Mixed-Case.VERCEL.app/path')).toBe('mixed-case');
    expect(vercelAppLabel('https://a.b.vercel.app')).toBe('a');
  });
  it('null for custom domains, look-alikes, null and garbage', () => {
    expect(vercelAppLabel('https://www.freshcuts.com')).toBeNull();
    expect(vercelAppLabel('https://evil.vercel.app.example.com')).toBeNull();
    expect(vercelAppLabel(null)).toBeNull();
    expect(vercelAppLabel('')).toBeNull();
    expect(vercelAppLabel('not a url')).toBeNull();
    expect(vercelAppLabel(42)).toBeNull();
  });
});

describe('gatedWebDeploy site versions', () => {
  it('a web edit of an iOS site bumps the stored version (owner) and carries the admin version forward', async () => {
    const row = iosRow();
    const d = {
      ...deps(),
      readPending: vi.fn(async (_slug: string) => ({ siteId: 'fade-studio-x7k2', siteData: siteData(), version: 4, editedBy: 'admin', adminVersion: 4 } as PendingSite)),
    };
    await gatedWebDeploy(body({ siteData: siteData() }), owner(row), d);
    expect(d.readPending).toHaveBeenCalledWith('fade-studio-x7k2');
    expect(d.writePending.mock.calls[0][1]).toMatchObject({ version: 5, editedBy: 'owner', editedAt: iso(NOW), adminVersion: 4 });
  });

  it('a failed read of the previous copy skips the refresh (never restarts the version); the deploy still succeeds', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const row = iosRow();
    const d = { ...deps(), readPending: vi.fn(async () => { throw new Error('gcs down'); }) };
    const out = await gatedWebDeploy(body({ siteData: siteData() }), owner(row), d);
    expect(out.blocked).toBe(false);
    expect(out.result!.deploymentUrl).toMatch(/vercel\.app$/);
    expect(d.writePending).not.toHaveBeenCalled();
  });
});
