// Review fixes for the website importer: card services, photos, shop name, cost bounds, robustness. No network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { htmlToLines, imagesFrom, parseWebsiteHtml, phoneFrom, emailFrom, servicesFromLines, stripSeoTail } from '../../lib/scrapers/website';
import { finalize, runApifyWebScraper } from '../../lib/scrapers/util';
import { fetchPublicHtml, isPrivateAddress, parseWebsiteUrl } from '../../lib/scrapers/safeFetch';
import { scrapeWebsiteUrl } from '../../lib/scrapers/index';
import { ScrapeError } from '../../lib/scrapers/types';
import { allowApifyFallback } from '../../api/import-scrape';

const fx = (n: string) => readFileSync(join(__dirname, '..', 'fixtures', n), 'utf8');
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('services from card markup', () => {
  it('finds exactly the 4 cards and none of the junk lines', () => {
    const s = servicesFromLines(htmlToLines(fx('website-cards.html')));
    expect(s.map((x) => [x.title, x.price])).toEqual([
      ['Classic Haircut', '$25'], ['Beard Trim', '$15'], ['Hot Towel Shave', '$40'], ['Kids Cut', '$20'],
    ]);
    expect(s[0].duration).toBeTruthy();
  });
  it('rejects prose with a price', () => {
    expect(servicesFromLines(['Deposit of $10 required', 'Save $10', 'Gift cards $25', 'Tip $5'])).toEqual([]);
  });
});

describe('photos', () => {
  const base = 'https://shop.example/';
  const nx = (u: string, w: number) => `<img src="/_next/image?url=${encodeURIComponent(u)}&w=${w}&q=75" width="800" height="600">`;
  it('a Next.js gallery of 3 stays 3 and returns the underlying URL', () => {
    const html = nx('/g/a.jpg', 640) + nx('/g/b.jpg', 640) + nx('/g/c.jpg', 640);
    const shop = parseWebsiteHtml(`<title>Shop</title><a href="tel:2125550142">x</a>${html}`, base)!;
    expect(shop.photos).toEqual(['https://shop.example/g/a.jpg', 'https://shop.example/g/b.jpg', 'https://shop.example/g/c.jpg']);
  });
  it('finalize keys cross-site _next/image URLs on the decoded url=', () => {
    const mk = (u: string, w: number) => `https://shop.example/_next/image?url=${encodeURIComponent(u)}&w=${w}`;
    const out = finalize({ shopName: 'x', area: '', address: '', services: [], reviews: [], hours: [], staff: [],
      photos: [mk('https://cdn.other.example/a.jpg', 640), mk('https://cdn.other.example/a.jpg', 1080), mk('https://cdn.other.example/b.jpg', 640), mk('https://cdn.other.example/c.jpg', 640)] } as any);
    expect(out.photos).toHaveLength(3);
  });
  it('decodes &quot; in CSS url()', () => {
    const html = '<div style="background-image:url(&quot;https://cdn.shop.example/hero.jpg&quot;)"></div>';
    expect(imagesFrom(html, base)).toEqual(['https://cdn.shop.example/hero.jpg']);
  });
  it('drops icons by class/alt and small width/height', () => {
    const html = [
      '<img src="/a/one.jpg" class="nav-icon" width="400">', '<img src="/a/two.jpg" alt="Our logo">',
      '<img src="/a/three.jpg" width="120" height="120">', '<img src="/a/four.jpg" width="800" height="600">',
    ].join('');
    expect(imagesFrom(html, base)).toEqual(['https://shop.example/a/four.jpg']);
  });
});

describe('shop name', () => {
  it('strips the SEO tail, keeps the first non-generic segment', () => {
    expect(stripSeoTail('Cardinal Cuts | Best fades in Brooklyn')).toBe('Cardinal Cuts');
    expect(stripSeoTail('Cardinal Cuts - Barbers')).toBe('Cardinal Cuts');
    expect(stripSeoTail('Cardinal Cuts – NYC · Open daily')).toBe('Cardinal Cuts');
    expect(stripSeoTail('Home | Cardinal Cuts')).toBe('Cardinal Cuts');
    expect(stripSeoTail('Welcome')).toBe('');
  });
  it('parseWebsiteHtml uses it, and never sets bookingUrl', () => {
    const shop = parseWebsiteHtml(fx('website-cards.html'), 'https://cardinal.example/')!;
    expect(shop.shopName).toBe('Cardinal Cuts');
    expect((shop as any).bookingUrl).toBeUndefined();
  });
});

describe('robustness', () => {
  it('malformed % in tel: / mailto: never throws', () => {
    expect(() => phoneFrom('<a href="tel:%E0%A4%A">x</a>', [])).not.toThrow();
    expect(() => emailFrom('<a href="mailto:a%zz@b.com">x</a>')).not.toThrow();
    expect(emailFrom('<a href="mailto:hi@b.com">x</a>')).toBe('hi@b.com');
  });
  it('blocks fec0::/10 and 2001:db8::/32', () => {
    for (const ip of ['fec0::1', 'feff::1', '2001:db8::1', '2001:db8:ffff::2']) expect(isPrivateAddress(ip), ip).toBe(true);
    expect(isPrivateAddress('2001:4860:4860::8888')).toBe(false);
  });
  it('error messages stay at 120 characters or less and keep their code', async () => {
    for (const u of ['http://example.com:22/', 'https://user:pw@example.com/', 'ftp://x.example/', 'http://printer.local/', 'http://[fd00::1]/']) {
      try { parseWebsiteUrl(u); throw new Error('no throw'); } catch (e: any) { expect(e.message.length, e.message).toBeLessThanOrEqual(120); expect(e.code).toBe('blocked_url'); }
    }
    vi.stubGlobal('fetch', async () => ({ status: 200, headers: { get: (k: string) => (k === 'content-type' ? 'text/html' : null) }, text: async () => '<title>Home</title>' }));
    const err: any = await scrapeWebsiteUrl('https://empty.example', {}, { resolve: async () => ['93.184.216.34'] }).catch((e) => e);
    expect(err).toBeInstanceOf(ScrapeError);
    expect(err.code).toBe('no_data');
    expect(err.message.length).toBeLessThanOrEqual(120);
  });
});

describe('Apify cost bounds', () => {
  it('waits at most 45 s for the run', async () => {
    const shell = '<html><body><div id="root"></div></body></html>';
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (u: any) => {
      calls.push(String(u));
      if (/apify/.test(String(u))) return { ok: true, status: 200, json: async () => [] };
      return { status: 200, headers: { get: () => 'text/html' }, text: async () => shell };
    });
    await scrapeWebsiteUrl('https://spa.example', { apifyToken: 't' }, { resolve: async () => ['93.184.216.34'] }).catch(() => {});
    expect(calls.find((c) => /apify/.test(c))).toMatch(/timeout=45\b/);
  });
  it('apifyAllow=false skips the run and gives no_data', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (u: any) => { calls.push(String(u)); return { status: 200, headers: { get: () => 'text/html' }, text: async () => '<html><body></body></html>' }; });
    const err: any = await scrapeWebsiteUrl('https://spa2.example', { apifyToken: 't', apifyAllow: () => false }, { resolve: async () => ['93.184.216.34'] }).catch((e) => e);
    expect(err.code).toBe('no_data');
    expect(calls.some((c) => /apify/.test(c))).toBe(false);
  });
  it('global daily cap and per-URL 24 h memory', async () => {
    vi.stubEnv('WEBSITE_IMPORT_APIFY_DAILY_CAP', '2');
    const now = Date.now();
    expect(await allowApifyFallback('https://cap-a.example/', now)).toBe(true);
    expect(await allowApifyFallback('https://cap-a.example/', now + 1000)).toBe(true); // 2nd run of the same URL is fine
    expect(await allowApifyFallback('https://cap-c.example/', now)).toBe(false); // global cap of 2 used up
    vi.stubEnv('WEBSITE_IMPORT_APIFY_DAILY_CAP', '100');
    expect(await allowApifyFallback('https://cap-a.example/', now + 2000)).toBe(true); // 3rd
    expect(await allowApifyFallback('https://cap-a.example/', now + 3000)).toBe(false); // 4th within 24 h
  });
});
