// Phase A of generic-and-location pages (plan 2026-10-24): the extra page keys, their gate, and the
// suppression until Phase B supplies copy.
import { describe, expect, it } from 'vitest';
import {
  assertSiteFilePath, buildPageSet, cleanExtraPages, cleanPagesModel, defaultExtraPages, EXTRA_KEYS, eligiblePages, extraPageRows,
  isPageKey, isReservedPath, pageHref, pagePath, sitemapXml, PAGE_KEYS, type ExtraKey,
} from '../../lib/render/pages';
import { renderSite, renderSiteBundle } from '../../lib/render/site';
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
// A test seam: pretend Phase B shipped copy for these pages.
const READY = { extraCopy: [...EXTRA_KEYS] as ExtraKey[] };

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

describe('suppressed until Phase B supplies copy', () => {
  const all = shop({ extraPages: { on: [...EXTRA_KEYS] } });
  it('every extra on, every floor met: still no extra page, no file, no sitemap entry, no link', () => {
    const set = buildPageSet(all);
    expect(set.extras).toEqual([]);
    expect(set.files.map((f) => f.path)).toEqual(['index.html', 'services/index.html', 'services/skin-fade/index.html', 'services/beard-trim/index.html', 'services/kids-cut/index.html', 'hours/index.html', 'location/index.html', 'contact/index.html']);
    const b = renderSiteBundle(all, { siteBaseUrl: 'https://fresh.example.com' });
    expect(b.sitemap).not.toMatch(/faq|first-visit|hair-care|beard-care/);
    for (const f of b.pages) expect(f.html).not.toMatch(/href="\/(faq|first-visit|hair-care|beard-care)\//);
  });
  it('output with all four on is identical to output with none on', () => {
    const a = renderSite(all).map((f) => f.html.replace(/published-at" content="\d+"/, ''));
    const b = renderSite({ ...all, extraPages: undefined }).map((f) => f.html.replace(/published-at" content="\d+"/, ''));
    expect(a).toEqual(b);
  });
  it('the Pages sheet rows exist, are on, are not eligible, and carry a reason', () => {
    const rows = extraPageRows(all);
    expect(rows.map((r) => r.key)).toEqual([...EXTRA_KEYS]);
    for (const r of rows) expect(r).toMatchObject({ on: true, eligible: false });
    for (const r of rows) expect(r.reason).not.toBe('');
  });
});

describe('with copy available (seam): the gates of plan 1c', () => {
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
