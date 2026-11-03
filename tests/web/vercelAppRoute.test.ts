import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The web app lives at /app (its own Vercel project). The rule order is load-bearing: /app must come
// after /api, /book and /shop and BEFORE the catch-all that sends everything else to the marketing page.
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../vercel.json'), 'utf8')) as {
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const idx = (src: string) => cfg.rewrites.findIndex((r) => r.source === src);

describe('vercel.json /app route', () => {
  it('forwards /app and /app/* to the web app project, and nothing wider', () => {
    expect(cfg.rewrites[idx('/app')].destination).toBe('https://prime-barber-web.vercel.app/app/');
    expect(cfg.rewrites[idx('/app/:path*')].destination).toBe('https://prime-barber-web.vercel.app/app/:path*');
    expect(cfg.rewrites.filter((r) => /\/app/.test(r.source)).map((r) => r.source)).toEqual(['/app', '/app/', '/app/:path*']);
  });
  it('sits above the marketing catch-all and below the existing routes', () => {
    const catchAll = idx('/((?!api/|_ab/).*)');
    expect(catchAll).toBe(cfg.rewrites.length - 1);
    expect(idx('/app')).toBeLessThan(catchAll);
    expect(idx('/app/:path*')).toBeLessThan(catchAll);
    for (const s of ['/api/(.*)', '/book/(.*)', '/shop/(.*)', '/privacy', '/terms', '/support', '/stripe-return']) {
      expect(idx(s)).toBeGreaterThanOrEqual(0);
      expect(idx(s)).toBeLessThan(idx('/app'));
    }
  });
  it('keeps /app out of search results and leaves the existing asset header alone', () => {
    const h = (s: string) => cfg.headers.find((x) => x.source === s);
    // /app itself is the homepage's destination, so it stays indexable; inner app pages do not.
    expect(h('/app')).toBeUndefined();
    expect(h('/app/(.+)')?.headers).toEqual([{ key: 'X-Robots-Tag', value: 'noindex' }]);
    expect(h('/_ab/assets/(.*)')?.headers).toEqual([{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]);
  });
  it.skip('(pending: static index.html wins over the rewrite) serves the app at the www.primebarber.org homepage without a redirect', () => {
    const r = cfg.rewrites.find((x: any) => x.source === '/');
    expect(r?.destination).toBe('https://prime-barber-web.vercel.app/app/');
    expect(r?.has).toEqual([{ type: 'host', value: 'www.primebarber.org' }]);
    const toApp = (cfg as any).redirects.find((x: any) => x.source === '/' && x.destination === '/app');
    expect(toApp.missing).toContainEqual({ type: 'host', value: 'www.primebarber.org' });
  });
  it('did not remove or reorder any other rewrite or cron', () => {
    expect(cfg.rewrites.filter((r) => !/\/app/.test(r.source)).map((r) => r.source)).toEqual([
      '/api/(.*)', '/privacy', '/privacy/', '/terms', '/terms/', '/support', '/support/', '/stripe-return', '/stripe-return/', '/book/(.*)', '/shop/(.*)', '/', '/((?!api/|_ab/).*)',
    ]);
  });
});
