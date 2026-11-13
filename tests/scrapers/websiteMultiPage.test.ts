// Multi-page website import against saved copies of a real static site (tests/fixtures/website-real-*.html).
// No network: fetch is stubbed, unrouted requests throw.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scrapeWebsiteUrl } from '../../lib/scrapers/index';
import { aboutTextFromHtml, pickSubPages, removeBooksy } from '../../lib/scrapers/website';
import handler from '../../api/import-scrape';

const fx = (n: string) => readFileSync(join(__dirname, '..', 'fixtures', `website-real-${n}.html`), 'utf8');
afterEach(() => vi.unstubAllGlobals());

type Reply = { status?: number; body?: string; headers?: Record<string, string> };
function stub(routes: Record<string, Reply>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: any) => {
    const url = String(input);
    calls.push(url);
    const r = routes[url];
    if (!r) throw new Error(`unrouted fetch in test: ${url}`);
    const status = r.status ?? 200;
    const headers = new Map(Object.entries({ 'content-type': 'text/html; charset=utf-8', ...(r.headers || {}) }).map(([k, v]) => [k.toLowerCase(), v]));
    return { ok: status < 300, status, url, headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null }, text: async () => r.body ?? '' } as any;
  });
  return calls;
}
const deps = { resolve: async () => ['93.184.216.34'] };
const SITE = 'https://cutz.example';
const routes = (): Record<string, Reply> => ({
  [`${SITE}/`]: { body: fx('index') },
  [`${SITE}/services.html`]: { status: 301, headers: { location: '/services' } },
  [`${SITE}/services`]: { body: fx('services') },
  [`${SITE}/gallery.html`]: { body: fx('gallery') },
  [`${SITE}/about.html`]: { body: fx('about') },
});

const EXPECTED = [
  ["Men's Haircut/ Without Enhancements", '$35', '30 min'],
  ["Kid's Haircut (12 & Under) Mon-Wed Only", '$15', '30 min'],
  ['Kids (12 and up)', '$25', '30 min'],
  ['Beard Line Up', '$20', '20 min'],
  ['Temp fade and line up', '$30', '30 min'],
  ['Kids even all over haircut Mon-Wed Only', '$15', '30 min'],
  ['Military Haircuts (Mens) Mon-Wed', '$25', '30 min'],
  ['Bald head w/razor and hot towel service', '$45', '1 hr'],
  ['Women haircuts', '$30', '30 min'],
  ['Bald head(clippers only) w/ beard line up', '$30', '30 min'],
  ['Kids line up', '$10', '10 min'],
  ['Men’s line up', '$15', '10 min'],
  ['Men Full Haircut Thurs-Sunday', '$42', '30 min'],
  ['Kids Haircut (11 And Under)', '$20', '30 min'],
  ['Facial', '$10', '5 min'],
  ['Seniors HAIRCUT (62 Or Older)', '$20', '30 min'],
  ['Men’s Haircut (new customer only)', '$25+', '30 min'],
  ['Kids haircut (new customer only)', '$15', '30 min'],
];

describe('real multi-page site (saved fixtures)', () => {
  it('picks services, gallery, about from the entry page links', () => {
    expect(pickSubPages(fx('index'), `${SITE}/`).map((p) => [p.kind, p.url])).toEqual([
      ['services', `${SITE}/services.html`], ['gallery', `${SITE}/gallery.html`], ['about', `${SITE}/about.html`],
    ]);
  });

  it('imports the exact service list, no promo prices, no Booksy, about paragraph as description', async () => {
    const calls = stub(routes());
    const { shop } = await scrapeWebsiteUrl(SITE, {}, deps);
    expect(calls).toContain(`${SITE}/services`); // the services.html redirect was followed
    expect(shop.services.map((s) => [s.title, s.price, s.duration])).toEqual(EXPECTED);
    const all = JSON.stringify(shop);
    for (const promo of ['35.70', '29.75', '12.75', '17', '21.25', '38.25', '25.50']) expect(shop.services.some((s) => s.price?.includes(promo))).toBe(false);
    expect(shop.services.find((s) => s.title === 'Facial')?.description).toBe('Clean up and massage face');
    expect(shop.services.some((s) => /booksy/i.test(s.description || ''))).toBe(false);
    expect(all).not.toMatch(/booksy\.com/i);
    expect(shop.description).not.toMatch(/booksy/i);
    expect(shop.description!.length).toBeLessThanOrEqual(400);
    expect(shop.description).toBe('Cutz by Ant Da Barber is a one-barber shop at 2601 Dawson Road, Suite C10 in Albany, Georgia. No revolving door, no rushed fades for the next chair — just Ant, taking the time to get it right.');
    expect(shop.phone).toBe('(229) 449-6675');
    expect(shop.photos.length).toBeGreaterThanOrEqual(12);
    expect(shop.photos.length).toBeLessThanOrEqual(20);
  });

  it('a failed sub-page is ignored', async () => {
    const r = routes();
    delete r[`${SITE}/gallery.html`];
    delete r[`${SITE}/about.html`];
    stub(r);
    const { shop } = await scrapeWebsiteUrl(SITE, {}, deps);
    expect(shop.services).toHaveLength(EXPECTED.length);
    expect(shop.description).not.toMatch(/booksy/i);
  });

  it('a sub-page redirecting off the site is dropped', async () => {
    const r = routes();
    r[`${SITE}/about.html`] = { status: 302, headers: { location: 'https://other.example/about' } };
    const calls = stub({ ...r, 'https://other.example/about': { body: '<p>Evil text that is long enough to be a paragraph of the about page ok.</p>' } });
    const { shop } = await scrapeWebsiteUrl(SITE, {}, deps);
    expect(shop.description).not.toMatch(/Evil/);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('never fetches more than 4 sub-pages', () => {
    const links = ['services', 'menu', 'pricing', 'gallery', 'photos', 'about', 'about-us'].map((p) => `<a href="/${p}">${p}</a>`).join('');
    expect(pickSubPages(links, `${SITE}/`).length).toBeLessThanOrEqual(4);
  });
});

describe('Booksy text cleanup', () => {
  it('removes references', () => {
    expect(removeBooksy('5.0 rating on 83 Booksy reviews. Haircut $35 — Booksy promo pricing online. Book on Booksy or call (229) 449-6675.')).toBe('5.0 rating on 83 reviews. Haircut $35.');
  });
  it('about text: first real paragraph, within 400 chars', () => {
    expect(aboutTextFromHtml(fx('about'))).toMatch(/^Cutz by Ant Da Barber is a one-barber shop/);
  });
});

describe('CORS on api/import-scrape', () => {
  const call = async (method: string, headers: any, body: any = {}) => {
    const res: any = { code: 0, headers: {} as any, ended: false };
    res.status = (c: number) => { res.code = c; return res; };
    res.json = (j: any) => { res.out = j; return res; };
    res.end = () => { res.ended = true; return res; };
    res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
    await handler({ method, body, headers } as any, res);
    return res;
  };
  it('answers the staging preflight with 204 and allow headers', async () => {
    const r = await call('OPTIONS', { origin: 'https://prime-barber-app.vercel.app' });
    expect(r.code).toBe(204);
    expect(r.headers['Access-Control-Allow-Origin']).toBe('https://prime-barber-app.vercel.app');
    expect(r.headers['Access-Control-Allow-Methods']).toMatch(/POST/);
    expect(r.headers['Access-Control-Allow-Headers']).toMatch(/Content-Type/);
  });
  it('sets allow-origin on error replies; no Origin header = no CORS headers', async () => {
    const a = await call('POST', { origin: 'https://prime-barber-app.vercel.app', 'x-real-ip': '203.0.113.50' }, {});
    expect(a.code).toBe(400);
    expect(a.headers['Access-Control-Allow-Origin']).toBe('https://prime-barber-app.vercel.app');
    const b = await call('POST', { 'x-real-ip': '203.0.113.51' }, {});
    expect(b.code).toBe(400);
    expect(b.headers['Access-Control-Allow-Origin']).toBeUndefined();
    const c = await call('POST', { origin: 'https://evil.example', 'x-real-ip': '203.0.113.52' }, {});
    expect(c.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });
});
