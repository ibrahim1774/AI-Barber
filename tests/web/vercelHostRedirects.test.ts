import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { match } from 'path-to-regexp-updated'; // path-to-regexp@6, the version Vercel uses

type Cond = { type: string; key?: string; value?: string };
type Redirect = { source: string; destination: string; permanent: boolean; has?: Cond[]; missing?: Cond[] };
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../vercel.json'), 'utf8')) as { redirects: Redirect[] };

// Simulates Vercel redirects for a request: returns the destination, or null when served.
function redirectFor(url: string, host: string): string | null {
  const u = new URL(url, 'https://x.test');
  const holds = (c: Cond) => (c.type === 'host' ? c.value === host : c.type === 'query' ? u.searchParams.has(c.key!) : false);
  for (const r of cfg.redirects) {
    if (r.has && !r.has.every(holds)) continue;
    if (r.missing?.some(holds)) continue;
    const m = match(r.source, { decode: decodeURIComponent })(u.pathname);
    if (!m) continue;
    const p = (m.params as Record<string, string>).path;
    return r.destination.replace(':path', p ?? '') + (u.search && !r.destination.includes('?') ? u.search : '');
  }
  return null;
}

describe('www.aibarber.org is the old site again (existing customers sign in there)', () => {
  it('has no redirect that sends www.aibarber.org anywhere', () => {
    for (const u of ['/', '/?signin', '/privacy', '/terms', '/app', '/app/edit?paid=1', '/book/slug', '/shop', '/api/ios/publish', '/edit', '/admin', '/?stripe_session=x', '/?session_id=x', '/new', '/booksy']) {
      expect(redirectFor(u, 'www.aibarber.org'), u).toBeNull();
    }
  });

  it('www.primebarber.org / is not redirected (middleware serves the app); legacy returns and other paths untouched', () => {
    expect(redirectFor('/', 'www.primebarber.org')).toBeNull();
    for (const u of ['/?stripe_session=x', '/?payment=success', '/?stripe_cancelled=1', '/?session_id=x', '/?signin']) {
      expect(redirectFor(u, 'www.primebarber.org'), u).toBeNull();
    }
    expect(redirectFor('/privacy', 'www.primebarber.org')).toBeNull();
    expect(redirectFor('/api/x', 'www.primebarber.org')).toBeNull();
  });

  it('other hosts keep the / -> /app redirect, except the pbroot preview test', () => {
    expect(redirectFor('/?pbroot=1', 'prime-barber-ai-git-x.vercel.app')).toBeNull();
    expect(redirectFor('/', 'prime-barber-ai.vercel.app')).toBe('/app');
  });
});
