import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadSiteSlug, siteTheme, canonicalHref, homeHref, shopBackHref, onSiteNow, SITE_FONTS, fontsFor } from '../../src/site/site';
import { parseRoute } from '../../src/book/logic';
import { parseShopRoute } from '../../src/shop/logic';

const res = (body: unknown, ok = true) => ({ ok, json: async () => body }) as unknown as Response;

describe('routes on the barber\'s own domain', () => {
  it('/book and /shop are the site\'s pages (slug from the site config)', () => {
    expect(parseRoute('/book')).toEqual({ kind: 'book', slug: null });
    expect(parseRoute('/book/')).toEqual({ kind: 'book', slug: null });
    expect(parseShopRoute('/shop')).toEqual({ kind: 'shop', slug: null });
    expect(parseShopRoute('/shop/')).toEqual({ kind: 'shop', slug: null });
    // aibarber.org paths still carry the slug.
    expect(parseRoute('/book/fresh')).toEqual({ kind: 'book', slug: 'fresh' });
    expect(parseShopRoute('/shop/fresh')).toEqual({ kind: 'shop', slug: 'fresh' });
  });
});

describe('loadSiteSlug', () => {
  it('reads the slug from /ab-site.json', async () => {
    const f = vi.fn(async () => res({ slug: 'fresh-cuts' }));
    expect(await loadSiteSlug(f)).toBe('fresh-cuts');
    expect(f).toHaveBeenCalledWith('/ab-site.json');
  });
  it('null when missing, malformed or the fetch fails', async () => {
    expect(await loadSiteSlug(async () => res({}, false))).toBeNull();
    expect(await loadSiteSlug(async () => res({ slug: '../x' }))).toBeNull();
    expect(await loadSiteSlug(async () => res({ slug: 5 }))).toBeNull();
    expect(await loadSiteSlug(async () => { throw new Error('offline'); })).toBeNull();
  });
});

describe('siteTheme', () => {
  const look = { template: 'prime' as const, accent: '#22c55e', bg: '#160328', text: '#f0ece4', heroUrl: null };
  it('uses the site\'s colours and fonts', () => {
    const t = siteTheme({ baseUrl: 'https://freshcuts.com', look }, '#112233');
    expect(t.vars['--accent']).toBe('#22c55e');
    expect(t.vars['--on-accent']).toBe('#111111');
    expect(t.vars['--bg']).toBe('#160328');
    expect(t.vars['--text']).toBe('#f0ece4');
    expect(t.vars['--font-head']).toContain('Newsreader');
    expect(t.vars['--font-body']).toContain('Inter');
    expect(t.fontHref).toBe(SITE_FONTS.prime.href);
  });
  it('without a look keeps the page defaults and the shop accent', () => {
    const t = siteTheme(undefined, '#112233');
    expect(t.vars).toEqual({ '--accent': '#112233', '--on-accent': '#ffffff' });
    expect(t.fontHref).toBeNull();
  });
  it('never lets a bad colour through', () => {
    const t = siteTheme({ baseUrl: null, look: { ...look, accent: 'red;}', bg: 'x' as any } }, null);
    expect(t.vars['--accent']).toMatch(/^#[0-9a-f]{6}$/);
    expect(t.vars['--bg']).toBeUndefined();
  });
});

describe('links', () => {
  const site = { baseUrl: 'https://freshcuts.com', look: null };
  it('home and canonical follow the site', () => {
    expect(homeHref(site)).toBe('https://freshcuts.com');
    expect(homeHref(undefined)).toBeNull();
    expect(homeHref({ baseUrl: 'javascript:alert(1)', look: null })).toBeNull();
    expect(canonicalHref(site, 'book')).toBe('https://freshcuts.com/book');
    expect(canonicalHref(site, 'shop')).toBe('https://freshcuts.com/shop');
    expect(canonicalHref(undefined, 'book')).toBeNull();
  });
  it('Back to shop: /shop on the site (null base too), the site\'s /shop from aibarber.org, else the old path; none when closed', () => {
    expect(shopBackHref('fresh', site, true)).toBe('/shop');
    expect(shopBackHref('fresh', undefined, true)).toBe('/shop');
    expect(shopBackHref('fresh', { baseUrl: null, look: null }, true)).toBe('/shop');
    expect(shopBackHref('fresh', site, false)).toBe('https://freshcuts.com/shop');
    expect(shopBackHref('fresh cuts', undefined, false)).toBe('/shop/fresh%20cuts');
    // Lapsed (manage-only site) or closed store: no link.
    expect(shopBackHref('fresh', site, true, false)).toBeNull();
    expect(shopBackHref('fresh', site, false, false)).toBeNull();
  });

  it('onSiteNow: the page is on a barber site when its /ab-site.json names a shop (aibarber.org answers with HTML)', async () => {
    expect(await onSiteNow(async () => ({ ok: true, json: async () => ({ slug: 'fresh' }) }) as any)).toBe(true);
    expect(await onSiteNow(async () => ({ ok: true, json: async () => { throw new SyntaxError('html'); } }) as any)).toBe(false);
    expect(await onSiteNow(async () => ({ ok: false, json: async () => ({}) }) as any)).toBe(false);
  });
});

describe('template fonts match the site (lib/render)', () => {
  const shell = readFileSync('lib/render/shell.ts', 'utf8');
  const themeBlock = shell.slice(shell.indexOf('const THEME_CSS'));
  const themeCss = (t: string) => themeBlock.match(new RegExp('^  ' + t + ': `([^`]*)`', 'm'))![1];
  const families = (href: string) => [...href.matchAll(/family=([A-Za-z+]+)/g)].map((m) => m[1].replace(/\+/g, ' '));
  for (const t of ['luxe', 'prime', 'euphoria'] as const) {
    it(`${t}: same families, heading weight, case and tracking as the site`, () => {
      const css = themeCss(t);
      const f = SITE_FONTS[t];
      expect(css).toContain(`--ab-head-font:${f.head.replace(/, /g, ',')}`);
      expect(css).toContain(`--ab-body-font:${f.body.replace(/, /g, ',')}`);
      expect(css).toContain(`--ab-head-weight:${f.headWeight}`);
      expect(css).toContain(`--ab-head-transform:${f.headTransform}`);
      expect(css).toContain(`--ab-head-track:${f.headTrack}`);
      for (const fam of families(f.href)) expect(`${f.head} ${f.body}`).toContain(fam);
      // the head weight is among the loaded weights, and font-display is swap
      expect(f.href).toContain(f.headWeight);
      expect(f.href).toContain('display=swap');
    });
    it(`${t}: siteTheme applies them`, () => {
      const th = siteTheme({ baseUrl: null, look: { template: t, accent: null, bg: null, text: null, heroUrl: null } }, null);
      expect(th.vars['--font-head']).toBe(SITE_FONTS[t].head);
      expect(th.vars['--head-weight']).toBe(SITE_FONTS[t].headWeight);
      expect(th.fontHref).toBe(SITE_FONTS[t].href);
    });
  }
  it('an unknown template keeps the page\'s own fonts', () => {
    expect(fontsFor('retro')).toBeNull();
    expect(fontsFor('__proto__')).toBeNull();
    const th = siteTheme({ baseUrl: null, look: { template: 'retro' as any, accent: '#112233', bg: null, text: null, heroUrl: null } }, null);
    expect(th.vars['--font-head']).toBeUndefined();
    expect(th.fontHref).toBeNull();
  });
  it('book and shop stylesheets read the font variables', () => {
    for (const css of ['src/book/book.css', 'src/shop/shop.css']) {
      const c = readFileSync(css, 'utf8');
      for (const v of ['--font-head', '--font-body', '--head-weight', '--head-transform', '--head-track']) expect(c).toContain(v);
    }
  });
});
