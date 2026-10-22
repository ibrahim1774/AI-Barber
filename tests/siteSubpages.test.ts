import { describe, expect, it, vi } from 'vitest';
import {
  AIBARBER_ORIGIN, SITE_CONFIG_FILE, siteVercelConfig, subpageRewrites, siteConfigFile, withSubpageLinks, hasAiBarberSiteLinks,
  pickPublicBase, siteLookOf, refreshSiteBase, isShopSlug,
} from '../lib/siteSubpages';

/** Vercel's path matching for the source forms the generator uses (literal, :param, unnamed regex group). */
function matches(source: string, path: string): boolean {
  const re = '^' + source.replace(/\./g, '\\.').replace(/:[a-zA-Z]+/g, '([^/]+)') + '/?$';
  return new RegExp(re).test(path);
}

const FULL = subpageRewrites({ mode: 'full', shopSlug: 'fresh-cuts' });
const MANAGE = subpageRewrites({ mode: 'manage-only' });

describe('subpage rewrites: the closed allow-list', () => {
  it('full mode is exactly the pages, their assets and the APIs the pages call', () => {
    expect(FULL).toEqual([
      { source: '/book', destination: `${AIBARBER_ORIGIN}/_ab/book.html` },
      { source: '/book/manage/([^/]+)', destination: `${AIBARBER_ORIGIN}/_ab/book.html` },
      { source: '/shop', destination: `${AIBARBER_ORIGIN}/_ab/shop.html` },
      { source: '/shop/manage/([^/]+)', destination: `${AIBARBER_ORIGIN}/_ab/shop.html` },
      { source: '/_ab/assets/:file', destination: `${AIBARBER_ORIGIN}/_ab/assets/:file` },
      ...['/api/book/shop', '/api/book/days', '/api/book/slots', '/api/book/appointments', '/api/book/manage', '/api/book/sent',
        '/api/store/shop', '/api/store/orders', '/api/store/order', '/api/store/sent']
        .map((p) => ({ source: p, destination: `${AIBARBER_ORIGIN}${p}` })),
    ]);
  });

  it('manage-only mode (offline site) keeps only the manage/order pages, assets and their APIs', () => {
    expect(MANAGE.map((r) => r.source)).toEqual([
      '/book/manage/([^/]+)', '/shop/manage/([^/]+)', '/_ab/assets/:file',
      '/api/book/manage', '/api/book/sent', '/api/store/order', '/api/store/sent',
    ]);
    for (const p of ['/book', '/shop', '/api/book/appointments', '/api/store/orders', '/api/book/shop', '/api/store/shop']) {
      expect(MANAGE.some((r) => matches(r.source, p)), p).toBe(false);
    }
  });

  it('has no wildcard sources and only destinations on the aibarber.org origin from a fixed set', () => {
    const allowed = new Set([
      '/_ab/book.html', '/_ab/shop.html', '/_ab/assets/:file',
      '/api/book/shop', '/api/book/days', '/api/book/slots', '/api/book/appointments', '/api/book/manage', '/api/book/sent',
      '/api/store/shop', '/api/store/orders', '/api/store/order', '/api/store/sent',
    ]);
    for (const r of [...FULL, ...MANAGE]) {
      expect(r.source).not.toMatch(/\*|\(\.\*\)|:path|\(\.\+\)/);
      expect(r.destination.startsWith(`${AIBARBER_ORIGIN}/`)).toBe(true);
      expect(allowed.has(r.destination.slice(AIBARBER_ORIGIN.length))).toBe(true);
    }
  });

  it('never proxies admin, app, owner, deploy, cron or webhook routes, nor other shops\' pages', () => {
    const forbidden = [
      '/', '/index.html', '/admin', '/api/admin/sites', '/api/admin-overview', '/api/ios/publish', '/api/ios/site', '/api/ios/sweep',
      '/api/shop/setup', '/api/shop/plan', '/api/shop/appointments', '/api/shop/appointments/x/cancel', '/api/shop/orders/x/refund',
      '/api/shop/stripe/onboard', '/api/shop/push-token', '/api/shop/time-off', '/api/deploy-site', '/api/stripe-webhook',
      '/api/stripe/connect-webhook', '/api/book/ics', '/api/book/reminders', '/api/book/daily-summary', '/api/publish-sweeper',
      '/api/create-checkout-session', '/api/save-pending-site', '/api/upload-image', '/api/get-upload-urls', '/api/gemini',
      '/book/other-shop', '/shop/other-shop', '/book/manage', '/shop/manage', '/book/manage/a/b', '/_ab/assets/a/b.js',
      '/_ab/book.html', '/_ab', '/stripe-return', '/privacy', '/assets/index.js', '/.well-known/x', '/api/book', '/api/store',
    ];
    for (const p of forbidden) {
      for (const r of FULL) expect(matches(r.source, p), `${r.source} must not match ${p}`).toBe(false);
    }
  });

  it('serves the pages it is meant to', () => {
    for (const p of ['/book', '/book/manage/tok123', '/shop', '/shop/manage/tok', '/_ab/assets/book-abc.js', '/api/store/orders']) {
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

  it('with a shop adds the rewrites and turns rewrite caching off for the proxied pages and APIs', () => {
    const cfg = siteVercelConfig({ mode: 'full', shopSlug: 'fresh-cuts' });
    expect(cfg.rewrites).toEqual(FULL);
    expect(cfg.headers.slice(0, 2)).toEqual(base.headers);
    const noCache = (path: string) => cfg.headers.some((h: any) => matches(h.source, path)
      && h.headers.some((x: any) => x.key === 'x-vercel-enable-rewrite-caching' && x.value === '0'));
    for (const p of ['/book', '/shop', '/book/manage/t', '/shop/manage/t', '/api/book/slots', '/api/store/shop']) expect(noCache(p), p).toBe(true);
    // Hashed assets may be cached.
    expect(noCache('/_ab/assets/x.js')).toBe(false);
    // The site config is revalidated.
    expect(cfg.headers.some((h: any) => h.source === SITE_CONFIG_FILE && h.headers[0].value.includes('max-age=0'))).toBe(true);
  });

  it('the site config file carries only the shop slug', () => {
    expect(SITE_CONFIG_FILE).toBe('/ab-site.json');
    expect(JSON.parse(siteConfigFile('fresh-cuts'))).toEqual({ slug: 'fresh-cuts' });
    expect(() => siteConfigFile('Bad Slug')).toThrow();
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
