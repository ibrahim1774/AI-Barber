// Re-hosting imported photos at publish time. No network, no GCS: fetch is stubbed, storage is a Map.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rehostImageMap, rehostFilename, type RehostDeps } from '../../lib/rehostImages.js';
import { fetchPublicImage } from '../../lib/scrapers/safeFetch.js';
import { runWebPublish } from '../../lib/webApp/publishFlow.js';

afterEach(() => vi.unstubAllGlobals());

const PUBLIC = async () => ['93.184.216.34'];
const CDN = 'https://d2zdpiztbgorvt.cloudfront.net';
type Reply = { status?: number; type?: string; bytes?: number; magic?: boolean; headers?: Record<string, string> };

function stubFetch(routes: Record<string, Reply>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: any) => {
    const url = String(input);
    calls.push(url);
    const r = routes[url];
    if (!r) throw new Error(`unrouted fetch: ${url}`);
    const h = new Map(Object.entries({ 'content-type': r.type ?? 'image/jpeg', ...(r.headers || {}) }));
    const body = Buffer.alloc(r.bytes ?? 100, 1);
    if (r.magic !== false) { body[0] = 0xff; body[1] = 0xd8; body[2] = 0xff; } // real JPEG magic: the fetch trusts bytes, not headers
    let sent = false;
    return {
      status: r.status ?? 200,
      headers: { get: (k: string) => h.get(k.toLowerCase()) ?? null },
      body: { getReader: () => ({ read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: new Uint8Array(body) })), cancel: async () => {} }) },
    } as any;
  });
  return calls;
}

function deps(over: Partial<RehostDeps> = {}) {
  const store = new Map<string, Buffer>();
  const d: RehostDeps = {
    bucketName: 'bkt',
    fetchImage: (u, o) => fetchPublicImage(u, { ...o, resolve: PUBLIC }),
    exists: async (s, f) => store.has(`${s}/${f}`),
    upload: vi.fn(async (s, f, buf) => { store.set(`${s}/${f}`, buf); return `https://storage.googleapis.com/bkt/${s}/${f}`; }),
    urlOf: (s, f) => `https://storage.googleapis.com/bkt/${s}/${f}`,
    ...over,
  };
  return { d, store };
}
const WEB = { importedFrom: 'website' as const };
const hosted = (u: string) => `https://storage.googleapis.com/bkt/shop/${rehostFilename(u)}`;

describe('rehostImageMap', () => {
  it('re-hosts an in-scope site and substitutes the hosted URL (shared sources fetched once)', async () => {
    const a = `${CDN}/a.jpg`, b = `${CDN}/b.png`;
    const calls = stubFetch({ [a]: {}, [b]: { type: 'image/png' } });
    const { d } = deps();
    const out = await rehostImageMap('shop', WEB, { hero: a, gallery0: b, gallery1: a }, d);
    expect(out).toEqual({ hero: hosted(a), gallery0: hosted(b), gallery1: hosted(a) });
    expect(calls).toEqual([a, b]);
  });

  it('skips a private-address URL (never fetched) and leaves it', async () => {
    const calls = stubFetch({});
    const { d } = deps();
    const m = { hero: 'https://127.0.0.1/a.jpg', gallery0: 'https://intranet/a.jpg' };
    expect(await rehostImageMap('shop', WEB, m, d)).toEqual(m);
    expect(calls).toEqual([]);
  });

  it('skips a host that resolves to a private address', async () => {
    const calls = stubFetch({});
    const { d } = deps({ fetchImage: (u, o) => fetchPublicImage(u, { ...o, resolve: async () => ['10.0.0.5'] }) });
    const m = { hero: 'https://evil.example.com/a.jpg' };
    expect(await rehostImageMap('shop', WEB, m, d)).toEqual(m);
    expect(calls).toEqual([]);
  });

  it('skips non-image content (html, svg)', async () => {
    const h = `${CDN}/page.jpg`, s = `${CDN}/x.svg`;
    stubFetch({ [h]: { type: 'text/html' }, [s]: { type: 'image/svg+xml' } });
    const { d } = deps();
    const m = { hero: h, gallery0: s };
    expect(await rehostImageMap('shop', WEB, m, d)).toEqual(m);
    expect(d.upload).not.toHaveBeenCalled();
  });

  it('skips an oversize image, by declared length and by streamed size', async () => {
    const dec = `${CDN}/dec.jpg`, str = `${CDN}/str.jpg`;
    stubFetch({ [dec]: { headers: { 'content-length': String(7 * 1024 * 1024) } }, [str]: { bytes: 6 * 1024 * 1024 + 1 } });
    const { d } = deps();
    const m = { hero: dec, gallery0: str };
    expect(await rehostImageMap('shop', WEB, m, d)).toEqual(m);
    expect(d.upload).not.toHaveBeenCalled();
  });

  it('keeps the original on fetch, status and upload failures, and still re-hosts the good one', async () => {
    const bad = `${CDN}/404.jpg`, boom = `${CDN}/boom.jpg`, up = `${CDN}/up.jpg`, ok = `${CDN}/ok.jpg`;
    stubFetch({ [bad]: { status: 404 }, [up]: {}, [ok]: {} });
    const upload = vi.fn(async (s: string, f: string) => { if (f === rehostFilename(up)) throw new Error('gcs down'); return `https://storage.googleapis.com/bkt/${s}/${f}`; });
    const { d } = deps({ upload });
    const m = { hero: bad, gallery0: boom, gallery1: up, gallery2: ok };
    expect(await rehostImageMap('shop', WEB, m, d)).toEqual({ hero: bad, gallery0: boom, gallery1: up, gallery2: hosted(ok) });
  });

  it('a second publish does not fetch again (copy found by its hash name)', async () => {
    const a = `${CDN}/a.jpg`;
    const calls = stubFetch({ [a]: {} });
    const { d } = deps();
    await rehostImageMap('shop', WEB, { hero: a }, d);
    expect(calls).toHaveLength(1);
    expect(await rehostImageMap('shop', WEB, { hero: a }, d)).toEqual({ hero: hosted(a) });
    expect(calls).toHaveLength(1);
  });

  it('leaves an out-of-scope site untouched (booking, gbp, manual) with no fetch', async () => {
    const calls = stubFetch({});
    const { d } = deps();
    const m = { hero: `${CDN}/a.jpg` };
    for (const sd of [{ importedFrom: 'booking' }, { importedFrom: 'gbp' }, {}, null]) expect(await rehostImageMap('shop', sd as any, m, d)).toBe(m);
    expect(calls).toEqual([]);
  });

  it('does not touch our own storage, stock photos or own sites', async () => {
    const calls = stubFetch({});
    const { d } = deps();
    const m = { hero: 'https://storage.googleapis.com/bkt/x/y.jpg', gallery0: 'https://my-shop.vercel.app/a.jpg' };
    expect(await rehostImageMap('shop', WEB, m, d)).toEqual(m);
    expect(calls).toEqual([]);
  });

  it('caps at 30 images and 5 in parallel', async () => {
    let live = 0, peak = 0;
    const m: Record<string, string> = {};
    for (let i = 0; i < 40; i++) m[`gallery${i}`] = `${CDN}/${i}.jpg`;
    const { d } = deps({
      exists: async () => false,
      fetchImage: async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 2)); live--; return { buffer: Buffer.from('x'), contentType: 'image/jpeg' }; },
    });
    const out = await rehostImageMap('shop', WEB, m, d);
    expect(d.upload).toHaveBeenCalledTimes(30);
    expect(peak).toBeLessThanOrEqual(5);
    expect(out.gallery0).toBe(hosted(m.gallery0));
    expect(out.gallery35).toBe(m.gallery35);
  });

  it('gives up at the time budget and keeps the originals', async () => {
    const m = { hero: `${CDN}/a.jpg`, gallery0: `${CDN}/b.jpg` };
    const { d } = deps({ budgetMs: 30, fetchImage: () => new Promise(() => {}) });
    const t = Date.now();
    expect(await rehostImageMap('shop', WEB, m, d)).toEqual(m);
    expect(Date.now() - t).toBeLessThan(1000);
  });
});

describe('fetchPublicImage redirects', () => {
  it('re-checks every hop: a redirect to a private address is refused', async () => {
    stubFetch({ 'https://img.example.com/a.jpg': { status: 302, headers: { location: 'http://169.254.169.254/x.jpg' } } });
    await expect(fetchPublicImage('https://img.example.com/a.jpg', { resolve: PUBLIC })).rejects.toThrow();
  });
});

// The publish path itself: scope is decided on the server from siteData.importedFrom.
describe('runWebPublish', () => {
  const USER = '3f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f';
  const NOW = 1_800_000_000_000;
  const src = `${CDN}/h.jpg`;
  const site = (over: object = {}) => ({
    shopName: 'Fresh Cuts', area: 'Brooklyn', phone: '555-0100',
    hero: { heading: 'H', tagline: 'T', imageUrl: src }, about: { heading: 'A', description: ['d'], imageUrl: '' },
    services: [], gallery: [], craftImages: [], staff: [], contact: { address: '1 Main St', email: 'a@b.co' }, ...over,
  });
  function run(siteData: unknown, rehost: RehostDeps) {
    const pending = new Map<string, any>();
    const sites = new Map<string, any>();
    const owners = new Map<string, any>();
    const d: any = {
      environment: 'live', userOf: async () => ({ id: USER, email: 'o@example.com' }),
      entitlementOf: async () => ({ stripe_subscription_id: 'sub_1', stripe_customer_id: 'c', user_id: USER, site_slug: null, tier: 'website', billing_interval: 'month', status: 'active', environment: 'live', current_period_end: null, cancel_at_period_end: false }),
      sites: {
        byUser: async () => [...sites.values()][0] ?? null, get: async (s: string) => sites.get(s) ?? null,
        insertIfAbsent: async (r: any) => { sites.set(r.slug, { ...r, published_at: null, taken_down_at: null, removed_at: null }); return true; },
        releaseUnpublished: async () => {}, markPublished: async () => {},
      },
      owners: { get: async (s: string) => owners.get(s) ?? null, insertIfAbsent: async (r: any) => { if (owners.has(r.slug)) return false; owners.set(r.slug, r); return true; } },
      isTaken: async () => false, readPending: async (s: string) => pending.get(s) ?? null, writePending: async (s: string, p: any) => { pending.set(s, p); },
      publish: vi.fn(async (slug: string) => ({ ok: true, siteId: slug, deployedUrl: `https://${slug}.vercel.app` })),
      render: () => [], rememberSlug: async () => {}, now: () => NOW, rehost,
    };
    return runWebPublish({ siteData }, d, { authorization: 'Bearer t' }).then((r) => ({ r, pending, d }));
  }

  it('re-hosts for importedFrom website; the stored copy and the deploy see the hosted URL', async () => {
    stubFetch({ [src]: {} });
    const { d } = deps();
    const { r, pending } = await run(site({ importedFrom: 'website' }), d);
    expect(r.status).toBe(200);
    const stored = [...pending.values()][0];
    expect(stored.imageUrlMap.hero).toMatch(/^https:\/\/storage\.googleapis\.com\/bkt\/fresh-cuts[^/]*\/rehost-/);
  });

  it('a failing re-host never fails the publish; the original URL stays', async () => {
    const { d } = deps({ fetchImage: async () => { throw new Error('boom'); } });
    const { r, pending } = await run(site({ importedFrom: 'website' }), d);
    expect(r.status).toBe(200);
    expect([...pending.values()][0].imageUrlMap.hero).toBe(src);
  });

  it('does nothing for a site that is not a website import', async () => {
    const calls = stubFetch({});
    const { d } = deps();
    const { r, pending } = await run(site({ importedFrom: 'booking' }), d);
    expect(r.status).toBe(200);
    expect([...pending.values()][0].imageUrlMap.hero).toBe(src);
    expect(calls).toEqual([]);
  });
});

describe('fetchPublicImage: the bytes decide the type', () => {
  const publicHost = { resolve: async () => ['93.184.216.34'] };
  it("accepts a photo a CDN labels with a bare 'image' (Booksy cloudfront) when the bytes are a JPEG", async () => {
    const { fetchPublicImage } = await import('../../lib/scrapers/safeFetch.js');
    stubFetch({ 'https://cdn.example.com/a.jpeg': { type: 'image' } });
    const r = await fetchPublicImage('https://cdn.example.com/a.jpeg', publicHost as any);
    expect(r.contentType).toBe('image/jpeg');
  });
  it('refuses a vague type whose bytes are not an image, and a declared non-image type', async () => {
    const { fetchPublicImage } = await import('../../lib/scrapers/safeFetch.js');
    stubFetch({ 'https://cdn.example.com/b': { type: 'application/octet-stream', magic: false }, 'https://cdn.example.com/c': { type: 'text/html' } });
    await expect(fetchPublicImage('https://cdn.example.com/b', publicHost as any)).rejects.toThrow();
    await expect(fetchPublicImage('https://cdn.example.com/c', publicHost as any)).rejects.toThrow();
  });
});
