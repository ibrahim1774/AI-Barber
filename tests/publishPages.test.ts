import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.mock('@google-cloud/storage', () => ({
  Storage: class {
    bucket() {
      return {
        file: (name: string) => ({
          exists: async () => [store.has(name)],
          download: async () => [Buffer.from(store.get(name) ?? '')],
          save: async (data: string) => { store.set(name, data); },
        }),
      };
    }
  },
}));
const deployRenderedSite = vi.fn(async (_args: any) => ({ deploymentUrl: 'https://fresh-cuts.vercel.app', uploadedImages: {}, projectName: 'fresh-cuts' }));
vi.mock('../lib/deploySite.js', () => ({ deployRenderedSite: (a: any) => deployRenderedSite(a) }));

import { publishSite, renderPending, renderPendingBundle, writePendingSite } from '../lib/publishSite.js';
import { DEMO_GALLERY_STOCK } from '../lib/stockImages.js';

const MID = '3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b';
const pending = (extra: Record<string, unknown> = {}, imageUrlMap: Record<string, string> = { hero: 'https://img.test/hero.jpg' }): any => ({
  siteId: 'fresh-cuts',
  siteData: {
    template: 'luxe', shopName: 'Fresh Cuts', area: 'Austin, TX', phone: '(512) 555-0100',
    bookingUrl: 'https://www.aibarber.org/book/fresh', shopUrl: 'https://www.aibarber.org/shop/fresh',
    hero: { heading: 'Fresh Cuts', tagline: 'Sharp.', imageUrl: 'uploaded' },
    about: { heading: 'About', description: ['Cutting hair since 1998.'], imageUrl: '' },
    services: [{ title: 'Fade', subtitle: '', description: 'A fade.', icon: 'scissors', imageUrl: '', price: '30' }],
    contact: { address: '1 Main St', email: '' },
    gallery: [], craftImages: [],
    staff: [{ name: 'Sam', bio: 'Fades.', photo: 'uploaded', memberId: MID }],
    reviews: [{ author: 'A', rating: 5, comment: 'Great' }],
    hours: [{ day: 'Mon', open: '9', close: '5' }],
    pages: { order: [], hidden: [] }, // multi-page is opt-in (P3b review B1)
    ...extra,
  },
  imageUrlMap: { ...imageUrlMap, ...(extra.staff === undefined ? { staff0: 'https://img.test/sam.jpg' } : {}) },
});
const deps = (base: string | null) => ({
  projectDomains: vi.fn(async () => []), domainServing: vi.fn(async () => true), updateShop: vi.fn(async () => {}),
  readBase: vi.fn(async () => base),
});

beforeEach(() => {
  store.clear();
  deployRenderedSite.mockClear();
  process.env.GCS_BUCKET_NAME = 'b';
  process.env.GCS_CREDENTIALS = JSON.stringify({ project_id: 'p' });
});

describe('renderPending', () => {
  it('returns SiteFile[]: index.html first, then the pages with data (file-list snapshot, full site)', () => {
    const files = renderPending(pending());
    expect(files.map((f) => f.path)).toMatchInlineSnapshot(`
      [
        "index.html",
        "about/index.html",
        "services/index.html",
        "services/fade/index.html",
        "team/index.html",
        "team/sam/index.html",
        "reviews/index.html",
        "hours/index.html",
        "contact/index.html",
      ]
    `);
    for (const f of files) expect(Object.keys(f).sort()).toEqual(['html', 'path']);
  });
  it('a stock-only gallery in the stored (marker) shape makes no Gallery page', () => {
    const p = pending({ gallery: ['uploaded', 'uploaded', 'uploaded'] }, Object.fromEntries([0, 1, 2].map((i) => [`gallery${i}`, DEMO_GALLERY_STOCK[i]])));
    expect(renderPending(p).map((f) => f.path)).not.toContain('gallery/index.html');
    const own = pending({ gallery: ['uploaded', 'uploaded', 'uploaded'] }, Object.fromEntries([0, 1, 2].map((i) => [`gallery${i}`, `https://img.test/g${i}.jpg`])));
    expect(renderPending(own).map((f) => f.path)).toContain('gallery/index.html');
  });
  it('base known -> canonical links and a sitemap; unknown -> neither', () => {
    expect(renderPendingBundle(pending()).sitemap).toBeNull();
    const b = renderPendingBundle(pending(), { siteBaseUrl: 'https://fresh-cuts.vercel.app' });
    expect(b.sitemap).toContain('https://fresh-cuts.vercel.app/about/');
    expect(b.pages.every((f) => f.html.includes('rel="canonical"'))).toBe(true);
  });
});

describe('publishSite deploys every page', () => {
  it('passes pages (home = html) and the sitemap built from the stored base; book/shop become the site\'s own pages', async () => {
    await writePendingSite('fresh-cuts', pending());
    const out = await publishSite('fresh-cuts', { force: true, findShop: async () => ({ id: 'shop-1', slug: 'fresh' }), siteBase: deps('https://freshcuts.com') });
    expect(out.ok).toBe(true);
    const arg = deployRenderedSite.mock.calls[0][0];
    expect(arg.pages.map((p: any) => p.path)).toContain('team/sam/index.html');
    expect(arg.html).toBe(arg.pages[0].html);
    expect(arg.sitemap).toContain('<loc>https://freshcuts.com/book</loc>');
    expect(arg.sitemap).toContain('<loc>https://freshcuts.com/shop</loc>');
    expect(arg.pages[0].html).toContain('href="/book"');
  });
  it('no stored base (first publish, or the read fails): pages ship with no canonical and no sitemap', async () => {
    await writePendingSite('fresh-cuts', pending());
    await publishSite('fresh-cuts', { force: true, findShop: async () => ({ id: 'shop-1', slug: 'fresh' }), siteBase: deps(null) });
    expect(deployRenderedSite.mock.calls[0][0].sitemap).toBeNull();
    deployRenderedSite.mockClear();
    const failing = { ...deps(null), readBase: vi.fn(async () => { throw new Error('db down'); }) };
    const out = await publishSite('fresh-cuts', { force: true, findShop: async () => ({ id: 'shop-1', slug: 'fresh' }), siteBase: failing });
    expect(out.ok).toBe(true);
    expect(deployRenderedSite.mock.calls[0][0].sitemap).toBeNull();
    expect(deployRenderedSite.mock.calls[0][0].pages.every((p: any) => !p.html.includes('rel="canonical"'))).toBe(true);
  });
  it('canonical uses the base valid at deploy time, not the one stored by the previous publish (P3b review S3)', async () => {
    await writePendingSite('fresh-cuts', pending());
    const live = { ...deps('https://fresh-cuts.vercel.app'), projectDomains: vi.fn(async () => [{ name: 'fresh-cuts.vercel.app', verified: true }, { name: 'freshcuts.com', verified: true }]) } as any;
    await publishSite('fresh-cuts', { force: true, findShop: async () => ({ id: 'shop-1', slug: 'fresh' }), siteBase: live });
    const arg = deployRenderedSite.mock.calls[0][0];
    expect(live.projectDomains).toHaveBeenCalledWith('fresh-cuts');
    expect(arg.pages.every((p: any) => p.html.includes('<link rel="canonical" href="https://freshcuts.com/'))).toBe(true);
    expect(arg.sitemap).toContain('<loc>https://freshcuts.com/about/</loc>');
    expect(arg.sitemap).not.toContain('vercel.app');
  });
  it('a site with no shop row still gets canonical links from the live base', async () => {
    await writePendingSite('fresh-cuts', pending());
    const live = { ...deps(null), projectDomains: vi.fn(async () => [{ name: 'fresh-cuts.vercel.app', verified: true }]) } as any;
    await publishSite('fresh-cuts', { force: true, findShop: async () => null, siteBase: live });
    const arg = deployRenderedSite.mock.calls[0][0];
    expect(arg.pages.every((p: any) => p.html.includes('<link rel="canonical" href="https://fresh-cuts.vercel.app/'))).toBe(true);
    expect(arg.sitemap).toContain('https://fresh-cuts.vercel.app/about/');
  });
  it('a failed domains lookup falls back to the stored base; with none stored there is no canonical', async () => {
    await writePendingSite('fresh-cuts', pending());
    const down = (base: string | null) => ({ ...deps(base), projectDomains: vi.fn(async () => { throw new Error('vercel down'); }) }) as any;
    await publishSite('fresh-cuts', { force: true, findShop: async () => ({ id: 'shop-1', slug: 'fresh' }), siteBase: down('https://freshcuts.com') });
    expect(deployRenderedSite.mock.calls[0][0].sitemap).toContain('https://freshcuts.com/about/');
    deployRenderedSite.mockClear();
    await publishSite('fresh-cuts', { force: true, findShop: async () => ({ id: 'shop-1', slug: 'fresh' }), siteBase: down(null) });
    expect(deployRenderedSite.mock.calls[0][0].sitemap).toBeNull();
    expect(deployRenderedSite.mock.calls[0][0].pages.every((p: any) => !p.html.includes('rel="canonical"'))).toBe(true);
  });
  it('a single-page site (no pages field) makes no domain lookup and ships no canonical or sitemap', async () => {
    const p = pending(); delete p.siteData.pages;
    await writePendingSite('fresh-cuts', p);
    const live = { ...deps('https://fresh-cuts.vercel.app'), projectDomains: vi.fn(async () => [{ name: 'fresh-cuts.vercel.app', verified: true }]) } as any;
    await publishSite('fresh-cuts', { force: true, findShop: async () => ({ id: 'shop-1', slug: 'fresh' }), siteBase: live });
    const arg = deployRenderedSite.mock.calls[0][0];
    expect(arg.pages).toHaveLength(1);
    expect(arg.sitemap).toBeNull();
    expect(arg.html).not.toContain('rel="canonical"');
  });
  it('a site without a shop gets its pages but no Book page', async () => {
    await writePendingSite('fresh-cuts', pending());
    await publishSite('fresh-cuts', { force: true, findShop: async () => null, siteBase: deps(null) });
    const arg = deployRenderedSite.mock.calls[0][0];
    expect(arg.subpages).toBeNull();
    expect(arg.pages.length).toBeGreaterThan(1);
    expect(arg.pages[0].html).not.toContain('href="/book"');
  });
});
