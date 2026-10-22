import { describe, expect, it, vi } from 'vitest';
import { loadSiteSlug, siteTheme, canonicalHref, homeHref, shopBackHref, SITE_FONTS } from '../../src/site/site';
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
  it('Back to shop: /shop on the site, the site\'s /shop from aibarber.org, else the old path', () => {
    expect(shopBackHref('fresh', site, true)).toBe('/shop');
    expect(shopBackHref('fresh', undefined, true)).toBe('/shop');
    expect(shopBackHref('fresh', site, false)).toBe('https://freshcuts.com/shop');
    expect(shopBackHref('fresh cuts', undefined, false)).toBe('/shop/fresh%20cuts');
  });
});
