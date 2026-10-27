// Header brand: logo + shop name together (default), logo only, or name only (site.headerShow = 'logo' | 'name'; absent = both).
// Plan: docs/superpowers/plans/2026-10-27-batch-a-logo-font-fixes.md A2 + A3.
import { describe, expect, it } from 'vitest';
import { renderSiteBundle } from '../../lib/render/site';
import { LOGO_SIZE, PAIR_CSS, brandHtml } from '../../lib/render/shell';
import { headerBrand, cleanHeaderShow } from '../../lib/render/logo';
import { toPendingSiteData } from '../../lib/ios/pendingData';
import { validationProblem, restoreImageUrls } from '../../lib/ios/siteShape';
import type { WebsiteData } from '../../types';

const URL_ = 'https://storage.googleapis.com/bkt/ios-drafts/abc-123/logo/1-ab.png';
const SHAPES: Record<string, { w: number; h: number }> = {
  wide: { w: 600, h: 80 }, tall: { w: 80, h: 600 }, square: { w: 300, h: 300 }, tiny: { w: 16, h: 16 }, transparent: { w: 400, h: 200 },
};
const svc = (title: string) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '' });
const site = (template: string, multi: boolean, extra: Record<string, unknown> = {}): WebsiteData => ({
  shopName: 'Jax Barber Shop', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template,
  hero: { heading: 'Hello', tagline: '', imageUrl: '' }, about: { heading: 'About', description: [], imageUrl: '' },
  services: [svc('Skin Fade')], gallery: [], contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' },
  ...(multi ? { pages: { order: [], hidden: [] }, extraPages: { on: ['faq'], serviceGuides: true, seed: 1 } } : {}),
  ...extra,
} as unknown as WebsiteData);
const stamp = (h: string) => h.replace(/(name="published-at" content=")\d+/, '$1T');
const render = (d: WebsiteData) => stamp(renderSiteBundle(d, { siteBaseUrl: 'https://x.example.com' }).pages[0].html);
const nested = (d: WebsiteData) => stamp(renderSiteBundle(d, { siteBaseUrl: 'https://x.example.com' }).pages.find((x) => x.path === 'services/index.html')!.html);
/** The header region: <header> for multi-page, the first <nav>/<header> of the body for single pages. */
const headerOf = (html: string, multi: boolean, t: string): string => {
  // a multi-page site's nested pages (and its prime/euphoria home) use the shared header; the luxe home keeps its own
  const shared = /<header class="ab-head"[\s\S]*?<\/header>/.exec(html);
  if (shared) return shared[0];
  const i = html.indexOf(t === 'luxe' ? '<header id="header"' : '<nav style="position:sticky');
  return html.slice(i, html.indexOf(t === 'luxe' ? '</header>' : '</nav>', i));
};
const text = (h: string) => h.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe.each(['luxe', 'prime', 'euphoria'] as const)('%s header brand', (t) => {
  for (const multi of [true, false]) {
    const where = multi ? 'multi-page' : 'single-page';
    for (const [shape, dims] of Object.entries(SHAPES)) {
      it(`${where} ${shape}: default (no headerShow) = logo + name, one img alt="", name fully printed, no clipping`, () => {
        const html = render(site(t, multi, { logo: { url: URL_, ...dims } }));
        const hdr = headerOf(html, multi, t);
        const imgs = hdr.match(/<img\b[^>]*>/g) ?? [];
        expect(imgs).toHaveLength(1);
        expect(imgs[0]).toContain('alt=""');
        expect(imgs[0]).toContain('class="ab-logo-img"');
        expect(imgs[0]).toContain(`width="${dims.w}" height="${dims.h}"`);
        expect(imgs[0]).toContain('fetchpriority="high"');
        expect(imgs[0]).toContain(`height:${LOGO_SIZE[t].both.h}`);
        expect(imgs[0]).toContain(`max-width:min(${LOGO_SIZE[t].both.maxW.slice(4, -1)},30%)`);
        expect(hdr).toContain('class="ab-brand ab-pair"');
        expect(hdr).toMatch(/<span class="ab-brand-name[ "]/);
        expect(text(hdr)).toContain('Jax Barber Shop');
        // never clipped: no clamp, no overflow:hidden in the header markup or the pair CSS
        expect(hdr.replace(/<style>[\s\S]*?<\/style>/g, '')).not.toMatch(/line-clamp|overflow:\s*hidden/);
        const css = [...hdr.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).find((c) => c.includes('.ab-pair')) ?? '';
        expect(css).toBe(PAIR_CSS[t]);
        expect(css).not.toMatch(/line-clamp|overflow:\s*hidden/);
        expect(css).toMatch(/\.ab-brand\.ab-pair img\{[^}]*min-width:28px[^}]*max-width:30%/);
      });
    }

    it(`${where}: headerShow 'logo' = logo only (alt = name, no name span, no pair)`, () => {
      const hdr = headerOf(render(site(t, multi, { logo: { url: URL_, ...SHAPES.wide }, headerShow: 'logo' })), multi, t);
      const img = /<img\b[^>]*>/.exec(hdr)![0];
      expect(img).toContain('alt="Jax Barber Shop"');
      expect(img).not.toContain('ab-logo-img');
      expect(img).toContain(`height:${LOGO_SIZE[t].logo.h}`);
      expect(hdr).not.toContain('ab-pair');
      expect(hdr).not.toContain('ab-brand-name');
      expect(text(hdr).replace(/Jax Barber Shop/, '')).not.toContain('Barber'); // name only in alt
    });

    it(`${where}: headerShow 'name' = today's no-logo header, byte for byte (the logo stays stored)`, () => {
      const withLogoHidden = render(site(t, multi, { logo: { url: URL_, ...SHAPES.square }, headerShow: 'name' }));
      const noLogo = render(site(t, multi));
      expect(withLogoHidden).toBe(noLogo);
      expect(headerOf(withLogoHidden, multi, t)).not.toContain('<img');
    });

    it(`${where}: an invalid logo with headerShow 'logo' or 'both' falls back to the name; unknown headerShow renders both`, () => {
      for (const headerShow of ['logo', undefined]) {
        const html = render(site(t, multi, { logo: { url: URL_, w: 'x', h: 5 }, ...(headerShow ? { headerShow } : {}) }));
        expect(html).toBe(render(site(t, multi)));
      }
      for (const headerShow of ['x', 5, 'both', null, {}]) {
        const hdr = headerOf(render(site(t, multi, { logo: { url: URL_, ...SHAPES.wide }, headerShow })), multi, t);
        expect(hdr, String(headerShow)).toContain('ab-pair');
      }
    });

    it(`${where}: the shop name is escaped in both mode`, () => {
      const hdr = headerOf(render(site(t, multi, { shopName: 'A <b>x</b> & "Q"', logo: { url: URL_, ...SHAPES.square } })), multi, t);
      expect(hdr).not.toContain('<b>');
      expect(hdr).toContain('&lt;b&gt;');
    });

    it(`${where}: editor markers survive in both mode and the img stays inside the header (tap routes to the logo screen)`, () => {
      const SEP = '⁣';
      const name = `${SEP}shopName${SEP}Jax Barber Shop${SEP}/${SEP}`;
      const hdr = headerOf(render(site(t, multi, { shopName: name, logo: { url: URL_, ...SHAPES.square } })), multi, t);
      expect(hdr).toContain(`${SEP}shopName${SEP}`);
      expect(hdr).toContain(`${SEP}/${SEP}`);
      expect(hdr).toContain('fetchpriority="high"');
    });
  }

  it('luxe splits the first word and the accent in both mode', () => {
    if (t !== 'luxe') return;
    expect(headerOf(nested(site(t, true, { logo: { url: URL_, ...SHAPES.square } })), true, t)).toContain('<span class="ab-accent">Barber Shop</span>');
    expect(headerOf(render(site(t, false, { logo: { url: URL_, ...SHAPES.square } })), false, t)).toContain('<span class="text-[#f4a100]">Barber Shop</span>');
  });

  it('a nested page: pair in both mode (links home), logo only, and the plain name when hidden', () => {
    const logo = { url: URL_, ...SHAPES.square };
    const both = headerOf(nested(site(t, true, { logo })), true, t);
    expect(both).toMatch(/<a class="ab-brand ab-pair" href="\/"><img [^>]*alt=""[^>]*><span class="ab-brand-name">/);
    expect(text(both)).toContain('Jax Barber Shop');
    expect(headerOf(nested(site(t, true, { logo, headerShow: 'logo' })), true, t)).toMatch(/<a class="ab-brand ab-logo" href="\/"[^>]*><img[^>]*alt="Jax Barber Shop"/);
    expect(nested(site(t, true, { logo, headerShow: 'name' }))).toBe(nested(site(t, true)));
  });
});

describe('sizes and CSS', () => {
  it('every design defines logo and both sizes; both is smaller than logo-only', () => {
    for (const t of ['luxe', 'prime', 'euphoria'] as const) {
      expect(LOGO_SIZE[t].logo.h).toMatch(/^clamp\(/);
      expect(LOGO_SIZE[t].both.h).toMatch(/^clamp\(/);
      expect(parseInt(LOGO_SIZE[t].both.h.slice(6), 10)).toBeLessThan(parseInt(LOGO_SIZE[t].logo.h.slice(6), 10));
      expect(PAIR_CSS[t]).not.toMatch(/line-clamp|overflow:\s*hidden/);
      expect(PAIR_CSS[t]).toContain('.ab-brand-name{min-width:0;flex:1 1 auto;overflow-wrap:break-word');
    }
  });
  it('brandHtml returns the name-only markup untouched when the mode is name or there is no logo', () => {
    const base = { single: true, alt: 'x', href: '#top', nameHtml: 'N', nameOnly: '<NAME-ONLY/>' };
    expect(brandHtml('prime', { ...base, mode: 'name', logo: { w: 1, h: 1 } })).toBe('<NAME-ONLY/>');
    expect(brandHtml('prime', { ...base, mode: 'both', logo: null })).toBe('<NAME-ONLY/>');
  });
});

describe('headerShow data model', () => {
  const L = { url: URL_, w: 600, h: 200 };
  it('headerBrand picks the mode; no usable logo is always name', () => {
    expect(headerBrand({ logo: L })).toEqual({ mode: 'both', logo: { w: 600, h: 200 } });
    expect(headerBrand({ logo: L, headerShow: 'logo' })).toEqual({ mode: 'logo', logo: { w: 600, h: 200 } });
    expect(headerBrand({ logo: L, headerShow: 'name' }).mode).toBe('name');
    expect(headerBrand({ logo: L, headerShow: 'x' as never }).mode).toBe('both');
    expect(headerBrand({}).mode).toBe('name');
    expect(headerBrand({ headerShow: 'logo' }).mode).toBe('name');
  });
  it('cleanHeaderShow accepts only the two literals', () => {
    expect(cleanHeaderShow('logo')).toBe('logo');
    expect(cleanHeaderShow('name')).toBe('name');
    for (const v of ['both', 'x', '', 5, null, undefined, {}, [], 'LOGO']) expect(cleanHeaderShow(v)).toBeUndefined();
  });
  it('save/publish shape: valid values survive the pending round trip, anything else is dropped; the logo is kept for name-only', () => {
    const base = site('prime', true, { logo: L }) as WebsiteData & { headerShow?: unknown };
    const map = { logo: URL_ };
    for (const v of ['logo', 'name'] as const) {
      const p = toPendingSiteData({ ...base, headerShow: v } as WebsiteData, map);
      expect(p.headerShow).toBe(v);
      expect(p.logo).toEqual({ url: 'uploaded', w: 600, h: 200 });
      const back = restoreImageUrls(p, map);
      expect(back.headerShow).toBe(v);
      expect(back.logo).toEqual(L);
    }
    for (const v of ['x', 5, 'both', null, {}, 'LOGO']) {
      const p = toPendingSiteData({ ...base, headerShow: v } as unknown as WebsiteData, map);
      expect('headerShow' in p, String(v)).toBe(false);
      expect('headerShow' in restoreImageUrls({ ...base, headerShow: v } as unknown as WebsiteData, map)).toBe(false);
    }
    expect('headerShow' in toPendingSiteData(base, map)).toBe(false);
  });
  it('validationProblem has no complaint about headerShow (invalid values are dropped on save, not refused)', () => {
    for (const v of [undefined, 'logo', 'name', 'x', 5]) expect(validationProblem(site('prime', false, v === undefined ? {} : { headerShow: v }))).toBeNull();
  });
});
