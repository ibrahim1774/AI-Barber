import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();

vi.mock('@google-cloud/storage', () => ({
  Storage: class {
    bucket() {
      return {
        file: (name: string) => ({
          exists: async () => [store.has(name)],
          download: async () => [Buffer.from(store.get(name) ?? '')],
          save: async (data: string) => {
            store.set(name, data);
          },
        }),
      };
    }
  },
}));

const deployRenderedSite = vi.fn(async (_args: any) => ({ deploymentUrl: 'https://x.vercel.app', uploadedImages: {} }));
vi.mock('../lib/deploySite.js', () => ({ deployRenderedSite: (a: any) => deployRenderedSite(a) }));
// A web site: no shop behind the slug (lib/siteSubpages.ts; a lookup error would fail the publish).
vi.mock('../lib/siteSubpages.js', async (orig) => ({ ...(await orig<object>()), findShopForSite: async () => null }));

import { publishSite, writePendingSite, slugify } from '../lib/publishSite.js';

const pending: any = {
  siteId: 'fresh-cuts',
  siteData: {
    template: 'luxe',
    shopName: 'Fresh Cuts',
    area: 'Austin',
    phone: '555-0100',
    hero: { heading: 'Fresh Cuts', tagline: 'Sharp.', imageUrl: '' },
    about: { heading: 'About', description: ['Barbers.'], imageUrl: '' },
    services: [{ title: 'Fade', subtitle: 'Classic', description: 'A fade.', icon: 'scissors', imageUrl: '' }],
    contact: { address: '1 Main St', email: 'a@b.co' },
    gallery: [],
    craftImages: [],
    staff: [],
  },
  imageUrlMap: {},
};

const liveFetch = () => vi.fn(async () => new Response('<meta name="published-at" content="x">', { status: 200 }));

beforeEach(() => {
  store.clear();
  deployRenderedSite.mockClear();
  process.env.GCS_BUCKET_NAME = 'b';
  process.env.GCS_CREDENTIALS = JSON.stringify({ project_id: 'p' });
});

describe('publishSite', () => {
  it('default call returns alreadyLive without deploying when our marker is served', async () => {
    await writePendingSite('fresh-cuts', pending);
    vi.stubGlobal('fetch', liveFetch());
    const out = await publishSite('fresh-cuts');
    expect(out.ok).toBe(true);
    expect(out.alreadyLive).toBe(true);
    expect(deployRenderedSite).not.toHaveBeenCalled();
  });

  it('force deploys even when the site is already live', async () => {
    await writePendingSite('fresh-cuts', pending);
    vi.stubGlobal('fetch', liveFetch());
    const out = await publishSite('fresh-cuts', { force: true });
    expect(out.ok).toBe(true);
    expect(out.alreadyLive).toBe(false);
    expect(deployRenderedSite).toHaveBeenCalledTimes(1);
  });

  it('slugify is idempotent: a cut at 50 never leaves a trailing dash (review finding 1)', () => {
    const S = 'a'.repeat(45) + '-bcd';
    for (const raw of [S + '-zzz', S + '-', S + '--x', 'Fresh Cuts', "Joe's  Barber -- Shop!", '-x-', 'é'.repeat(80)]) {
      const once = slugify(raw);
      expect(slugify(once)).toBe(once);
      expect(once).not.toMatch(/^-|-$/);
      expect(once.length).toBeLessThanOrEqual(50);
    }
    expect(slugify(S + '-zzz')).toBe(S);
  });

  it('writePendingSite then publishSite reads it back', async () => {
    await writePendingSite('Fresh Cuts', pending);
    expect(slugify('Fresh Cuts')).toBe('fresh-cuts');
    const stored = JSON.parse(store.get('pending-sites/fresh-cuts.json')!);
    expect(stored.siteId).toBe('fresh-cuts');
    expect(typeof stored.savedAt).toBe('number');
    expect(stored.data.siteData.shopName).toBe('Fresh Cuts');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    const out = await publishSite('fresh-cuts');
    expect(out.ok).toBe(true);
    expect(out.alreadyLive).toBe(false);
    expect(deployRenderedSite).toHaveBeenCalledTimes(1);
    expect(deployRenderedSite.mock.calls[0][0].siteId).toBe('fresh-cuts');
  });
});

describe('publishSite stamping (stored copy can change during a deploy)', () => {
  const read = () => JSON.parse(store.get('pending-sites/fresh-cuts.json')!).data;

  it('stamps deployedUrl onto the copy it deployed', async () => {
    await writePendingSite('fresh-cuts', { ...pending, version: 3, timestamp: 10 });
    await publishSite('fresh-cuts', { force: true });
    expect(read()).toMatchObject({ version: 3, deployedUrl: 'https://x.vercel.app' });
  });

  it('a newer copy written during the deploy is not overwritten by the stale stamp', async () => {
    await writePendingSite('fresh-cuts', { ...pending, version: 3, timestamp: 10 });
    deployRenderedSite.mockImplementationOnce(async () => {
      await writePendingSite('fresh-cuts', { ...pending, siteData: { ...pending.siteData, phone: 'NEW' }, version: 4, timestamp: 20 });
      return { deploymentUrl: 'https://x.vercel.app', uploadedImages: {} };
    });
    await publishSite('fresh-cuts', { force: true });
    expect(read()).toMatchObject({ version: 4, timestamp: 20 });
    expect(read().siteData.phone).toBe('NEW');
  });

  it('opts.pending deploys that copy and leaves the stored content as it was', async () => {
    await writePendingSite('fresh-cuts', { ...pending, version: 3, timestamp: 10, siteData: { ...pending.siteData, shopUrl: 'https://s' } });
    const alt = { ...pending, version: 3, timestamp: 10, siteData: { ...pending.siteData, shopName: 'Rendered Copy' } };
    await publishSite('fresh-cuts', { force: true, pending: alt });
    expect(deployRenderedSite.mock.calls[0][0].html).toContain('Rendered Copy');
    expect(read().siteData.shopName).toBe('Fresh Cuts');
    expect(read().siteData.shopUrl).toBe('https://s');
    expect(read().deployedUrl).toBe('https://x.vercel.app');
  });
});

describe('renderPending', () => {
  it('renders a stored copy; throws on data the renderers cannot handle', async () => {
    const { renderPending } = await import('../lib/publishSite.js');
    expect(renderPending(pending)).toContain('Fresh Cuts');
    expect(() => renderPending({ ...pending, siteData: { ...pending.siteData, contact: undefined } })).toThrow();
  });
});
