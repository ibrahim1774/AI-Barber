import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const store = new Map<string, string>();
// Generations, as GCS keeps them: the stored copy is written compare-and-set (e2e I1).
const gens = new Map<string, number>();
let gen = 0;
const notFound = () => Object.assign(new Error('not found'), { code: 404 });

vi.mock('@google-cloud/storage', () => ({
  Storage: class {
    bucket() {
      return {
        file: (name: string, opts: { generation?: number } = {}) => ({
          exists: async () => [store.has(name)],
          getMetadata: async () => {
            if (!store.has(name)) throw notFound();
            return [{ generation: String(gens.get(name)) }];
          },
          download: async () => {
            if (opts.generation != null && String(opts.generation) !== String(gens.get(name))) throw notFound();
            return [Buffer.from(store.get(name) ?? '')];
          },
          save: async (data: string, o: any = {}) => {
            const want = o?.preconditionOpts?.ifGenerationMatch;
            if (want != null && String(gens.get(name) ?? 0) !== String(want)) throw Object.assign(new Error('precondition'), { code: 412 });
            store.set(name, data);
            gens.set(name, ++gen);
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

import { publishSite, writePendingSite } from '../lib/publishSite.js';

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


beforeEach(() => {
  store.clear(); gens.clear(); deployRenderedSite.mockClear();
  process.env.GCS_BUCKET_NAME = 'b';
  process.env.GCS_CREDENTIALS = JSON.stringify({ project_id: 'p' });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('nothing', { status: 404 })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('SAFE_TAKE_OFFLINE: a removed slug with a kept copy is never redeployed by a non-owner', () => {
  const removed = vi.fn(async (_s: string) => true);
  const notRemoved = vi.fn(async (_s: string) => false);
  beforeEach(() => { removed.mockClear(); notRemoved.mockClear(); });
  it('switch on, non-owner caller (webhook / sweeper / restore): refused, nothing deployed', async () => {
    vi.stubEnv('SAFE_TAKE_OFFLINE', '1');
    await writePendingSite('fresh-cuts', pending);
    const out = await publishSite('fresh-cuts', { removedCheck: removed });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('site-removed');
    expect(deployRenderedSite).not.toHaveBeenCalled();
  });
  it('switch on, owner publish: allowed to deploy the kept copy', async () => {
    vi.stubEnv('SAFE_TAKE_OFFLINE', '1');
    await writePendingSite('fresh-cuts', pending);
    const out = await publishSite('fresh-cuts', { removedCheck: removed, ownerPublish: true, force: true });
    expect(out.ok).toBe(true);
    expect(deployRenderedSite).toHaveBeenCalled();
    expect(removed).not.toHaveBeenCalled(); // owner flows do not even read
  });
  it('switch on, not removed: deploys as today', async () => {
    vi.stubEnv('SAFE_TAKE_OFFLINE', '1');
    await writePendingSite('fresh-cuts', pending);
    expect((await publishSite('fresh-cuts', { removedCheck: notRemoved, force: true })).ok).toBe(true);
  });
  it('switch on, lookup error: fails closed for a non-owner (nothing deployed)', async () => {
    vi.stubEnv('SAFE_TAKE_OFFLINE', '1');
    await writePendingSite('fresh-cuts', pending);
    const out = await publishSite('fresh-cuts', { removedCheck: async () => { throw new Error('supabase 500'); }, force: true });
    expect(out.ok).toBe(false);
    expect(deployRenderedSite).not.toHaveBeenCalled();
  });
  it('switch off: no lookup at all, deploys as today', async () => {
    await writePendingSite('fresh-cuts', pending);
    const out = await publishSite('fresh-cuts', { removedCheck: removed, force: true });
    expect(out.ok).toBe(true);
    expect(removed).not.toHaveBeenCalled();
  });
});
