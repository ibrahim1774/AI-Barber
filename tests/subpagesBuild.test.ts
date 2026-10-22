import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as ptr from 'path-to-regexp-updated';
import subpages, { SUBPAGES_BASE } from '../vite.subpages.config';
import { SUBPAGE_ASSET_FILE } from '../lib/siteSubpages';

const { pathToRegexp } = ptr as unknown as { pathToRegexp: (s: string, k?: any[], o?: any) => RegExp };
const matches = (source: string, p: string) => pathToRegexp(source, [], { strict: true, sensitive: true, delimiter: '/' }).test(p);

const root = process.cwd();
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

describe('the booking and shop page build', () => {
  it('is its own build under /_ab/ with only book and shop', () => {
    const c = subpages as any;
    expect(SUBPAGES_BASE).toBe('/_ab/');
    expect(c.base).toBe('/_ab/');
    expect(c.build.outDir).toBe('dist/_ab');
    expect(c.build.emptyOutDir).toBe(false);
    expect(Object.keys(c.build.rollupOptions.input).sort()).toEqual(['book', 'shop']);
  });

  it('npm run build runs both builds, main first, and Vercel is pinned to it', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts.build).toBe('vite build && vite build -c vite.subpages.config.ts');
    // Without the second build /_ab/*.html would not exist and every /book/{slug} link would 404.
    expect(cfg.buildCommand).toBe('npm run build');
  });

  it('aibarber.org serves /book/{slug} and /shop/{slug} from the /_ab/ pages, before the catch-all', () => {
    const rw: { source: string; destination: string }[] = cfg.rewrites;
    const i = (s: string) => rw.findIndex((r) => r.source === s);
    expect(rw[i('/book/(.*)')].destination).toBe('/_ab/book.html');
    expect(rw[i('/shop/(.*)')].destination).toBe('/_ab/shop.html');
    expect(i('/book/(.*)')).toBeLessThan(i('/((?!api/|_ab/).*)'));
  });

  it('a miss under /_ab/ is a 404 on aibarber.org, never the marketing SPA (it would render on barber domains)', () => {
    const rw: { source: string; destination: string }[] = cfg.rewrites;
    for (const p of ['/_ab/assets/nope.js', '/_ab/assets/..', '/_ab/assets/%2e%2e', '/_ab/x', '/_ab/']) {
      const hit = rw.find((r) => matches(r.source, p));
      expect(hit?.destination, p).not.toBe('/index.html');
      expect(hit, p).toBeUndefined();
    }
    // The SPA still owns every other path.
    expect(rw.find((r) => matches(r.source, '/pricing'))?.destination).toBe('/index.html');
    expect(rw.find((r) => matches(r.source, '/abc'))?.destination).toBe('/index.html');
  });

  it('hashed /_ab/assets are cached as immutable on aibarber.org (and so on the barber edges)', () => {
    const h = (cfg.headers || []).find((x: any) => x.source === '/_ab/assets/(.*)');
    expect(h.headers).toEqual([{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]);
  });

  const built = path.join(root, 'dist/_ab');
  it.skipIf(!fs.existsSync(path.join(built, 'book.html')))('built pages reference only /_ab/ assets (run after npm run build)', () => {
    for (const f of ['book.html', 'shop.html']) {
      const html = fs.readFileSync(path.join(built, f), 'utf8');
      const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
      expect(refs.length).toBeGreaterThan(0);
      for (const r of refs) expect(r.startsWith('/_ab/assets/'), `${f}: ${r}`).toBe(true);
    }
    const assetName = new RegExp(`^${SUBPAGE_ASSET_FILE}$`);
    for (const f of fs.readdirSync(path.join(built, 'assets'))) {
      // Every emitted file is one the barber sites proxy (lib/siteSubpages.ts SUBPAGE_ASSET_FILE).
      expect(assetName.test(f), `dist/_ab/assets/${f} would not be proxied`).toBe(true);
      const src = fs.readFileSync(path.join(built, 'assets', f), 'utf8');
      // No absolute /assets/ (main build) references and no aibarber.org URLs in the pages' code.
      expect(src, f).not.toMatch(/["'(]\/assets\//);
      expect(src, f).not.toMatch(/https?:\/\/(www\.)?aibarber\.org/);
    }
  });
});
