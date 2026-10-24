// Phase C (plan 2026-10-24, section 4): the per-page hero photo slot, its sample fallback, and the publish path.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { heroKeyOf, heroPathOf, heroSlot, heroSlotsOf, sampleHeroUrl, HERO_EXTRA_PAGES } from '../../lib/render/heroes';
import { DEMO_GALLERY_STOCK, isStockImage } from '../../lib/stockImages';
import { renderSiteBundle, imageUrlMapOf, forRender } from '../../lib/render/site';
import { buildImageUrlMap, toPendingSiteData } from '../../lib/ios/pendingData';
import { restoreImageUrls, validationProblem } from '../../lib/ios/siteShape';
import { finalizePages } from '../../lib/deploySite';
import { SECTION_IDS } from '../../lib/render/sections';
import { extraPageRows } from '../../lib/render/pages';
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
  extraPages: { on: ['faq', 'first-visit', 'hair-care', 'beard-care'], serviceGuides: true, seed: 3 },
  ...extra,
});
const OWN = 'https://blob.example.com/barber/fade.jpg';
const html = (d: WebsiteData, path: string, opts = {}) => renderSiteBundle(d, opts).pages.find((p) => p.path === path)?.html ?? '';

describe('hero keys and paths', () => {
  it('service pages use service<i> / services.<i>.imageUrl, guide pages page-<key> / extraPages.images.<key>', () => {
    expect(heroKeyOf({ key: 'services', child: { index: 2 } })).toBe('service2');
    expect(heroPathOf({ key: 'services', child: { index: 2 } })).toBe('services.2.imageUrl');
    for (const k of HERO_EXTRA_PAGES) {
      expect(heroKeyOf({ key: k })).toBe(`page-${k}`);
      expect(heroPathOf({ key: k })).toBe(`extraPages.images.${k}`);
    }
    expect(heroKeyOf({ key: 'faq' })).toBeNull();
    expect(heroKeyOf({ key: 'services' })).toBeNull();
    expect(heroKeyOf({ key: 'location' })).toBeNull();
  });
  it('samples come only from DEMO_GALLERY_STOCK and are recognised as samples', () => {
    for (const f of [{ key: 'services', child: { index: 0 } }, { key: 'first-visit' }, { key: 'hair-care' }, { key: 'beard-care' }]) {
      const u = sampleHeroUrl(shop(), f);
      expect(DEMO_GALLERY_STOCK).toContain(u);
      expect(isStockImage(u)).toBe(true);
    }
  });
  it('a guide always gets the same sample', () => {
    const d = shop();
    expect(sampleHeroUrl(d, { key: 'services', child: { index: 0 } })).toBe(sampleHeroUrl(d, { key: 'services', child: { index: 0 } }));
  });
});

describe('heroSlot', () => {
  it('is null for sites that never opted into pages v2 (old sites gain nothing)', () => {
    expect(heroSlot(shop({ extraPages: undefined }), { key: 'services', child: { index: 0 } })).toBeNull();
  });
  it('own photo wins; no photo falls back to a sample, flagged', () => {
    const d = shop({ services: [svc('Skin Fade', { imageUrl: OWN }), svc('Taper')] });
    const own = heroSlot(d, { key: 'services', child: { index: 0 } }, imageUrlMapOf(d))!;
    expect(own).toMatchObject({ key: 'service0', path: 'services.0.imageUrl', own: true, sample: false, url: OWN });
    const none = heroSlot(d, { key: 'services', child: { index: 1 } }, imageUrlMapOf(d))!;
    expect(none).toMatchObject({ key: 'service1', own: false, sample: true });
    expect(isStockImage(none.url)).toBe(true);
  });
  it('a stock URL stored in the slot is still a sample', () => {
    const d = shop({ extraPages: { on: ['first-visit'], serviceGuides: true, images: { 'first-visit': DEMO_GALLERY_STOCK[2] } } });
    const s = heroSlot(d, { key: 'first-visit' }, imageUrlMapOf(d))!;
    expect(s).toMatchObject({ own: true, sample: true });
  });
  it('non-http values and marker strings are not photos', () => {
    const d = shop({ services: [svc('Skin Fade', { imageUrl: 'javascript:alert(1)' })] });
    expect(heroSlot(d, { key: 'services', child: { index: 0 } }, imageUrlMapOf(d))!.own).toBe(false);
  });
  it('heroSlotsOf lists the slots the app can edit', () => {
    const slots = heroSlotsOf(shop());
    expect(slots.map((s) => s.path)).toEqual(['services.0.imageUrl', 'services.1.imageUrl', 'services.2.imageUrl', 'extraPages.images.first-visit', 'extraPages.images.hair-care', 'extraPages.images.beard-care']);
    expect(heroSlotsOf(shop({ extraPages: undefined }))).toEqual([]);
  });
});

describe('rendering the hero', () => {
  it('own photo prints a placeholder, alt is the service name, never the shop work', () => {
    const d = shop({ services: [svc('Skin Fade', { imageUrl: OWN }), svc('Beard Trim')] });
    const h = html(d, 'services/skin-fade/index.html');
    expect(h).toContain('src="{{service0}}"');
    expect(h).toMatch(/alt="Skin Fade"/);
    expect(h).not.toMatch(/our work|our shop/i);
  });
  it('no photo prints the sample URL directly (escaped), with an empty alt', () => {
    const h = html(shop(), 'services/skin-fade/index.html');
    expect(h).toMatch(/<img class="ab-photo ab-hero"[^>]*src="https:\/\/images\.unsplash\.com[^"]*"/);
    expect(h).toMatch(/ab-hero"[^>]*alt=""/);
  });
  it('guide pages carry a hero too, FAQ and the rest do not', () => {
    const d = shop();
    for (const p of ['first-visit', 'hair-care', 'beard-care']) expect(html(d, `${p}/index.html`)).toContain('class="ab-photo ab-hero"');
    expect(html(d, 'faq/index.html')).not.toContain('ab-hero');
    expect(html(d, 'location/index.html')).not.toContain('ab-hero');
  });
  it('sites without extraPages render service pages exactly as before (no hero)', () => {
    const h = html(shop({ extraPages: undefined, services: [svc('Skin Fade', { imageUrl: OWN })] }), 'services/skin-fade/index.html');
    expect(h).not.toContain('ab-hero');
    expect(h).not.toContain('{{service0}}');
  });
  it('samples never reach the gallery page or the home gallery', () => {
    const d = shop();
    const files = renderSiteBundle(d).pages;
    expect(files.some((p) => p.path === 'gallery/index.html')).toBe(false);
    const g = shop({ gallery: [OWN, OWN + '2', OWN + '3', DEMO_GALLERY_STOCK[0]] });
    const gh = html(g, 'gallery/index.html');
    expect(gh).toContain('{{gallery0}}');
    expect(gh).not.toContain('{{gallery3}}');
    expect(gh).not.toContain(DEMO_GALLERY_STOCK[5]);
  });
  it('XSS: a hostile image URL is escaped in the swapped page and never breaks the attribute', () => {
    const evil = 'https://x.example.com/a.jpg"><script>alert(1)</script>';
    const d = shop({ services: [svc('Skin Fade', { imageUrl: evil })] });
    const out = finalizePages(renderSiteBundle(d).pages, imageUrlMapOf(d)).find((p) => p.path === 'services/skin-fade/index.html')!.html;
    expect(out).not.toContain('<script>alert(1)');
    expect(out).toContain('&quot;&gt;&lt;script&gt;');
  });
  it('a hostile service title in alt is escaped', () => {
    const d = shop({ services: [svc('Fade "><img src=x onerror=1>', {})] });
    const all = renderSiteBundle(d).pages.map((p) => p.html).join('');
    expect(all).not.toContain('<img src=x onerror=1>');
  });
  it('every {{key}} is swapped on every page', () => {
    const d = shop({ services: [svc('Skin Fade', { imageUrl: OWN }), svc('Beard Trim', { imageUrl: OWN + '2' })], extraPages: { on: ['first-visit', 'hair-care'], serviceGuides: true, images: { 'hair-care': OWN + '3' } } });
    const pages = finalizePages(renderSiteBundle(d).pages, imageUrlMapOf(d));
    for (const p of pages) expect(p.html, p.path).not.toMatch(/\{\{(service\d+|page-[a-z-]+)\}\}/);
    expect(pages.find((p) => p.path === 'hair-care/index.html')!.html).toContain(OWN + '3');
  });
});

describe('the publish path', () => {
  const d = shop({ services: [svc('Skin Fade', { imageUrl: OWN }), svc('Taper', { imageUrl: 'data-less' })], extraPages: { on: ['first-visit'], serviceGuides: true, images: { 'first-visit': OWN + '9', 'hair-care': 'not a url' } } });
  it('buildImageUrlMap adds service<i> and page-<key> for http(s) URLs only', () => {
    const m = buildImageUrlMap(d);
    expect(m.service0).toBe(OWN);
    expect(m.service1).toBeUndefined();
    expect(m['page-first-visit']).toBe(OWN + '9');
    expect(m['page-hair-care']).toBeUndefined();
  });
  it('toPendingSiteData stores uploaded markers for them, and clears the rest', () => {
    const p = toPendingSiteData(d, buildImageUrlMap(d));
    expect(p.services[0].imageUrl).toBe('uploaded');
    expect(p.services[1].imageUrl).toBe('');
    expect(p.extraPages!.images).toEqual({ 'first-visit': 'uploaded' });
    expect(p.extraPages!.on).toEqual(['first-visit']);
    expect(JSON.stringify(p)).not.toContain(OWN);
  });
  it('restoreImageUrls is the inverse', () => {
    const m = buildImageUrlMap(d);
    const back = restoreImageUrls(toPendingSiteData(d, m), m);
    expect(back.services[0].imageUrl).toBe(OWN);
    expect(back.extraPages!.images).toEqual({ 'first-visit': OWN + '9' });
  });
  it('sites without extraPages keep service imageUrl blanked exactly as before and gain no map keys', () => {
    const old = shop({ extraPages: undefined, services: [svc('Skin Fade', { imageUrl: OWN })] });
    const m = buildImageUrlMap(old);
    expect(Object.keys(m).some((k) => k.startsWith('service'))).toBe(false);
    expect(toPendingSiteData(old, m).services[0].imageUrl).toBe('');
    expect(toPendingSiteData(old, m).extraPages).toBeUndefined();
  });
  it('the pending shape renders the same bytes as the real-URL shape (swap on every page)', () => {
    const m = buildImageUrlMap(d);
    const pend = toPendingSiteData(d, m);
    const a = finalizePages(renderSiteBundle(pend, { imageUrls: m }).pages, m);
    const b = finalizePages(renderSiteBundle(d).pages, imageUrlMapOf(d));
    const strip = (h: string) => h.replace(/published-at" content="\d+"/, '');
    expect(a.map((p) => strip(p.html))).toEqual(b.map((p) => strip(p.html)));
  });
  it('imageUrlMapOf and forRender know the new keys', () => {
    const m = imageUrlMapOf(d);
    expect(m.service0).toBe(OWN);
    expect(m['page-first-visit']).toBe(OWN + '9');
    const r = forRender(d, m);
    expect(r.services[0].imageUrl).toBe('has-image');
    expect(r.extraPages!.images).toEqual({ 'first-visit': 'has-image' });
  });
  it('data: images in the new slots are still refused; the 3 MB cap stays', () => {
    const bad = shop({ services: [svc('Skin Fade', { imageUrl: 'data:image/png;base64,AAAA' })] });
    expect(validationProblem(bad)).toMatch(/data:/);
    const bad2 = shop({ extraPages: { on: [], images: { 'hair-care': 'data:image/png;base64,AAAA' } } });
    expect(validationProblem(bad2)).toMatch(/data:/);
  });
  it('the publish route does not special-case images (the shared transforms are the only path)', () => {
    const src = readFileSync(join(__dirname, '../../lib/ios/publishFlow.ts'), 'utf8');
    expect(src).toContain('buildImageUrlMap(sd)');
  });
});

describe('Phase C review fixes', () => {
  it('B1: the sample tables use the corrected photos and never the women\'s salon photo (index 5)', async () => {
    const { SAMPLE_FOR_GUIDE, SAMPLE_FOR_PAGE } = await import('../../lib/render/heroes');
    expect(DEMO_GALLERY_STOCK).toHaveLength(8);
    expect(SAMPLE_FOR_GUIDE).toEqual({ 'cut-beard': 3, fade: 4, taper: 0, 'line-up': 3, 'beard-trim': 7, shave: 6, 'kids-cut': 2, design: 2, color: 6, haircut: 2 });
    expect(SAMPLE_FOR_PAGE).toEqual({ 'first-visit': 1, 'hair-care': 0, 'beard-care': 7 });
    for (const n of [...Object.values(SAMPLE_FOR_GUIDE), ...Object.values(SAMPLE_FOR_PAGE)]) { expect(n).not.toBe(5); expect(n).toBeLessThan(8); }
  });
  it('N1: one opt-in helper; an array extraPages is not pages v2 anywhere', async () => {
    const { hasPagesV2 } = await import('../../lib/pagesV2');
    expect(hasPagesV2({ extraPages: { on: [] } } as never)).toBe(true);
    for (const v of [[], undefined, null, 'x', 5, true]) expect(hasPagesV2({ extraPages: v } as never)).toBe(false);
    const d = shop({ extraPages: [] as never, services: [svc('Skin Fade', { imageUrl: OWN })] });
    expect(imageUrlMapOf(d)).not.toHaveProperty('service0');
    expect(forRender(d, imageUrlMapOf(d)).services[0].imageUrl).toBe(d.services[0].imageUrl);
    expect(buildImageUrlMap(d)).not.toHaveProperty('service0');
  });
  it('N4: a sample hero has an empty alt; the first hero image is not lazy; an own photo keeps the service name as alt', () => {
    const sample = html(shop(), 'services/skin-fade/index.html');
    const tag = /<img class="ab-photo ab-hero"[^>]*>/.exec(sample)![0];
    expect(tag).toContain('alt=""');
    expect(tag).not.toContain('loading="lazy"');
    for (const p of ['first-visit', 'hair-care', 'beard-care']) expect(/<img class="ab-photo ab-hero"[^>]*>/.exec(html(shop(), `${p}/index.html`))![0]).toContain('alt=""');
    const own = /<img class="ab-photo ab-hero"[^>]*>/.exec(html(shop({ services: [svc('Skin Fade', { imageUrl: OWN })] }), 'services/skin-fade/index.html'))![0];
    expect(own).toContain('alt="Skin Fade"');
    expect(own).not.toContain('loading="lazy"');
  });
  it('null entries in services do not throw', () => {
    expect(() => renderSiteBundle(shop({ services: [null as never, svc('Haircut')] }), {})).not.toThrow();
  });
});

describe('S1: a page whose content sections are all hidden is switched off', () => {
  const ids = (page: 'first-visit' | 'hair-care' | 'beard-care' | 'faq') => SECTION_IDS[page].filter((x) => x !== 'hero' && x !== 'cta');
  it('is not published, not in the menu, not in the sitemap; the Pages sheet row says why', () => {
    const d = shop({ pageSections: { 'hair-care': { hidden: ids('hair-care') } } as never });
    const r = renderSiteBundle(d, { siteBaseUrl: 'https://fresh.example.com' });
    expect(r.pages.some((p) => p.path === 'hair-care/index.html')).toBe(false);
    expect(r.pages.some((p) => p.path.includes('hair-care'))).toBe(false);
    for (const p of r.pages) expect(p.html, p.path).not.toContain('href="/hair-care/"');
    expect(r.pages.find((p) => p.path === 'sitemap.xml')?.html ?? '').not.toContain('hair-care');
    const row = extraPageRows(d).find((x) => x.key === 'hair-care')!;
    expect(row.eligible).toBe(false);
    expect(row.reason).toMatch(/section/i);
  });
  it('showing one section brings the page back', () => {
    const hidden = ids('hair-care').filter((x) => x !== 'wash');
    const r = renderSiteBundle(shop({ pageSections: { 'hair-care': { hidden } } as never }), {});
    expect(r.pages.some((p) => p.path === 'hair-care/index.html')).toBe(true);
  });
  it('the other extra pages behave the same', () => {
    for (const k of ['first-visit', 'beard-care', 'faq'] as const) {
      const r = renderSiteBundle(shop({ pageSections: { [k]: { hidden: ids(k) } } as never }), {});
      expect(r.pages.some((p) => p.path === `${k}/index.html`), k).toBe(false);
    }
  });
});
