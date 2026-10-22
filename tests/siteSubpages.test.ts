import { describe, expect, it, vi } from 'vitest';
import * as ptr from 'path-to-regexp-updated';
import {
  AIBARBER_ORIGIN, SITE_CONFIG_FILE, siteVercelConfig, subpageRewrites, siteConfigFile, withSubpageLinks, hasAiBarberSiteLinks,
  pickPublicBase, siteLookOf, refreshSiteBase, isShopSlug, SUBPAGE_ASSET_FILE,
} from '../lib/siteSubpages';

// Vercel's own matcher: path-to-regexp 6 (the "-updated" alias Vercel bundles) with the options of
// @vercel/routing-utils sourceToRegex: strict, case-sensitive, '/' delimiter.
const { pathToRegexp } = ptr as unknown as { pathToRegexp: (s: string, k?: any[], o?: any) => RegExp };
const VERCEL = { strict: true, sensitive: true, delimiter: '/' };
function matches(source: string, path: string): boolean {
  return pathToRegexp(source, [], VERCEL).test(path);
}
const keysOf = (source: string) => { const k: { name: string | number }[] = []; pathToRegexp(source, k, VERCEL); return k; };

const FULL = subpageRewrites({ mode: 'full', shopSlug: 'fresh-cuts' });
const MANAGE = subpageRewrites({ mode: 'manage-only' });
const TOKEN = '([A-Za-z0-9_-]+)';
const PAGE_APIS = ['/api/book/shop', '/api/book/days', '/api/book/slots', '/api/book/appointments', '/api/book/manage', '/api/book/sent',
  '/api/store/shop', '/api/store/orders', '/api/store/order', '/api/store/sent'];
const to = (p: string) => `${AIBARBER_ORIGIN}${p}`;

describe('subpage rewrites: the closed allow-list', () => {
  it('full mode is exactly the pages (with and without a trailing slash), hashed assets and the APIs the pages call', () => {
    expect(FULL).toEqual([
      { source: '/book', destination: to('/_ab/book.html') },
      { source: '/book/', destination: to('/_ab/book.html') },
      { source: `/book/manage/${TOKEN}`, destination: to('/_ab/book.html') },
      { source: `/book/manage/${TOKEN}/`, destination: to('/_ab/book.html') },
      { source: '/shop', destination: to('/_ab/shop.html') },
      { source: '/shop/', destination: to('/_ab/shop.html') },
      { source: `/shop/manage/${TOKEN}`, destination: to('/_ab/shop.html') },
      { source: `/shop/manage/${TOKEN}/`, destination: to('/_ab/shop.html') },
      { source: `/_ab/assets/:file(${SUBPAGE_ASSET_FILE})`, destination: to('/_ab/assets/:file') },
      ...PAGE_APIS.map((p) => ({ source: p, destination: to(p) })),
    ]);
  });

  it('manage-only mode (offline site) keeps only the manage/order pages, assets and their APIs', () => {
    expect(MANAGE.map((r) => r.source)).toEqual([
      `/book/manage/${TOKEN}`, `/book/manage/${TOKEN}/`, `/shop/manage/${TOKEN}`, `/shop/manage/${TOKEN}/`,
      `/_ab/assets/:file(${SUBPAGE_ASSET_FILE})`,
      '/api/book/manage', '/api/book/sent', '/api/store/order', '/api/store/sent',
    ]);
    for (const p of ['/book', '/book/', '/shop', '/api/book/appointments', '/api/store/orders', '/api/book/shop', '/api/store/shop']) {
      expect(MANAGE.some((r) => matches(r.source, p)), p).toBe(false);
    }
  });

  it('every source compiles with Vercel\'s matcher; no wildcards; no named param left out of its destination (query leakage)', () => {
    for (const r of [...FULL, ...MANAGE]) {
      expect(() => keysOf(r.source)).not.toThrow();
      expect(r.source).not.toMatch(/\*|\(\.\*\)|:path|\(\.\+\)|\[\^\/\]/);
      for (const k of keysOf(r.source)) {
        if (typeof k.name === 'string') expect(r.destination, `${r.source} :${k.name}`).toContain(`:${k.name}`);
      }
    }
  });

  it('only destinations on the aibarber.org origin from a fixed set', () => {
    const allowed = new Set(['/_ab/book.html', '/_ab/shop.html', '/_ab/assets/:file', ...PAGE_APIS]);
    for (const r of [...FULL, ...MANAGE]) {
      expect(r.destination.startsWith(`${AIBARBER_ORIGIN}/`)).toBe(true);
      expect(allowed.has(r.destination.slice(AIBARBER_ORIGIN.length))).toBe(true);
    }
  });

  it('never proxies admin, app, owner, deploy, cron or webhook routes, other shops\' pages, or odd paths', () => {
    const forbidden = [
      '/', '/index.html', '/admin', '/api/admin/sites', '/api/admin-overview', '/api/ios/publish', '/api/ios/site', '/api/ios/sweep',
      '/api/shop/setup', '/api/shop/plan', '/api/shop/appointments', '/api/shop/appointments/x/cancel', '/api/shop/orders/x/refund',
      '/api/shop/stripe/onboard', '/api/shop/push-token', '/api/shop/time-off', '/api/deploy-site', '/api/stripe-webhook',
      '/api/stripe/connect-webhook', '/api/book/ics', '/api/book/reminders', '/api/book/daily-summary', '/api/publish-sweeper',
      '/api/create-checkout-session', '/api/save-pending-site', '/api/upload-image', '/api/get-upload-urls', '/api/gemini',
      '/book/other-shop', '/shop/other-shop', '/book/manage', '/shop/manage', '/book/manage/a/b', '/book/manage/',
      '/stripe-return', '/privacy', '/assets/index.js', '/.well-known/x', '/api/book', '/api/store', '/_ab', '/_ab/', '/_ab/book.html',
      // assets: only hashed .js/.css build files, one segment
      '/_ab/assets/', '/_ab/assets/..', '/_ab/assets/.', '/_ab/assets/%2e%2e', '/_ab/assets/%2e%2e%2fapi%2fadmin%2fsites',
      '/_ab/assets/x.html', '/_ab/assets/index.html', '/_ab/assets/a/b.js', '/_ab/assets/a.js/', '/_ab/assets/..%2fbook.js',
      '/_ab/assets/a%2fb.js', '/_ab/assets/x.JS', '/_ab/assets/x.js.map', '/_ab/assets/.js',
      // manage tokens: the token alphabet only
      '/book/manage/a%2fb', '/book/manage/..', '/book/manage/%2e%2e', '/shop/manage/a.b',
      // double slashes and case
      '//book', '/book//', '//api/book/shop', '/api//book/shop', '/BOOK', '/Shop', '/API/book/shop', '/api/Book/shop', '/_AB/assets/x.js',
      // encoded and dot segments
      '/book/%2e%2e/api/admin/sites', '/api/book/shop/..', '/api/book/%2e%2e/admin', '/%2fapi/admin/sites', '/book/..',
    ];
    for (const p of forbidden) {
      for (const r of FULL) expect(matches(r.source, p), `${r.source} must not match ${p}`).toBe(false);
    }
  });

  it('serves the pages it is meant to, with and without a trailing slash', () => {
    for (const p of ['/book', '/book/', '/book/manage/tok_123-AB', '/book/manage/tok/', '/shop', '/shop/', '/shop/manage/tok', '/shop/manage/tok/',
      '/_ab/assets/book-DE8U-nPI.js', '/_ab/assets/vendor-react-CVzL7Oab.js', '/_ab/assets/shop-77-XaOFA.css', '/api/store/orders']) {
      expect(FULL.some((r) => matches(r.source, p)), p).toBe(true);
    }
  });

  it('refuses a slug the ab_shops check would refuse', () => {
    for (const bad of ['', 'Fresh', '-x', 'x-', 'a/b', 'manage', 'api', 'book', 'shop', 'stripe-return', 'x'.repeat(64), '../x']) {
      expect(isShopSlug(bad)).toBe(false);
      expect(() => subpageRewrites({ mode: 'full', shopSlug: bad })).toThrow();
    }
    expect(isShopSlug('fresh-cuts-2')).toBe(true);
  });
});

describe('siteVercelConfig', () => {
  const base = siteVercelConfig(null);

  it('without a shop is exactly today\'s config (headers only)', () => {
    expect(base).toEqual({
      headers: [
        { source: '/index.html', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
        { source: '/', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
      ],
    });
  });

  it('with a shop adds the rewrites and turns rewrite caching off for the proxied pages and APIs (not the hashed assets)', () => {
    const cfg = siteVercelConfig({ mode: 'full', shopSlug: 'fresh-cuts' });
    expect(cfg.rewrites).toEqual(FULL);
    expect(cfg.headers.slice(0, 2)).toEqual(base.headers);
    const noCache = (path: string) => cfg.headers.some((h: any) => matches(h.source, path)
      && h.headers.some((x: any) => x.key === 'x-vercel-enable-rewrite-caching' && x.value === '0'));
    for (const p of ['/book', '/book/', '/shop', '/shop/', '/book/manage/t', '/shop/manage/t/', '/api/book/slots', '/api/store/shop']) expect(noCache(p), p).toBe(true);
    expect(noCache('/_ab/assets/x.js')).toBe(false);
    expect(cfg.headers.some((h: any) => h.source === SITE_CONFIG_FILE && h.headers[0].value.includes('max-age=0'))).toBe(true);
    for (const h of cfg.headers) expect(() => keysOf(h.source)).not.toThrow();
  });

  it('the site config file carries only the shop slug', () => {
    expect(SITE_CONFIG_FILE).toBe('/ab-site.json');
    expect(JSON.parse(siteConfigFile('fresh-cuts'))).toEqual({ slug: 'fresh-cuts' });
    expect(() => siteConfigFile('Bad Slug')).toThrow();
  });

  it('survives a JSON round trip unchanged (the regex escapes are what Vercel reads)', () => {
    const cfg = siteVercelConfig({ mode: 'full', shopSlug: 'fresh-cuts' });
    const back = JSON.parse(JSON.stringify(cfg));
    expect(back).toEqual(cfg);
    expect(matches(back.rewrites[8].source, '/_ab/assets/a-b.js')).toBe(true);
    expect(matches(back.rewrites[8].source, '/_ab/assets/aXjs')).toBe(false);
  });
});

describe('withSubpageLinks', () => {
  const sd = (o: Record<string, unknown>) => ({ shopName: 'X', ...o }) as any;

  it('with the pages: any AI Barber booking link becomes /book and the shop link /shop', () => {
    for (const bookingUrl of ['https://www.aibarber.org/book/fresh', 'aibarber.org/book/fresh', '/book']) {
      expect(withSubpageLinks(sd({ bookingUrl, shopUrl: 'https://www.aibarber.org/shop/fresh' }), true))
        .toMatchObject({ bookingUrl: '/book', shopUrl: '/shop' });
    }
  });

  it('never touches another booking site, and does not mutate the input', () => {
    const input = sd({ bookingUrl: 'https://booksy.com/x' });
    expect(withSubpageLinks(input, true).bookingUrl).toBe('https://booksy.com/x');
    expect(withSubpageLinks(input, false).bookingUrl).toBe('https://booksy.com/x');
    const abs = sd({ bookingUrl: 'https://www.aibarber.org/book/x' });
    withSubpageLinks(abs, true);
    expect(abs.bookingUrl).toBe('https://www.aibarber.org/book/x');
  });

  it('without the pages: drops relative /book and /shop (no dead buttons), keeps old absolute links', () => {
    const out = withSubpageLinks(sd({ bookingUrl: '/book', shopUrl: '/shop' }), false);
    expect('bookingUrl' in out).toBe(false);
    expect('shopUrl' in out).toBe(false);
    expect(withSubpageLinks(sd({ bookingUrl: 'https://www.aibarber.org/book/x', shopUrl: 'https://www.aibarber.org/shop/x' }), false))
      .toMatchObject({ bookingUrl: 'https://www.aibarber.org/book/x', shopUrl: 'https://www.aibarber.org/shop/x' });
  });

  it('hasAiBarberSiteLinks spots both forms', () => {
    expect(hasAiBarberSiteLinks(sd({ bookingUrl: '/book' }))).toBe(true);
    expect(hasAiBarberSiteLinks(sd({ shopUrl: '/shop' }))).toBe(true);
    expect(hasAiBarberSiteLinks(sd({ bookingUrl: 'https://www.aibarber.org/book/x' }))).toBe(true);
    expect(hasAiBarberSiteLinks(sd({ bookingUrl: 'https://booksy.com/x' }))).toBe(false);
    expect(hasAiBarberSiteLinks(sd({}))).toBe(false);
  });
});

describe('pickPublicBase', () => {
  it('prefers a verified custom domain that does not redirect', () => {
    expect(pickPublicBase([
      { name: 'fresh-cuts.vercel.app', verified: true },
      { name: 'www.freshcuts.com', verified: true, redirect: 'freshcuts.com' },
      { name: 'freshcuts.com', verified: true },
    ], 'https://fresh-cuts.vercel.app')).toBe('https://freshcuts.com');
  });

  it('falls back to the deployed URL (origin only) when no custom domain is usable', () => {
    expect(pickPublicBase([{ name: 'freshcuts.com', verified: false }, { name: 'x.vercel.app', verified: true }], 'https://fresh-cuts.vercel.app/'))
      .toBe('https://fresh-cuts.vercel.app');
    expect(pickPublicBase(null, 'https://fresh-cuts-abc.vercel.app')).toBe('https://fresh-cuts-abc.vercel.app');
  });

  it('never returns a non-https or malformed origin', () => {
    expect(pickPublicBase([{ name: 'bad host/x', verified: true }], 'http://x.vercel.app')).toBeNull();
    expect(pickPublicBase([], 'javascript:alert(1)')).toBeNull();
    expect(pickPublicBase([], '')).toBeNull();
  });
});

describe('siteLookOf', () => {
  const sd = (o: Record<string, unknown>) => ({ shopName: 'X', hero: { imageUrl: 'uploaded' }, ...o }) as any;
  it('takes the template, its theme colours and the hero photo', () => {
    expect(siteLookOf(sd({ template: 'luxe', colorTheme: 'redBlack' }), { hero: 'https://img.test/h.jpg' }))
      .toEqual({ template: 'luxe', accent: '#dc2626', bg: '#0d0d0d', text: '#ffffff', heroUrl: 'https://img.test/h.jpg' });
    expect(siteLookOf(sd({ template: 'prime' }), {})).toEqual({ template: 'prime', accent: '#d4a64a', bg: '#0a0a0a', text: '#f0ece4', heroUrl: null });
    expect(siteLookOf(sd({ template: 'euphoria', colorTheme: 'purpleGreen' }), { hero: 'http://insecure.test/h.jpg' }))
      .toEqual({ template: 'euphoria', accent: '#22c55e', bg: '#160328', text: '#f0ece4', heroUrl: null });
    expect(siteLookOf(sd({}), {}).template).toBe('luxe');
  });
  it('drops a non-hex custom colour', () => {
    expect(siteLookOf(sd({ template: 'prime', colorTheme: '#12345g' }), {}).accent).toBe('#d4a64a');
  });
});

describe('refreshSiteBase', () => {
  it('stores the picked base and the look on the shop', async () => {
    const update = vi.fn(async () => {});
    const domains = vi.fn(async () => [{ name: 'freshcuts.com', verified: true }]);
    const out = await refreshSiteBase(
      { shopId: 's1', projectName: 'fresh-cuts', deployedUrl: 'https://fresh-cuts.vercel.app', siteData: { template: 'prime' } as any, imageUrlMap: {} },
      { projectDomains: domains, updateShop: update },
    );
    expect(domains).toHaveBeenCalledWith('fresh-cuts');
    expect(out).toBe('https://freshcuts.com');
    expect(update).toHaveBeenCalledWith('s1', { site_base_url: 'https://freshcuts.com', site_look: expect.objectContaining({ template: 'prime' }) });
  });

  it('a failed domain lookup falls back to the deployed URL; no usable base leaves the shop untouched', async () => {
    const update = vi.fn(async () => {});
    await refreshSiteBase(
      { shopId: 's1', projectName: 'p', deployedUrl: 'https://p.vercel.app', siteData: {} as any, imageUrlMap: {} },
      { projectDomains: async () => { throw new Error('vercel down'); }, updateShop: update },
    );
    expect(update).toHaveBeenCalledWith('s1', expect.objectContaining({ site_base_url: 'https://p.vercel.app' }));
    update.mockClear();
    expect(await refreshSiteBase(
      { shopId: 's1', projectName: 'p', deployedUrl: 'nope', siteData: {} as any, imageUrlMap: {} },
      { projectDomains: async () => [], updateShop: update },
    )).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});
