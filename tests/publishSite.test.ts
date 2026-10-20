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
