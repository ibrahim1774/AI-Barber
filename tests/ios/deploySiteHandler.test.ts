import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { findBySlug, deployRenderedSite, writePendingSite, readPendingSite } = vi.hoisted(() => ({
  // The gate reads the previous copy to carry its version (no stored copy here).
  readPendingSite: vi.fn(async (_s: string) => null),
  findBySlug: vi.fn(),
  deployRenderedSite: vi.fn(async (_i: unknown) => ({ deploymentUrl: 'https://fresh-cuts.vercel.app', uploadedImages: {} })),
  writePendingSite: vi.fn(async (_s: string, _p: unknown) => {}),
}));
vi.mock('../../lib/deploySite.js', () => ({ deployRenderedSite }));
vi.mock('../../lib/ios/purchases.js', () => ({ supabasePurchases: () => ({ findBySlug }) }));
vi.mock('../../lib/publishSite.js', async (orig) => ({ ...(await orig<object>()), writePendingSite, readPendingSite }));

import handler from '../../api/deploy-site.js';

const mkRes = () => { const res: any = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn(), end: vi.fn() }; return res; };
const post = (body: unknown) => ({ method: 'POST', body });
const sd = {
  shopName: 'Fresh Cuts', hero: { imageUrl: 'https://img/h.jpg' }, about: { imageUrl: '' },
  gallery: [], services: [],
};

describe('api/deploy-site iOS gate', () => {
  beforeEach(() => { findBySlug.mockReset(); deployRenderedSite.mockClear(); writePendingSite.mockClear(); });
  afterEach(() => vi.restoreAllMocks());

  it('web slug (no iOS row) → 200, same response as before', async () => {
    findBySlug.mockResolvedValue(null);
    const res = mkRes();
    await handler(post({ siteId: 'fresh-cuts', html: '<h1/>', imageUrls: {}, siteData: sd }), res);
    expect(findBySlug).toHaveBeenCalledWith('fresh-cuts');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, deploymentUrl: 'https://fresh-cuts.vercel.app' }));
    expect(writePendingSite).not.toHaveBeenCalled();
  });

  it('revoked or taken-down iOS slug → 402 subscription-inactive, no deploy', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const extra of [{ revoked_at: '2026-10-01T00:00:00Z', taken_down_at: null }, { revoked_at: null, taken_down_at: '2026-10-01T00:00:00Z' }]) {
      findBySlug.mockResolvedValue({ original_transaction_id: 'o1', site_slug: 'fresh-cuts', expires_at: '2020-01-01T00:00:00Z', ...extra });
      const res = mkRes();
      await handler(post({ siteId: 'fresh-cuts', html: '<h1/>', siteData: sd }), res);
      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'subscription-inactive' });
    }
    expect(deployRenderedSite).not.toHaveBeenCalled();
  });

  it('iOS site published from the web with its suffixed deployedUrl deploys to the bound slug', async () => {
    findBySlug.mockImplementation(async (s: string) => (s === 'fresh-cuts-x7k2'
      ? { original_transaction_id: 'o1', site_slug: 'fresh-cuts-x7k2', expires_at: '2999-01-01T00:00:00Z', revoked_at: null, taken_down_at: null }
      : null));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = mkRes();
    await handler(post({ siteId: 'fresh-cuts', html: '<h1/>', deployedUrl: 'https://fresh-cuts-x7k2.vercel.app', siteData: sd }), res);
    expect(deployRenderedSite).toHaveBeenCalledWith(expect.objectContaining({ siteId: 'fresh-cuts-x7k2' }));
    expect(writePendingSite).toHaveBeenCalledWith('fresh-cuts-x7k2', expect.anything());
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('web site whose vercel.app label differs from the project → shop-name slug, as today', async () => {
    findBySlug.mockResolvedValue(null);
    const res = mkRes();
    await handler(post({ siteId: 'ada', html: '<h1/>', deployedUrl: 'https://ada-pearl-phi.vercel.app', siteData: sd }), res);
    expect(deployRenderedSite).toHaveBeenCalledWith(expect.objectContaining({ siteId: 'ada' }));
    expect(writePendingSite).not.toHaveBeenCalled();
  });

  it('active iOS slug with siteData → deploys and writes pending-sites/<slug>.json', async () => {
    findBySlug.mockResolvedValue({ original_transaction_id: 'o1', site_slug: 'fresh-cuts', expires_at: '2999-01-01T00:00:00Z', revoked_at: null, taken_down_at: null });
    const res = mkRes();
    await handler(post({ siteId: 'fresh-cuts', html: '<h1/>', siteData: sd }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(writePendingSite).toHaveBeenCalledWith('fresh-cuts', expect.objectContaining({
      siteId: 'fresh-cuts', imageUrlMap: { hero: 'https://img/h.jpg' }, deployedUrl: 'https://fresh-cuts.vercel.app',
    }));
  });

  it('lookup throws → deploys anyway', async () => {
    findBySlug.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = mkRes();
    await handler(post({ siteId: 'fresh-cuts', html: '<h1/>' }), res);
    expect(deployRenderedSite).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('still validates siteId/html before any lookup', async () => {
    const res = mkRes();
    await handler(post({ html: '<h1/>' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(findBySlug).not.toHaveBeenCalled();
  });
});
