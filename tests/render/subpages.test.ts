import { describe, expect, it } from 'vitest';
import {
  SITE_BOOK_PATH, SITE_SHOP_PATH, SITE_CONFIG_PATH, isSiteBookLink, isSiteShopLink, isSiteSubpageLink,
  bookStripServices, bookStripHtml, shopPreviewHtml, SHOP_PREVIEW_SCRIPT, type SectionSkin,
} from '../../lib/render/subpages';
import { safeHref } from '../../lib/render/safeHref';

describe('site subpage links', () => {
  it('are the relative /book and /shop paths', () => {
    expect(SITE_BOOK_PATH).toBe('/book');
    expect(SITE_SHOP_PATH).toBe('/shop');
    expect(SITE_CONFIG_PATH).toBe('/ab-site.json');
  });

  it('recognise exactly /book and /shop, optionally with a query or fragment', () => {
    for (const ok of ['/book', '/book?x=1', '/book#top', ' /book ']) expect(isSiteBookLink(ok)).toBe(true);
    for (const ok of ['/shop', '/shop?x=1', '/shop#a']) expect(isSiteShopLink(ok)).toBe(true);
    for (const bad of ['/books', '/book/other-shop', '//book', '/\\book', 'book', 'https://x.test/book', '', null, undefined, 5]) {
      expect(isSiteBookLink(bad as any)).toBe(false);
    }
    for (const bad of ['/shopping', '/shop/x', '//shop', 'https://www.aibarber.org/shop/x']) expect(isSiteShopLink(bad)).toBe(false);
    expect(isSiteSubpageLink('/book')).toBe(true);
    expect(isSiteSubpageLink('/shop')).toBe(true);
    expect(isSiteSubpageLink('/about')).toBe(false);
  });

  it('safeHref keeps /book and /shop but still rejects other relative and protocol-relative links', () => {
    expect(safeHref('/book')).toBe('/book');
    expect(safeHref(' /shop ')).toBe('/shop');
    expect(safeHref('https://booksy.com/x')).toBe('https://booksy.com/x');
    for (const bad of ['//evil.test/book', '/\\evil.test', '/admin', 'javascript:alert(1)', '/book/x']) expect(safeHref(bad)).toBeNull();
  });
});

const skin: SectionSkin = {
  section: 'S', inner: 'I', heading: 'H', list: 'L', item: 'IT', name: 'N', price: 'P', button: 'B',
  grid: 'G', link: 'LK', css: '.ab-sp-card{color:red}',
};
const site = (over: Record<string, unknown> = {}) => ({
  bookingUrl: '/book',
  shopUrl: '/shop',
  services: [
    { title: 'Fade', price: '30' },
    { title: '  ', price: '5' },
    { title: 'Beard <trim>', price: '' },
    { title: 'Kids cut', price: '$20' },
    { title: 'Hot towel shave', price: '40' },
  ],
  ...over,
}) as any;

describe('book strip', () => {
  it('takes up to 3 named services with their price when set', () => {
    expect(bookStripServices(site())).toEqual([
      { name: 'Fade', price: '$30' },
      { name: 'Beard <trim>', price: '' },
      { name: 'Kids cut', price: '$20' },
    ]);
  });

  it('renders only when the Book button is the site /book page', () => {
    expect(bookStripHtml(site({ bookingUrl: 'https://booksy.com/x' }), skin)).toBe('');
    expect(bookStripHtml(site({ bookingUrl: 'https://www.aibarber.org/book/x' }), skin)).toBe('');
    expect(bookStripHtml(site({ bookingUrl: undefined }), skin)).toBe('');
    const html = bookStripHtml(site(), skin);
    expect(html).toContain('id="book-online"');
    expect(html).toContain('Book online');
    expect(html).toContain('href="/book"');
    expect(html).not.toContain('target="_blank"');
  });

  it('escapes service names and prices and never prints an empty price', () => {
    const html = bookStripHtml(site(), skin);
    expect(html).toContain('Beard &lt;trim&gt;');
    expect(html).not.toContain('<trim>');
    expect(html).not.toMatch(/class="P">\s*</);
    expect(html.match(/class="IT"/g)).toHaveLength(3);
  });

  it('with no services shows the heading and the button only (no empty list)', () => {
    const html = bookStripHtml(site({ services: [] }), skin);
    expect(html).toContain('Book online');
    expect(html).toContain('href="/book"');
    expect(html).not.toContain('class="L"');
  });
});

describe('shop preview', () => {
  it('renders only when the Shop link is the site /shop page', () => {
    expect(shopPreviewHtml(site({ shopUrl: undefined }), skin)).toBe('');
    expect(shopPreviewHtml(site({ shopUrl: 'https://www.aibarber.org/shop/x' }), skin)).toBe('');
  });

  it('is hidden in the HTML (no-JS: no section), with a See all link and the loader script', () => {
    const html = shopPreviewHtml(site(), skin);
    expect(html).toMatch(/<section id="shop-preview"[^>]*\bhidden\b/);
    expect(html).toContain('href="/shop"');
    expect(html).toContain('See all');
    expect(html).toContain(SHOP_PREVIEW_SCRIPT);
    // No product markup is server-rendered; the template's card styles ride along.
    expect(html).not.toContain('class="ab-sp-card"');
    expect(html).toContain('.ab-sp-card{color:red}');
  });
});

// ---------------------------------------------------------------------------
// The loader script, run against a tiny fake DOM.
// ---------------------------------------------------------------------------
class El {
  children: El[] = [];
  attrs: Record<string, string> = {};
  className = '';
  textContent = '';
  constructor(public tag: string) {}
  setAttribute(k: string, v: string) { this.attrs[k] = String(v); }
  removeAttribute(k: string) { delete this.attrs[k]; }
  hasAttribute(k: string) { return k in this.attrs; }
  appendChild(c: El) { this.children.push(c); return c; }
}
function fakeDom() {
  const section = new El('section'); section.setAttribute('hidden', '');
  const grid = new El('div');
  const byId: Record<string, El> = { 'shop-preview': section, 'shop-preview-grid': grid };
  const document = { getElementById: (id: string) => byId[id] ?? null, createElement: (t: string) => new El(t) };
  return { document, section, grid };
}
const json = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) });
async function run(responses: Record<string, unknown>, failing: string[] = []) {
  const dom = fakeDom();
  const calls: string[] = [];
  const fetch = (url: string) => {
    calls.push(url);
    const key = url.split('?')[0];
    if (failing.includes(key)) return Promise.reject(new Error('down'));
    return key in responses ? json(responses[key]) : json({}, false);
  };
  new Function('document', 'fetch', SHOP_PREVIEW_SCRIPT)(dom.document, fetch);
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  return { ...dom, calls };
}
const products = [
  { id: 'a', name: 'Pomade <b>', priceCents: 1800, photos: ['https://img.test/a.jpg'], soldOut: false },
  { id: 'b', name: 'Comb', priceCents: 450, photos: ['javascript:alert(1)'], soldOut: false },
  { id: 'c', name: 'Gone', priceCents: 100, photos: [], soldOut: true },
  { id: 'd', name: 'Oil', priceCents: 1200, photos: [], soldOut: false },
  { id: 'e', name: 'Wax', priceCents: 999, photos: [], soldOut: false },
  { id: 'f', name: 'Brush', priceCents: 1500, photos: [], soldOut: false },
];

describe('shop preview script', () => {
  it('reads the slug from the site config, fetches the proxied store endpoint and shows up to 4 available products', async () => {
    const { section, grid, calls } = await run({
      '/ab-site.json': { slug: 'fresh-cuts' },
      '/api/store/shop': { paused: false, shop: {}, products },
    });
    expect(calls).toEqual(['/ab-site.json', '/api/store/shop?slug=fresh-cuts']);
    expect(section.hasAttribute('hidden')).toBe(false);
    expect(grid.children).toHaveLength(4);
    const [first, second] = grid.children;
    expect(first.tag).toBe('a');
    expect(first.attrs.href).toBe('/shop');
    // Names go in as text, never markup.
    const texts = (e: El): string[] => [e.textContent, ...e.children.flatMap(texts)];
    expect(texts(first)).toContain('Pomade <b>');
    expect(texts(first)).toContain('$18');
    expect(texts(second)).toContain('$4.50');
    // https photos only.
    const imgs = (e: El): El[] => [...(e.tag === 'img' ? [e] : []), ...e.children.flatMap(imgs)];
    expect(imgs(first)[0].attrs.src).toBe('https://img.test/a.jpg');
    expect(imgs(second)).toHaveLength(0);
    expect(grid.children.flatMap(texts)).not.toContain('Gone');
  });

  it('stays hidden when the store has no products, is paused, or a fetch fails', async () => {
    for (const r of [
      { '/ab-site.json': { slug: 'x' }, '/api/store/shop': { paused: false, products: [] } },
      { '/ab-site.json': { slug: 'x' }, '/api/store/shop': { paused: true, shop: { name: 'X' } } },
      { '/ab-site.json': { slug: 'x' }, '/api/store/shop': { paused: false, products: [products[2]] } },
      { '/ab-site.json': { slug: 'x' } },
      { '/ab-site.json': {} },
      {},
    ]) {
      const { section, grid } = await run(r);
      expect(section.hasAttribute('hidden')).toBe(true);
      expect(grid.children).toHaveLength(0);
    }
    const failed = await run({ '/ab-site.json': { slug: 'x' } }, ['/api/store/shop']);
    expect(failed.section.hasAttribute('hidden')).toBe(true);
  });
});
