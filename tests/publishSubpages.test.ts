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

import { publishSite, writePendingSite } from '../lib/publishSite.js';

const pending = (links: Record<string, unknown> = {}): any => ({
  siteId: 'fresh-cuts',
  siteData: {
    template: 'prime', shopName: 'Fresh Cuts', area: 'Austin', phone: '555-0100',
    hero: { heading: 'Fresh Cuts', tagline: 'Sharp.', imageUrl: '' },
    about: { heading: 'About', description: ['Barbers.'], imageUrl: '' },
    services: [{ title: 'Fade', subtitle: '', description: '', icon: 'scissors', imageUrl: '', price: '30' }],
    contact: { address: '1 Main St', email: 'a@b.co' },
    gallery: [], craftImages: [], staff: [],
    ...links,
  },
  imageUrlMap: { hero: 'https://img.test/hero.jpg' },
});

const OLD = { bookingUrl: 'https://www.aibarber.org/book/fresh', shopUrl: 'https://www.aibarber.org/shop/fresh' };
const read = () => JSON.parse(store.get('pending-sites/fresh-cuts.json')!).data;

beforeEach(() => {
  store.clear();
  deployRenderedSite.mockClear();
  process.env.GCS_BUCKET_NAME = 'b';
  process.env.GCS_CREDENTIALS = JSON.stringify({ project_id: 'p' });
});

const baseDeps = () => ({ projectDomains: vi.fn(async () => [{ name: 'freshcuts.com', verified: true }]), updateShop: vi.fn(async () => {}) });

describe('publishSite with the site subpages', () => {
  it('a site with a shop deploys the rewrites, renders /book and /shop, and stores the shop base + look', async () => {
    await writePendingSite('fresh-cuts', pending(OLD));
    const siteBase = baseDeps();
    const out = await publishSite('fresh-cuts', { force: true, findShop: async () => ({ id: 'shop-1', slug: 'fresh' }), siteBase });
    expect(out.ok).toBe(true);
    const arg = deployRenderedSite.mock.calls[0][0];
    expect(arg.subpages).toEqual({ mode: 'full', shopSlug: 'fresh' });
    expect(arg.html).toContain('href="/book"');
    expect(arg.html).toContain('href="/shop"');
    expect(arg.html).not.toContain('aibarber.org/book/fresh');
    expect(arg.html).toContain('id="book-online"');
    expect(arg.html).toContain('id="shop-preview"');
    expect(siteBase.projectDomains).toHaveBeenCalledWith('fresh-cuts');
    expect(siteBase.updateShop).toHaveBeenCalledWith('shop-1', {
      site_base_url: 'https://freshcuts.com',
      site_look: { template: 'prime', accent: '#d4a64a', bg: '#0a0a0a', text: '#f0ece4', heroUrl: 'https://img.test/hero.jpg' },
    });
    // The stored copy keeps what the owner saved.
    expect(read().siteData.bookingUrl).toBe(OLD.bookingUrl);
  });

  it('a site without a shop (web customer) deploys exactly as before; relative links are dropped, old ones kept', async () => {
    await writePendingSite('fresh-cuts', pending({ bookingUrl: '/book', shopUrl: '/shop' }));
    const siteBase = baseDeps();
    await publishSite('fresh-cuts', { force: true, findShop: async () => null, siteBase });
    const arg = deployRenderedSite.mock.calls[0][0];
    expect(arg.subpages).toBeNull();
    expect(arg.html).not.toContain('href="/book"');
    expect(arg.html).not.toContain('href="/shop"');
    expect(siteBase.updateShop).not.toHaveBeenCalled();

    deployRenderedSite.mockClear();
    await writePendingSite('fresh-cuts', pending(OLD));
    await publishSite('fresh-cuts', { force: true, findShop: async () => null, siteBase });
    expect(deployRenderedSite.mock.calls[0][0].html).toContain('https://www.aibarber.org/book/fresh');
  });

  it('a failed shop lookup fails the publish (retryable) when the site has AI Barber links', async () => {
    await writePendingSite('fresh-cuts', pending(OLD));
    const out = await publishSite('fresh-cuts', { force: true, findShop: async () => { throw new Error('db down'); }, siteBase: baseDeps() });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('deploy-failed');
    expect(deployRenderedSite).not.toHaveBeenCalled();
  });

  it('a failed shop lookup does not block a site without AI Barber links (web customers)', async () => {
    await writePendingSite('fresh-cuts', pending({ bookingUrl: 'https://booksy.com/x' }));
    const out = await publishSite('fresh-cuts', { force: true, findShop: async () => { throw new Error('db down'); }, siteBase: baseDeps() });
    expect(out.ok).toBe(true);
    expect(deployRenderedSite.mock.calls[0][0].subpages).toBeNull();
  });

  it('a failed base update never fails a live publish', async () => {
    await writePendingSite('fresh-cuts', pending(OLD));
    const out = await publishSite('fresh-cuts', {
      force: true, findShop: async () => ({ id: 'shop-1', slug: 'fresh' }),
      siteBase: { projectDomains: async () => [], updateShop: async () => { throw new Error('db down'); } },
    });
    expect(out.ok).toBe(true);
  });
});
