// Website import: parsing fixtures, the Apify fallback (mocked), the SSRF guard, and the endpoint. No network, no Apify,
// no Google Places: fetch is stubbed per test and any unrouted request throws.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { vi as _vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scrapeWebsiteUrl } from '../../lib/scrapers/index';
import { hoursFromLines, htmlToLines, parseWebsiteHtml, servicesFromLines } from '../../lib/scrapers/website';
import { MAX_HTML_BYTES, fetchPublicHtml, isPrivateAddress, parseWebsiteUrl } from '../../lib/scrapers/safeFetch';
import { ScrapeError } from '../../lib/scrapers/types';
import handler from '../../api/import-scrape';

const fx = (n: string) => readFileSync(join(__dirname, '..', 'fixtures', n), 'utf8');
afterEach(() => vi.unstubAllGlobals());

type Reply = { status?: number; body?: string | Uint8Array; headers?: Record<string, string> };
/** Stub fetch: `routes` by exact URL. Replies carry headers (content-type, location). Unrouted = throw. */
function stub(routes: Record<string, Reply | ((init: any) => Reply)>) {
  const calls: { url: string; init: any }[] = [];
  vi.stubGlobal('fetch', async (input: any, init?: any) => {
    const url = String(input);
    calls.push({ url, init });
    const r0 = routes[url];
    if (!r0) throw new Error(`unrouted fetch in test: ${url}`);
    const r = typeof r0 === 'function' ? r0(init) : r0;
    const status = r.status ?? 200;
    const headers = new Map(Object.entries({ 'content-type': 'text/html; charset=utf-8', ...(r.headers || {}) }).map(([k, v]) => [k.toLowerCase(), v]));
    const text = typeof r.body === 'string' ? r.body : Buffer.from(r.body ?? '').toString('utf8');
    return { ok: status < 300, status, url, headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null }, text: async () => text, json: async () => JSON.parse(text) } as any;
  });
  return { calls, apify: () => calls.filter((c) => /apify\.com/.test(c.url)), places: () => calls.filter((c) => /googleapis\.com/.test(c.url)) };
}
const PUBLIC = async () => ['93.184.216.34'];
const deps = { resolve: PUBLIC };
const page = (body: string, extra: Reply = {}) => ({ body, ...extra });

describe('JSON-LD static site', () => {
  it('reads name, phone, address, hours, services, photos, logo, socials, email; no paid calls', async () => {
    const net = stub({ 'https://sharpedge.example/': page(fx('website-jsonld.html')) });
    const { platform, shop } = await scrapeWebsiteUrl('sharpedge.example', { apifyToken: 'tok' }, deps);
    expect(platform).toBe('website');
    expect(shop.shopName).toBe('Sharp Edge Barbers');
    expect(shop.phone).toBe('(212) 555-0142');
    expect(shop.address).toBe('41 Main St, Brooklyn, NY, 11201');
    expect(shop.area).toBe('Brooklyn, NY');
    expect(shop.hours?.find((h) => h.day === 'Wednesday')).toEqual({ day: 'Wednesday', open: '09:00', close: '18:00' });
    expect(shop.hours?.find((h) => h.day === 'Sunday')?.closed).toBe(true);
    expect(shop.services.map((s) => s.title)).toEqual(['Classic Haircut', 'Beard Trim']);
    expect(shop.services[0].price).toBe('$35');
    expect(shop.photos).toContain('https://sharpedge.example/img/hero.jpg');
    expect(shop.photos).toContain('https://cdn.sharpedge.example/shop2.jpg');
    expect(shop.photos).toContain('https://sharpedge.example/img/shop1.jpg');
    // private-IP / metadata / gif / logo images are dropped
    expect(shop.photos.join(' ')).not.toMatch(/10\.0\.0\.5|169\.254|spinner|logo/);
    expect(shop.logo).toBe('https://sharpedge.example/logo.png');
    expect(shop.socials).toEqual({ instagram: 'https://www.instagram.com/sharpedgebk' });
    expect(shop.email).toBe('hello@sharpedge.example');
    expect(net.apify()).toHaveLength(0);
    expect(net.places()).toHaveLength(0);
  });
});

describe('plain HTML heuristics', () => {
  it('price lines, hours table, address, tel, social', async () => {
    const net = stub({ 'https://mikescuts.example/': page(fx('website-plain.html')) });
    const { shop } = await scrapeWebsiteUrl('https://mikescuts.example', {}, deps);
    expect(shop.shopName).toBe("Mike's Cuts");
    const byTitle = Object.fromEntries(shop.services.map((s) => [s.title, s]));
    expect(byTitle["Men's Haircut"].price).toBe('$30');
    expect(byTitle['Skin Fade']).toMatchObject({ price: '$40+', duration: '45 min' });
    expect(byTitle['Kids Cut'].price).toBe('$22'); // price on the next line
    expect(byTitle['Beard Trim'].price).toBe('$15 - $20');
    expect(shop.services.some((s) => /cash and cards/.test(s.title))).toBe(false);
    expect(shop.hours?.find((h) => h.day === 'Thursday')).toEqual({ day: 'Thursday', open: '09:00', close: '19:00' });
    expect(shop.hours?.find((h) => h.day === 'Saturday')).toEqual({ day: 'Saturday', open: '10:00', close: '16:00' });
    expect(shop.hours?.find((h) => h.day === 'Sunday')?.closed).toBe(true);
    expect(shop.address).toBe('1200 Congress Ave, Austin, TX, 78701');
    expect(shop.area).toBe('Austin, TX');
    expect(shop.phone).toBe('(512) 555-0199');
    expect(shop.socials?.instagram).toBe('https://instagram.com/mikescuts');
    expect(shop.photos).toEqual(['https://images.example.com/chair.jpg']);
    expect(net.apify()).toHaveLength(0);
  });

  it('heuristics units: 9-5pm infers am, "Fri-Mon" wraps, closed-only gives no hours', () => {
    expect(hoursFromLines(['Mon - Fri 9 - 5pm'])?.[0]).toEqual({ day: 'Monday', open: '09:00', close: '17:00' });
    expect(hoursFromLines(['Sunday: Closed'])).toEqual([]);
    expect(servicesFromLines(['Fade $35', 'Fade $50', 'Total: $90'])).toHaveLength(1);
    expect(htmlToLines('<p>a<script>x</script></p><style>b</style><div>c &amp; d</div>')).toEqual(['a', 'c & d']);
  });
});

describe('JS-rendered shell -> Apify fallback (mocked)', () => {
  it('runs Apify once and parses the rendered HTML', async () => {
    const net = stub({
      'https://shell.example/': page(fx('website-shell.html')),
      // Recorded shape of run-sync-get-dataset-items output
      [`https://api.apify.com/v2/acts/apify~web-scraper/run-sync-get-dataset-items?token=tok&clean=1&timeout=45`]: page(JSON.stringify([{ html: fx('website-rendered.html'), photos: ['https://cdn.shell.example/g1.jpg', 'http://10.1.1.1/x.jpg'] }]), { headers: { 'content-type': 'application/json' } }),
    });
    const { shop } = await scrapeWebsiteUrl('https://shell.example', { apifyToken: 'tok' }, deps);
    expect(net.apify()).toHaveLength(1);
    expect(shop.shopName).toBe('Rendered Cuts');
    expect(shop.services[0]).toMatchObject({ title: 'Haircut', price: '$25' });
    expect(shop.phone).toBe('(518) 555-0123');
    expect(shop.photos).toEqual(['https://cdn.shell.example/g1.jpg']);
  });

  it('no token: clean no_data error, no Apify call', async () => {
    const net = stub({ 'https://shell.example/': page(fx('website-shell.html')) });
    await expect(scrapeWebsiteUrl('https://shell.example', {}, deps)).rejects.toMatchObject({ code: 'no_data' });
    expect(net.apify()).toHaveLength(0);
  });

  it('Apify returns nothing useful: still no_data, and only ONE run', async () => {
    const net = stub({
      'https://shell.example/': page(fx('website-shell.html')),
      'https://api.apify.com/v2/acts/apify~web-scraper/run-sync-get-dataset-items?token=tok&clean=1&timeout=45': page('[]'),
    });
    await expect(scrapeWebsiteUrl('https://shell.example', { apifyToken: 'tok' }, deps)).rejects.toBeInstanceOf(ScrapeError);
    expect(net.apify()).toHaveLength(1);
  });
});

describe('SSRF guard', () => {
  it.each([
    'http://127.0.0.1/', 'http://localhost/', 'http://10.0.0.1/', 'http://192.168.1.5/', 'http://172.16.0.1/', 'http://169.254.169.254/latest/meta-data',
    'http://[::1]/', 'http://[fd00::1]/', 'http://[::ffff:127.0.0.1]/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://100.64.0.1/',
    'ftp://example.com/', 'file:///etc/passwd', 'https://example.com:8443/', 'http://example.com:22/', 'https://user:pw@example.com/', 'http://intranet/', 'http://printer.local/',
  ])('refuses %s without any request', async (u) => {
    const net = stub({});
    await expect(fetchPublicHtml(u, deps)).rejects.toMatchObject({ code: 'blocked_url' });
    expect(net.calls).toHaveLength(0);
  });

  it('isPrivateAddress table', () => {
    for (const ip of ['0.0.0.0', '127.0.0.1', '10.2.3.4', '172.31.1.1', '192.168.0.1', '169.254.1.1', '224.0.0.1', '::', '::1', 'fe80::1', 'fc00::1', '::ffff:10.0.0.1', '64:ff9b::7f00:1']) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('refuses a public-looking name that resolves to a private address', async () => {
    const net = stub({});
    await expect(fetchPublicHtml('https://evil.example/', { resolve: async () => ['93.184.216.34', '10.0.0.7'] })).rejects.toMatchObject({ code: 'blocked_url' });
    expect(net.calls).toHaveLength(0);
  });

  it('refuses a redirect to a private IP, and one that resolves privately; follows a safe one', async () => {
    const net = stub({
      'https://a.example/': { status: 302, headers: { location: 'http://169.254.169.254/latest' } },
      'https://b.example/': { status: 301, headers: { location: 'https://internal.example/' } },
      'https://c.example/': { status: 301, headers: { location: '/home' } },
      'https://c.example/home': page('<title>ok</title>'),
    });
    const resolve = async (h: string) => (h === 'internal.example' ? ['10.9.9.9'] : ['93.184.216.34']);
    await expect(fetchPublicHtml('https://a.example/', { resolve })).rejects.toMatchObject({ code: 'blocked_url' });
    await expect(fetchPublicHtml('https://b.example/', { resolve })).rejects.toMatchObject({ code: 'blocked_url' });
    expect(net.calls.map((c) => c.url)).not.toContain('http://169.254.169.254/latest');
    expect((await fetchPublicHtml('https://c.example/', { resolve })).finalUrl).toBe('https://c.example/home');
    expect(net.calls.every((c) => c.init.redirect === 'manual')).toBe(true);
  });

  it('stops after 3 redirects', async () => {
    stub(Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`https://loop.example/${i || ''}`, { status: 302, headers: { location: `/${i + 1}` } }])));
    await expect(fetchPublicHtml('https://loop.example/', deps)).rejects.toMatchObject({ code: 'fetch_failed' });
  });

  it('rejects non-HTML, oversize (declared and streamed), bad status and timeouts', async () => {
    stub({
      'https://pdf.example/': page('%PDF', { headers: { 'content-type': 'application/pdf' } }),
      'https://big.example/': page('x', { headers: { 'content-length': String(MAX_HTML_BYTES + 1) } }),
      'https://big2.example/': page('x'.repeat(MAX_HTML_BYTES + 1)),
      'https://gone.example/': { status: 404, body: 'no' },
    });
    await expect(fetchPublicHtml('https://pdf.example/', deps)).rejects.toMatchObject({ code: 'not_html' });
    await expect(fetchPublicHtml('https://big.example/', deps)).rejects.toMatchObject({ code: 'too_large' });
    await expect(fetchPublicHtml('https://big2.example/', deps)).rejects.toMatchObject({ code: 'too_large' });
    await expect(fetchPublicHtml('https://gone.example/', deps)).rejects.toMatchObject({ code: 'fetch_failed' });
    vi.stubGlobal('fetch', (_u: any, init: any) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))));
    await expect(fetchPublicHtml('https://slow.example/', { resolve: PUBLIC, timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('parseWebsiteUrl adds https and keeps a path', () => {
    expect(parseWebsiteUrl('shop.example/about').toString()).toBe('https://shop.example/about');
  });
});

describe('api/import-scrape with source website', () => {
  const call = async (body: any, ip = '203.0.113.9') => {
    const res: any = { code: 0, json: null, headers: {} as any };
    res.status = (c: number) => { res.code = c; return res; };
    res.json = (j: any) => { res.out = j; return res; };
    res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
    await handler({ method: 'POST', body, headers: { 'x-real-ip': ip } } as any, res);
    return res;
  };

  it('blocked URL -> 422 {error, code} and no fetch', async () => {
    const net = stub({});
    const r = await call({ url: 'http://127.0.0.1/', source: 'website' });
    expect(r.code).toBe(422);
    expect(r.out).toMatchObject({ code: 'blocked_url' });
    expect(typeof r.out.error).toBe('string');
    expect(net.calls).toHaveLength(0);
  });

  it('without source the booking path is unchanged (generic site is not a supported booking site)', async () => {
    const r = await call({ url: 'https://mikescuts.example/' });
    expect(r.code).toBe(422);
    expect(r.out.error).toMatch(/don't recognise that booking site/);
    expect(r.out.code).toBeUndefined();
  });

  it('rate limits website imports per IP (429)', async () => {
    stub({});
    let last: any;
    for (let i = 0; i < 8; i++) last = await call({ url: 'http://localhost/', source: 'website' }, '198.51.100.77');
    expect(last.code).toBe(429);
    expect(last.headers['Retry-After']).toBe('60');
  });

  it('missing url -> 400', async () => {
    expect((await call({ source: 'website' })).code).toBe(400);
  });
});
