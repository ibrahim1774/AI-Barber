// Step 2: a service page with no text of its own stays on the site but is `noindex,follow` and left out of the sitemap,
// until it has real text. robots.txt ships with the sitemap. Pages v2 sites only; everything older is untouched.
import { describe, expect, it } from 'vitest';
import { renderSiteBundle } from '../../lib/render/site';
import { robotsTxt, sitemapXml, buildPageSet } from '../../lib/render/pages';
import { THIN_DESCRIPTION_MIN, thinServiceIndexes } from '../../lib/render/guides';
import type { WebsiteData } from '../../types';

const svc = (title: string, extra: Record<string, unknown> = {}) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '', ...extra });
const LONG = 'A close fade with a straight razor finish around the ears and the neckline, booked as one visit.';
const shop = (extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: '', imageUrl: '' },
  about: { heading: 'About', description: [], imageUrl: '' },
  services: [svc('Skin Fade'), svc('Low Fade'), svc('Facial'), svc('Enhancement', { description: LONG }), svc('Wash & Style', { description: 'Quick wash.' })],
  gallery: [], hours: [{ day: 'Mon', open: '09:00', close: '17:00' }],
  contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' },
  pages: { order: [], hidden: [] },
  extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 7 },
  ...extra,
});
const BASE = { siteBaseUrl: 'https://fresh.example.com' };
const bundle = (d: WebsiteData, t: 'luxe' | 'prime' | 'euphoria' = 'luxe') => renderSiteBundle({ ...d, template: t }, BASE);
const page = (b: ReturnType<typeof bundle>, path: string) => b.pages.find((p) => p.path === path)?.html ?? '';
const NOINDEX = '<meta name="robots" content="noindex,follow">';
const paged = (d: WebsiteData) => buildPageSet(d).services.map((c) => c.index);

describe('which service pages are thin', () => {
  it('first of a kind has the guide, the second has the alt block: neither is thin; no guide and no long description is', () => {
    const d = shop();
    expect([...thinServiceIndexes(d, paged(d))]).toEqual([2, 4]); // Facial and Wash & Style (11 characters of description)
  });
  it(`a description of ${THIN_DESCRIPTION_MIN} characters counts, one character less does not`, () => {
    const at = (n: number) => shop({ services: [svc('Facial', { description: 'x'.repeat(n) })] });
    expect([...thinServiceIndexes(at(THIN_DESCRIPTION_MIN), [0])]).toEqual([]);
    expect([...thinServiceIndexes(at(THIN_DESCRIPTION_MIN - 1), [0])]).toEqual([0]);
  });
  it('editor markers and padding do not count towards the length', () => {
    const m = '⁣a⁣';
    const d = shop({ services: [svc('Facial', { description: `${m}${' '.repeat(40)}${'x'.repeat(40)}${m}/⁣` })] });
    expect([...thinServiceIndexes(d, [0])]).toEqual([0]);
  });
  it('a hidden section does not count: with the guide hidden a fade is thin, with the description hidden a long description is', () => {
    const d = shop({ pageSections: { service: { hidden: ['guide'] } } as never });
    expect([...thinServiceIndexes(d, paged(d))].sort()).toEqual([0, 1, 2, 4]);
    const e = shop({ pageSections: { service: { hidden: ['description'] } } as never });
    expect([...thinServiceIndexes(e, paged(e))].sort()).toEqual([2, 3, 4]);
  });
  it('guides off: only a long description makes a page indexable', () => {
    const d = shop({ extraPages: { on: [], serviceGuides: false } });
    expect([...thinServiceIndexes(d, paged(d))].sort()).toEqual([0, 1, 2, 4]);
  });
  it('the visit block alone never makes a page indexable', () => {
    const d = shop({ services: [svc('Facial')] });
    expect([...thinServiceIndexes(d, [0])]).toEqual([0]);
  });
  it('only the services that have a page are judged', () => {
    const d = shop();
    expect([...thinServiceIndexes(d, [3])]).toEqual([]);
  });
});

describe('noindex, sitemap and robots.txt on a pages v2 site', () => {
  for (const t of ['luxe', 'prime', 'euphoria'] as const) {
    it(`${t}: thin pages carry noindex,follow and keep their canonical; indexable pages carry neither change`, () => {
      const b = bundle(shop(), t);
      for (const path of ['services/facial/index.html', 'services/wash-style/index.html']) {
        const h = page(b, path);
        expect(h, path).toContain(NOINDEX);
        expect(h, path).toContain(`<link rel="canonical" href="https://fresh.example.com/${path.replace('index.html', '')}">`);
      }
      for (const path of ['services/skin-fade/index.html', 'services/low-fade/index.html', 'services/enhancement/index.html', 'services/index.html', 'about/index.html', 'index.html']) {
        if (!page(b, path)) continue;
        expect(page(b, path), path).not.toContain('name="robots"');
      }
      expect(b.pages.filter((p) => p.html.includes(NOINDEX)).map((p) => p.path).sort()).toEqual(['services/facial/index.html', 'services/wash-style/index.html']);
    });
  }
  it('the sitemap leaves the thin pages out and keeps everything else', () => {
    const b = bundle(shop());
    expect(b.sitemap).not.toContain('/services/facial/');
    expect(b.sitemap).not.toContain('/services/wash-style/');
    for (const h of ['/', '/services/', '/services/skin-fade/', '/services/low-fade/', '/services/enhancement/', '/book']) expect(b.sitemap).toContain(`<loc>https://fresh.example.com${h}</loc>`);
    // the pages are still files, in the menu and linked from Services
    expect(b.pages.map((p) => p.path)).toContain('services/facial/index.html');
    expect(page(b, 'services/index.html')).toContain('href="/services/facial/"');
  });
  it('a page that gains real text leaves noindex and re-enters the sitemap', () => {
    const d = shop();
    d.services[2] = svc('Facial', { description: LONG });
    const b = bundle(d);
    expect(page(b, 'services/facial/index.html')).not.toContain(NOINDEX);
    expect(b.sitemap).toContain('/services/facial/');
  });
  it('robots.txt is Allow-all with the sitemap line, and only when a sitemap ships', () => {
    expect(bundle(shop()).robots).toBe('User-agent: *\nAllow: /\nSitemap: https://fresh.example.com/sitemap.xml\n');
    const noBase = renderSiteBundle(shop(), {});
    expect(noBase.sitemap).toBeNull();
    expect(noBase.robots).toBeNull();
    expect(robotsTxt(null)).toBeNull();
    expect(robotsTxt('not a host')).toBeNull();
    expect(robotsTxt('freshcuts.com')).toBe('User-agent: *\nAllow: /\nSitemap: https://freshcuts.com/sitemap.xml\n');
  });
  it('sitemapXml(set, base) with no skip is what it was', () => {
    const d = shop();
    const set = buildPageSet(d);
    const full = sitemapXml(set, 'https://x.com')!;
    expect(full).toContain('/services/facial/');
    expect(sitemapXml(set, 'https://x.com', new Set<string>())).toBe(full);
    expect(sitemapXml(set, 'https://x.com', new Set(['/services/facial/']))).not.toContain('/services/facial/');
  });
  it('a site with no services page has nothing to mark', () => {
    const b = bundle(shop({ services: [] }));
    expect(b.pages.some((p) => p.html.includes(NOINDEX))).toBe(false);
  });
});

describe('everything older is untouched', () => {
  const OLD = shop({ extraPages: undefined });
  it('a multi-page site without extraPages: no noindex, every service page in the sitemap, no robots.txt', () => {
    const b = bundle(OLD);
    expect(b.pages.some((p) => p.html.includes('name="robots"'))).toBe(false);
    for (const h of ['facial', 'skin-fade', 'low-fade', 'wash-style']) expect(b.sitemap).toContain(`/services/${h}/`);
    expect(b.robots).toBeNull();
  });
  it('a single-page site: one file, no sitemap, no robots.txt, no robots meta', () => {
    const { pages: _p, ...single } = shop();
    void _p;
    const b = renderSiteBundle(single as WebsiteData, BASE);
    expect(b.pages).toHaveLength(1);
    expect(b.sitemap).toBeNull();
    expect(b.robots).toBeNull();
    expect(b.pages[0].html).not.toContain('name="robots"');
  });
  it('the pages-v2 file list is the same as before the thin rule', () => {
    const b = bundle(shop());
    expect(b.pages.map((p) => p.path)).toEqual(['index.html', 'services/index.html', 'services/skin-fade/index.html', 'services/low-fade/index.html', 'services/facial/index.html', 'services/enhancement/index.html', 'services/wash-style/index.html', 'hours/index.html', 'location/index.html', 'contact/index.html', 'first-visit/index.html']);
  });
});
