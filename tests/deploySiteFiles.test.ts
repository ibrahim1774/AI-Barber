import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { buildSiteFiles, deployRenderedSite, finalizePages, swapImagePlaceholders } from '../lib/deploySite';
import { siteVercelConfig, subpageRewrites } from '../lib/siteSubpages';

vi.mock('axios', () => ({ default: { post: vi.fn(), patch: vi.fn() } }));

const decode = (f: { data: string }) => Buffer.from(f.data, 'base64').toString('utf-8');
const page = (path: string, html = `<p>${path}</p>`) => ({ path, html });
const FULL = { mode: 'full', shopSlug: 'fresh-cuts' } as const;

describe('buildSiteFiles', () => {
  it('without subpages ships exactly index.html, styles.css and today\'s vercel.json', () => {
    const files = buildSiteFiles([page('index.html', '<p>hi</p>')], 'a{}', null);
    expect(files.map((f) => f.file)).toEqual(['index.html', 'styles.css', 'vercel.json']);
    expect(decode(files[0])).toBe('<p>hi</p>');
    expect(JSON.parse(decode(files[2]))).toEqual(siteVercelConfig(null));
    expect(JSON.parse(decode(files[2])).rewrites).toBeUndefined();
  });

  it('with a shop adds the rewrites and the site config file', () => {
    const files = buildSiteFiles([page('index.html', '<p>hi</p>')], undefined, FULL);
    expect(files.map((f) => f.file)).toEqual(['index.html', 'styles.css', 'vercel.json', 'ab-site.json']);
    expect(JSON.parse(decode(files[2]))).toEqual(siteVercelConfig(FULL));
    expect(JSON.parse(decode(files[3]))).toEqual({ slug: 'fresh-cuts' });
  });

  it('the offline page keeps only the manage rewrites and ships no site config', () => {
    const files = buildSiteFiles([page('index.html', '<p>offline</p>')], undefined, { mode: 'manage-only' });
    expect(files.map((f) => f.file)).toEqual(['index.html', 'styles.css', 'vercel.json']);
    expect(JSON.parse(decode(files[2])).rewrites.map((r: any) => r.source)).not.toContain('/book');
  });

  it('writes every page, base64, at its own path (home first, the rest in order)', () => {
    const files = buildSiteFiles(
      [page('index.html'), page('about/index.html'), page('services/index.html'), page('services/fade/index.html')],
      'a{}', FULL, { sitemap: '<urlset/>' },
    );
    expect(files.map((f) => f.file)).toEqual([
      'index.html', 'about/index.html', 'services/index.html', 'services/fade/index.html', 'styles.css', 'vercel.json', 'ab-site.json', 'sitemap.xml',
    ]);
    expect(files.every((f) => f.encoding === 'base64')).toBe(true);
    expect(decode(files[3])).toBe('<p>services/fade/index.html</p>');
    expect(decode(files[7])).toBe('<urlset/>');
  });

  it('a home page listed after the others is still written as index.html first', () => {
    const files = buildSiteFiles([page('about/index.html'), page('index.html')], undefined, null);
    expect(files.map((f) => f.file).slice(0, 2)).toEqual(['index.html', 'about/index.html']);
  });

  it('no sitemap file when none is given (no known base on this publish)', () => {
    for (const sitemap of [undefined, null, '']) {
      expect(buildSiteFiles([page('index.html'), page('about/index.html')], undefined, null, { sitemap }).map((f) => f.file)).not.toContain('sitemap.xml');
    }
  });

  it('refuses a path that could escape, collide with the proxy, or overwrite a site file', () => {
    for (const bad of ['book/index.html', 'shop/index.html', '_ab/index.html', 'api/index.html', '../x/index.html', 'styles.css', 'vercel.json', 'sitemap.xml', 'about/page.html', 'a/b/c/index.html']) {
      expect(() => buildSiteFiles([page('index.html'), page(bad)], undefined, null), bad).toThrow();
    }
  });
  it('refuses duplicates, a missing home page and an empty deploy', () => {
    expect(() => buildSiteFiles([page('index.html'), page('about/index.html'), page('about/index.html')], undefined, null)).toThrow(/duplicate/);
    expect(() => buildSiteFiles([page('about/index.html')], undefined, null)).toThrow(/index\.html/);
    expect(() => buildSiteFiles([], undefined, null)).toThrow();
  });
});

describe('vercel.json', () => {
  it('a single page deploy is byte-for-byte what sites always had', () => {
    const files = buildSiteFiles([page('index.html')], undefined, null);
    expect(decode(files[2])).toBe(JSON.stringify({ headers: [
      { source: '/index.html', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
      { source: '/', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
    ] }));
  });
  it('a multi-page deploy adds the revalidate rule for nested pages and nothing else (exact JSON, full shop)', () => {
    const files = buildSiteFiles([page('index.html'), page('about/index.html')], undefined, FULL);
    expect(JSON.stringify(JSON.parse(decode(files[files.findIndex((f) => f.file === 'vercel.json')])), null, 2)).toMatchSnapshot();
  });
  it('multi-page, no shop and offline page', () => {
    const noShop = buildSiteFiles([page('index.html'), page('about/index.html')], undefined, null);
    expect(JSON.parse(decode(noShop[3]))).toEqual({ headers: [
      { source: '/index.html', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
      { source: '/', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
      { source: '/(.*)/', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
      { source: '/(.*)/index.html', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
    ] });
    const offline = siteVercelConfig({ mode: 'manage-only' }, { nestedPages: true });
    expect(offline.headers.slice(0, 4).map((h) => h.source)).toEqual(['/index.html', '/', '/(.*)/', '/(.*)/index.html']);
    expect(JSON.stringify(offline, null, 2)).toMatchSnapshot();
  });
  it('the proxy allow-list is untouched: no rewrite for /about, /services/* or /team/*, and the list equals the frozen one', () => {
    const sources = subpageRewrites(FULL).map((r) => r.source);
    expect(sources.some((s) => /about|services|team|gallery|reviews|hours|contact/.test(s))).toBe(false);
    expect(sources).toEqual([
      '/book', '/book/', '/book/manage/([A-Za-z0-9_-]+)', '/book/manage/([A-Za-z0-9_-]+)/',
      '/shop', '/shop/', '/shop/manage/([A-Za-z0-9_-]+)', '/shop/manage/([A-Za-z0-9_-]+)/',
      '/_ab/assets/:file([A-Za-z0-9_-]+\\.(?:js|css))',
      '/api/book/shop', '/api/book/days', '/api/book/slots', '/api/book/appointments', '/api/book/manage', '/api/book/sent',
      '/api/store/shop', '/api/store/orders', '/api/store/order', '/api/store/sent',
    ]);
    // a multi-page deploy ships the same rewrites
    const files = buildSiteFiles([page('index.html'), page('about/index.html')], undefined, FULL);
    expect(JSON.parse(decode(files[3])).rewrites).toEqual(subpageRewrites(FULL));
  });
});

describe('placeholders on every page', () => {
  it('finalizePages swaps {{key}} on every page and strips inline base64 images', () => {
    const big = `data:image/png;base64,${'A'.repeat(200)}`;
    const out = finalizePages([
      page('index.html', '<img src="{{hero}}"><img src="{{gallery0}}">'),
      page('team/sam/index.html', '<img src="{{staff0}}"><img src="{{gallery0}}">'),
      page('about/index.html', `<img src="${big}"><img src="{{about}}">`),
    ], { hero: 'https://x/h.jpg', gallery0: 'https://x/g.jpg?a=1&b=2', staff0: 'https://x/s.jpg', about: 'https://x/a.jpg' });
    expect(out.map((p) => p.html)).toEqual([
      '<img src="https://x/h.jpg"><img src="https://x/g.jpg?a=1&amp;b=2">',
      '<img src="https://x/s.jpg"><img src="https://x/g.jpg?a=1&amp;b=2">',
      '<img src=""><img src="https://x/a.jpg">',
    ]);
    expect(out.map((p) => p.path)).toEqual(['index.html', 'team/sam/index.html', 'about/index.html']);
  });
  it('swapImagePlaceholders is the same function the single page used', () => {
    expect(swapImagePlaceholders('{{a}}{{a}}', { a: '"x"' })).toBe('&quot;x&quot;&quot;x&quot;');
  });
});

describe('deployRenderedSite', () => {
  const post = axios.post as unknown as ReturnType<typeof vi.fn>;
  const OLD = process.env.VERCEL_TOKEN;
  beforeEach(() => {
    process.env.VERCEL_TOKEN = 'tok';
    post.mockReset();
    post.mockResolvedValue({ data: { name: 'fresh-cuts', alias: ['fresh-cuts.vercel.app'], id: 'dpl_1' } });
    (axios.patch as any).mockResolvedValue({});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ readyState: 'READY', alias: ['fresh-cuts.vercel.app'] }) })));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); if (OLD === undefined) delete process.env.VERCEL_TOKEN; else process.env.VERCEL_TOKEN = OLD; });

  it('pages: every page goes to Vercel with its placeholders swapped, plus the sitemap', async () => {
    await deployRenderedSite({
      siteId: 'fresh-cuts', html: '<img src="{{hero}}">',
      pages: [page('index.html', '<img src="{{hero}}">'), page('team/index.html', '<img src="{{staff0}}">')],
      sitemap: '<urlset/>', imageUrls: { hero: 'https://x/h.jpg', staff0: 'https://x/s.jpg' }, subpages: FULL,
    });
    const files = post.mock.calls[0][1].files as { file: string; data: string }[];
    expect(files.map((f) => f.file)).toEqual(['index.html', 'team/index.html', 'styles.css', 'vercel.json', 'ab-site.json', 'sitemap.xml']);
    expect(decode(files[0])).toBe('<img src="https://x/h.jpg">');
    expect(decode(files[1])).toBe('<img src="https://x/s.jpg">');
  });
  it('no pages: the single-page path is unchanged', async () => {
    await deployRenderedSite({ siteId: 'fresh-cuts', html: '<img src="{{hero}}">', imageUrls: { hero: 'https://x/h.jpg' } });
    const files = post.mock.calls[0][1].files as { file: string; data: string }[];
    expect(files.map((f) => f.file)).toEqual(['index.html', 'styles.css', 'vercel.json']);
    expect(decode(files[0])).toBe('<img src="https://x/h.jpg">');
    expect(JSON.parse(decode(files[2]))).toEqual(siteVercelConfig(null));
  });
  it('still requires html when there are no pages', async () => {
    await expect(deployRenderedSite({ siteId: 'x', html: '' })).rejects.toThrow(/html/);
  });
});

describe('finalizePages: the report-link slug placeholder is reserved (review L4)', () => {
  it('a client-supplied imageUrls.siteSlug cannot replace {{siteSlug}}', () => {
    const out = finalizePages([{ path: 'index.html', html: '<a href="mailto:x?subject={{siteSlug}}">r</a>' }], { siteSlug: 'EVIL' }, 'real-slug');
    expect(out[0].html).toContain('subject=real-slug');
    expect(out[0].html).not.toContain('EVIL');
  });
});
