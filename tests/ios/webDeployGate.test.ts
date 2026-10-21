import { describe, it, expect, vi, afterEach } from 'vitest';
import { gatedWebDeploy, type WebDeployDeps } from '../../lib/ios/webDeployGate.js';
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
    published_at: iso(NOW - 10 * DAY), taken_down_at: null, ...over,
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
    findBySlug: vi.fn(async () => { if (found instanceof Error) throw found; return found; }),
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

  it('lapsed iOS row → blocked, nothing deployed or written', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const row of [iosRow({ expires_at: iso(NOW - 2 * DAY) }), iosRow({ revoked_at: iso(NOW - 1) })]) {
      const d = deps(row);
      expect(await gatedWebDeploy(body({ siteData: siteData() }), d)).toEqual({ blocked: true });
      expect(d.deploy).not.toHaveBeenCalled();
      expect(d.writePending).not.toHaveBeenCalled();
    }
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

  it('a deploy error propagates (handler keeps its existing 500)', async () => {
    const d = deps(null);
    d.deploy.mockRejectedValueOnce(new Error('vercel'));
    await expect(gatedWebDeploy(body(), d)).rejects.toThrow('vercel');
  });
});
