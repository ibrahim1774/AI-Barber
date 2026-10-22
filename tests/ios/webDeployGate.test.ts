import { describe, it, expect, vi, afterEach } from 'vitest';
import { gatedWebDeploy, vercelAppLabel, type WebDeployDeps } from '../../lib/ios/webDeployGate.js';
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

function deps(found: PurchaseRow | null | Error) {
  const d = {
    findBySlug: vi.fn(async (_slug: string) => { if (found instanceof Error) throw found; return found; }),
    deploy: vi.fn(async (i) => ({ deploymentUrl: `https://${i.siteId}.vercel.app`, uploadedImages: {} })),
    writePending: vi.fn(async (_slug: string, _p: PendingSite) => {}),
    now: () => NOW,
  };
  return d satisfies WebDeployDeps;
}

const body = (over: Record<string, unknown> = {}) => ({
  siteId: 'Fade-Studio-X7K2', html: '<html></html>', imageUrls: { hero: 'https://h' }, ...over,
});

describe('gatedWebDeploy', () => {
  afterEach(() => vi.restoreAllMocks());

  it('no iOS row (every web customer) → deploys exactly as before, writes nothing', async () => {
    const d = deps(null);
    const out = await gatedWebDeploy(body({ siteData: siteData() }), d);
    expect(d.findBySlug).toHaveBeenCalledWith('fade-studio-x7k2'); // slugified like deployRenderedSite
    expect(out.blocked).toBe(false);
    expect(out.result!.deploymentUrl).toBe('https://Fade-Studio-X7K2.vercel.app');
    // siteData is never passed to the deployer
    expect(d.deploy).toHaveBeenCalledWith({ siteId: 'Fade-Studio-X7K2', html: '<html></html>', imageUrls: { hero: 'https://h' }, css: undefined, images: undefined });
    expect(d.writePending).not.toHaveBeenCalled();
  });

  it('revoked iOS row → blocked, nothing deployed or written', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = deps(iosRow({ revoked_at: iso(NOW - 1) }));
    expect(await gatedWebDeploy(body({ siteData: siteData() }), d)).toEqual({ blocked: true });
    expect(d.deploy).not.toHaveBeenCalled();
    expect(d.writePending).not.toHaveBeenCalled();
  });

  it('an expired (not taken down, not revoked) iOS row still deploys: expiry is Apple\'s call (billing grace)', async () => {
    const d = deps(iosRow({ expires_at: iso(NOW - 5 * DAY) }));
    const out = await gatedWebDeploy(body({ siteData: siteData() }), d);
    expect(out.blocked).toBe(false);
    expect(d.deploy).toHaveBeenCalledTimes(1);
    expect(d.writePending).toHaveBeenCalledTimes(1);
  });

  it('taken-down iOS row → blocked even if the subscription is active again (restore owns that)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = deps(iosRow({ taken_down_at: iso(NOW - DAY) }));
    expect(await gatedWebDeploy(body(), d)).toEqual({ blocked: true });
    expect(d.deploy).not.toHaveBeenCalled();
  });

  it('active iOS row with siteData → deploys, then writes the pending file in the publishFlow shape', async () => {
    const d = deps(iosRow());
    const out = await gatedWebDeploy(body({ siteData: siteData() }), d);
    expect(out.blocked).toBe(false);
    expect(d.deploy).toHaveBeenCalledTimes(1);
    expect(d.writePending).toHaveBeenCalledTimes(1);
    const [slug, pending] = d.writePending.mock.calls[0];
    expect(slug).toBe('fade-studio-x7k2');
    expect(pending).toEqual({
      siteId: 'fade-studio-x7k2',
      existingSiteId: null,
      timestamp: NOW,
      deployedUrl: 'https://Fade-Studio-X7K2.vercel.app',
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
    const d = deps(iosRow());
    const out = await gatedWebDeploy(body(), d);
    expect(out.blocked).toBe(false);
    expect(d.writePending).not.toHaveBeenCalled();
  });

  it('malformed siteData or a failing pending write never fails a deploy that went live', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d1 = deps(iosRow());
    expect((await gatedWebDeploy(body({ siteData: { shopName: 'x', gallery: 'nope' } }), d1)).blocked).toBe(false);
    expect(d1.writePending).not.toHaveBeenCalled();
    const d2 = deps(iosRow());
    d2.writePending.mockRejectedValueOnce(new Error('gcs down'));
    const out = await gatedWebDeploy(body({ siteData: siteData() }), d2);
    expect(out.blocked).toBe(false);
    expect(out.result!.deploymentUrl).toContain('vercel.app');
    expect(err).toHaveBeenCalled();
  });

  it('lookup throws → logs and deploys as today', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps(new Error('supabase down'));
    const out = await gatedWebDeploy(body({ siteData: siteData() }), d);
    expect(out.blocked).toBe(false);
    expect(d.deploy).toHaveBeenCalledTimes(1);
    expect(d.writePending).not.toHaveBeenCalled();
    expect(err.mock.calls.flat().join(' ')).toMatch(/supabase down/);
  });

  it('a lookup that never answers times out and deploys as today (fail open)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = { ...deps(null), lookupTimeoutMs: 20 };
    d.findBySlug.mockImplementation(() => new Promise<PurchaseRow | null>(() => {}));
    const out = await gatedWebDeploy({ siteId: 'fade-studio', html: 'h', deployedUrl: 'https://fade-studio-x7k2.vercel.app', siteData: siteData() }, d);
    expect(out.blocked).toBe(false);
    expect(d.deploy).toHaveBeenCalledWith(expect.objectContaining({ siteId: 'fade-studio' }));
    expect(d.writePending).not.toHaveBeenCalled();
    expect(err.mock.calls.flat().join(' ')).toMatch(/timed out/);
  });

  it('default lookup cap is 3 s', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const d = deps(null);
      d.findBySlug.mockImplementation(() => new Promise<PurchaseRow | null>(() => {}));
      const p = gatedWebDeploy(body(), d);
      await vi.advanceTimersByTimeAsync(2_999);
      expect(d.deploy).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      await p;
      expect(d.deploy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a deploy error propagates (handler keeps its existing 500)', async () => {
    const d = deps(null);
    d.deploy.mockRejectedValueOnce(new Error('vercel'));
    await expect(gatedWebDeploy(body(), d)).rejects.toThrow('vercel');
  });
});

describe('gatedWebDeploy: a Sandbox row the sweep only gate-closed (N4)', () => {
  const sandboxDown = () => iosRow({ environment: 'Sandbox', taken_down_at: iso(NOW - DAY), expires_at: iso(NOW - 2 * DAY) });

  it('its website is still up (no offline page without IOS_TAKEDOWN_SANDBOX), so a web deploy goes ahead', async () => {
    const d = deps(sandboxDown());
    const out = await gatedWebDeploy(body({ siteData: siteData() }), d);
    expect(out.blocked).toBe(false);
    expect(d.deploy).toHaveBeenCalledTimes(1);
    expect(d.writePending).toHaveBeenCalledTimes(1);
  });

  it('with takedownSandbox (the offline page was deployed) it is blocked like Production', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = { ...deps(sandboxDown()), takedownSandbox: true };
    expect(await gatedWebDeploy(body(), d)).toEqual({ blocked: true });
    expect(d.deploy).not.toHaveBeenCalled();
  });

  it('a revoked Sandbox row is still blocked', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = deps(iosRow({ environment: 'Sandbox', revoked_at: iso(NOW - 1) }));
    expect(await gatedWebDeploy(body(), d)).toEqual({ blocked: true });
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
    const d = deps(iosRow({ product_id: P + suffix }));
    await gatedWebDeploy(body({ siteData: linked() }), d);
    const sd = d.writePending.mock.calls[0][1].siteData as any;
    expect('bookingUrl' in sd).toBe(keepsBook);
    expect('shopUrl' in sd).toBe(keepsShop);
  });

  it('a Booksy link is kept on Website', async () => {
    const d = deps(iosRow({ product_id: `${P}hosting.monthly` }));
    await gatedWebDeploy(body({ siteData: { ...siteData(), bookingUrl: 'https://booksy.com/x' } }), d);
    expect((d.writePending.mock.calls[0][1].siteData as any).bookingUrl).toBe('https://booksy.com/x');
  });
});

describe('gatedWebDeploy target slug from deployedUrl', () => {
  afterEach(() => vi.restoreAllMocks());
  const bySlug = (rows: Record<string, PurchaseRow>) => {
    const d = deps(null);
    d.findBySlug.mockImplementation(async (s: string) => rows[s] ?? null);
    return d;
  };

  it('web site whose vercel.app label differs from its project still deploys to the shop-name slug', async () => {
    const d = bySlug({});
    const out = await gatedWebDeploy({ siteId: 'ada', html: 'h', deployedUrl: 'https://ada-pearl-phi.vercel.app' }, d);
    expect(out.blocked).toBe(false);
    expect(d.findBySlug.mock.calls).toEqual([['ada-pearl-phi'], ['ada']]);
    expect(d.deploy).toHaveBeenCalledWith(expect.objectContaining({ siteId: 'ada' }));
    expect(d.writePending).not.toHaveBeenCalled();
  });

  it('iOS site with a suffixed slug deploys to that slug, not the shop-name slug, and refreshes its pending file', async () => {
    const d = bySlug({ 'fade-studio-x7k2': iosRow() });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const out = await gatedWebDeploy(
      { siteId: 'fade-studio', html: 'h', deployedUrl: 'https://fade-studio-x7k2.vercel.app/', siteData: siteData() }, d);
    expect(out.blocked).toBe(false);
    expect(d.findBySlug.mock.calls).toEqual([['fade-studio-x7k2']]);
    expect(d.deploy).toHaveBeenCalledWith(expect.objectContaining({ siteId: 'fade-studio-x7k2' }));
    expect(d.writePending.mock.calls[0][0]).toBe('fade-studio-x7k2');
  });

  it('a renamed iOS shop keeps deploying to its bound slug', async () => {
    const d = bySlug({ 'fade-studio-x7k2': iosRow() });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await gatedWebDeploy({ siteId: 'brand-new-name', html: 'h', deployedUrl: 'https://fade-studio-x7k2.vercel.app' }, d);
    expect(d.deploy).toHaveBeenCalledWith(expect.objectContaining({ siteId: 'fade-studio-x7k2' }));
  });

  it('a taken-down iOS site found via deployedUrl is blocked', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = bySlug({ 'fade-studio-x7k2': iosRow({ taken_down_at: iso(NOW - DAY) }) });
    expect(await gatedWebDeploy({ siteId: 'fade-studio', html: 'h', deployedUrl: 'https://fade-studio-x7k2.vercel.app' }, d))
      .toEqual({ blocked: true });
    expect(d.deploy).not.toHaveBeenCalled();
  });

  it('shop-name slug that is itself iOS-bound is still gated (custom-domain deployedUrl)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = bySlug({ 'fresh-cuts': iosRow({ site_slug: 'fresh-cuts', revoked_at: iso(NOW) }) });
    expect(await gatedWebDeploy({ siteId: 'fresh-cuts', html: 'h', deployedUrl: 'https://www.freshcuts.com' }, d))
      .toEqual({ blocked: true });
    expect(d.findBySlug.mock.calls).toEqual([['fresh-cuts']]);
  });

  it('a lookup error on the label falls back to today: deploy body.siteId, ungated', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps(new Error('db down'));
    const out = await gatedWebDeploy({ siteId: 'fade-studio', html: 'h', deployedUrl: 'https://fade-studio-x7k2.vercel.app', siteData: siteData() }, d);
    expect(out.blocked).toBe(false);
    expect(d.deploy).toHaveBeenCalledWith(expect.objectContaining({ siteId: 'fade-studio' }));
    expect(d.writePending).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
  });

  it('deployedUrl is never passed to the deployer', async () => {
    const d = bySlug({});
    await gatedWebDeploy({ siteId: 'x', html: 'h', deployedUrl: 'https://x.vercel.app' }, d);
    expect(Object.keys(d.deploy.mock.calls[0][0])).not.toContain('deployedUrl');
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
