// Phase 1 step 5 through publishSite: the previous publish's paths are read, the diff becomes redirects in the deploy, the new record is
// stored; a site that does not qualify (iOS-made, pages v1, single page) never touches the store and ships exactly what it always did.
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
import type { PathsStore } from '../lib/publishedPathsStore';
import { parsePublishedPaths, type PublishedPaths } from '../lib/siteRedirects';

const { buildSiteFiles } = await vi.importActual<typeof import('../lib/deploySite.js')>('../lib/deploySite.js');
const svc = (title: string) => ({ title, subtitle: '', description: `${title} done properly.`, icon: 'scissors', imageUrl: '', price: '30' });
const pending = (titles: string[], extra: Record<string, unknown> = {}): any => ({
  siteId: 'fresh-cuts',
  siteData: {
    template: 'luxe', shopName: 'Fresh Cuts', area: 'Austin, TX', phone: '(512) 555-0100',
    hero: { heading: 'Fresh Cuts', tagline: 'Sharp.', imageUrl: 'uploaded' },
    about: { heading: 'About', description: ['Cutting hair since 1998.'], imageUrl: '' },
    services: titles.map(svc),
    contact: { address: '1 Main St, Austin, TX 78701', email: '' },
    gallery: [], craftImages: [], staff: [], reviews: [], hours: [{ day: 'Mon', open: '9', close: '5' }],
    pages: { order: [], hidden: [] },
    extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 3 },
    source: 'web-app',
    ...extra,
  },
  imageUrlMap: { hero: 'https://img.test/hero.jpg' },
});
const siteBase = (base: string | null) => ({ projectDomains: vi.fn(async () => (base ? [{ name: new URL(base).host, verified: true }] : [])), domainServing: vi.fn(async () => true), updateShop: vi.fn(async () => {}), readBase: vi.fn(async () => base) });
const BASE = 'https://freshcuts.com';

function fakeStore(initial: PublishedPaths | null = null) {
  let value: PublishedPaths | null = initial;
  const s = {
    read: vi.fn(async (_slug: string) => (value ? parsePublishedPaths(JSON.parse(JSON.stringify(value))) : null)),
    write: vi.fn(async (_slug: string, v: PublishedPaths, _prev?: PublishedPaths | null) => { value = JSON.parse(JSON.stringify(v)); }),
  };
  return { s: s as PathsStore & typeof s, get: () => value };
}
const go = async (titles: string[], ps: PathsStore | null, extra: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) => {
  deployRenderedSite.mockClear();
  await writePendingSite('fresh-cuts', pending(titles, extra));
  const out = await publishSite('fresh-cuts', { force: true, findShop: async () => null, siteBase: siteBase(BASE) as any, pathsStore: ps, ...opts });
  expect(out.ok).toBe(true);
  return deployRenderedSite.mock.calls[0][0];
};
const R = (from: string, to: string) => ({ from: `/services/${from}/`, to: to ? `/services/${to}/` : '/services/' });
const vercelJson = (arg: any) => JSON.parse(Buffer.from(buildSiteFiles(arg.pages, '', arg.subpages ?? null, { sitemap: arg.sitemap, robots: arg.robots, redirects: arg.redirects }).find((f) => f.file === 'vercel.json')!.data, 'base64').toString());

beforeEach(() => {
  store.clear();
  deployRenderedSite.mockClear();
  process.env.GCS_BUCKET_NAME = 'b';
  process.env.GCS_CREDENTIALS = JSON.stringify({ project_id: 'p' });
});

describe('the first tracked publish records the paths and ships no redirect', () => {
  it('stores / and every page path; nothing to redirect', async () => {
    const { s, get } = fakeStore();
    const arg = await go(['Fade', 'Beard Trim'], s);
    expect(arg.redirects).toBeUndefined();
    expect('redirects' in arg).toBe(false);
    expect(s.read).toHaveBeenCalledWith('fresh-cuts');
    expect(s.write).toHaveBeenCalledTimes(1);
    expect(get()!.v).toBe(1);
    expect(get()!.paths).toEqual(expect.arrayContaining(['/', '/services/', '/services/fade/', '/services/beard-trim/', '/faq/', '/first-visit/']));
    expect(get()!.paths).toEqual([...get()!.paths].sort());
    expect(get()!.redirects).toEqual([]);
  });
});

describe('remove, rename, re-add, chains', () => {
  it('a removed service redirects to /services/, the deploy carries the 308 rules, the sitemap and every page leave it out', async () => {
    const { s, get } = fakeStore();
    await go(['Fade', 'Beard Trim', 'Kids Cut'], s);
    const arg = await go(['Fade', 'Kids Cut'], s);
    expect(arg.redirects).toEqual([R('beard-trim', '')]);
    expect(get()!.redirects).toEqual([R('beard-trim', '')]);
    expect(vercelJson(arg).redirects).toEqual([
      { source: '/services/beard-trim', destination: '/services/', permanent: true }, { source: '/services/beard-trim/', destination: '/services/', permanent: true },
      { source: '/services/beard-trim/index.html', destination: '/services/', permanent: true },
    ]);
    expect(arg.sitemap).toContain('https://freshcuts.com/services/fade/');
    expect(arg.sitemap).not.toContain('beard-trim');
    for (const p of arg.pages) { expect(p.html, p.path).not.toContain('/services/beard-trim'); expect(p.path).not.toContain('beard-trim'); }
  });
  it('a rename with the editor\'s moved map redirects to the new page; JSON-LD and the sitemap list only the new one', async () => {
    const { s, get } = fakeStore();
    await go(['Fade', 'Beard Trim'], s);
    const arg = await go(['Skin Fade', 'Beard Trim'], s, { extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 3, moved: { fade: 'skin-fade' } } });
    expect(arg.redirects).toEqual([R('fade', 'skin-fade')]);
    expect(get()!.redirects).toEqual([R('fade', 'skin-fade')]);
    expect(arg.sitemap).toContain('/services/skin-fade/');
    expect(arg.sitemap).not.toContain('/services/fade/');
    expect(arg.pages.some((p: any) => p.html.includes('application/ld+json'))).toBe(true);
    for (const p of arg.pages) expect(p.html, p.path).not.toMatch(/\/services\/fade\//);
  });
  it('a rename without that map is a removal (never guessed)', async () => {
    const { s } = fakeStore();
    await go(['Fade', 'Beard Trim'], s);
    expect((await go(['Skin Fade', 'Beard Trim'], s)).redirects).toEqual([R('fade', '')]);
  });
  it('re-adding the service drops its redirect and the rules', async () => {
    const { s, get } = fakeStore();
    await go(['Fade', 'Beard Trim'], s);
    expect((await go(['Fade'], s)).redirects).toEqual([R('beard-trim', '')]);
    const arg = await go(['Fade', 'Beard Trim'], s);
    expect(arg.redirects).toBeUndefined();
    expect(get()!.redirects).toEqual([]);
    expect(vercelJson(arg).redirects).toBeUndefined();
    expect(arg.sitemap).toContain('/services/beard-trim/');
  });
  it('remove, then rename another: both redirects, each one hop', async () => {
    const { s } = fakeStore();
    await go(['Fade', 'Beard Trim', 'Kids Cut'], s);
    await go(['Fade', 'Kids Cut'], s);
    const arg = await go(['Fade', 'Junior Cut'], s, { extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 3, moved: { 'kids-cut': 'junior-cut' } } });
    expect(arg.redirects).toEqual([R('beard-trim', ''), R('kids-cut', 'junior-cut')]);
    const live = new Set(arg.pages.map((p: any) => p.path));
    for (const r of arg.redirects) { expect(live.has(`${r.from.slice(1)}index.html`)).toBe(false); expect(live.has(`${r.to.slice(1)}index.html`) || r.to === '/services/').toBe(true); }
  });
  it('the 13th service has no page; removing the 3rd redirects to /services/', async () => {
    const { s } = fakeStore();
    const titles = Array.from({ length: 13 }, (_, i) => `Service ${i + 1}`);
    const first = await go(titles, s);
    expect(first.pages.filter((p: any) => /^services\/[^/]+\/index\.html$/.test(p.path))).toHaveLength(12);
    const arg = await go(titles.filter((_, i) => i !== 2), s);
    expect(arg.redirects).toEqual([R('service-3', '')]);
    expect(arg.pages.map((p: any) => p.path)).toContain('services/service-13/index.html');
  });
  it('hidden services group: no /services/ page, so no redirect (a plain 404, never a redirect to a page that is not there)', async () => {
    const { s } = fakeStore();
    await go(['Fade', 'Beard Trim'], s);
    const arg = await go(['Fade', 'Beard Trim'], s, { pages: { order: [], hidden: ['services'] } });
    expect(arg.pages.map((p: any) => p.path)).not.toContain('services/index.html');
    expect(arg.redirects).toBeUndefined();
  });
});

describe('republishing', () => {
  it('is idempotent: the same redirects and vercel.json, and nothing is written again', async () => {
    const { s } = fakeStore();
    await go(['Fade', 'Beard Trim'], s);
    const a = await go(['Fade'], s);
    expect(s.write).toHaveBeenCalledTimes(2);
    const b = await go(['Fade'], s);
    const c = await go(['Fade'], s);
    expect(s.write).toHaveBeenCalledTimes(2);
    expect(b.redirects).toEqual(a.redirects); expect(c.redirects).toEqual(a.redirects);
    expect(JSON.stringify(vercelJson(b))).toBe(JSON.stringify(vercelJson(a)));
  });
});

describe('failures never fail the publish', () => {
  const publishWith = async (titles: string[], ps: PathsStore, opts: Record<string, unknown> = {}) => {
    deployRenderedSite.mockClear();
    await writePendingSite('fresh-cuts', pending(titles));
    return publishSite('fresh-cuts', { force: true, findShop: async () => null, siteBase: siteBase(BASE) as any, pathsStore: ps, ...opts });
  };
  it('a read that fails once is retried and the publish keeps its redirects', async () => {
    const { s } = fakeStore();
    await go(['Fade', 'Beard Trim'], s);
    s.read.mockRejectedValueOnce(new Error('blip'));
    deployRenderedSite.mockClear();
    const arg = await go(['Fade'], s);
    expect(s.read).toHaveBeenCalledTimes(3); // go #1, the failed try, the retry
    expect(arg.redirects).toEqual([R('beard-trim', '')]);
  });
  it('a read that keeps failing FAILS the publish before any deploy: live redirects are never shrunk, the record is kept, the next publish works', async () => {
    const { s, get } = fakeStore();
    await go(['Fade', 'Beard Trim'], s);
    await go(['Fade'], s); // the redirect is live and recorded
    const before = JSON.stringify(get());
    s.read.mockRejectedValueOnce(new Error('supabase 503')).mockRejectedValueOnce(new Error('supabase 503'));
    const out = await publishWith(['Fade'], s);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('deploy-failed');
    expect(out.error).toMatch(/published paths/);
    expect(deployRenderedSite).not.toHaveBeenCalled();
    expect(JSON.stringify(get())).toBe(before);
    expect(s.write).toHaveBeenCalledTimes(2); // the two earlier publishes only
    expect((await go(['Fade'], s)).redirects).toEqual([R('beard-trim', '')]);
  });
  it('a hanging read is cut off by the timeout (twice), the publish fails retryably, nothing is deployed', async () => {
    const { s } = fakeStore();
    s.read.mockImplementation(() => new Promise(() => {}));
    const t0 = Date.now();
    const out = await publishWith(['Fade'], s, { pathsTimeoutMs: 25 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/timed out/);
    expect(s.read).toHaveBeenCalledTimes(2);
    expect(deployRenderedSite).not.toHaveBeenCalled();
  });
  it('a slow read that finishes inside the limit is fine', async () => {
    const { s } = fakeStore();
    await go(['Fade', 'Beard Trim'], s);
    const real = s.read.getMockImplementation()!;
    s.read.mockImplementation(async (slug: string) => { await new Promise((r) => setTimeout(r, 20)); return real(slug); });
    deployRenderedSite.mockClear();
    expect((await publishWith(['Fade'], s, { pathsTimeoutMs: 500 })).ok).toBe(true);
    expect(deployRenderedSite.mock.calls[0][0].redirects).toEqual([R('beard-trim', '')]);
  });
  it('a hanging write is cut off: the publish that is already live still succeeds', async () => {
    const { s } = fakeStore();
    await go(['Fade', 'Beard Trim'], s);
    s.write.mockImplementation(() => new Promise(() => {}));
    const t0 = Date.now();
    const out = await publishWith(['Fade'], s, { pathsTimeoutMs: 25 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(out.ok).toBe(true);
    expect(deployRenderedSite).toHaveBeenCalledTimes(1);
  });
  it('a write that updates no row (false) is logged, and the publish is ok', async () => {
    const { s } = fakeStore();
    s.write.mockResolvedValueOnce(false as any);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await publishWith(['Fade'], s)).ok).toBe(true);
    expect(warn.mock.calls.some((c) => /no stored row/.test(String(c[0])))).toBe(true);
    warn.mockRestore();
  });
  it('write receives the record that was read (the live store guards a first write)', async () => {
    const { s } = fakeStore();
    await go(['Fade', 'Beard Trim'], s);
    expect(s.write.mock.calls[0][2]).toBeNull();
    await go(['Fade'], s);
    expect(s.write.mock.calls[1][2]).toMatchObject({ v: 1 });
  });
  it('a redeploy round that no longer qualifies (the stored copy turned pages v1) does not record round 0\'s paths', async () => {
    const { s } = fakeStore();
    deployRenderedSite.mockClear();
    await writePendingSite('fresh-cuts', { ...pending(['Fade', 'Beard Trim']), version: 1, timestamp: 1 });
    deployRenderedSite.mockImplementationOnce(async () => {
      await writePendingSite('fresh-cuts', { ...pending(['Fade'], { extraPages: undefined }), version: 2, timestamp: 2 });
      return { deploymentUrl: 'https://fresh-cuts.vercel.app', uploadedImages: {}, projectName: 'fresh-cuts' };
    });
    const out = await publishSite('fresh-cuts', { force: true, findShop: async () => null, siteBase: siteBase(BASE) as any, pathsStore: s });
    expect(out.ok).toBe(true);
    expect(deployRenderedSite).toHaveBeenCalledTimes(2);
    expect('redirects' in deployRenderedSite.mock.calls[1][0]).toBe(false);
    expect(s.write).not.toHaveBeenCalled();
  });
  it('a rename onto a service page that already existed (a merge) redirects to /services/ (decision: moved can be stale)', async () => {
    const { s } = fakeStore();
    await go(['Fade', 'Beard Trim'], s);
    const arg = await go(['Fade'], s, { extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 3, moved: { 'beard-trim': 'fade' } } });
    expect(arg.redirects).toEqual([R('beard-trim', '')]);
  });
  it('a failed write is logged; the publish is ok and the next one recomputes from the older record', async () => {
    const { s, get } = fakeStore();
    await go(['Fade', 'Beard Trim'], s);
    s.write.mockRejectedValueOnce(new Error('db down'));
    expect((await go(['Fade'], s)).redirects).toEqual([R('beard-trim', '')]);
    expect(get()!.redirects).toEqual([]); // not recorded
    expect((await go(['Fade'], s)).redirects).toEqual([R('beard-trim', '')]); // healed
    expect(get()!.redirects).toEqual([R('beard-trim', '')]);
  });
  it('a failed deploy writes nothing', async () => {
    const { s } = fakeStore();
    await go(['Fade', 'Beard Trim'], s);
    deployRenderedSite.mockRejectedValueOnce(new Error('vercel'));
    await writePendingSite('fresh-cuts', pending(['Fade']));
    const out = await publishSite('fresh-cuts', { force: true, findShop: async () => null, siteBase: siteBase(BASE) as any, pathsStore: s });
    expect(out.ok).toBe(false);
    expect(s.write).toHaveBeenCalledTimes(1);
  });
  it('tracking off (null store, or no service role configured): no redirects, no key on the deploy', async () => {
    const arg = await go(['Fade'], null);
    expect('redirects' in arg).toBe(false);
    const prevUrl = process.env.SUPABASE_URL; delete process.env.SUPABASE_URL;
    try { expect('redirects' in (await go(['Fade'], null))).toBe(false); } finally { if (prevUrl) process.env.SUPABASE_URL = prevUrl; }
  });
});

describe('sites that do not qualify are untouched (the store is never read or written)', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['made in the iOS app (no web marker)', { source: undefined }],
    ['made in the iOS app, marker "ios"', { source: 'ios' }],
    ['pages v1 (no extraPages)', { extraPages: undefined }],
    ['a single-page site (no pages field)', { pages: undefined }],
  ];
  for (const [name, extra] of cases) {
    it(name, async () => {
      const { s } = fakeStore({ v: 1, paths: ['/', '/services/', '/services/old/'], redirects: [R('older', '')] });
      const base = await go(['Fade', 'Beard Trim'], null, extra);
      const arg = await go(['Fade', 'Beard Trim'], s, extra);
      expect(s.read).not.toHaveBeenCalled();
      expect(s.write).not.toHaveBeenCalled();
      expect('redirects' in arg).toBe(false);
      expect(Object.keys(arg).sort()).toEqual(Object.keys(base).sort());
      expect(Object.keys(arg).sort()).toEqual(['html', 'imageUrls', 'pages', 'robots', 'siteId', 'sitemap', 'subpages']);
      expect(JSON.stringify(vercelJson(arg))).toBe(JSON.stringify(vercelJson(base)));
      expect(vercelJson(arg).redirects).toBeUndefined();
    });
  }
  it('a stored record is ignored for them even when it lists redirects', async () => {
    const { s } = fakeStore({ v: 1, paths: ['/services/gone/'], redirects: [R('old', '')] });
    const arg = await go(['Fade'], s, { source: undefined });
    expect(vercelJson(arg).redirects).toBeUndefined();
  });
});
