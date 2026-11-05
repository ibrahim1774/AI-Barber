// Guide pages and the floor of 21 pages (Step 8). Page counts are worked out BY HAND from the page lists written in this file (never from
// countPages), and the markup is checked with parsers written here (robots meta, sitemap <loc>, JSON-LD blocks), not with the code under test.
import { describe, expect, it } from 'vitest';
import { renderSiteBundle } from '../../lib/render/site';
import { buildPageSet, extraPageRows, assertSiteFilePath, isPageKey, PAGE_KEYS, EXTRA_KEYS, RESERVED_PATHS } from '../../lib/render/pages';
import { guidesApply, countPages, countRealPages, GUIDE_ADDED_CAP, guideCopySanitize, guideOverrides, guideSettings, PAGE_FLOOR, planGuides, resolveGuide, styleMatchesTitle } from '../../lib/render/guidePages';
import { GUIDE_PAGE_IDS, isGuideFile } from '../../lib/render/guideIds';
import { GUIDE_LIBRARY } from '../../lib/render/guideLibrary';
import { variantIndex } from '../../lib/render/guides';
import { svcCopySanitize } from '../../lib/serviceCopy/prune';
import { RICH_SITE } from './helpers/richSite';
import type { WebsiteData } from '../../types';

const svc = (title: string, extra: Record<string, unknown> = {}) => ({ title, subtitle: '', description: '', price: '$30', duration: '30 min', icon: 'scissors' as const, imageUrl: '', ...extra });
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => ({ day, open: '09:00', close: '17:00' }));
const SIX = ['Haircut', 'Skin Fade', 'Beard Trim', 'Kids Haircut', 'Line Up', 'Hot Towel Shave'];
const shop = (extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: 'https://book.example.com/fresh', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: '', imageUrl: '' }, about: { heading: 'About', description: [], imageUrl: '' },
  services: [svc('Haircut'), svc('Skin Fade'), svc('Beard Trim')], gallery: [], hours: WEEK,
  contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' }, pages: { order: [], hidden: [] },
  extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 7 }, source: 'web-app',
  ...extra,
} as WebsiteData);
const BASE = { siteBaseUrl: 'https://fresh.example.com' };
const bundle = (d: WebsiteData, t: 'luxe' | 'prime' | 'euphoria' = 'luxe') => renderSiteBundle({ ...d, template: t }, BASE);
const paths = (b: ReturnType<typeof bundle>) => b.pages.map((p) => p.path);
const guidePaths = (b: ReturnType<typeof bundle>) => paths(b).filter((p) => p.startsWith('guides/'));
const html = (b: ReturnType<typeof bundle>, path: string) => b.pages.find((p) => p.path === path)?.html ?? '';
/** Pages a visitor can reach: the rendered files plus the proxied /book and /shop (which are not files). */
const proxied = (d: WebsiteData) => (d.bookingUrl === '/book' ? 1 : 0) + (d.shopUrl === '/shop' ? 1 : 0);
const total = (d: WebsiteData) => { const b = bundle(d); return b.pages.length + proxied(d); };

// ── independent parsers ──
const robotsMeta = (h: string): string | null => /<meta name="robots" content="([^"]*)">/.exec(h)?.[1] ?? null;
const locs = (xml: string | null): string[] => [...(xml ?? '').matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
const ldBlocks = (h: string): unknown[] => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const navHtml = (h: string): string => /<nav class="ab-nav"[\s\S]*?<\/nav>/.exec(h)?.[0] ?? '';
const footerHtml = (h: string): string => /<footer[\s\S]*?<\/footer>/.exec(h)?.[0] ?? '';
const mainOf = (h: string): string => /<section class="ab-sec">([\s\S]*?)<\/section>/.exec(h)?.[1] ?? '';
/** A render is compared without its publish timestamp. */
const stable = (pages: { path: string; html: string }[]) => pages.map((p) => ({ path: p.path, html: p.html.replace(/published-at" content="\d+"/, '') }));

// The hand-written page lists of the fixtures (real pages only).
const SPARSE3 = ['index.html', 'services/index.html', 'services/haircut/index.html', 'services/skin-fade/index.html', 'services/beard-trim/index.html', 'hours/index.html', 'location/index.html', 'contact/index.html', 'first-visit/index.html'];
const svcPages = (slugs: string[]) => slugs.map((s) => `services/${s}/index.html`);
const SPARSE6 = ['index.html', 'services/index.html', ...svcPages(['haircut', 'skin-fade', 'beard-trim', 'kids-haircut', 'line-up', 'hot-towel-shave']), 'hours/index.html', 'location/index.html', 'contact/index.html', 'first-visit/index.html'];

const sparse3 = () => shop();
const sparse6 = () => shop({ services: SIX.map((t) => svc(t)) });
const noAddress6 = () => shop({ services: SIX.map((t) => svc(t)), hours: [], contact: { address: '', email: '' } });
const noAddress3 = () => shop({ hours: [], contact: { address: '', email: '' } });
const tiny = () => shop({ services: [svc('Haircut')], hours: [], contact: { address: '', email: '' }, bookingUrl: '', phone: '555 0100' });
const solo = () => shop({ staff: [{ name: 'Sam', role: 'Barber', bio: 'Sam cuts hair.' }] } as Partial<WebsiteData>);
const soloNoBio = () => shop({ staff: [{ name: 'Sam', role: 'Barber' }] } as Partial<WebsiteData>);
const bookShop = () => shop({ bookingUrl: '/book', shopUrl: '/shop' });
const rich = () => ({ ...RICH_SITE, source: 'web-app', extraPages: { on: ['faq', 'first-visit', 'hair-care', 'beard-care'], serviceGuides: true, seed: 11 } }) as WebsiteData;

describe('countPages: real pages, worked out by hand', () => {
  it('sparse 3-service shop = 9 real pages (Home, Services, 3 services, Hours, Location, Contact, First visit; a web site has no FAQ)', () => {
    expect(paths(bundle(sparse3())).filter((p) => !p.startsWith('guides/'))).toEqual(SPARSE3);
    expect(countPages(sparse3())).toBe(9);
  });
  it('sparse 6-service shop = 12', () => {
    expect(paths(bundle(sparse6())).filter((p) => !p.startsWith('guides/'))).toEqual(SPARSE6);
    expect(countPages(sparse6())).toBe(12);
  });
  it('a shop with no address and no hours loses Location and Hours (and First visit): 6 services = 9, 3 services = 6', () => {
    expect(countPages(noAddress6())).toBe(9); // Home, Services, 6 services, Contact (phone)
    expect(countPages(noAddress3())).toBe(6); // Home, Services, 3 services, Contact
    expect(paths(bundle(noAddress3())).filter((p) => !p.startsWith('guides/'))).toEqual(['index.html', 'services/index.html', ...svcPages(['haircut', 'skin-fade', 'beard-trim']), 'contact/index.html']);
  });
  it('a solo barber: whatever the page set says. With a staff entry that has a bio there is a Team page AND the barber\'s own page (+2 = 11); with a name only there is a Team page and no barber page (+1 = 10); with no staff entry neither (9). Team eligibility is not special-cased (that would break parity)', () => {
    expect(countPages(solo())).toBe(11);
    expect(countPages(soloNoBio())).toBe(10);
    expect(countPages(shop({ staff: [] } as Partial<WebsiteData>))).toBe(9);
  });
  it('/book is a page when it is in the nav and /shop only when it is the site\'s own shop: the proxied pages add 2 (11), an external shop link adds 0 (10 with /book)', () => {
    expect(countPages(bookShop())).toBe(11);
    expect(countPages(shop({ bookingUrl: '/book', shopUrl: 'https://shop.example.com' }))).toBe(10);
    expect(countPages(shop({ bookingUrl: '/book' }))).toBe(10);
  });
  it('a hidden page does not count', () => {
    expect(countPages(shop({ pages: { order: [], hidden: ['first-visit', 'contact'] } }))).toBe(7);
    // (hiding Hours also keeps Location off on a setup saved before Location existed, so that pair is 2 pages fewer)
    expect(countPages(shop({ pages: { order: [], hidden: ['hours'] } }))).toBe(7);
  });
  it('a thin (noindex) service page still counts', () => {
    expect(countPages(shop({ services: [svc('Enhancement'), svc('Facial'), svc('Wash & Style')] }))).toBe(9);
  });
  it('a site that is not multi-page is one page', () => {
    const { pages: _p, ...single } = shop();
    expect(countPages(single as WebsiteData)).toBe(1);
  });
  it('countRealPages is the page set\'s files plus the proxied pages and nothing else', () => {
    const set = buildPageSet(bookShop());
    expect(set.files).toHaveLength(9);
    expect(countRealPages(set)).toBe(11);
  });
});

describe('the floor of 21', () => {
  it('constants: floor 21, hub + guides at most 12, so 9 real pages is the least that can reach 21', () => {
    expect(PAGE_FLOOR).toBe(21);
    expect(GUIDE_ADDED_CAP).toBe(12);
    expect(PAGE_FLOOR - GUIDE_ADDED_CAP).toBe(9);
  });
  const cases: [string, () => WebsiteData, number][] = [
    ['sparse 3 (9 real)', sparse3, 9], ['sparse 6 (12 real)', sparse6, 12], ['no address, 6 services (9 real)', noAddress6, 9],
    ['solo barber (11 real)', solo, 11], ['solo, name only (10 real)', soloNoBio, 10], ['bookings and store (11 real)', bookShop, 11],
  ];
  for (const [name, make, real] of cases) {
    it(`${name}: exactly 21 pages, the hub plus ${20 - real} guide pages (never more than 11 guides)`, () => {
      const d = make();
      const b = bundle(d);
      expect(total(d)).toBe(21);
      expect(guidePaths(b)).toHaveLength(21 - real);
      expect(guidePaths(b)).toContain('guides/index.html');
      expect(guidePaths(b).length - 1).toBeLessThanOrEqual(11);
    });
  }
  it('a rich shop that already has 21 or more real pages gets no guides at all (23 here)', () => {
    const d = rich();
    expect(countPages(d)).toBe(23); // Home, About, Services + 6, Team + 3, Gallery, Reviews, Hours, Location, Contact, First visit, Hair care, Beard care, Book, Shop (a web site has no FAQ)
    expect(guidePaths(bundle(d))).toEqual([]);
    expect(planGuides(d, buildPageSet(d))).toBeNull();
    expect(bundle(d).pages.some((p) => p.html.includes('/guides/'))).toBe(false);
  });
  it('21 real pages: no guides; 20: the hub and ONE guide (22 pages, the only overshoot); 19: hub + 1 guide (21); 18: hub + 2 (21)', () => {
    const mk = (n: number): WebsiteData => shop({ services: Array.from({ length: n }, (_x, i) => svc(['Haircut', 'Skin Fade', 'Beard Trim', 'Kids Haircut', 'Line Up', 'Hot Towel Shave', 'Taper', 'Mohawk', 'Buzz Cut', 'Crew Cut', 'Undercut', 'Mullet'][i])) });
    const d18 = mk(12); // 9 + 9 more services
    expect(countPages(d18)).toBe(18);
    expect(guidePaths(bundle(d18))).toHaveLength(3); expect(total(d18)).toBe(21);
    const d19 = { ...d18, bookingUrl: '/book' } as WebsiteData;
    expect(countPages(d19)).toBe(19);
    expect(guidePaths(bundle(d19))).toHaveLength(2); expect(total(d19)).toBe(21);
    const d20 = { ...d19, shopUrl: '/shop' } as WebsiteData;
    expect(countPages(d20)).toBe(20);
    expect(guidePaths(bundle(d20))).toHaveLength(2); expect(total(d20)).toBe(22);
    const d21 = { ...d20, about: { heading: 'About', description: ['We cut hair on this corner.'], imageUrl: '' } } as WebsiteData;
    expect(countPages(d21)).toBe(21);
    expect(guidePaths(bundle(d21))).toEqual([]);
  });
  it('9 real pages reach 21 with the hub and 11 guides; fewer than 9 end below 21 and are never padded (6 real -> 18, 4 real -> 16)', () => {
    const nine = noAddress6();
    expect(countPages(nine)).toBe(9); // Home, Services, 6 services, Contact
    expect(guidePaths(bundle(nine))).toHaveLength(12);
    expect(total(nine)).toBe(21);
    expect(countPages(noAddress3())).toBe(6);
    expect(guidePaths(bundle(noAddress3()))).toHaveLength(12);
    expect(total(noAddress3())).toBe(18);
    expect(countPages(tiny())).toBe(4);
    expect(guidePaths(bundle(tiny()))).toHaveLength(12);
    expect(total(tiny())).toBe(16);
  });
  it('the guide count flexes: more services, fewer guides; the same data always gives the same plan', () => {
    const a = guidePaths(bundle(sparse3())).length;
    const b = guidePaths(bundle(sparse6())).length;
    expect(a).toBe(12);
    expect(b).toBe(9);
    expect(guidePaths(bundle(sparse3()))).toEqual(guidePaths(bundle(sparse3())));
    // the guides of a smaller plan are the first guides of a larger one for the same services (a prefix): a page that appears later only drops the tail
    const big = guidePaths(bundle(sparse3()));
    const small = guidePaths(bundle(bookShop()));
    expect(small.length).toBeLessThan(big.length);
    expect(big.slice(0, small.length)).toEqual(small);
  });
  it('the floor holds in every design', () => {
    for (const t of ['luxe', 'prime', 'euphoria'] as const) for (const make of [sparse3, sparse6, noAddress6, solo, bookShop]) {
      const d = make();
      const b = bundle(d, t);
      expect(b.pages.length + proxied(d), `${t}`).toBe(21);
    }
  });
});

describe('guide pages are filler: noindex, no sitemap, no JSON-LD, not in the menu', () => {
  for (const t of ['luxe', 'prime', 'euphoria'] as const) {
    it(`${t}: every guide page and the hub carry robots noindex,follow and a self canonical`, () => {
      const b = bundle(sparse3(), t);
      const g = guidePaths(b);
      expect(g).toHaveLength(12);
      for (const p of g) {
        expect(robotsMeta(html(b, p)), p).toBe('noindex,follow');
        const href = p === 'guides/index.html' ? '/guides/' : `/${p.replace('/index.html', '/')}`;
        expect(html(b, p), p).toContain(`<link rel="canonical" href="https://fresh.example.com${href}">`);
      }
    });
  }
  it('real pages that are indexable carry no robots meta (guides did not change that)', () => {
    const b = bundle(sparse3());
    for (const p of ['index.html', 'hours/index.html', 'location/index.html', 'contact/index.html', 'faq/index.html']) expect(robotsMeta(html(b, p)), p).toBeNull();
  });
  it('sitemap.xml lists the real pages and not one guide page; robots.txt points at it', () => {
    const b = bundle(sparse3());
    const l = locs(b.sitemap);
    expect(l.length).toBeGreaterThan(5);
    expect(l.filter((u) => u.includes('guides'))).toEqual([]);
    expect(l).toContain('https://fresh.example.com/hours/');
    expect(b.robots).toContain('Sitemap: https://fresh.example.com/sitemap.xml');
    // the sitemap is the same as for the same site with guides switched off
    const off = bundle({ ...sparse3(), extraPages: { ...sparse3().extraPages!, guidesOff: true } });
    expect(b.sitemap).toBe(off.sitemap);
    expect(b.robots).toBe(off.robots);
  });
  it('JSON-LD: no guide page carries any; no JSON-LD anywhere mentions /guides', () => {
    const b = bundle(sparse3());
    for (const p of guidePaths(b)) expect(ldBlocks(html(b, p)), p).toEqual([]);
    const all = b.pages.flatMap((p) => ldBlocks(p.html));
    expect(all.length).toBeGreaterThan(0);
    expect(JSON.stringify(all)).not.toContain('guides');
  });
  it('the menu never links to the guides (home and inner pages), on every design', () => {
    for (const t of ['luxe', 'prime', 'euphoria'] as const) {
      const b = bundle(sparse3(), t);
      for (const p of b.pages) expect(navHtml(p.html), `${t} ${p.path}`).not.toContain('/guides');
    }
  });
  it('link placement: a footer "Guides" link on every inner page and one line on Services; nothing on Home; no other page links to them', () => {
    const b = bundle(sparse3());
    for (const p of b.pages.filter((x) => x.path !== 'index.html')) {
      const f = footerHtml(p.html);
      expect(f.match(/<a href="\/guides\/">Guides<\/a>/g) ?? [], p.path).toHaveLength(1);
    }
    expect(footerHtml(html(b, 'index.html'))).not.toContain('/guides');
    const services = html(b, 'services/index.html');
    expect(services.match(/data-guides-line/g)).toHaveLength(1);
    expect(/<p class="ab-muted" data-guides-line>[^<]+ <a href="\/guides\/">Hair and grooming guides<\/a><\/p>/.test(services)).toBe(true);
    for (const p of b.pages.filter((x) => !['services/index.html'].includes(x.path) && !x.path.startsWith('guides/'))) {
      expect(p.html.replace(footerHtml(p.html), '').includes('/guides/'), `${p.path} body`).toBe(false);
    }
  });
  it('the hub lists every guide and each guide page links back to the hub and on to the others', () => {
    const b = bundle(sparse3());
    const hub = html(b, 'guides/index.html');
    for (const p of guidePaths(b).filter((x) => x !== 'guides/index.html')) {
      expect(hub).toContain(`href="/${p.replace('index.html', '')}"`);
      expect(html(b, p)).toContain('href="/guides/"');
      expect(html(b, p).match(/<h1 /g)).toHaveLength(1);
    }
  });
  it('every guide page is a legal site file path under /guides/ (closed ids only)', () => {
    for (const p of guidePaths(bundle(sparse3()))) { expect(() => assertSiteFilePath(p)).not.toThrow(); expect(isGuideFile(p)).toBe(true); }
    for (const bad of ['guides/x/index.html', 'guides/ask-for-the-cut/extra/index.html', 'guides/../index.html', 'guides/index.htm']) expect(() => assertSiteFilePath(bad), bad).toThrow();
  });
});

describe('web-created pages-v2 sites have no FAQ page (iOS and legacy keep it)', () => {
  const withFaq = (d: WebsiteData): WebsiteData => ({ ...d, extraPages: { ...(d.extraPages as object), on: ['faq', 'first-visit'] } } as WebsiteData);
  it('no /faq/ file, menu item, footer link, sitemap entry or JSON-LD mention, even with faq in extraPages.on and plenty of data', () => {
    for (const t of ['luxe', 'prime', 'euphoria'] as const) {
      const b = bundle(withFaq(shop({ policy: { title: 'Policy', body: 'Be on time.' } } as Partial<WebsiteData>)), t);
      expect(paths(b)).not.toContain('faq/index.html');
      for (const p of b.pages) expect(p.html.includes('/faq/'), `${t} ${p.path}`).toBe(false);
      expect(locs(b.sitemap).some((u) => u.includes('faq'))).toBe(false);
      expect(JSON.stringify(b.pages.flatMap((p) => ldBlocks(p.html)))).not.toContain('faq');
    }
  });
  it('the Pages sheet lists it as unavailable', () => {
    const row = extraPageRows(withFaq(sparse3())).find((r) => r.key === 'faq')!;
    expect([row.on, row.eligible]).toEqual([false, false]);
    expect(extraPageRows(withFaq(shop({ source: 'ios' } as Partial<WebsiteData>))).find((r) => r.key === 'faq')!.eligible).toBe(true);
  });
  it('an iOS-made, a legacy (no marker) and a pre-pages-v2 multi-page site still get /faq/ with the same data', () => {
    expect(paths(bundle(withFaq(shop({ source: 'ios' } as Partial<WebsiteData>))))).toContain('faq/index.html');
    expect(paths(bundle(withFaq(shop({ source: undefined } as Partial<WebsiteData>))))).toContain('faq/index.html');
  });
  it('a web site that used to have the FAQ now counts one page less, so guides fill the gap (9 real for the 3-service shop)', () => {
    expect(paths(bundle(withFaq(sparse3()))).filter((p) => !p.startsWith('guides/'))).toEqual(SPARSE3);
  });
});

describe('reserved path /guides', () => {
  it('no page key, extra key or reserved word is "guides", so nothing else can take the path', () => {
    expect((PAGE_KEYS as readonly string[]).includes('guides')).toBe(false);
    expect((EXTRA_KEYS as readonly string[]).includes('guides')).toBe(false);
    expect(isPageKey('guides')).toBe(false);
    expect(RESERVED_PATHS).not.toContain('guides');
  });
  it('a service called "Guides" gets /services/guides/, never /guides/', () => {
    const b = bundle(shop({ services: [svc('Guides'), svc('Haircut'), svc('Skin Fade')] }));
    expect(paths(b)).toContain('services/guides/index.html');
    expect(html(b, 'guides/index.html')).toContain('<h1 class="ab-h1">Hair and grooming guides</h1>');
  });
  it('guide slugs are the library ids and each is a clean slug', () => {
    for (const id of GUIDE_PAGE_IDS) expect(id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
  });
});

describe('the gate: guides only for web-created pages-v2 multi-page barber sites', () => {
  it('iOS-made, no marker, empty marker, unknown marker: no guide pages and no guide link anywhere', () => {
    for (const source of ['ios', '', 'web', undefined]) {
      const d = shop({ source } as Partial<WebsiteData>);
      const b = bundle(d);
      expect(guidePaths(b), String(source)).toEqual([]);
      expect(b.pages.some((p) => p.html.includes('/guides/')), String(source)).toBe(false);
    }
  });
  it('a multi-page site without extraPages (before pages v2) and a single-page site get none', () => {
    const { extraPages: _e, ...v1 } = shop();
    expect(guidePaths(bundle(v1 as WebsiteData))).toEqual([]);
    const { pages: _p, ...single } = shop();
    expect(bundle(single as WebsiteData).pages).toHaveLength(1);
  });
  it('a non-barber niche gets none (the library talks to the reader about "your barber")', () => {
    for (const niche of ['nails', 'lashes', 'hair', 'medspa', 'tattoo']) expect(guidePaths(bundle(shop({ niche } as Partial<WebsiteData>))), niche).toEqual([]);
    expect(guidePaths(bundle(shop({ niche: 'barber' } as Partial<WebsiteData>)))).toHaveLength(12);
  });
  it('decided: the serviceGuides flag does NOT decide this feature (it controls the About-this-service text), so a web site with it off still reaches 21', () => {
    const d = shop({ extraPages: { on: ['faq', 'first-visit'], serviceGuides: false, seed: 7 } });
    expect(total(d)).toBe(21);
  });
  it('the owner can switch the feature off or hide single guides', () => {
    const off = shop({ extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 7, guidesOff: true } });
    expect(guidePaths(bundle(off))).toEqual([]);
    expect(bundle(off).pages.some((p) => p.html.includes('/guides/'))).toBe(false);
    const hid = shop({ extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 7, guidesHidden: ['face-shape', 'hair-types'] } });
    const g = guidePaths(bundle(hid));
    expect(g).toHaveLength(10); // two of the 11 guides removed, NOT backfilled
    expect(g).not.toContain('guides/face-shape/index.html');
    expect(total(hid)).toBe(19);
  });
  it('hiding every guide removes the hub, the footer link and the Services line', () => {
    const hid = shop({ extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 7, guidesHidden: [...GUIDE_PAGE_IDS] } });
    const b = bundle(hid);
    expect(guidePaths(b)).toEqual([]);
    expect(b.pages.some((p) => p.html.includes('/guides/') || p.html.includes('data-guides-line'))).toBe(false);
  });
  it('a stored selection limits and orders the guides; a hidden guide keeps its slot', () => {
    const sel = shop({ extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 7, guidesSel: ['hair-types', 'new-barber', 'face-shape'] } });
    expect(guidePaths(bundle(sel)).sort()).toEqual(['guides/face-shape/index.html', 'guides/hair-types/index.html', 'guides/index.html', 'guides/new-barber/index.html']);
    const junk = guideSettings({ extraPages: { on: [], guidesSel: ['nope', 'face-shape', 'face-shape', 7], guidesHidden: ['x', 'hair-types'], guidesOff: 'yes' } } as unknown as WebsiteData);
    expect([junk.sel, [...junk.hidden], junk.off]).toEqual([['face-shape'], ['hair-types'], false]);
  });
  it('conditional guides need a service the closed vocabulary finds', () => {
    const ids = (d: WebsiteData) => guidePaths(bundle(d)).map((p) => p.split('/')[1]);
    expect(ids(sparse3())).toContain('fade-and-taper'); // Skin Fade
    const noFade = shop({ services: [svc('Haircut'), svc('Beard Trim'), svc('Hot Towel Shave')] });
    expect(ids(noFade)).not.toContain('fade-and-taper');
    expect(ids(noFade)).toContain('shave-guide');
    expect(ids(noFade)).not.toContain('child-first-haircut');
    expect(ids(sparse6())).toContain('child-first-haircut');
    // a title that only contains the word is not a service of that kind
    const trap = shop({ services: [svc('Fade Away Gift Card'), svc('Kids Nails'), svc('Shave Cream')] });
    const t = ids(trap);
    expect(t).not.toContain('fade-and-taper'); expect(t).not.toContain('child-first-haircut'); expect(t).not.toContain('shave-guide');
  });
});

describe('the gate holds on its own (planGuides / guidesApply called directly, not only through the renderer)', () => {
  it('iOS-made, unmarked and pre-pages-v2 data get no plan even when called directly', () => {
    for (const source of ['ios', '', undefined]) { const d = shop({ source } as Partial<WebsiteData>); expect(guidesApply(d, buildPageSet(d)), String(source)).toBe(false); expect(planGuides(d, buildPageSet(d))).toBeNull(); }
    const { extraPages: _e, ...v1 } = shop();
    expect(guidesApply(v1 as WebsiteData, buildPageSet(v1 as WebsiteData))).toBe(false);
    expect(guidesApply(shop(), buildPageSet(shop()))).toBe(true);
  });
});

describe('deterministic wording, per business', () => {
  it('the same shop renders byte-identical pages every time', () => {
    const a = bundle(sparse3());
    const b = bundle(sparse3());
    expect(stable(a.pages)).toEqual(stable(b.pages));
  });
  it('two shops with different seeds get different wordings on most guide pages', () => {
    const pagesOf = (seed: number) => bundle(shop({ extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed } })).pages.filter((p) => p.path.startsWith('guides/') && p.path !== 'guides/index.html');
    let best = 0;
    for (let s = 1; s <= 6; s++) {
      const a = pagesOf(1); const c = pagesOf(1 + s);
      const diff = a.filter((p, i) => p.html !== c[i].html).length;
      best = Math.max(best, diff);
    }
    expect(best).toBeGreaterThanOrEqual(8);
    // and across 30 seeds each guide page takes more than one wording
    const variants = new Set<string>();
    for (let s = 1; s <= 30; s++) variants.add(html(bundle(shop({ extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: s } })), 'guides/ask-for-the-cut/index.html'));
    expect(variants.size).toBeGreaterThanOrEqual(3);
  });
  it('no seed: wording 0 everywhere, still deterministic', () => {
    const d = shop({ extraPages: { on: ['faq', 'first-visit'], serviceGuides: true } });
    const v = resolveGuide(d, 'ask-for-the-cut');
    expect(v.intro[0]).toBe(GUIDE_LIBRARY['ask-for-the-cut'].blocks[0].variants[0].join(' '));
    expect(stable(bundle(d).pages)).toEqual(stable(bundle(d).pages));
  });
  it('the owner\'s pick wins over the seed, per block', () => {
    const d = shop({ extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 7, pick: { 'guides.ask-for-the-cut.intro': 2, 'guides.ask-for-the-cut.tip': 1 } } });
    const v = resolveGuide(d, 'ask-for-the-cut');
    const blocks = GUIDE_LIBRARY['ask-for-the-cut'].blocks;
    expect(v.intro[0]).toBe(blocks[0].variants[2].join(' '));
    expect(v.tip[0]).toBe(blocks[2].variants[1].join(' '));
    expect(variantIndex(d, 'guides.ask-for-the-cut.intro')).toBe(2);
  });
  it('the wording is a function of the seed and the key only: not of the services, the prices or the page count', () => {
    const a = resolveGuide(sparse3(), 'face-shape');
    const b = resolveGuide(shop({ services: SIX.map((t) => svc(t, { price: '$99' })), bookingUrl: '/book' }), 'face-shape');
    expect(a).toEqual(b);
  });
  it('hand-pinned picks (seed 7): the library picks never silently move', () => {
    const picks = GUIDE_PAGE_IDS.map((id) => ['intro', 'points', 'tip'].map((b) => variantIndex({ extraPages: { on: [], seed: 7 } } as WebsiteData, `guides.${id}.${b}`)));
    // fnv1a over "7:guides.<id>.<block>" mod 3
    const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
    expect(picks).toEqual(GUIDE_PAGE_IDS.map((id) => ['intro', 'points', 'tip'].map((b) => fnv(`7:guides.${id}.${b}`) % 3)));
  });
});

describe('words printed are the library\'s, escaped; nothing about the shop is claimed', () => {
  it('every guide page prints only library sentences (plus the shop name in the title and the shared header and footer)', () => {
    const b = bundle(sparse3());
    const lib = new Set<string>();
    for (const id of GUIDE_PAGE_IDS) for (const blk of GUIDE_LIBRARY[id].blocks) for (const v of blk.variants) for (const s of v) lib.add(s);
    for (const p of guidePaths(b).filter((x) => x !== 'guides/index.html')) {
      const main = /<section class="ab-sec">([\s\S]*?)<\/section>/.exec(html(b, p))![1];
      for (const m of main.matchAll(/<(?:p|li)>([^<]*)<\/p?l?i?>/g)) {
        const text = m[1].replace(/&#39;/g, "'");
        const sentences = text.split(/(?<=\.) /);
        for (const s of sentences) expect(lib.has(s), `${p}: ${s}`).toBe(true);
      }
    }
  });
  it('the shop name, the phone and the address appear only in the shared chrome of a guide page, never in its body', () => {
    const b = bundle(sparse3());
    for (const p of guidePaths(b)) {
      const main = /<section class="ab-sec">([\s\S]*?)<\/section>/.exec(html(b, p))![1];
      expect(main, p).not.toContain('Fresh Cuts');
      expect(main, p).not.toContain('555');
      expect(main, p).not.toContain('Main St');
      expect(main, p).not.toMatch(/\$\d/);
    }
  });
  it('a hostile shop name, service title and place are escaped in the chrome and never reach a guide body', () => {
    const evil = '<img src=x onerror=alert(1)>"\'&';
    const d = shop({ shopName: evil, area: evil, services: [svc(evil), svc('Skin Fade'), svc('Haircut')] });
    const b = bundle(d);
    for (const p of guidePaths(b)) {
      const h = html(b, p);
      expect(h, p).not.toContain('<img src=x');
      const main = /<section class="ab-sec">([\s\S]*?)<\/section>/.exec(h)![1];
      expect(main, p).not.toContain('onerror');
    }
  });
});

describe('the owner\'s own words (copy keys)', () => {
  const withCopy = (copy: Record<string, string>) => shop({ copy } as Partial<WebsiteData>);
  it('title, intro, points and tip overrides replace the library text, escaped and unlinted', () => {
    const d = withCopy({
      'guides.ask-for-the-cut.title': 'Ask for it Tom & Jerry\'s way', 'guides.ask-for-the-cut.intro': 'Our barbers are the best.\n\nSecond paragraph.',
      'guides.ask-for-the-cut.points': 'First point\nSecond point', 'guides.ask-for-the-cut.tip': 'Call us on 555 0100.',
    });
    const b = bundle(d);
    const h = html(b, 'guides/ask-for-the-cut/index.html');
    expect(h).toContain('<h1 class="ab-h1">Ask for it Tom &amp; Jerry&#39;s way</h1>');
    expect(h).toContain('<p>Our barbers are the best.</p><p>Second paragraph.</p>');
    expect(h).toContain('<li>First point</li><li>Second point</li>');
    expect(h).toContain('<p>Call us on 555 0100.</p>');
    expect(h).not.toContain(GUIDE_LIBRARY['ask-for-the-cut'].title);
    expect(html(b, 'guides/index.html')).toContain('Ask for it Tom &amp; Jerry&#39;s way');
  });
  it('markup, entities, control characters, shouting and over-long values are ignored (the library text is shown), never repaired', () => {
    const bad: Record<string, string>[] = [
      { 'guides.ask-for-the-cut.intro': '<script>alert(1)</script>' }, { 'guides.ask-for-the-cut.intro': 'a &lt;b&gt; c' }, { 'guides.ask-for-the-cut.title': 'x'.repeat(61) },
      { 'guides.ask-for-the-cut.intro': 'x'.repeat(601) }, { 'guides.ask-for-the-cut.title': 'LOUD TITLE EVERYWHERE' }, { 'guides.ask-for-the-cut.tip': 'a​b' },
      { 'guides.ask-for-the-cut.title': 'tab\there' }, { 'guides.ask-for-the-cut.title': '!!!!!!' },
    ];
    for (const copy of bad) {
      const h = html(bundle(withCopy(copy)), 'guides/ask-for-the-cut/index.html');
      const [key, val] = Object.entries(copy)[0];
      expect(guideOverrides({ copy } as WebsiteData).size, key + val.slice(0, 12)).toBe(0);
      expect(h).toContain(`<h1 class="ab-h1">${GUIDE_LIBRARY['ask-for-the-cut'].title}</h1>`);
      expect(h).not.toContain('<script>alert');
    }
  });
  it('unknown keys, a non-barber id and inherited keys are ignored; the hub keys work', () => {
    const d = withCopy({ 'guides.nope.title': 'x', 'guides.hub.points': 'x', 'guides.hub.title': 'Read first', 'guides.hub.intro': 'Hello there.', 'guides.hub.line': 'Start here.' });
    expect([...guideOverrides(d).keys()].sort()).toEqual(['guides.hub.intro', 'guides.hub.line', 'guides.hub.title']);
    const b = bundle(d);
    expect(html(b, 'guides/index.html')).toContain('<h1 class="ab-h1">Read first</h1>');
    expect(html(b, 'guides/index.html')).toContain('<p>Hello there.</p>');
    expect(html(b, 'services/index.html')).toContain('>Start here. <a href="/guides/">Read first</a></p>');
    expect(guideOverrides({ copy: Object.create({ 'guides.hub.title': 'inherited' }) } as unknown as WebsiteData).size).toBe(0);
  });
  it('guideCopySanitize drops what the renderer would ignore, reports it, keeps the rest, never mutates and is idempotent', () => {
    const copy = { 'guides.hub.title': 'Fine', 'guides.face-shape.intro': '<b>x</b>', 'guides.bad.key': 'x', 'guides.hair-types.tip': 5, 'seo.home.title': 'Keep me', 'faq.book': 'Keep me too', 'guides.hub.line': '' };
    const sd = { shopName: 'X', copy } as unknown as WebsiteData;
    const before = JSON.stringify(sd);
    const r = guideCopySanitize(sd);
    expect(JSON.stringify(sd)).toBe(before);
    expect(Object.keys((r.siteData as WebsiteData).copy!).sort()).toEqual(['faq.book', 'guides.hub.line', 'guides.hub.title', 'seo.home.title']);
    expect(r.problems.map((p) => [p.key, p.reason]).sort()).toEqual([['guides.bad.key', 'bad_key'], ['guides.face-shape.intro', 'markup'], ['guides.hair-types.tip', 'not_text']]);
    expect(guideCopySanitize(r.siteData).problems).toEqual([]);
    const clean = { copy: { 'guides.hub.title': 'Fine' } };
    expect(guideCopySanitize(clean).siteData).toBe(clean);
  });
  it('guideCopySanitize caps the number of guide keys and survives a __proto__ key', () => {
    const copy: Record<string, string> = {};
    for (const id of GUIDE_PAGE_IDS) for (const p of ['title', 'intro', 'points', 'tip']) copy[`guides.${id}.${p}`] = 'Some words';
    copy['guides.hub.title'] = 'Hub'; copy['guides.hub.intro'] = 'Intro'; copy['guides.hub.line'] = 'Line';
    const r = guideCopySanitize({ copy });
    expect(r.problems).toEqual([]); // 68 + 3 = 71 keys, within the cap of 80
    const sd = JSON.parse('{"copy":{"__proto__":"x","guides.hub.title":"ok"}}');
    expect(() => guideCopySanitize(sd)).not.toThrow();
  });
  it('overrides survive what the stored data goes through: a re-save by an older client, the svcCopy pruner and a second render', () => {
    const d = shop({
      copy: { 'guides.face-shape.intro': 'My words.' },
      extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 7, guidesHidden: ['hair-types'], guidesSel: [...GUIDE_PAGE_IDS], pick: { 'guides.face-shape.tip': 2 }, svcCopy: { gone: { x: 1 } } },
    } as Partial<WebsiteData>);
    // an old app build saves the draft by spreading it: every field is kept
    const resaved = { ...JSON.parse(JSON.stringify(d)), extraPages: { ...(d.extraPages as object) }, copy: { ...d.copy } } as WebsiteData;
    expect(stable(bundle(resaved).pages)).toEqual(stable(bundle(d).pages));
    const pruned = svcCopySanitize(d).siteData as WebsiteData;
    expect(pruned.extraPages).toMatchObject({ guidesHidden: ['hair-types'], guidesSel: [...GUIDE_PAGE_IDS], pick: { 'guides.face-shape.tip': 2 } });
    expect(pruned.copy).toEqual({ 'guides.face-shape.intro': 'My words.' });
    expect(guidePaths(bundle(pruned))).not.toContain('guides/hair-types/index.html');
    expect(html(bundle(pruned), 'guides/face-shape/index.html')).toContain('<p>My words.</p>');
  });
});

describe('links to the shop\'s own service pages: closed vocabulary only', () => {
  const T = (style: Parameters<typeof styleMatchesTitle>[0], title: string) => styleMatchesTitle(style, title);
  it('truth table', () => {
    const yes: [Parameters<typeof styleMatchesTitle>[0], string][] = [
      ['fade', 'Skin Fade'], ['fade', 'Taper Fade'], ['fade', 'Fade'], ['fade', 'Low Fade'], ['fade', "Men's Burst Fade"], ['taper', 'Taper'], ['taper', 'Low Taper'], ['buzz-cut', 'Buzz Cut'], ['buzz-cut', "Men's Buzz Cut"], ['buzz-cut', 'Buzzcut'],
      ['crew-cut', 'Crew Cut'], ['mohawk', 'Mohawk'], ['mohawk', 'Mohawk Haircut'], ['mullet', 'Mullet'], ['undercut', 'Undercut'], ['undercut', 'Under Cut'], ['caesar', 'Caesar'], ['caesar', 'Caesar Cut'],
    ];
    const no: [Parameters<typeof styleMatchesTitle>[0], string][] = [
      ['buzz-cut', 'Haircut'], ['buzz-cut', 'Crew Cut'], ['crew-cut', 'Buzz Cut'], ['buzz-cut', 'Buzz Cut & Beard Trim'], ['buzz-cut', 'Buzz Cut Gift Card'], ['mohawk', 'Mohawk Fade'], ['mohawk', 'Haircut'],
      ['fade', 'Fade & Beard Trim'], ['fade', 'Beard Oil'], ['fade', 'Fade Gift Card'], ['taper', 'Taper Fade'], ['fade', 'Taper'], ['taper', 'Skin Fade'], ['fade', 'Fade Removal Cream'], ['fade', '<b>Fade</b>'], ['fade', 'Fade 2 Pack'],
      ['pompadour', 'Pompadour'], ['quiff', 'Quiff'], ['side-part', 'Side Part'], ['slick-back', 'Slick Back'], ['comb-over', 'Comb Over'], ['textured-crop', 'Textured Crop'],
      ['mullet', 'Mullet Wig'], ['undercut', 'Undercut Beard'], ['caesar', 'Caesar Salad'], ['fade', ''],
    ];
    for (const [s, t] of yes) expect(T(s, t), `${s} <- ${t}`).toBe(true);
    for (const [s, t] of no) expect(T(s, t), `${s} <- ${t}`).toBe(false);
  });
  const withIdeas = (services: ReturnType<typeof svc>[], wording: 0 | 1 | 2) => shop({ services, extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 7, pick: { 'guides.hairstyle-ideas.points': wording }, guidesSel: ['hairstyle-ideas', 'fade-and-taper', 'beard-care-basics'] } });
  it('the hairstyle page links a style to a service only when that service passes the matcher, with the title as the label', () => {
    const d = withIdeas([svc('Skin Fade'), svc('Buzz Cut'), svc('Haircut'), svc('Beard Trim')], 0);
    const h = mainOf(html(bundle(d), 'guides/hairstyle-ideas/index.html'));
    expect(h).toContain('<h3 class="ab-copy-h">On this site</h3>');
    expect(h).toContain('<li><a href="/services/skin-fade/">Skin Fade</a></li>');
    expect(h).toContain('<li><a href="/services/buzz-cut/">Buzz Cut</a></li>');
    expect(h).not.toContain('/services/haircut/'); // a plain Haircut is not a crew cut, a buzz cut or a fade
    expect(h).not.toContain('/services/beard-trim/');
    // the sentences themselves never name the shop's service
    expect(/<li>A buzz cut is a short style[^<]*<\/li>/.test(h)).toBe(true);
  });
  it('no matching service: no link list and no claim that the shop offers anything', () => {
    const d = withIdeas([svc('Haircut'), svc('Kids Nails'), svc('Gift Card')], 0);
    const h = mainOf(html(bundle(d), 'guides/hairstyle-ideas/index.html'));
    expect(h).not.toContain('On this site');
    expect(h).not.toContain('/services/');
  });
  it('a service without a page (past the cap of 12) is never linked; a hostile title is omitted, not repaired', () => {
    const many = [...Array.from({ length: 12 }, (_x, i) => svc(`Cut Number ${i}`)), svc('Mullet')];
    const h = mainOf(html(bundle(withIdeas(many, 2)), 'guides/hairstyle-ideas/index.html'));
    expect(h).not.toContain('On this site');
    const d = withIdeas([svc('Fade <b>'), svc('Mullet')], 2);
    const h2 = mainOf(html(bundle(d), 'guides/hairstyle-ideas/index.html'));
    expect(h2).toContain('<li><a href="/services/mullet/">Mullet</a></li>');
    expect(h2).not.toContain('<b>');
  });
  it('the first matching service in the owner\'s order is the one linked, once', () => {
    const d = withIdeas([svc('Taper Fade'), svc('Low Fade'), svc('High Fade')], 0);
    const h = mainOf(html(bundle(d), 'guides/hairstyle-ideas/index.html'));
    expect((h.match(/<li><a href="\/services\//g) ?? []).length).toBe(1);
    expect(h).toContain('/services/taper-fade/'); // Taper Fade is a fade (the vocabulary: "taper" is a fade modifier) and is first
  });
  it('the fade, kids, shave and beard pages list their matching services', () => {
    const d = shop({ services: [svc('Skin Fade'), svc('Kids Haircut'), svc('Hot Towel Shave'), svc('Beard Trim'), svc('Facial')], extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 7, guidesSel: ['fade-and-taper', 'child-first-haircut', 'shave-guide', 'beard-care-basics'] } });
    const b = bundle(d);
    expect(mainOf(html(b, 'guides/fade-and-taper/index.html'))).toContain('<li><a href="/services/skin-fade/">Skin Fade</a></li>');
    expect(mainOf(html(b, 'guides/child-first-haircut/index.html'))).toContain('<li><a href="/services/kids-haircut/">Kids Haircut</a></li>');
    expect(mainOf(html(b, 'guides/shave-guide/index.html'))).toContain('<li><a href="/services/hot-towel-shave/">Hot Towel Shave</a></li>');
    expect(mainOf(html(b, 'guides/beard-care-basics/index.html'))).toContain('<li><a href="/services/beard-trim/">Beard Trim</a></li>');
    expect(mainOf(html(b, 'guides/beard-care-basics/index.html'))).not.toContain('Facial');
  });
});
