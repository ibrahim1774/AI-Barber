// Phase A of generic-and-location pages (plan 2026-10-24): the extra page keys, their gate, and the
// suppression until Phase B supplies copy.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertSiteFilePath, buildPageSet, cleanExtraPages, cleanPagesModel, defaultExtraPages, EXTRA_KEYS, eligiblePages, extraPageRows,
  isPageKey, isReservedPath, pageHref, pagePath, sitemapXml, PAGE_KEYS, type ExtraKey,
} from '../../lib/render/pages';
import { renderSite, renderSiteBundle } from '../../lib/render/site';
import { cityStateOnly, placeFromArea } from '../../lib/render/honest';
import type { WebsiteData } from '../../types';

const svc = (title: string, extra: Record<string, unknown> = {}) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '', ...extra });
const shop = (extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: '', imageUrl: '' },
  about: { heading: 'About', description: [], imageUrl: '' },
  services: [svc('Skin Fade', { price: '$35', duration: '45 min' }), svc('Beard Trim', { price: '$15' }), svc('Kids Cut', { price: '$20' })],
  gallery: [], hours: [{ day: 'Mon', open: '09:00', close: '17:00' }],
  contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' },
  pages: { order: [], hidden: [] },
  ...extra,
});
const READY = undefined;

describe('extra page keys', () => {
  it('are page keys, appended after the existing ones, with clean file paths that are not reserved', () => {
    expect([...EXTRA_KEYS]).toEqual(['faq', 'first-visit', 'hair-care', 'beard-care']);
    expect(PAGE_KEYS.slice(0, 11)).toEqual(['home', 'about', 'services', 'team', 'gallery', 'reviews', 'hours', 'location', 'contact', 'book', 'shop']);
    for (const k of EXTRA_KEYS) {
      expect(isPageKey(k)).toBe(true);
      expect(pagePath(k)).toBe(`${k}/index.html`);
      expect(pageHref(k)).toBe(`/${k}/`);
      expect(() => assertSiteFilePath(pagePath(k) as string)).not.toThrow();
      expect(isReservedPath(k)).toBe(false);
    }
  });
  it('cleanPagesModel accepts them in order and hidden (the Pages sheet may save them)', () => {
    expect(cleanPagesModel({ order: ['faq', 'about', 'nope'], hidden: ['first-visit', 'home'] })).toEqual({ order: ['faq', 'about'], hidden: ['first-visit'] });
  });
});

describe('cleanExtraPages (untrusted JSON)', () => {
  it('keeps known keys once, drops the rest', () => {
    expect(cleanExtraPages({ on: ['faq', 'faq', 'about', 'hair-care', 7, '__proto__'] }).on).toEqual(['faq', 'hair-care']);
    expect(cleanExtraPages(null).on).toEqual([]);
    expect(cleanExtraPages('x').on).toEqual([]);
    expect(cleanExtraPages({ on: 'faq' }).on).toEqual([]);
  });
  it('seed is a finite integer, serviceGuides a boolean, pick/images closed and typed', () => {
    const c = cleanExtraPages({ on: [], seed: 12.5, serviceGuides: 'yes', pick: { a: 1, b: 9, c: 'x' }, images: { faq: 'https://x/y.jpg', evil: 'z', 'first-visit': 3 } });
    expect(c.seed).toBeUndefined();
    expect(c.serviceGuides).toBe(false);
    expect(c.pick).toEqual({ a: 1 });
    expect(c.images).toEqual({ faq: 'https://x/y.jpg' });
    expect(cleanExtraPages({ on: [], seed: 42 }).seed).toBe(42);
  });
});

describe('the default set for new sites', () => {
  it('FAQ + First visit + service guides on; hair care and beard care suggested but off; the seed is the app\'s', () => {
    const d = defaultExtraPages();
    expect(d.on).toEqual(['faq', 'first-visit']);
    expect(d.serviceGuides).toBe(true);
    expect(d.seed).toBeUndefined();
    expect(defaultExtraPages(7).seed).toBe(7);
    expect(defaultExtraPages()).not.toBe(defaultExtraPages());
  });
});

describe('gate: only extraPages.on can create an extra page (the S2 trap)', () => {
  it('a pages model that lists them, with no extraPages.on, produces nothing', () => {
    const d = shop({ pages: { order: ['faq', 'first-visit', 'hair-care', 'beard-care'], hidden: [] } });
    expect(eligiblePages(d, READY)).not.toEqual(expect.arrayContaining(['faq']));
    for (const k of EXTRA_KEYS) expect(buildPageSet(d, READY).files.map((f) => f.key)).not.toContain(k);
  });
  it('an extraPages.on entry for a page whose data floor is not met produces nothing, and says why', () => {
    const d = shop({ extraPages: { on: ['first-visit'] }, phone: '', bookingUrl: '', hours: [], contact: { address: '', email: '' } });
    expect(eligiblePages(d, READY)).not.toContain('first-visit');
    const row = extraPageRows(d, READY).find((r) => r.key === 'first-visit')!;
    expect(row).toMatchObject({ on: true, eligible: false });
    expect(row.reason).not.toBe('');
  });
});

describe('with the library copy (Phase B): every extra on and every floor met', () => {
  const all = shop({ extraPages: { on: [...EXTRA_KEYS] } });
  it('the four pages are files, in the sitemap and the menu', () => {
    const set = buildPageSet(all);
    expect(set.extras).toEqual([...EXTRA_KEYS]);
    expect(set.files.map((f) => f.path)).toEqual(expect.arrayContaining(['faq/index.html', 'first-visit/index.html', 'hair-care/index.html', 'beard-care/index.html']));
    const b = renderSiteBundle(all, { siteBaseUrl: 'https://fresh.example.com' });
    expect(b.sitemap).toMatch(/faq/);
  });
  it('with none on, no extra page exists (the S2 gate)', () => {
    const none = shop({ extraPages: { on: [] } });
    expect(buildPageSet(none).extras).toEqual([]);
  });
  it('the Pages sheet rows are on and eligible', () => {
    const rows = extraPageRows(all);
    expect(rows.map((r) => r.key)).toEqual([...EXTRA_KEYS]);
    for (const r of rows) expect(r).toMatchObject({ on: true, eligible: true, reason: '' });
  });
  it('there is no extraCopy seam anywhere in lib/ (review S2)', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
    for (const f of walk(join(__dirname, '..', '..', 'lib'))) expect(readFileSync(f, 'utf8'), f).not.toContain('extraCopy');
  });
});

describe('the data floors of plan 1c', () => {
  const rows = (d: WebsiteData) => Object.fromEntries(extraPageRows(d, READY).map((r) => [r.key, r.eligible]));
  const on = { extraPages: { on: [...EXTRA_KEYS] } };
  it('FAQ needs at least 3 data-answered questions', () => {
    expect(rows(shop({ ...on }))['faq']).toBe(true);
    expect(rows(shop({ ...on, phone: '', bookingUrl: '', hours: [], services: [svc('Skin Fade')], contact: { address: '1 Main St', email: '' } }))['faq']).toBe(false);
  });
  it('First visit needs (booking link or phone) and (address or hours)', () => {
    expect(rows(shop({ ...on }))['first-visit']).toBe(true);
    expect(rows(shop({ ...on, phone: '', bookingUrl: '' }))['first-visit']).toBe(false);
    expect(rows(shop({ ...on, hours: [], contact: { address: '', email: '' } }))['first-visit']).toBe(false);
    expect(rows(shop({ ...on, bookingUrl: '', hours: [] }))['first-visit']).toBe(true);
  });
  it('Hair care needs a haircut-type service; Beard care a beard or shave service', () => {
    expect(rows(shop({ ...on }))).toMatchObject({ 'hair-care': true, 'beard-care': true });
    expect(rows(shop({ ...on, services: [svc('Hot Towel Shave')] }))).toMatchObject({ 'hair-care': false, 'beard-care': true });
    expect(rows(shop({ ...on, services: [svc('Skin Fade')] }))).toMatchObject({ 'hair-care': true, 'beard-care': false });
    expect(rows(shop({ ...on, services: [] }))).toMatchObject({ 'hair-care': false, 'beard-care': false });
  });
  it('an eligible, on page is a file in the set, the sitemap and the nav; an off one is none of them', () => {
    const d = shop({ extraPages: { on: ['faq', 'first-visit'] } });
    const set = buildPageSet(d, READY);
    expect(set.extras).toEqual(['faq', 'first-visit']);
    expect(set.files.map((f) => f.path)).toEqual(expect.arrayContaining(['faq/index.html', 'first-visit/index.html']));
    expect(set.files.map((f) => f.path)).not.toContain('hair-care/index.html');
    const xml = sitemapXml(set, 'https://fresh.example.com')!;
    expect(xml).toContain('https://fresh.example.com/faq/');
    expect(xml).not.toContain('hair-care');
    // hiding it in the Pages sheet takes it out again
    const hidden = buildPageSet({ ...d, pages: { order: [], hidden: ['faq'] } }, READY);
    expect(hidden.files.map((f) => f.path)).not.toContain('faq/index.html');
    expect(hidden.extras).toEqual(['first-visit']);
    // and so does a single-page site
    expect(renderSite({ ...d, pages: undefined }, 'luxe', {}).map((f) => f.path)).toEqual(['index.html']);
  });
});

describe('the page shells: menu, titles, links and sitemap only reach deployed pages', () => {
  const d = shop({ extraPages: { on: [...EXTRA_KEYS] } });
  const base = { siteBaseUrl: 'https://fresh.example.com' };
  it.each(['luxe', 'prime', 'euphoria'] as const)('%s: each extra page is a file with its own title, a self-canonical and the full shell', (template) => {
    const r = renderSiteBundle({ ...d, template }, base);
    const paths = r.pages.map((p) => p.path);
    expect(paths).toEqual(expect.arrayContaining(['faq/index.html', 'first-visit/index.html', 'hair-care/index.html', 'beard-care/index.html']));
    const html = (p: string) => r.pages.find((x) => x.path === p)!.html;
    expect(html('faq/index.html')).toContain('<title>Questions · Fresh Cuts, Brooklyn, NY</title>');
    expect(html('first-visit/index.html')).toContain('<title>Your first visit · Fresh Cuts</title>');
    expect(html('hair-care/index.html')).toContain('<title>Hair care between cuts · Fresh Cuts</title>');
    expect(html('beard-care/index.html')).toContain('<title>Beard care · Fresh Cuts</title>');
    expect(html('faq/index.html')).toContain('<link rel="canonical" href="https://fresh.example.com/faq/">');
    const titles = r.pages.map((p) => /<title>([\s\S]*?)<\/title>/.exec(p.html)?.[1]);
    expect(new Set(titles).size).toBe(titles.length);
    expect(r.sitemap).toContain('https://fresh.example.com/first-visit/');
  });
  it('every internal href of every page is a file in the set (or the proxied /book)', () => {
    for (const hidden of [[], ['hours'], ['faq'], ['services', 'location'], ['contact', 'first-visit']] as const) {
      const r = renderSiteBundle({ ...d, pages: { order: [], hidden: [...hidden] as never } }, base);
      const files = new Set(r.pages.map((p) => p.path));
      for (const p of r.pages) {
        for (const m of p.html.matchAll(/href="(\/[^"#?]*)"/g)) {
          const href = m[1];
          if (href === '/book' || href === '/styles.css') continue;
          const file = href === '/' ? 'index.html' : `${href.slice(1)}index.html`;
          expect(files.has(file), `${p.path} -> ${href} (hidden ${hidden.join(',')})`).toBe(true);
        }
      }
    }
  });
  it('the menu and footer name the extra pages with their labels, and a renamed label is escaped', () => {
    const r = renderSiteBundle({ ...d, labels: { pgNavFirstVisit: '1st <b>visit</b>' } as never }, base);
    const h = r.pages.find((p) => p.path === 'hours/index.html')!.html;
    expect(h).toContain('>FAQ<'); expect(h).toContain('1st &lt;b&gt;visit&lt;/b&gt;');
    expect(h).not.toContain('<b>visit');
  });
});

describe('the place default (Phase A review B1, S1)', () => {
  it.each<[string, string]>([
    ['123 Main St, Brooklyn, NY 11201, USA', 'Brooklyn, NY'],
    ['123 Main St, Brooklyn, NY 11201', 'Brooklyn, NY'],
    ['123 Main St, Brooklyn, NY, United States', 'Brooklyn, NY'],
    ['728 Franklin Ave, Brooklyn, NY 11238, USA', 'Brooklyn, NY'],
    ['10 King St W, Toronto, ON M5V 3A8, Canada', 'Toronto, ON'],
    ['Austin, TX', 'Austin, TX'],
    ['Austin, TX, USA', 'Austin, TX'],
    ['Downtown, Brooklyn, NY', 'Brooklyn, NY'],
    ['Brooklyn', 'Brooklyn'],
    ['1 Main St, Austin', ''],
    ['1 Main St', ''],
    ['', ''],
    ['x'.repeat(61), ''],
  ])('%s -> %s', (area, place) => { expect(placeFromArea(area)).toBe(place); });
  it('a formatted-address area gives a clean service title, Location title and eyebrow', () => {
    const d = shop({ area: '123 Main St, Brooklyn, NY 11201, USA' });
    const html = renderSite(d).find((f) => f.path === 'services/skin-fade/index.html')!.html;
    expect(html).toContain('<title>Skin Fade in Brooklyn, NY · Fresh Cuts</title>');
    expect(html).toContain('Barbershop in Brooklyn, NY');
    expect(renderSite(d).find((f) => f.path === 'location/index.html')!.html).toContain('<title>Barbershop in Brooklyn, NY · Fresh Cuts</title>');
  });
  it('a street-address area that gives no place keeps the old titles and prints no place line', () => {
    const html = renderSite(shop({ area: '1 Main St, Austin' })).find((f) => f.path === 'services/skin-fade/index.html')!.html;
    expect(html).toContain('<title>Skin Fade · Fresh Cuts</title>');
    expect(/<main[\s\S]*<\/main>/.exec(html)![0]).not.toContain('ab-eyebrow');
  });
  it('the single-page footer line still uses cityStateOnly (single pages did not move)', () => {
    expect(cityStateOnly('123 Main St, Brooklyn, NY 11201, USA')).toBe('NY 11201, USA');
  });
});

describe('the footer call link (Phase A review S3)', () => {
  it('keeps digits and + only', () => {
    const html = renderSite(shop({ phone: '(512) 555-0100 ext 2' })).find((f) => f.path === 'hours/index.html')!.html;
    const foot = /<footer[\s\S]*<\/footer>/.exec(html)![0];
    expect(foot).toContain('href="tel:51255501002"');
    expect(foot).not.toContain('tel:(512)');
  });
});
