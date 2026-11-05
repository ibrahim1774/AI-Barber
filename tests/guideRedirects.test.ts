// Step 8: guide pages in published_paths and redirects. A guide path is recorded like any page; a guide page that goes away while the hub stays is
// redirected (308) to /guides/; a vanished hub leaves plain 404s (guides are filler: never re-pointed at /services/); service redirects are untouched.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.mock('@google-cloud/storage', () => ({
  Storage: class { bucket() { return { file: (name: string) => ({ exists: async () => [store.has(name)], download: async () => [Buffer.from(store.get(name) ?? '')], save: async (data: string) => { store.set(name, data); } }) }; } },
}));
const deployRenderedSite = vi.fn(async (_args: any) => ({ deploymentUrl: 'https://fresh-cuts.vercel.app', uploadedImages: {}, projectName: 'fresh-cuts' }));
vi.mock('../lib/deploySite.js', () => ({ deployRenderedSite: (a: any) => deployRenderedSite(a) }));

import { publishSite, writePendingSite } from '../lib/publishSite.js';
import type { PathsStore } from '../lib/publishedPathsStore';
import { isGuidePagePath, pagePathsOf, parsePublishedPaths, planPublishedPaths, redirectRules, type PublishedPaths } from '../lib/siteRedirects';
import { renderSiteBundle } from '../lib/render/site';
import { GUIDE_PAGE_IDS } from '../lib/render/guideIds';
import type { WebsiteData } from '../types';

const svc = (title: string, extra: Record<string, unknown> = {}) => ({ title, subtitle: '', description: `${title} done properly.`, icon: 'scissors', imageUrl: '', price: '30', ...extra });
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => ({ day, open: '09:00', close: '17:00' }));
const shop = (titles: string[], extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: 'https://book.example.com/fresh', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: '', imageUrl: '' }, about: { heading: 'About', description: [], imageUrl: '' },
  services: titles.map((t) => svc(t)), gallery: [], hours: WEEK, contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' }, pages: { order: [], hidden: [] },
  extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 7 }, source: 'web-app', ...extra,
} as WebsiteData);
const pathsOf = (d: WebsiteData): string[] => pagePathsOf(renderSiteBundle(d, { siteBaseUrl: 'https://fresh.example.com' }).pages);
const THREE = ['Haircut', 'Skin Fade', 'Beard Trim'];
const G = (id?: string) => (id ? `/guides/${id}/` : '/guides/');
const guideOnly = (p: string[]) => p.filter((x) => x.startsWith('/guides/'));

describe('guide paths are recorded like any page', () => {
  it('the published paths of a sparse site hold the hub and 10 guides (sorted, valid page paths)', () => {
    const p = pathsOf(shop(THREE));
    expect(guideOnly(p)).toHaveLength(12);
    expect(p).toContain('/guides/');
    expect(p).not.toContain('/faq/');
    expect(p).toEqual([...p].sort());
    expect(parsePublishedPaths({ v: 1, paths: p, redirects: [] })!.paths).toEqual(p);
  });
  it('a site that reaches 21 on its own records no guide path', () => {
    const many = ['Haircut', 'Skin Fade', 'Beard Trim', 'Kids Haircut', 'Line Up', 'Hot Towel Shave', 'Taper', 'Mohawk', 'Buzz Cut', 'Crew Cut', 'Undercut', 'Mullet'];
    const d = shop(many, { bookingUrl: '/book', shopUrl: '/shop', about: { heading: 'About', description: ['We cut hair here.'], imageUrl: '' } }); // 9 + 9 + /book + /shop + About = 21
    expect(guideOnly(pathsOf(d))).toEqual([]);
  });
});

describe('a removed guide page is redirected to the hub while the hub stays', () => {
  it('adding services shrinks the plan: the dropped tail guides redirect to /guides/, the kept ones do not', () => {
    const before = { v: 1 as const, paths: pathsOf(shop(THREE)), redirects: [] };
    const after = pathsOf(shop([...THREE, 'Kids Haircut', 'Line Up', 'Taper']));
    const plan = planPublishedPaths(before, after);
    const gone = guideOnly(before.paths).filter((p) => !after.includes(p));
    expect(gone.length).toBeGreaterThan(0);
    expect(plan.redirects).toEqual(expect.arrayContaining(gone.map((from) => ({ from, to: '/guides/' }))));
    expect(plan.redirects.every((r) => !after.includes(r.from) && after.includes(r.to))).toBe(true);
    expect(plan.redirects.filter((r) => r.from.startsWith('/services/'))).toEqual([]);
  });
  it('the owner hiding a guide redirects it to the hub', () => {
    const before = { v: 1 as const, paths: pathsOf(shop(THREE)), redirects: [] };
    const hid = shop(THREE, { extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 7, guidesHidden: ['face-shape'] } as WebsiteData['extraPages'] });
    const plan = planPublishedPaths(before, pathsOf(hid));
    expect(plan.redirects).toEqual([{ from: '/guides/face-shape/', to: '/guides/' }]);
    const rules = redirectRules(plan.redirects);
    expect(rules).toEqual([
      { source: '/guides/face-shape', destination: '/guides/', permanent: true },
      { source: '/guides/face-shape/', destination: '/guides/', permanent: true },
      { source: '/guides/face-shape/index.html', destination: '/guides/', permanent: true },
    ]);
  });
  it('a guide that comes back loses its redirect', () => {
    const r = [{ from: G('face-shape'), to: G() }];
    const live = pathsOf(shop(THREE));
    const plan = planPublishedPaths({ v: 1, paths: live.filter((p) => p !== G('face-shape')), redirects: r }, live);
    expect(plan.redirects).toEqual([]);
  });
});

describe('the old /faq/ of a web site', () => {
  it('a /faq/ published before is redirected to the hub (live) or /services/, and the deploy carries the 308 rules', () => {
    const live = pathsOf(shop(THREE));
    const plan = planPublishedPaths({ v: 1, paths: [...live, '/faq/'], redirects: [] }, live);
    expect(plan.redirects).toEqual([{ from: '/faq/', to: '/guides/' }]);
    expect(redirectRules(plan.redirects).map((r) => r.source)).toEqual(['/faq', '/faq/', '/faq/index.html']);
    // No record at all (every live site today): the same redirect, to the hub or /services/.
    expect(planPublishedPaths(null, live).redirects).toEqual([{ from: '/faq/', to: '/guides/' }]);
    // A record that never listed /faq/ adds nothing.
    expect(planPublishedPaths({ v: 1, paths: ['/'], redirects: [] }, live).redirects).toEqual([]);
    const rich = pathsOf(shop(['Haircut', 'Skin Fade', 'Beard Trim', 'Kids Haircut', 'Line Up', 'Hot Towel Shave', 'Taper', 'Mohawk', 'Buzz Cut', 'Crew Cut', 'Undercut', 'Mullet'], { bookingUrl: '/book', shopUrl: '/shop', about: { heading: 'About', description: ['We cut hair here.'], imageUrl: '' } }));
    expect(planPublishedPaths({ v: 1, paths: [...rich, '/faq/'], redirects: [] }, rich).redirects).toEqual([{ from: '/faq/', to: '/services/' }]);
  });
});

describe('a vanished hub leaves plain 404s', () => {
  it('reaching 21 pages removes every guide: no redirect is created, none points anywhere', () => {
    const before = { v: 1 as const, paths: pathsOf(shop(THREE)), redirects: [] };
    const rich = shop(['Haircut', 'Skin Fade', 'Beard Trim', 'Kids Haircut', 'Line Up', 'Hot Towel Shave', 'Taper', 'Mohawk', 'Buzz Cut', 'Crew Cut', 'Undercut', 'Mullet'], { bookingUrl: '/book', shopUrl: '/shop', about: { heading: 'About', description: ['We cut hair here.'], imageUrl: '' } });
    const after = pathsOf(rich);
    expect(guideOnly(after)).toEqual([]);
    const plan = planPublishedPaths(before, after);
    expect(plan.redirects.filter((r) => r.from.startsWith('/guides/'))).toEqual([]);
    expect(plan.paths).not.toContain('/guides/');
  });
  it('a stored guide redirect whose hub is gone is dropped, NOT re-pointed at /services/ (a service redirect with the same trouble still is)', () => {
    const live = pathsOf(shop(['Haircut', 'Skin Fade', 'Beard Trim', 'Kids Haircut', 'Line Up', 'Hot Towel Shave', 'Taper', 'Mohawk', 'Buzz Cut', 'Crew Cut', 'Undercut', 'Mullet'], { bookingUrl: '/book', shopUrl: '/shop', about: { heading: 'About', description: ['We cut hair here.'], imageUrl: '' } }));
    const plan = planPublishedPaths({ v: 1, paths: [], redirects: [{ from: G('face-shape'), to: G() }, { from: '/services/old/', to: '/services/gone/' }] }, live);
    expect(plan.redirects).toEqual([{ from: '/services/old/', to: '/services/' }]);
  });
  it('the owner hiding every guide removes the hub: the old guide pages 404', () => {
    const before = { v: 1 as const, paths: pathsOf(shop(THREE)), redirects: [] };
    const none = shop(THREE, { extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 7, guidesOff: true } as WebsiteData['extraPages'] });
    const plan = planPublishedPaths(before, pathsOf(none));
    expect(plan.redirects).toEqual([]);
  });
});

describe('only guide pages go to the hub, only service pages go to services', () => {
  it('parsePublishedPaths omits every redirect that mixes them or uses a path that is not a guide page', () => {
    const bad = [
      { from: G(), to: '/services/' }, { from: G(), to: G('face-shape') }, { from: G('face-shape'), to: '/services/' }, { from: G('face-shape'), to: G('hair-types') },
      { from: '/services/a/', to: G() }, { from: G('nope'), to: G() }, { from: '/guides/face-shape', to: G() }, { from: '/guides/face-shape/extra/', to: G() }, { from: G('face-shape'), to: G('face-shape') },
      { from: '/guides/../', to: G() }, { from: 'https://evil.example/guides/', to: G() },
    ];
    const good = [{ from: G('face-shape'), to: G() }, { from: '/services/a/', to: '/services/' }];
    const r = parsePublishedPaths({ v: 1, paths: [], redirects: [...bad, ...good] })!;
    expect(r.redirects).toEqual(good);
    expect(redirectRules(bad as never)).toEqual([]);
  });
  it('isGuidePagePath: the closed ids only, never the hub', () => {
    expect(isGuidePagePath(G())).toBe(false);
    for (const id of GUIDE_PAGE_IDS) expect(isGuidePagePath(G(id))).toBe(true);
    for (const p of ['/guides/x/', '/guides/face-shape', '/services/face-shape/', '', null, 5]) expect(isGuidePagePath(p as never)).toBe(false);
  });
  it('service redirects behave as before next to guide ones', () => {
    const live = ['/', '/services/', '/services/a/', '/guides/', '/guides/face-shape/'];
    const plan = planPublishedPaths({ v: 1, paths: [...live, '/services/b/', '/guides/hair-types/'], redirects: [] }, live);
    expect([...plan.redirects].sort((a, b) => a.from.localeCompare(b.from))).toEqual([{ from: '/guides/hair-types/', to: '/guides/' }, { from: '/services/b/', to: '/services/' }]);
  });
});

describe('through publishSite', () => {
  const pending = (titles: string[], extra: Record<string, unknown> = {}): any => ({
    siteId: 'fresh-cuts',
    siteData: { ...shop(titles), hero: { heading: 'Fresh Cuts', tagline: 'Sharp.', imageUrl: 'uploaded' }, staff: [], reviews: [], craftImages: [], ...extra },
    imageUrlMap: { hero: 'https://img.test/hero.jpg' },
  });
  const siteBase = (base: string) => ({ projectDomains: vi.fn(async () => [{ name: new URL(base).host, verified: true }]), domainServing: vi.fn(async () => true), updateShop: vi.fn(async () => {}), readBase: vi.fn(async () => base) });
  function fakeStore(initial: PublishedPaths | null = null) {
    let value: PublishedPaths | null = initial;
    const s = { read: vi.fn(async (_slug: string) => (value ? parsePublishedPaths(JSON.parse(JSON.stringify(value))) : null)), write: vi.fn(async (_slug: string, v: PublishedPaths) => { value = JSON.parse(JSON.stringify(v)); }) };
    return { s: s as PathsStore & typeof s, get: () => value };
  }
  beforeEach(() => { store.clear(); deployRenderedSite.mockClear(); process.env.GCS_BUCKET_NAME = 'b'; process.env.GCS_CREDENTIALS = JSON.stringify({ project_id: 'p' }); });
  const go = async (titles: string[], ps: PathsStore, extra: Record<string, unknown> = {}) => {
    deployRenderedSite.mockClear();
    await writePendingSite('fresh-cuts', pending(titles, extra));
    const out = await publishSite('fresh-cuts', { force: true, findShop: async () => null, siteBase: siteBase('https://freshcuts.com') as any, pathsStore: ps });
    expect(out.ok).toBe(true);
    return deployRenderedSite.mock.calls[0][0];
  };
  it('first publish records the guide paths and ships them as noindex pages outside the sitemap; the second ships the hub redirect when a guide is hidden', async () => {
    const { s, get } = fakeStore();
    const first = await go(THREE, s);
    expect(guideOnly(get()!.paths)).toHaveLength(12);
    expect(first.redirects).toEqual([{ from: '/faq/', to: '/guides/' }]); // no record yet: the old /faq/ is redirected from the first publish
    expect(first.pages.filter((p: any) => p.path.startsWith('guides/'))).toHaveLength(12);
    expect(first.sitemap).not.toContain('guides');
    expect(first.pages.filter((p: any) => p.path.startsWith('guides/')).every((p: any) => p.html.includes('<meta name="robots" content="noindex,follow">'))).toBe(true);
    const second = await go(THREE, s, { extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 3, guidesHidden: ['hair-types'] } });
    expect(second.redirects).toEqual([{ from: '/faq/', to: '/guides/' }, { from: '/guides/hair-types/', to: '/guides/' }]);
    expect(get()!.redirects).toEqual([{ from: '/faq/', to: '/guides/' }, { from: '/guides/hair-types/', to: '/guides/' }]);
  });
  it('an iOS-made site never touches the store and ships no guide page', async () => {
    const { s } = fakeStore();
    const arg = await go(THREE, s, { source: 'ios' });
    expect(s.read).not.toHaveBeenCalled();
    expect(arg.pages.some((p: any) => p.path.startsWith('guides/'))).toBe(false);
  });
});
