import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { match } from 'path-to-regexp-updated'; // path-to-regexp@6, the version Vercel uses

type Redirect = { source: string; destination: string; permanent: boolean; has?: { type: string; value?: string }[]; missing?: { type: string; key: string }[] };
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../vercel.json'), 'utf8')) as { redirects: Redirect[] };
const hostRules = cfg.redirects.filter((r) => r.has?.some((h) => h.type === 'host' && h.value === 'www.aibarber.org'));

// Simulates Vercel for a request to www.aibarber.org: returns the redirect destination, or null when served.
function redirectFor(url: string, host = 'www.aibarber.org'): string | null {
  const u = new URL(url, 'https://x.test');
  for (const r of cfg.redirects) {
    if (r.has && !r.has.every((h) => h.type !== 'host' || h.value === host)) continue;
    if (r.missing?.some((m) => m.type === 'query' && u.searchParams.has(m.key))) continue;
    const m = match(r.source, { decode: decodeURIComponent })(u.pathname);
    if (!m) continue;
    const p = (m.params as Record<string, string>).path;
    return r.destination.replace(':path', p ?? '') + (u.search && !r.destination.includes('?') ? u.search : '');
  }
  return null;
}

describe('www.aibarber.org host redirects', () => {
  it('has the two host rules first, both temporary (307) for now', () => {
    expect(cfg.redirects.slice(0, 2)).toEqual(hostRules);
    expect(hostRules).toHaveLength(2);
    for (const r of hostRules) expect(r.permanent).toBe(false);
  });

  it('keeps serving every path that iOS, published sites, Stripe, crons and calendars depend on', () => {
    const kept = [
      '/api/book/x', '/api/store/x', '/api/stripe-webhook', '/api/ios/publish', '/api/book/ics?t=abc', '/api/web-app/webhook',
      '/_ab/assets/book-abc.js', '/assets/index-abc.js', '/assets/vendor-react.js',
      '/book', '/book/slug', '/shop', '/shop/slug',
      '/stripe-return', '/stripe-return/', '/stripe-return.html',
      '/learn-clips/buttons.jpg', '/learn-clips/a.mp4',
      '/google6479dff46419de0d.html',
      '/edit', '/admin',
      '/?stripe_session=x', '/?payment=success', '/?stripe_cancelled=1', '/?session_id=x',
    ];
    for (const u of kept) expect(redirectFor(u), u).toBeNull();
  });

  it('redirects pages to the same path on www.primebarber.org, query kept', () => {
    expect(redirectFor('/')).toBe('https://www.primebarber.org/');
    expect(redirectFor('/privacy')).toBe('https://www.primebarber.org/privacy');
    expect(redirectFor('/terms')).toBe('https://www.primebarber.org/terms');
    expect(redirectFor('/support')).toBe('https://www.primebarber.org/support');
    expect(redirectFor('/app')).toBe('https://www.primebarber.org/app');
    expect(redirectFor('/app/edit?paid=1')).toBe('https://www.primebarber.org/app/edit?paid=1');
    expect(redirectFor('/new')).toBe('https://www.primebarber.org/new');
    expect(redirectFor('/booksy')).toBe('https://www.primebarber.org/booksy');
    expect(redirectFor('/home-2')).toBe('https://www.primebarber.org/home-2');
    expect(redirectFor('/bookings')).toBe('https://www.primebarber.org/bookings');
    expect(redirectFor('/free-barber?utm=a')).toBe('https://www.primebarber.org/free-barber?utm=a');
  });

  it('never redirects on any other host (www.primebarber.org keeps its own / to /app rule)', () => {
    expect(redirectFor('/privacy', 'www.primebarber.org')).toBeNull();
    expect(redirectFor('/api/x', 'www.primebarber.org')).toBeNull();
    expect(redirectFor('/', 'www.primebarber.org')).toBe('/app');
  });
});
