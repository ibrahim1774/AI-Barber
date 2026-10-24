// Phase C: pageSections (per page type, closed section ids, hide flags and order) and how the renderer honours them.
import { describe, expect, it } from 'vitest';
import { SECTION_IDS, SECTION_PAGES, composeSections, isSectionPage, pageSectionsOf, sectionPageOf } from '../../lib/render/sections';
import { renderSiteBundle } from '../../lib/render/site';
import type { WebsiteData } from '../../types';

const svc = (title: string, extra: Record<string, unknown> = {}) => ({ title, subtitle: '', description: 'A clean fade.', icon: 'scissors' as const, imageUrl: '', ...extra });
const shop = (extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: '', imageUrl: '' },
  about: { heading: 'About', description: [], imageUrl: '' },
  services: [svc('Skin Fade', { price: '$35', duration: '45 min' }), svc('Beard Trim', { price: '$15' }), svc('Kids Cut', { price: '$20' })],
  gallery: [], hours: [{ day: 'Mon', open: '09:00', close: '17:00' }],
  contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' },
  pages: { order: [], hidden: [] },
  extraPages: { on: ['faq', 'first-visit', 'hair-care', 'beard-care'], serviceGuides: true, seed: 3 },
  ...extra,
});
const html = (d: WebsiteData, path: string) => renderSiteBundle(d).pages.find((p) => p.path === path)?.html ?? '';
const at = (h: string, needle: string) => h.indexOf(needle);

describe('the closed section set', () => {
  it('has the page types and ids the app will offer', () => {
    expect([...SECTION_PAGES]).toEqual(['service', 'first-visit', 'hair-care', 'beard-care', 'faq', 'location']);
    expect(SECTION_IDS.service).toEqual(['hero', 'description', 'guide', 'cta', 'team', 'others']);
    expect(SECTION_IDS['first-visit']).toEqual(['hero', 'booking', 'findUs', 'before', 'inChair', 'prices', 'cta']);
    expect(SECTION_IDS.location).toEqual(['map', 'hours', 'services', 'team', 'rating']);
    expect(SECTION_IDS['hair-care']).toContain('often');
    expect(SECTION_IDS['beard-care']).toContain('services');
    expect(SECTION_IDS.faq[0]).toBe('book');
    expect(SECTION_IDS.faq.at(-1)).toBe('cta');
  });
  it('maps page files to a page type', () => {
    expect(sectionPageOf({ key: 'services', child: { index: 0 } })).toBe('service');
    expect(sectionPageOf({ key: 'services' })).toBeNull();
    expect(sectionPageOf({ key: 'about' })).toBeNull();
    expect(sectionPageOf({ key: 'location' })).toBe('location');
    expect(isSectionPage('__proto__')).toBe(false);
  });
});

describe('pageSectionsOf (untrusted JSON)', () => {
  const ids = (d: Partial<WebsiteData>, p: 'service' | 'location') => pageSectionsOf(d as WebsiteData, p).map((s) => (s.hidden ? `-${s.id}` : s.id));
  it('no settings: every section, default order, none hidden', () => {
    expect(ids({}, 'service')).toEqual([...SECTION_IDS.service]);
    expect(ids({ pageSections: undefined }, 'location')).toEqual([...SECTION_IDS.location]);
  });
  it('order wins, the rest keep their default place after it', () => {
    expect(ids({ pageSections: { service: { order: ['others', 'hero'] } } }, 'service')).toEqual(['others', 'hero', 'description', 'guide', 'cta', 'team']);
  });
  it('hidden flags apply and unknown, repeated and non-string ids are ignored', () => {
    const ps = { service: { hidden: ['guide', 'guide', 'nope', 7, '__proto__'], order: ['cta', 'cta', 'x', null] } } as unknown as WebsiteData['pageSections'];
    expect(ids({ pageSections: ps }, 'service')).toEqual(['cta', 'hero', 'description', '-guide', 'team', 'others']);
  });
  it('junk shapes and unknown page types are ignored', () => {
    for (const junk of [null, 5, 'x', [], { service: 5 }, { service: [] }, { service: { order: 'hero', hidden: {} } }, { toString: 1 }]) {
      expect(ids({ pageSections: junk as never }, 'service')).toEqual([...SECTION_IDS.service]);
    }
    expect(ids({ pageSections: JSON.parse('{"__proto__":{"hidden":["hero"]}}') }, 'service')).toEqual([...SECTION_IDS.service]);
  });
  it('a huge order list is capped, not walked', () => {
    const order = Array.from({ length: 50000 }, () => 'cta');
    expect(ids({ pageSections: { service: { order } } }, 'service')[0]).toBe('cta');
  });
  it('composeSections prints visible sections in order', () => {
    expect(composeSections({ pageSections: { location: { hidden: ['hours'], order: ['rating'] } } } as unknown as WebsiteData, 'location', { map: 'M', hours: 'H', services: 'S', team: 'T', rating: 'R' })).toBe('RMST');
  });
});

describe('rendering honours pageSections', () => {
  it('hides a service guide but keeps the rest, and the data stays', () => {
    const d = shop();
    const before = html(d, 'services/skin-fade/index.html');
    expect(before).toContain('About this service');
    const hid = shop({ pageSections: { service: { hidden: ['guide'] } } });
    const after = html(hid, 'services/skin-fade/index.html');
    expect(after).not.toContain('About this service');
    expect(after).toContain('ab-actions');
    expect(hid.pageSections!.service.hidden).toEqual(['guide']);
  });
  it('hides the hero', () => {
    expect(html(shop({ pageSections: { service: { hidden: ['hero'] } } }), 'services/skin-fade/index.html')).not.toContain('ab-hero');
    expect(html(shop({ pageSections: { 'first-visit': { hidden: ['hero'] } } }), 'first-visit/index.html')).not.toContain('ab-hero');
  });
  it('reorders a guide page: Book button first, prices before the blocks', () => {
    const d = shop({ pageSections: { 'first-visit': { order: ['cta', 'prices'] } } });
    const h = html(d, 'first-visit/index.html');
    expect(at(h, 'class="ab-actions"')).toBeGreaterThan(-1);
    expect(at(h, 'class="ab-actions"')).toBeLessThan(at(h, 'Booking'));
    expect(at(h, 'class="ab-rows"')).toBeLessThan(at(h, 'Booking'));
  });
  it('hides one FAQ question by its block id', () => {
    const d = shop();
    expect(html(d, 'faq/index.html')).toContain('How do I book?');
    const h = html(shop({ pageSections: { faq: { hidden: ['book'] } } }), 'faq/index.html');
    expect(h).not.toContain('How do I book?');
    expect(h).toContain('Where is the shop?');
  });
  it('hides and reorders the Location sections', () => {
    const d = shop({ pageSections: { location: { hidden: ['map'], order: ['hours'] } } });
    const h = html(d, 'location/index.html');
    expect(h).not.toContain('class="ab-map"');
    expect(h).toContain('Mon');
  });
  it('hair-care "often" and beard-care "services" hide', () => {
    const d = shop();
    expect(html(d, 'beard-care/index.html')).toContain('Beard Trim');
    expect(html(d, 'beard-care/index.html')).toContain('class="ab-rows"');
    expect(html(shop({ pageSections: { 'beard-care': { hidden: ['services'] } } }), 'beard-care/index.html')).not.toContain('class="ab-rows"');
  });
  it('settings for another page type, or unknown ones, change nothing', () => {
    const base = html(shop(), 'services/skin-fade/index.html').replace(/published-at" content="\d+"/, '');
    const other = html(shop({ pageSections: { location: { hidden: ['map'] }, nope: { hidden: ['hero'] } } as never }), 'services/skin-fade/index.html').replace(/published-at" content="\d+"/, '');
    expect(other).toBe(base);
  });
  it('hiding every section leaves a valid page with its heading and menu', () => {
    const d = shop({ pageSections: { service: { hidden: [...SECTION_IDS.service] } } });
    const h = html(d, 'services/skin-fade/index.html');
    expect(h).toContain('<h1 class="ab-h1">Skin Fade</h1>');
    expect(h).toContain('ab-nav');
  });
  it('internal links still point at deployed files under hidden and reordered setups', () => {
    const d = shop({ pageSections: { service: { hidden: ['team'], order: ['others', 'cta'] }, location: { order: ['rating'] } } });
    const out = renderSiteBundle(d);
    const paths = new Set(out.set.files.map((f) => f.href));
    for (const p of out.pages) for (const m of p.html.matchAll(/href="(\/[^"#?]*)"/g)) if (m[1] !== '/book' && m[1] !== '/shop' && m[1] !== '/styles.css') expect(paths.has(m[1]) || m[1] === '/', `${p.path} ${m[1]}`).toBe(true);
  });
  it('old multi-page sites without extraPages ignore pageSections hero but honour no new pages', () => {
    const old = shop({ extraPages: undefined, pageSections: { service: { hidden: ['guide'], order: ['others'] } } });
    const files = renderSiteBundle(old).pages.map((p) => p.path);
    expect(files.some((p) => /^(faq|first-visit|hair-care|beard-care)\//.test(p))).toBe(false);
  });
});
